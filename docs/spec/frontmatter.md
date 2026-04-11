# Spec: Frontmatter parser

**Feature doc:** [../features/frontmatter.md](../features/frontmatter.md)
**TS source:** `src/indexer.ts` lines 291-403 (`extractFrontmatter`, `RESERVED_FRONTMATTER_KEYS`, `extractFacets`, `PATH_TYPE_PATTERNS`, `inferTypeFromPath`), `src/curator.ts` lines 134-144 (`WIKI_RESERVED_FRONTMATTER_KEYS`), lines 478-516 (`validateFrontmatter`)
**Go package:** `internal/frontmatter`

## Scope

Authoritative for parsing, validating, and classifying markdown
frontmatter in the Go port. Specifies the delimiter format, the
accepted YAML subset, the reserved-key list, the facet projection,
and the path-to-type inference table. Does **not** cover
frontmatter serialization (owned by `internal/curator`) or the
merge of facets with content-inferred facets (owned by
`internal/indexer`).

## Types

```go
package frontmatter

// Frontmatter is a decoded YAML frontmatter block. The value
// types that Validate accepts are:
//
//   - string
//   - int64 (yaml.v3 uses this for integer scalars)
//   - float64
//   - bool
//   - nil
//   - []any (every element must itself be a string or numeric)
//
// Nested maps and other types are rejected by Validate.
type Frontmatter map[string]any
```

## Functions

### `Extract`

**Signature:**

```go
func Extract(source []byte) (Frontmatter, string, error)
```

**Preconditions:**

- `source` is a markdown document as raw bytes. UTF-8 is assumed;
  invalid UTF-8 is not checked here — if the YAML parser chokes,
  the error bubbles up.

**Behavior:**

1. If `len(source) < 4` or the first three bytes are not
   `"---"`, return `(Frontmatter{}, string(source), nil)`.
2. If byte 3 is not `'\n'` (or `'\r'` followed by `'\n'`), return
   `(Frontmatter{}, string(source), nil)`. The TS regex at
   `src/indexer.ts:304` requires `---\n`; Go accepts CRLF as a
   documented convenience for Windows-authored files.
3. Search for the closing delimiter: the byte sequence
   `"\n---\n"` (or `"\r\n---\r\n"`) starting at byte 4.
4. If no closing delimiter is found, return
   `(Frontmatter{}, string(source), nil)`. Do not return an
   error; a lone `---` at the top of a doc is legal markdown.
5. Let `raw` be the bytes between the opening and closing
   delimiters (exclusive of both).
6. Decode with
   `yaml.Unmarshal(raw, &decoded)` into a `map[string]any`. On
   error, return `(nil, "", fmt.Errorf("frontmatter: %w", err))`.
7. If `decoded` is nil (empty frontmatter block), substitute a
   zero-length `Frontmatter{}`.
8. Let `body` be the bytes after the closing delimiter and
   (possibly) one trailing newline.
9. Return `(decoded, string(body), nil)`.

**Postconditions:**

- The returned `Frontmatter` is never nil on a nil error.
- `body` contains no leading `---` delimiter.
- `Extract(source)` followed by `yaml.Unmarshal` on the same
  `raw` block produces the same `Frontmatter` — deterministic.

**Errors:**

| Condition | Sentinel | Message shape |
|---|---|---|
| YAML parse failure | *(wrapped)* | `"frontmatter: %w"` |
| Duplicate key | `ErrDuplicateKey` | `"frontmatter: duplicate key %q"` |

**Edge cases:**

- `"---\n---\n"` (empty frontmatter): returns `(Frontmatter{},
  "", nil)`.
- `"---\nfoo: bar"` (unterminated): returns `(Frontmatter{}, "---\nfoo: bar", nil)`.
- `"---\nfoo: bar\n---"` (no trailing newline on closing
  delimiter): accepted; TS regex is stricter. Documented as a Go
  convenience.
