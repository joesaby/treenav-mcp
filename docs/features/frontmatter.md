# Frontmatter parser

## Summary

Parses the YAML frontmatter block at the top of a markdown file,
separates it from the body, validates the key names the curator
later writes back out, and classifies keys into the reserved list
(never used as search facets) and the facet list (folded into
`DocumentMeta.Facets`). Also provides `InferTypeFromPath` so the
indexer can synthesize a `type` facet from directory structure
when the frontmatter does not supply one.

## Go package

`internal/frontmatter` — YAML frontmatter extraction, validation,
and path-based type inference.

Exports:

- `Frontmatter` — an alias for `map[string]any` with helper
  methods that preserve ordering concerns required by the curator
  round-trip.
- `Extract` — split a markdown source into `(Frontmatter, body
  string)`; returns an empty `Frontmatter` and the whole input
  as the body when no frontmatter delimiter is present.
- `Validate` — reject frontmatter structures that the curator
  would refuse to serialize back out (invalid key names, embedded
  newlines, unsupported value types).
- `ExtractFacets` — project a `Frontmatter` onto the facet map
  `map[string][]string`, skipping reserved keys.
- `InferTypeFromPath` — look at a doc-relative path and return a
  normalized document type (`"runbook"`, `"guide"`, etc.) or
  empty string.
- `IsReservedKey` — report whether a given key name is on the
  reserved list.
- `ReservedKeys` — return the canonical reserved key list as a
  `[]string` for testing and MCP tool reflection.

## Public API (Go signatures)

```go
package frontmatter

// Frontmatter is a decoded YAML frontmatter block. Values are
// typed as any because YAML can carry strings, numbers, booleans,
// arrays and nulls; callers type-assert at consumption time.
type Frontmatter map[string]any

// Extract splits a markdown document into its frontmatter and
// body. If the input does not begin with a "---\n" delimiter,
// the returned Frontmatter is empty (non-nil) and body == source.
func Extract(source []byte) (Frontmatter, string, error)

// Validate enforces the curator's round-trip rules on a
// Frontmatter value. Used by the curator before serializing, and
// can be called independently by the indexer if strict mode is
// enabled.
func Validate(fm Frontmatter) error

// ExtractFacets converts a Frontmatter into the
// map[string][]string shape used by DocumentMeta.Facets. Reserved
// keys are skipped; tags are skipped (they live on their own
// field in DocumentMeta); array values become string slices;
// scalar values become single-element string slices.
func ExtractFacets(fm Frontmatter) map[string][]string

// InferTypeFromPath returns the document type inferred from the
// directory segments of relPath, or "" if none match. Matches
// are case-insensitive and based on whole-word regex patterns.
func InferTypeFromPath(relPath string) string

// IsReservedKey returns true if the given frontmatter key is
// reserved (must not be used as a facet).
func IsReservedKey(key string) bool

// ReservedKeys returns a copy of the reserved key list, safe to
// mutate by the caller.
func ReservedKeys() []string
```

## Key behaviors

- `Extract` accepts only the `---\n...\n---\n` delimiter shape
  (matching the TS regex at `src/indexer.ts:304`). An opening
  `---` without a matching closing `---` is treated as no
  frontmatter; the document body is the original source.
- `Extract` uses `gopkg.in/yaml.v3` with strict-ish defaults:
  unknown keys are allowed (the schema is open), but duplicate
  keys within a single frontmatter block are rejected.
- Empty frontmatter `---\n---\n` produces a non-nil, zero-length
  `Frontmatter` map.
- `Validate` rejects keys that do not match
  `^[A-Za-z][A-Za-z0-9_-]*$` (matches TS validator at
  `src/curator.ts:485`), embedded newlines inside string values,
  and value types outside of `string`, `int64`, `float64`,
  `bool`, `nil`, and `[]any` (where every element is a string
  or number).
- `ExtractFacets` skips any key in the reserved list and also
  skips `tags` (which moves to `DocumentMeta.Tags`). Array
  values become `[]string` via per-element stringification;
  scalar string/number/bool values become one-element `[]string`
  slices.
- `InferTypeFromPath` matches against the same regex table the
  TS version uses (`src/indexer.ts:367-388`). It considers only
  directory segments, not the filename, so `guides/intro.md`
  infers `"guide"` but `guide-to-shell.md` at the root does
  not.
- The reserved key list is the union of the sets declared in
  `src/indexer.ts:333-341` and
  `src/curator.ts:139-144`:
  `title, description, layout, permalink, slug, draft, date,
  source_url, source_title, captured_at, curator`.

## Dependencies

- **stdlib:** `bytes`, `errors`, `fmt`, `regexp`, `strings`.
- **third-party:** `gopkg.in/yaml.v3` — the YAML parser. Chosen
  over `sigs.k8s.io/yaml` and `ghodss/yaml` because it is the
  closest one-for-one replacement for the TS regex parser's
  behaviors and the only one that provides line-number
  information for error messages out of the box.
- **internal:** `internal/types` (for reference only; this
  package does not import it in the current plan, but if
  `ExtractFacets` grows to return a `types.DocumentMeta` fragment
  it will).

## Relationship to TS source

- `Extract` replaces `extractFrontmatter` at
  `src/indexer.ts:300-325`. The TS implementation is a regex
  parser that handles only a tiny YAML subset
  (`key: value` and `key: [a, b, c]`). The Go version upgrades
  to a real YAML parser because the curator needs lossless
  round-trip through `yaml.v3`.
- `Validate` maps to `validateFrontmatter` at
  `src/curator.ts:478-516`.
- `ExtractFacets` maps to `extractFacets` at
  `src/indexer.ts:343-359`.
- `InferTypeFromPath` maps to `inferTypeFromPath` at
  `src/indexer.ts:390-403`. The Go version uses precompiled
  `*regexp.Regexp` values held in a package-level slice of
  `{pattern, type}` structs, mirroring the TS table.
- **Behavior change:** the TS regex parser silently ignores
  YAML features it does not understand (nested maps, anchors,
  block scalars). The Go `yaml.v3` parser decodes them. The
  indexer calls `Validate` before using the result, and
  `Validate` rejects those structures — which preserves the
  TS "flat key-value only" guarantee even though the parser is
  richer.

## Non-goals

- This package does not write frontmatter. Serialization lives
  in `internal/curator` because the curator's rules about
  quoting, ordering, and blank lines are tightly bound to its
  "diff-friendly output" goals.
- It does not mutate a `DocumentMeta`. It produces the inputs
  the indexer feeds into a `DocumentMeta` constructor.
- It does not sniff frontmatter format. TOML (`+++`) and JSON
  frontmatter are not supported — the TS implementation does
  not support them either, and adding support would surprise
  users.
- It does not expand references or resolve `!include` style
  directives. `yaml.v3` refuses to follow them by default.
- It does not expose the reserved-key list as a mutable global.
  `ReservedKeys()` always returns a fresh copy.
