# Spec: Code indexer

**Feature doc:** [../features/code-indexer.md](../features/code-indexer.md)
**TS source:** `src/code-indexer.ts`
**Go package:** `internal/codeindex`

## Scope

This spec covers the code-indexing coordinator: its public surface,
the parser interface, the language-detection map, the file-to-document
conversion pipeline, the collection walker, and the `CODE_ROOT`
gating. Language-specific extraction details live in
[language-parsers.md](./language-parsers.md).

**In scope**

- `codeindex.Parser` interface and registry
- `IsCodeFile`, `DetectLanguage`, `IndexFile`, `IndexCollection`
- Extension → language id map
- `doc_id` construction
- Facet auto-population (`language`, `content_type`, `symbol_kind`)
- Empty-file fallback (one synthetic root node)
- Content-hashing for incremental reindex
- Batch parallelism and error quarantine
- `CODE_ROOT` / `CODE_COLLECTION` / `CODE_WEIGHT` / `CODE_GLOB`
  environment variables (see `CLAUDE.md` for defaults; fully specified
  in `spec/environment.md`)

**Out of scope**

- Per-language parsing rules (see `language-parsers.md`)
- BM25 scoring (see `spec/bm25-engine.md`)
- MCP tool schemas (see `spec/mcp-tools.md`)
- Path containment (see `spec/safepath.md`)

## Types

```go
package codeindex

import (
    "context"
    "sync"

    "github.com/treenavmcp/treenav-mcp/internal/types"
)

// DefaultCodeGlob is the fallback glob when CollectionConfig.GlobPattern
// is empty. Mirrors CODE_GLOB at src/code-indexer.ts:80 verbatim.
const DefaultCodeGlob = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,py,pyi,go,rs,java,kt,scala,c,cpp,cc,h,hpp,cs,rb,swift,php,lua,sh,bash,zsh}"

// Parser is the contract language parsers satisfy.
type Parser interface {
    Extensions() []string
    Parse(path, source, docID string) ([]types.TreeNode, error)
}

// Registry is a thread-safe extension → Parser map. A single package
// default Registry is created at init time; parsers plug themselves in.
type Registry struct {
    mu       sync.RWMutex
    byExt    map[string]Parser  // key = lowercased extension with leading dot
    fallback Parser             // generic parser
}
```

Notes:

- `byExt` is populated by `Register`; once the binary's `main.init()`
  has finished, the map is read-only. The `sync.RWMutex` protects the
  registry during registration and is held in read mode by `Lookup`.
- `fallback` is set to the generic parser by its own `init()` via
  `SetFallback(p Parser)` (internal helper). Phase C must guarantee
  `fallback != nil` before `IndexFile` is called.

## Functions

### `func IsCodeFile(path string) bool`

**Signature**

```go
func IsCodeFile(path string) bool
```

**Preconditions**

- None. `path` may be empty or absolute or relative.

**Behavior**

1. Take `ext := strings.ToLower(filepath.Ext(path))`.
2. Return `true` iff any registered parser (including the fallback)
   claims this extension. Implementation: `DefaultRegistry().byExt`
   has the key, or the extension is in `generic.Extensions`.

**Postconditions**

- Pure function, no side effects.

**Errors**

- None.

**Edge cases**

- `""` → `false`
- `"Makefile"` (no extension) → `false`
- `"foo.TS"` → `true` (case folded)
- `"foo.tar.gz"` → `false` (ext is `.gz`, not registered)
- `"foo.bak.ts"` → `true`

**Parity requirements**

- Must return the same boolean as `isCodeFile` at
  `src/code-indexer.ts:85` for the same input on the full set of
  extensions in `CODE_EXTENSIONS`.

**Test requirements**

- Table test covering every extension in the union of all parsers'
  `Extensions()` plus 20 negative cases (`.md`, `.json`, `.yml`,
  `.lock`, `.txt`, empty, dot-file, directory-ending slash, etc.).

---

### `func DetectLanguage(path string) string`

**Signature**