- Frontmatter containing `---` inside a quoted string
  (`foo: "---"`): the YAML parser handles this correctly; the
  closing delimiter search in step 3 is naïve and would be
  fooled here. Accept this limitation — it matches the TS regex
  parser's behavior exactly and curator serialization never
  produces such a string.
- BOM at start (`\xef\xbb\xbf---\n...`): treat as no frontmatter
  per the TS regex behavior. The indexer strips BOMs before
  calling `Extract`.

**Parity requirements:**

- For every markdown file in `testdata/corpus/` whose TS parser
  produces a non-empty frontmatter map, the Go parser must
  produce an equivalent map. Equivalence is defined as
  `reflect.DeepEqual` after converting the TS output to the Go
  type set (TS numbers become `float64`; yaml.v3 ints become
  `int64`; the fixture dumper normalizes both sides to
  `float64` for comparison).

**Test requirements (unit):**

- `TestExtract_NoFrontmatter` — empty, whitespace-only, and
  markdown-without-delimiter inputs return empty `Frontmatter`
  and full body.
- `TestExtract_SimpleScalars` — `title`, `description`, and
  tagged-list frontmatter.
- `TestExtract_EmptyBlock` — `"---\n---\n# Hello"` returns
  `(Frontmatter{}, "# Hello", nil)`.
- `TestExtract_UnterminatedTreatedAsBody` — `"---\nfoo: bar"`
  returns `(Frontmatter{}, "---\nfoo: bar", nil)`.
- `TestExtract_CRLF` — `"---\r\nfoo: bar\r\n---\r\nbody"`
  produces the expected map and body.
- `TestExtract_DuplicateKey` — asserts
  `errors.Is(err, ErrDuplicateKey)`.
- `TestExtract_ArrayValue` — `tags: [a, b, c]` produces
  `[]any{"a", "b", "c"}`.
- `TestExtract_Number` — `priority: 5` produces `int64(5)`.

**Test requirements (e2e):**

- Corpus parity: every file in `testdata/corpus/markdown/**/*.md`
  is parsed by both TS and Go implementations; the Phase B
  fixture dumper writes `testdata/fixtures/frontmatter/<hash>.json`
  per-file, and Go tests compare.

### `Validate`

**Signature:**

```go
func Validate(fm Frontmatter) error
```

**Preconditions:** `fm` is non-nil (zero-length is fine).

**Behavior:**

1. For each `(key, value)` pair:
   1. If `key` does not match `^[A-Za-z][A-Za-z0-9_-]*$`, return
      `fmt.Errorf("frontmatter: invalid key %q: %w", key,
      ErrInvalidKey)`.
   2. If `value` is `nil`, continue (null is tolerated).
   3. If `value` is a `string`:
      1. If it contains `'\n'` or `'\r'`, return
         `ErrNewlineInValue` wrapped.
      2. Otherwise continue.
   4. If `value` is `int64`, `float64`, or `bool`, continue.
   5. If `value` is `[]any`, iterate each element:
      1. If element is not `string`, `int64`, or `float64`,
         return `ErrInvalidArrayElement` wrapped.
      2. If element is a string containing newline, return
         `ErrNewlineInValue` wrapped.
   6. Otherwise (nested map, struct, other), return
      `ErrUnsupportedValueType` wrapped.
2. Return nil.

**Postconditions:**

- A `Frontmatter` that passes `Validate` can be round-tripped by
  the curator's serializer and re-parsed by `Extract` without
  byte-level loss.

**Errors:**

| Condition | Sentinel | Message shape |
|---|---|---|
| Key not matching regex | `ErrInvalidKey` | `"frontmatter: invalid key %q: %w"` |
| String/array element contains `\n` | `ErrNewlineInValue` | `"frontmatter: key %q value contains newline: %w"` |
| Array element type wrong | `ErrInvalidArrayElement` | `"frontmatter: key %q array element: %w"` |
| Value type unsupported | `ErrUnsupportedValueType` | `"frontmatter: key %q unsupported type %T: %w"` |

