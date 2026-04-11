# Code indexer

## Summary

Walks a source tree, detects the language of each file by extension,
delegates extraction to a per-language parser, and folds the resulting
symbols into the same `TreeNode` / `IndexedDocument` shape that the
markdown indexer produces. One file becomes one document; classes,
functions, interfaces, and other top-level symbols become tree nodes;
methods and properties become children. The existing BM25 engine, the
facet filters, and every MCP tool (`search_documents`, `get_tree`,
`get_node_content`, `navigate_tree`, `find_symbol`) then work on code
without any store-side changes.

The feature is **disabled by default**. Setting `CODE_ROOT` in the
environment turns it on; unset means the Go binary runs as a pure
markdown indexer with no code-side overhead.

Co-owned with [language parsers](./language-parsers.md), which define
the per-language extraction rules this coordinator dispatches to.

## Go package

`internal/codeindex` — the coordinator. It depends on
`internal/parsers/*` for the extractors, `internal/fsutil` for file IO,
`internal/safepath` for containment, `internal/types` for the data
model, and `github.com/bmatcuk/doublestar/v4` for glob matching.

Exports:

- `Parser` — the unified interface every language extractor
  implements. Phase C plugs in one value per language plus the generic
  fallback.
- `IsCodeFile(path string) bool` — mirror of `isCodeFile` in
  `src/code-indexer.ts:85`.
- `DetectLanguage(path string) string` — extension → language id map
  (`src/code-indexer.ts:92-112`).
- `IndexFile(ctx, path, root, collection string) (types.IndexedDocument, error)` —
  read, parse, convert, produce one document.
- `IndexCollection(ctx, cfg types.CollectionConfig) ([]types.IndexedDocument, error)` —
  walk `cfg.Root` with `cfg.GlobPattern` (or the default), call
  `IndexFile` for each hit, drop files the registry can't handle.
- `Register(p Parser)` — registers a parser with the default registry.
  Phase C wires the six parsers in `init()` inside the parsers sub-packages.
- `DefaultRegistry() *Registry` — accessor for the package-level
  registry used by `IndexFile`.

The `CODE_GLOB` default (`src/code-indexer.ts:80`) lives in this
package as an exported `const`.

## Public API (Go signatures)

```go
package codeindex

import (
    "context"

    "github.com/treenavmcp/treenav-mcp/internal/types"
)

// DefaultCodeGlob mirrors CODE_GLOB in src/code-indexer.ts:80.
const DefaultCodeGlob = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,py,pyi,go,rs,java,kt,scala,c,cpp,cc,h,hpp,cs,rb,swift,php,lua,sh,bash,zsh}"

// Parser is the contract every language extractor implements. One parser
// value handles one or more file extensions; the coordinator picks the
// right one via DetectLanguage + Registry.Lookup.
type Parser interface {
    // Extensions returns the lowercase extensions (with leading dot) this
    // parser claims. Multiple parsers may not claim the same extension —
    // Register panics if a collision is detected.
    Extensions() []string

    // Parse turns a source file into a flat slice of tree nodes already
    // shaped for IndexedDocument.Tree. docID is the caller-constructed
    // document id; nodes use "docID:n<counter>" as their NodeID.
    Parse(path, source, docID string) ([]types.TreeNode, error)
}

// Registry maps file extensions to Parser values. Phase C constructs one
// package-level registry in codeindex.init() and each parsers/<lang>
// sub-package calls codeindex.Register from its own init().
type Registry struct { /* ... */ }

// Register adds a parser to the default registry, panicking on
// collision. Phase C parsers register themselves at init time.
func Register(p Parser)

// DefaultRegistry returns the package-level registry used by IndexFile.
func DefaultRegistry() *Registry

// Lookup returns the parser for an extension, or the generic fallback
// if no language-specific parser claims it. Never returns nil — the
// generic parser is the final fallback.
func (r *Registry) Lookup(ext string) Parser

// IsCodeFile reports whether the extension is covered by any registered
// parser (including generic). Mirrors isCodeFile at src/code-indexer.ts:85.
func IsCodeFile(path string) bool

// DetectLanguage returns the language id (e.g. "python", "go") from the
// file extension. Unknown extensions return "unknown".
// Mirrors detectLanguage at src/code-indexer.ts:109.
func DetectLanguage(path string) string

// IndexFile reads one source file, picks a parser via DetectLanguage,
// runs it, converts CodeSymbols to TreeNodes, and returns a complete
// IndexedDocument. Equivalent of indexCodeFile at src/code-indexer.ts:205.
func IndexFile(ctx context.Context, path, root, collection string) (types.IndexedDocument, error)

// IndexCollection walks cfg.Root with cfg.GlobPattern (or
// DefaultCodeGlob), applies IsCodeFile, and fans out to IndexFile.
// Equivalent of indexCodeCollection at src/code-indexer.ts:292.
func IndexCollection(ctx context.Context, cfg types.CollectionConfig) ([]types.IndexedDocument, error)
```

## Key behaviors

- **Language detection is extension-based.** The extension is
  lowercased, looked up in the language map, and used to pick the
  registered parser. Unknown extensions fall through to the generic
  parser; a file is silently skipped only if its extension is not in
  `IsCodeFile`.