```go
func DetectLanguage(path string) string
```

**Preconditions**

- None.

**Behavior**

1. `ext := strings.ToLower(filepath.Ext(path))`
2. Look up in the package-private `languages` map (ported from
   `src/code-indexer.ts:92-107`).
3. Return the mapped value, or `"unknown"` if absent.

**Language map** (exact port):

| ext | language |
|-----|----------|
| `.ts`, `.tsx`, `.mts`, `.cts` | `typescript` |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `javascript` |
| `.py`, `.pyi` | `python` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.java` | `java` |
| `.kt` | `kotlin` |
| `.scala` | `scala` |
| `.c`, `.h` | `c` |
| `.cpp`, `.cc`, `.hpp` | `cpp` |
| `.cs` | `csharp` |
| `.rb` | `ruby` |
| `.swift` | `swift` |
| `.php` | `php` |
| `.lua` | `lua` |
| `.r`, `.R` | `r` |
| `.sh`, `.bash`, `.zsh` | `shell` |

**Postconditions**

- Return value is stable across calls.

**Errors**

- None.

**Edge cases**

- Capital extensions normalized via `ToLower` — `foo.R` becomes
  language `r` because the key `.r` is present. Matches the TS map
  via the lowercase lookup at `src/code-indexer.ts:110`.
- No extension → `"unknown"`.

**Parity requirements**

- Byte-identical output vs. TS for every key in `LANGUAGE_MAP`.

**Test requirements**

- Table test mirroring the language map.
- Negative case for `.xyz` returning `"unknown"`.

---

### `func Register(p Parser)`

**Signature**

```go
func Register(p Parser)
```

**Preconditions**

- `p != nil`, `p.Extensions()` returns at least one entry.

**Behavior**

1. Acquire `DefaultRegistry().mu` write lock.
2. For each `ext` in `p.Extensions()`:
   - Normalize to lowercase.
   - If the extension is already registered, **panic** with
     `"codeindex: extension %q registered twice"`. Duplicate
     registration is a programmer error, surfaced at init time.
3. Release the lock.

**Postconditions**

- `Lookup(ext)` returns `p` for every `ext` claimed by `p`.

**Errors**

- Panics on collision.

**Edge cases**

- Parser with zero extensions: panic with
  `"codeindex: parser has no extensions"`.
- Re-registering the same parser instance: panic (safer than silent
  skip).

**Parity requirements**

- None — this is a Go-specific init-time mechanism.

**Test requirements**

- Collision detection test (two parsers claiming `.x`).
- Empty-extensions test.

---

### `func (r *Registry) Lookup(ext string) Parser`

**Signature**

```go
func (r *Registry) Lookup(ext string) Parser
```

**Preconditions**

- `r != nil`, `r.fallback != nil`.

**Behavior**

1. Normalize `ext` to lowercase.
2. Acquire read lock.
3. If `r.byExt[ext]` is set, return it.
4. Else return `r.fallback`.

**Postconditions**

- Never returns nil.

**Errors**

- None.

**Edge cases**

- Mixed-case input returns same parser as lowercase.
- Nil-fallback precondition violation panics via safe-guard check (the
  spec forbids reaching this state).

**Parity requirements**

- `Lookup(ext)` for any key in the TS `LANGUAGE_MAP` returns a parser
  whose extraction output matches the corresponding TS parser's output
  on the same source.

**Test requirements**

- Unit test: every registered parser is reachable via every extension
  it claims. Every extension in `GENERIC_EXTENSIONS` resolves to the
  generic fallback. Unknown extension resolves to generic.

---

### `func IndexFile(ctx context.Context, path, root, collection string) (types.IndexedDocument, error)`

**Signature**

```go
func IndexFile(
    ctx context.Context,
    path, root, collection string,
) (types.IndexedDocument, error)
```

**Preconditions**

- `path` is absolute and passes `safepath.Contains(root, path)`.
- `root` is absolute.
- `collection` is non-empty (the env var default is `"code"`).
- Default registry has been populated (main has done the blank
  imports).

**Behavior**

1. Check `ctx.Err()`. If non-nil, return it wrapped.
2. Read the file via `fsutil.ReadText(ctx, path)`.
3. `ext := strings.ToLower(filepath.Ext(path))`.
4. `language := DetectLanguage(path)`.
5. Compute `relPath := filepath.Rel(root, path)`, replace path
   separators with `:`, replace the final `.<ext>` with `_<ext>`, and
   prefix with `collection + ":"`. This is the exact algorithm at
   `src/code-indexer.ts:217`.
6. `parser := DefaultRegistry().Lookup(ext)`.
7. `nodes, err := parser.Parse(path, source, docID)`. On error, wrap
   with `fmt.Errorf("parse %s: %w", path, err)` and return.
8. If `len(nodes) == 0`, synthesise a single root node:
   - `NodeID = docID + ":n1"`
   - `Title = filepath.Base(path)`
   - `Level = 1`
   - `ParentID = nil`
   - `Children = []string{}`
   - `Content = source`
   - `Summary = source[:min(200, len(source))]`
   - `WordCount = countWords(source)` (whitespace-split, empty tokens
     skipped — match `src/code-indexer.ts:236`)
   - `LineStart = 1`
   - `LineEnd = numberOfLines(source)` (count of `\n` + 1, even on
     empty file → 1)
9. Compute `contentHash := fsutil.HashBytes(sourceBytes)` (hex).
10. Build facets:
    - `language: [language]`
    - `content_type: ["code"]`
    - `symbol_kind: sorted unique kinds from node titles, excluding
      "import"` — **only if non-empty**.
11. Extract the first 20 exported symbol names into `Tags`.
12. Compute `RootNodes` as all node ids with `ParentID == nil`.
13. `meta.Description = buildCodeDescription(nodes, language)`.
14. `meta.Title = filepath.Base(path)`.
15. `meta.WordCount = sum(nodes[i].WordCount)`.
16. `meta.HeadingCount = len(nodes)`.
17. `meta.MaxDepth = max(nodes[i].Level)` (0 if none).
18. `meta.LastModified = fsutil.LastModifiedRFC3339(path)`.
19. Return the populated `IndexedDocument`.

**Postconditions**

- `IndexedDocument.Meta.Collection == collection`
- `IndexedDocument.Meta.DocID == docID`
- `len(IndexedDocument.Tree) >= 1`
- `IndexedDocument.RootNodes` is non-empty.
- Every `ParentID` in the tree refers to a node that is also present
  in the tree (internal consistency).

**Errors**

| Condition | Error |
|-----------|-------|
| Context cancelled | `ctx.Err()` wrapped in `"codeindex: cancelled"` |
| File read failure | `fs.PathError` unwrapped from `fsutil.ReadText` |
| Parser returns error | `fmt.Errorf("codeindex: parse %s: %w", path, err)` |
| `filepath.Rel` fails (not inside root) | `errors.New("codeindex: path outside root")` |
| Stat fails (for mtime) | `fs.PathError` |

**Edge cases**

- Empty file (0 bytes): the empty-file branch in step 8 fires,
  producing exactly one node with empty `Content` and `Summary`.
- File with only comments: parser likely returns zero symbols →
  empty-file branch applies.
- File with a BOM: read as-is; do not strip. Matches TS.
- Path with spaces: preserved in `file_path` and `doc_id`
  (colon-separated).
- Collection name containing `:` itself: accepted but discouraged;
  spec says do not validate.
- Symlinked file inside root: honoured (follow symlinks). Safepath
  precondition already enforced by the caller.

**Parity requirements**

- For a fixed fixture file and collection name, the returned
  `IndexedDocument.Meta` must match the TS `indexCodeFile` output in:
  - `DocID`, `FilePath`, `Title`, `Description`, `Collection`,
    `Tags`, `HeadingCount`, `MaxDepth`, `Facets`
- `Tree[i].{NodeID,Title,Level,ParentID,LineStart,LineEnd}` must
  match byte-for-byte.
- `Tree[i].Content` must match byte-for-byte.
- `WordCount` fields match as integers.
- `LastModified` formats differ between TS (`toISOString`) and Go
  (`time.RFC3339Nano`) — the spec relaxes to "parses to the same
  `time.Time` value".
- `ContentHash` parity is relaxed: the hash may use a different
  algorithm as long as the invariant
  `hash(a) == hash(b) ⟺ a == b` holds. The store-level fixture test
  operates on Go-computed hashes so this relaxation is safe.

**Test requirements**

- Unit test with at least one fixture per language (see parser spec).
- Empty-file fixture exercising the synthetic-root branch.
- Unicode filename fixture.
- Fixture with symbols that have identical names at different levels
  (class vs. method with same name).
- Fixture producing a facet map with all three keys.

---

### `func IndexCollection(ctx context.Context, cfg types.CollectionConfig) ([]types.IndexedDocument, error)`

**Signature**

```go
func IndexCollection(
    ctx context.Context,
    cfg types.CollectionConfig,
) ([]types.IndexedDocument, error)
```

**Preconditions**

- `cfg.Root` is absolute and exists.
- `cfg.Name` is non-empty.
- Default registry populated.

**Behavior**

1. Determine `pattern := cfg.GlobPattern`; if empty, use
   `DefaultCodeGlob`.
2. Walk `cfg.Root` with `doublestar.Glob(os.DirFS(cfg.Root), pattern)`
   to get relative paths; convert to absolute.
3. Filter with `IsCodeFile`.
4. If zero files remain, return `nil, nil` (matches
   `src/code-indexer.ts:308`).
5. Log `"[name] Found N code files in root"` at info level.
6. Process files in batches of 50 (mirrors
   `BATCH_SIZE` at `src/code-indexer.ts:312`).
7. Each batch is fanned out to a bounded `errgroup.Group` with
   `SetLimit(50)`. Each goroutine calls `IndexFile`.
8. A file-level error logs a warning
   (`"Failed to index code file %s: %v"`) and is dropped. The
   collection continues (matches TS `catch` at
   `src/code-indexer.ts:319`).
9. Between batches, check `ctx.Err()`; return immediately if
   cancelled.
10. After each full batch except the last, log progress
    `"[name] Indexed M/N code files…"`.
11. After the walk, log `"[name] Complete: N code files indexed"`.
12. Return the accumulated slice in **deterministic order**: sort by
    `DocID` (lexicographic) before returning. This is a Go-specific
    requirement — parallelism means natural order would be
    non-deterministic, and downstream parity tests need stable input.

**Postconditions**

- Returned slice order is deterministic across runs on the same
  filesystem.
- Every element has `.Meta.Collection == cfg.Name`.

**Errors**

| Condition | Behavior |
|-----------|----------|
| Context cancelled | Return `ctx.Err()` wrapped |
| Glob pattern invalid | Return `fmt.Errorf("codeindex: invalid glob %q: %w", pattern, err)` |
| Root does not exist | Return `fs.PathError` |
| Individual file parse fails | Log warning, skip |
| Individual file read fails | Log warning, skip |

**Edge cases**

- Symlink loops: handled by `doublestar`/`filepath.WalkDir`'s built-in
  loop detection — do **not** reinvent.
- Zero matches: return `nil, nil`.
- Glob pattern without a `*`: still valid, picks up exact filenames.
- Files excluded by `IsCodeFile`: silently skipped.
- Case-insensitive filesystems (macOS): the glob sees whatever the
  OS presents; no normalization.

**Parity requirements**

- Set equality of returned `DocID`s vs. `indexCodeCollection` at
  `src/code-indexer.ts:292` over the same corpus.
- Order is not required to match TS (TS uses `Promise.all` which also
  returns unordered, so TS sorting is a happy accident).

**Test requirements**

- Fixture corpus with at least 60 files (>batch size) to exercise
  the batching path.
- Corpus containing one known-bad file (parser error) plus five good
  files → result has five documents.
- Context cancellation mid-walk (requires a fake slow parser).
- Empty root → empty result, no error.

## Invariants

1. **Every IndexedDocument has ≥ 1 node.** Enforced by the synthetic
   root in `IndexFile` step 8.
2. **Every `ParentID != nil` refers to a node present in the same
   tree.** Enforced by the parser contract — the coordinator does not
   repair broken trees, it only validates them. Validation:
   `IndexFile` runs an internal `assertTreeConsistent(nodes)` helper
   before returning in test builds.
3. **No two parsers claim the same extension.** Enforced by
   `Register`.
4. **`facets["language"]` is always a single-element slice.** One
   file = one language.
5. **`facets["content_type"] = ["code"]` always** for everything that
   went through `IndexFile` (vs `"markdown"` from `indexer.IndexFile`).
6. **`symbol_kind` facet excludes `"import"`.** Reasons: we do not
   want agents to filter by "imports" — the import node exists purely
   for navigation, not as a facet value. Matches
   `src/code-indexer.ts:246`.
7. **Tags are at most 20 entries.** Matches
   `src/code-indexer.ts:276`.
8. **Deterministic output.** Given the same file bytes, the same
   `doc_id`, and the same parser, `IndexFile` returns byte-identical
   output.

## Concurrency

- **Registry** is protected by `sync.RWMutex`. `Register` takes the
  write lock; `Lookup` takes the read lock. After `main.init()` runs,
  no more writes happen in normal operation, so `Lookup` is
  effectively lock-free with RLock-only contention.
- **`IndexFile`** is goroutine-safe: it takes no shared mutable state
  beyond the read-only registry and the stdlib.
- **`IndexCollection`** uses `golang.org/x/sync/errgroup` with
  `SetLimit(50)`. The limit matches the TS batch size, and it bounds
  FD pressure on corpuses with thousands of files.
- **Context cancellation** is checked between batches, not
  per-goroutine. A single batch is allowed to complete before
  returning. Worst-case latency for cancellation: the longest-running
  file in the current batch.
- The package is safe for `go test -race`.

## Fixture data

Fixtures live under `internal/codeindex/testdata/`:

```
testdata/
├── corpus-small/        # 5 files, mixed languages, baseline sanity
├── corpus-batched/      # 120 files, forces ≥2 batches
├── empty-file.txt       # 0-byte file in a code extension
├── only-comments.go     # parser returns zero symbols
├── symlink-loop/        # A → B → A cycle, must not crash
├── parse-error.py       # Artificially malformed, exercises error path
└── goldens/
    ├── corpus-small.json  # expected IndexedDocument[] from TS
    └── corpus-batched.json
```

Fixture generation:

- Goldens are produced by a TS script `scripts/dump-fixtures.ts`
  (added in Phase B) which runs `indexCodeCollection` on each corpus
  and writes the result as JSON.
- Go parity tests load the JSON, run Go `IndexCollection`, and do a
  semantic diff ignoring `ContentHash` and `LastModified` (those are
  relaxed per `IndexFile` parity requirements above).
- The diff is strict on everything else — any per-field mismatch
  fails the test with a unified diff in the error message.

## Environment variable interactions

The `internal/codeindex` package does **not** read environment
variables itself. `cmd/treenav-mcp/main.go` reads:

| Variable | Default | Consumer |
|----------|---------|----------|
| `CODE_ROOT` | unset | If unset, `codeindex` is not wired at all |
| `CODE_COLLECTION` | `"code"` | Passed as `cfg.Name` |
| `CODE_WEIGHT` | `1.0` | Passed as `cfg.Weight` (consumed by store) |
| `CODE_GLOB` | `DefaultCodeGlob` | Passed as `cfg.GlobPattern` |

Rationale: keeping env parsing out of library packages is a Go style
convention and keeps `internal/codeindex` testable without any
environment mutation. See `spec/environment.md` for the full env var
contract.