**Edge cases:**

- Empty `Frontmatter{}`: passes validation.
- Key `"0bad"` (starts with digit): rejected.
- Key `"no spaces"`: rejected.
- Value `[]any{}` (empty array): passes validation.
- Value `map[string]any{"nested": true}`: rejected
  (`ErrUnsupportedValueType`).
- Value `[]any{"fine", 3, true}`: **rejected** because `true` is
  not string or number — matches TS behavior at
  `src/curator.ts:491`.

**Parity requirements:**

- Go `Validate` and TS `validateFrontmatter` must classify the
  same inputs the same way. Fixture file:
  `testdata/fixtures/frontmatter/validate_cases.json` —
  array of `{input, expected_error_kind}`.

**Test requirements (unit):**

- Table-driven test with one row per bullet in the error table
  above.
- `TestValidate_AcceptsEmptyMap`.
- `TestValidate_AcceptsFullCuratorWikiEntry` — a realistic
  frontmatter block produced by the curator, exercising every
  reserved key and a mix of tags, facets, and descriptions.

**Test requirements (e2e):**

- Curator round-trip: every successful curator write call
  implicitly runs `Validate`; the e2e test feeds adversarial
  inputs into `draft_wiki_entry` / `write_wiki_entry` and
  asserts the MCP error surface.

### `ExtractFacets`

**Signature:**

```go
func ExtractFacets(fm Frontmatter) map[string][]string
```

**Preconditions:** `fm` is non-nil.

**Behavior:**

1. Allocate `facets := make(map[string][]string)`.
2. For each `(key, value)` pair in `fm` (iteration order is
   irrelevant because the output is a map):
   1. If `IsReservedKey(key)` is true, continue.
   2. If `key == "tags"`, continue. Tags have their own
      `DocumentMeta.Tags` field.
   3. If `value` is nil, continue.
   4. If `value` is `[]any`, convert each element to string via
      `fmt.Sprint(e)`, collect into a `[]string`, and store
      under `facets[key]`. If the conversion produces an empty
      slice, still store an empty slice.
   5. If `value` is a `string`, store `[]string{value}`.
   6. If `value` is `int64` or `float64`, store
      `[]string{fmt.Sprintf("%v", v)}`. Note: float formatting
      matches TS `String(num)` output for common cases;
      integer-valued floats are rendered as `"5"` not `"5.0"`
      because yaml.v3 returns an `int64` for whole numbers. The
      divergent edge case — a float literal `1.5` — is formatted
      by Go as `"1.5"`, matching TS.
   7. If `value` is `bool`, store `[]string{"true"}` or
      `[]string{"false"}`.
   8. Otherwise, skip the pair silently (mirrors TS which only
      handles string / number / array).
3. Return `facets`.

**Postconditions:**

- Returned map is non-nil.
- Every value slice is non-nil and contains only strings. None
  of the strings contain `\n`.
- No reserved key appears as a facet key.
- `"tags"` never appears as a facet key.

**Errors:** none.

**Edge cases:**

- `fm["category"] = nil`: skipped, no facet entry.
- `fm["rank"] = int64(3)`: facet `rank = ["3"]`.
- `fm["score"] = float64(0.75)`: facet `score = ["0.75"]`.
- `fm["tags"] = []any{"a", "b"}`: skipped.
- `fm["nested"] = map[string]any{}`: skipped silently.

**Parity requirements:**

- Identical output to TS `extractFacets` for every frontmatter
  block in `testdata/corpus/markdown/`.

**Test requirements (unit):**

- `TestExtractFacets_SkipsReserved` — frontmatter including
  every reserved key plus one facet; assert only the facet is
  returned.
