# Spec: Environment variables

**Feature doc:** [../features/environment.md](../features/environment.md)
**TS source:** `src/server.ts:33-49`, `src/server-http.ts:21-40`, `src/server.ts:64-77`
**Go package:** `internal/config`

## Scope

This spec is the authoritative contract for every environment
variable the Go binary reads. It binds:

1. `internal/config.Load` — the one function that reads
   `os.Getenv` in production code.
2. Every package constructor that takes a `Config` or
   sub-`Config`.
3. The startup failure output in `cmd/treenav-mcp/main.go`.
4. The CI fixture that runs `treenav-mcp --help` and diffs the
   printed env-var summary against this table.

It does not govern CLI flag parsing (there are only three flags
in Phase C), config-file loading (not implemented), or any
framework-level env loading (none used).

## Rules

### R1. One call to `os.Getenv` per variable

`internal/config.Load` reads every documented variable exactly
once. No other production code calls `os.Getenv`. A linter
check in CI greps `internal/` (excluding `internal/config/`) for
any `os.Getenv` call and fails the build on match.

### R2. Parse then validate then assign

For every variable:

1. `raw := os.Getenv("X")`. If empty and the variable has a
   default, `raw = defaultValue`.
2. Parse `raw` into its typed form (`strconv.Atoi`,
   `strconv.ParseFloat`, or raw string).
3. Validate the parsed value against its constraints.
4. Assign to the appropriate `Config` field.

Failure at any step returns an error wrapping `ErrInvalidValue`
or `ErrPathNotFound`.

### R3. Defaults are constants in `internal/config`

```go
const (
    DefaultDocsRoot        = "./docs"
    DefaultDocsGlob        = "**/*.md"
    DefaultMaxDepth        = 6
    DefaultSummaryLength   = 200
    DefaultPort            = 3100
    DefaultCodeCollection  = "code"
    DefaultCodeWeight      = 1.0
    DefaultWikiDupeThresh  = 0.35
)
```

No package outside `internal/config` declares any of these
numbers as a const.

### R4. Validation is bounded, not open-ended

Numeric bounds are enumerated in the table in R9 and fixed in
code as `min, max` pairs. A value outside the range is an error
with a message that includes the allowed range:

```
config: environment variable has invalid value: MAX_DEPTH=11: must be in [1, 10]
```

### R5. Path existence checks use `os.Stat`

Variables marked "must exist" are validated with `os.Stat`:

```go
info, err := os.Stat(cfg.Docs.Root)
if err != nil {
    return Config{}, fmt.Errorf("%w: DOCS_ROOT=%q: %v",
        ErrPathNotFound, cfg.Docs.Root, err)
}
if !info.IsDir() {
    return Config{}, fmt.Errorf("%w: DOCS_ROOT=%q: not a directory",
        ErrInvalidValue, cfg.Docs.Root)
}
```

`DOCS_ROOT` and `CODE_ROOT` (if set) and `WIKI_ROOT` (if
`WIKI_WRITE=1`) must be directories. `GLOSSARY_PATH` (if set)
must be a readable file.

### R6. `WIKI_WRITE` is a boolean gate

`WIKI_WRITE` is considered "enabled" if and only if its value is
the exact string `"1"`. Any other value — including `"true"`,
`"yes"`, `"on"`, `"0"`, or the empty string — leaves
`Wiki.Enabled = false`. This matches the TS check at
`src/server.ts:65` (`process.env.WIKI_WRITE === "1"`).

### R7. `CODE_ROOT` is a boolean gate

`Code.Enabled = (os.Getenv("CODE_ROOT") != "")`. All the other
`CODE_*` variables are read and validated only when
`Code.Enabled` is true; otherwise their values are ignored (not
errors).

### R8. Path canonicalization

`DOCS_ROOT`, `CODE_ROOT`, and `WIKI_ROOT` are run through
`filepath.Clean` to normalize, then `filepath.Abs` to resolve
relative paths against the process working directory. The
resolved absolute path is what's stored in the `Config` and
passed to downstream packages. Relative paths in error messages
refer back to the value of the env var as read, not the
resolved form, so users recognize what they typed.

### R9. The full validation table (normative)

| Variable | Required | Default | Type | Min | Max | Path rule |
|---|---|---|---|---|---|---|
| `DOCS_ROOT` | no | `./docs` | path | — | — | must exist, must be dir |
| `DOCS_GLOB` | no | `**/*.md` | string | — | — | non-empty |
| `MAX_DEPTH` | no | `6` | int | 1 | 10 | — |
| `SUMMARY_LENGTH` | no | `200` | int | 1 | 10000 | — |
| `PORT` | no | `3100` | int | 1 | 65535 | — |
| `GLOSSARY_PATH` | no | *(empty)* | path | — | — | if set, must exist and be file |
| `CODE_ROOT` | no | *(empty)* | path | — | — | if set, must exist, must be dir |
| `CODE_COLLECTION` | no (only if `CODE_ROOT` set) | `code` | string | — | — | non-empty |
| `CODE_WEIGHT` | no (only if `CODE_ROOT` set) | `1.0` | float64 | 0.0 | 10.0 | — |
| `CODE_GLOB` | no | *(empty)* | string | — | — | if set, non-empty |
| `WIKI_WRITE` | no | *(unset)* | bool-gate | — | — | equals `"1"` or treated as unset |
| `WIKI_ROOT` | no (only if `WIKI_WRITE=1`) | `$DOCS_ROOT` | path | — | — | if `WIKI_WRITE=1`, must exist and be dir |
| `WIKI_DUPLICATE_THRESHOLD` | no (only if `WIKI_WRITE=1`) | `0.35` | float64 | 0.0 | 1.0 | — |

### R10. No env var names outside this table are recognized