- **One file → one document.** The `doc_id` is
  `"<collection>:<path-with-slashes-as-colons>_<ext>"`, matching
  `src/code-indexer.ts:217`. Preserving the extension in the id is
  what lets `foo.c` and `foo.h` coexist in the same collection.
- **Empty files still index.** When a parser returns zero symbols, the
  coordinator synthesises one root node with `title = basename(path)`,
  the file contents as `content`, and the full file span as line
  numbers (`src/code-indexer.ts:226-240`). This means grep-over-search
  still works on files with no recognizable structure.
- **Facets get auto-populated.** `language` and `content_type=code`
  are always added. `symbol_kind` is populated with the distinct kinds
  present in the file (excluding `import`). Users filter with
  `search_documents(facets={language: "python", symbol_kind: "class"})`.
- **Top-N exported symbols become tags.** The first twenty exported
  symbol names are copied into `DocumentMeta.Tags` for tag-based
  discovery through `list_documents`
  (`src/code-indexer.ts:276`).
- **Content hashing for incremental reindex.** The file's raw bytes
  feed `xxhash.Sum64` (in Go) to produce `DocumentMeta.ContentHash`.
  `internal/store.AddDocument` uses this to short-circuit re-indexing
  of unchanged files. Parity requirement: the hex representation
  matches what `Bun.hash(raw).toString(16)` produces for the same
  bytes, accepting that the underlying hash algorithm differs — only
  the round-trip-stability invariant must hold.
- **Parallel batches, one error at a time.** `IndexCollection`
  processes files in batches of 50, matching `BATCH_SIZE` at
  `src/code-indexer.ts:312`. A parse failure on one file logs a
  warning and is dropped; the collection continues. The context is
  checked between batches for cancellation.
- **Go-specific AST upgrade.** The Go parser in `internal/parsers/golang`
  is the only one of the six that uses a real AST (`go/parser` +
  `go/ast`). This is called out as a "free accuracy upgrade" in the
  migration ADR. The other five stay on regex because the cost of
  writing AST parsers for Python, TypeScript, Rust, Java, and the
  generic long tail is not worth the marginal precision gain for a
  navigation-oriented index.

## Dependencies

- **stdlib:** `context`, `encoding/hex`, `errors`, `io/fs`, `os`,
  `path/filepath`, `strings`, `sync` (for registry mutex).
- **third-party:** `github.com/bmatcuk/doublestar/v4` (glob matching),
  `github.com/cespare/xxhash/v2` (content hashing via `internal/fsutil`).
- **internal:** `internal/types`, `internal/fsutil`, `internal/safepath`,
  `internal/parsers/{typescript,python,golang,rust,java,generic}`.

Phase C must guarantee that importing any `internal/parsers/*`
sub-package is enough to register its parser — the `cmd/treenav-mcp`
`main.go` does a blank import of each sub-package so the `init()` hooks
run before `IndexCollection` runs.

## Relationship to TS source

- `src/code-indexer.ts` is the whole-file oracle.
- `CodeSymbol` (`src/code-indexer.ts:43-54`) is an internal IR in TS;
  the Go port skips that layer and parsers return `[]types.TreeNode`
  directly, because the Go parsers can do the symbol-level bookkeeping
  on the stack. This removes one allocation pass and one conversion
  function (`symbolToTreeNode` at `src/code-indexer.ts:143`) from the
  hot path.
- `SymbolKind` (`src/code-indexer.ts:56-65`) is not a new Go type — the
  existing `string` value carried on `TreeNode.Title` and referenced by
  the `symbol_kind` facet key is enough.
- `CODE_EXTENSIONS` (`src/code-indexer.ts:70-77`) is computed at runtime
  in Go by asking each registered parser for its `Extensions()` and
  unioning the results.
- `LANGUAGE_MAP` (`src/code-indexer.ts:92-107`) ports verbatim to a
  `var languages = map[string]string{...}` in `codeindex`.
- `buildCodeDescription` (`src/code-indexer.ts:341-366`) ports to a
  private `buildCodeDescription(nodes, lang)` helper in Go. The
  pluralization rules ("1 class", "2 classes") are preserved for
  fixture parity.
- `Bun.Glob` → `doublestar.Glob` with `filepath.WalkDir`.
- `Bun.file(path).text()` → `fsutil.ReadText(ctx, path)`.

## Non-goals

- **No tree-sitter**, no LSP indexing, no embedding. The feature is
  deliberately regex + one AST parser.
- **No cross-file resolution.** Symbol references are not linked to
  their definitions across files. The existing BM25 engine handles
  "find me the class with this name" better than a half-built import
  graph would.
- **No `.gitignore` honouring.** Files excluded by git are still
  indexed if they match the glob. Users exclude them via the glob
  pattern instead.
- **No binary file detection.** A `.png` file that happened to slip
  past the glob would be fed to the generic parser as UTF-8. The glob
  is expected to keep binaries out.
- **No ID stability across runs.** `NodeID` values are `"<docID>:n<N>"`
  where N is a monotonic counter — rerunning the indexer produces the
  same ids for an unchanged file but only because the traversal order
  is deterministic. Consumers must not cache node ids across file
  edits.
- **No language auto-detection by content.** A file with `.txt` that
  happens to be Python is not detected as Python. Extension is truth.