- `TestExtractFacets_SkipsTags` — `tags` is never in the result.
- `TestExtractFacets_ArrayFacet` — string array.
- `TestExtractFacets_ScalarFacet` — string scalar.
- `TestExtractFacets_NumberFacet` — int64 and float64.
- `TestExtractFacets_BoolFacet` — matches TS stringification.
- `TestExtractFacets_NilValueSkipped`.

**Test requirements (e2e):**

- Indexer corpus parity: facet counts returned by
  `list_documents` must match the TS oracle across the corpus.

### `InferTypeFromPath`

**Signature:**

```go
func InferTypeFromPath(relPath string) string
```

**Preconditions:**

- `relPath` is a POSIX-slash-separated, root-relative path. No
  leading `/`.

**Behavior:**

1. If `relPath` does not contain `/`, return `""` (TS treats a
   root-level file as having no directory to infer from).
2. Let `dir := relPath[:strings.LastIndex(relPath, "/")]`.
3. For each `(pattern, typeName)` in the package-level
   `pathTypePatterns` table (same rows as
   `src/indexer.ts:367-388`), in order:
   1. If `pattern.MatchString(dir)`, return `typeName`.
4. If no pattern matched, return `""`.

The `pathTypePatterns` table:

| Pattern | Type |
|---|---|
| `\brunbooks?\b` | `runbook` |
| `\bguides?\b` | `guide` |
| `\btutorials?\b` | `tutorial` |
| `\breference\b` | `reference` |
| `\bapi[-_]?docs?\b` | `api-reference` |
| `\barchitectur(e\|al)\b` | `architecture` |
| `\badr[s]?\b` | `adr` |
| `\brfc[s]?\b` | `rfc` |
| `\bprocedures?\b` | `procedure` |
| `\bplaybooks?\b` | `playbook` |
| `\btroubleshoot` | `troubleshooting` |
| `\bfaq[s]?\b` | `faq` |
| `\bchangelog` | `changelog` |
| `\brelease[-_]?notes?\b` | `release-notes` |
| `\bhowto\b` | `howto` |
| `\bops\b` | `operations` |
| `\bdeploy` | `deployment` |
| `\bpipeline` | `pipeline` |
| `\bonboard` | `onboarding` |
| `\bpostmortem` | `postmortem` |

All patterns are compiled once at package init via
`regexp.MustCompile(`(?i)` + pattern)`. Case-insensitivity
matches TS `/i` flag.

**Postconditions:**

- Return value is either `""` or one of the 20 type strings in
  the table above. No other values are possible.

**Errors:** none. Regex compilation errors are caught at `init`
and panic — a broken table is a build-time bug.

**Edge cases:**

- `"guides/intro.md"` → `"guide"`.
- `"Guides/intro.md"` → `"guide"` (case-insensitive).
- `"guide-to-shell.md"` → `""` (no directory).
- `"docs/runbooks/db.md"` → `"runbook"` (second segment
  matches).
- `"docs/architecture-overview.md"` → `""` (architecture pattern
  requires a word boundary before `architectur`; the `-overview`
  suffix does not matter, but `docs/` alone does not match).
- Actually, revisit: `dir = "docs"`, pattern is
  `\barchitectur(e|al)\b`, does not match. Correct.
- `"api_docs/v1.md"` → `"api-reference"`.
- `"rfcs/001.md"` → `"rfc"`.

**Parity requirements:**

- Must match `inferTypeFromPath` at `src/indexer.ts:390-403`
  exactly for every path in `testdata/fixtures/frontmatter/
  type_inference_cases.json` (dumped from TS).

**Test requirements (unit):**

- Table-driven test with at least one row per row of the
  `pathTypePatterns` table plus negative cases.
- Case-insensitivity assertions.
- Root-level file returns `""` assertion.

**Test requirements (e2e):**

- Indexer corpus parity: every document in the corpus whose TS
  `facets.type` is inferred (not from frontmatter) must produce
  an identical `facets.type` in Go.