The Go binary ignores any env var not in R9. It does not honor
`TREENAV_*` prefixes, `MCP_*` prefixes, or generic Viper-style
name mangling. This keeps the contract explicit and auditable.

## Types

```go
type Config struct {
    Docs     DocsConfig
    Code     CodeConfig
    Wiki     WikiConfig
    HTTP     HTTPConfig
    Glossary GlossaryConfig
}

type DocsConfig struct {
    Root          string
    Glob          string
    MaxDepth      int
    SummaryLength int
}

type CodeConfig struct {
    Enabled    bool
    Root       string
    Collection string
    Weight     float64
    Glob       string
}

type WikiConfig struct {
    Enabled            bool
    Root               string
    DuplicateThreshold float64
}

type HTTPConfig struct {
    Port int
}

type GlossaryConfig struct {
    Path string // "" means unset; store.Load will try $DOCS_ROOT/glossary.json
}
```

No field is a pointer. No field is an interface. No field is a
`*string`. Zero-value-means-unset is avoided except where
explicitly documented (`Glossary.Path = ""`, `Code.Enabled`,
`Wiki.Enabled`).

## Functions

### `Load`

```go
// Load reads and validates every documented environment variable,
// returning a Config suitable for passing to every internal
// package constructor. The returned error, if non-nil, wraps
// one of ErrMissingRequired, ErrInvalidValue, or ErrPathNotFound
// so callers can match with errors.Is.
func Load() (Config, error)
```

Behavior:

1. Read `DOCS_ROOT`, default, clean, absolutize, stat. Store in
   `cfg.Docs.Root`.
2. Read `DOCS_GLOB`, default, non-empty check. Store in
   `cfg.Docs.Glob`.
3. Read `MAX_DEPTH`, default, parse int, bounds check `1..10`.
   Store in `cfg.Docs.MaxDepth`.
4. Read `SUMMARY_LENGTH`, default, parse int, bounds check
   `>0`. Store in `cfg.Docs.SummaryLength`.
5. Read `PORT`, default, parse int, bounds check `1..65535`.
   Store in `cfg.HTTP.Port`.
6. Read `GLOSSARY_PATH`. If non-empty, stat and validate it's a
   regular file. Store in `cfg.Glossary.Path` (may be empty).
7. Read `CODE_ROOT`. If empty, leave `cfg.Code.Enabled = false`
   and skip steps 8-11. Otherwise set `Enabled = true` and
   continue.
8. Clean, absolutize, stat `CODE_ROOT`. Store in `cfg.Code.Root`.
9. Read `CODE_COLLECTION`, default, non-empty. Store.
10. Read `CODE_WEIGHT`, default, parse float64, bounds
    `0.0..10.0`. Store.
11. Read `CODE_GLOB`. If set, non-empty. Store (may be empty).
12. Read `WIKI_WRITE`. If not exactly `"1"`, leave
    `cfg.Wiki.Enabled = false` and skip 13-15. Otherwise set
    `Enabled = true`.
13. Read `WIKI_ROOT`, default to `cfg.Docs.Root`, clean,
    absolutize, stat. Store in `cfg.Wiki.Root`.
14. Read `WIKI_DUPLICATE_THRESHOLD`, default, parse float64,
    bounds `0.0..1.0`. Store.
15. Return `cfg, nil`.

On any failure, return the zero `Config` and the wrapped error.

### `(Config) String`

```go
// String returns a human-readable multi-line summary of the
// resolved configuration, suitable for logging at startup.
// Sensitive values are never redacted because no value in the
// current contract is sensitive.
func (c Config) String() string
```

Used by `cmd/treenav-mcp/main.go` to echo the resolved
configuration on the `--verbose` startup path and in the
HTTP server's `/health` endpoint.

## Invariants

1. **I1 — Single source of truth.** No default value appears in
   two places. If `DefaultMaxDepth = 6`, then the number `6`
   does not appear as a default anywhere in `internal/` except
   in that one const declaration.
2. **I2 — Fail-closed defaults.** Every variable with a
   "must exist" path rule is validated before `Load` returns.
   No `os.Open` failure in a downstream package is the first
   sign of a misconfiguration.
3. **I3 — Idempotent parse.** `Load` has no side effects beyond
   reading env vars and calling `os.Stat`. Two consecutive
   `Load` calls with the same environment produce identical
   `Config` values.
4. **I4 — Case sensitivity.** Env var names are case-sensitive
   on all platforms. `docs_root` is not a synonym for
   `DOCS_ROOT`.
5. **I5 — Contract parity with TS.** For every variable in the
   table, the Go default and the TS default at `src/server.ts`
   / `src/server-http.ts` match exactly. Changing one without
   the other is a parity bug.

## Concurrency

`Load` is called once from `main` before any goroutine is
started. The returned `Config` is immutable by convention (no
package mutates it after receipt), so it's safe to share
across goroutines without locking. No field is a map or slice
pointing into shared storage.

## Fixture data

A small fixture in `testdata/config/` provides:

- `valid.env` — every variable set to a valid non-default value,
  drives a Load-success test.
- `invalid_max_depth.env` — `MAX_DEPTH=11`, drives a
  bounds-failure test.
- `missing_docs_root.env` — `DOCS_ROOT=/no/such/path`, drives a
  `ErrPathNotFound` test.
- `wiki_write_off.env` — `WIKI_WRITE=yes` (not `"1"`), asserts
  `Wiki.Enabled == false`.

Parity with TS: the TS version reads env vars but has no
`Load`-like entry point; the Go tests re-run the same
configurations against a shim script that launches the TS
server and parses its startup log, confirming the same
DocCount / NodeCount figures on a fixture corpus. That parity
test lives in `tests/go/config_parity_test.go`.