### `IsReservedKey` / `ReservedKeys`

**Signatures:**

```go
func IsReservedKey(key string) bool
func ReservedKeys() []string
```

**Behavior:**

- `IsReservedKey` consults a package-level
  `map[string]struct{}` and returns the membership boolean.
- `ReservedKeys` returns a fresh `[]string` built by ranging
  over the internal map and sorting the result
  lexicographically. The sort is load-bearing: callers (MCP
  tool reflection, test assertions) depend on a deterministic
  order.

**Canonical reserved key list** (union of
`src/indexer.ts:333-341` and `src/curator.ts:139-144`):

```
captured_at
curator
date
description
draft
layout
permalink
slug
source_title
source_url
title
```

Eleven keys total. This list is fixed by this spec; adding a
new reserved key requires a spec edit **and** a parity fixture
regeneration.

**Errors:** none.

**Test requirements (unit):**

- `TestReservedKeys_StableOrder` — call twice, assert byte
  equality.
- `TestReservedKeys_Union` — assert all eleven keys above are
  present and nothing else.
- `TestIsReservedKey_Case` — `IsReservedKey("Title")` is
  `false`; reserved matching is case-sensitive.

## Invariants

1. **`Extract` never returns a nil `Frontmatter` on a nil
   error.** Callers can safely iterate without a nil check.
2. **`ExtractFacets` never returns a nil map, and every value
   slice inside is non-nil.** Matches the `types.DocumentMeta`
   invariant from `spec/core-data-model.md`.
3. **The reserved key list is the single source of truth for
   what counts as a facet.** The indexer and the curator both
   consult this package; neither inlines the list.
4. **Type inference is deterministic and ordered.** When two
   patterns in the table could match the same directory, the
   first row wins. The table order is stable and the same as
   the TS source.
5. **Parser richness does not leak.** Even though `yaml.v3` can
   decode nested maps, sequences of maps, and anchored
   references, `Validate` rejects all of them. Downstream
   consumers can assume the flat `string → scalar|array`
   shape.

## Concurrency

- `Extract`, `Validate`, `ExtractFacets`, `InferTypeFromPath`,
  `IsReservedKey`, and `ReservedKeys` are all pure functions
  modulo their inputs. Safe to call from any goroutine.
- The `pathTypePatterns` table and the reserved-key set are
  package-level `var`s written once at `init` and read
  concurrently thereafter — Go's initialization guarantees
  cover this.
- `ReservedKeys` allocates a fresh slice on every call so
  callers cannot race by mutating a shared buffer.

## Fixture data

`testdata/fixtures/frontmatter/*.json` — dumped by
`scripts/dump-fixtures.ts` using the TS implementation as oracle:

- `extract_cases.json` — array of
  `{input_base64, expected_frontmatter_json, expected_body}`
  entries. Inputs include empty, simple scalars, arrays,
  numeric values, CRLF line endings, and unterminated blocks.
- `validate_cases.json` — array of
  `{frontmatter_json, expected_error_kind}` where
  `expected_error_kind` is one of
  `"ok"`, `"invalid_key"`, `"newline_in_value"`,
  `"invalid_array_element"`, `"unsupported_value_type"`.
- `extract_facets_cases.json` — array of
  `{frontmatter_json, expected_facets_json}` entries exercising
  reserved-key skipping, tags skipping, and the scalar-vs-array
  projections.
- `type_inference_cases.json` — array of
  `{rel_path, expected_type}` entries, at least one per row of
  the `pathTypePatterns` table plus negative cases.
- `reserved_keys.json` — a single JSON array with the eleven
  reserved keys, sorted lexicographically. The Go test suite
  loads this file and compares against `ReservedKeys()` to catch
  drift between the spec and the implementation.

Every file in this directory is regenerated from the TS oracle
before each parity run. Drift between the Go implementation and
these fixtures is a hard failure in CI.
