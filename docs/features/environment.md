# Environment variables

## Summary

The full environment-variable contract for the Go port. One
`Config` struct is built at startup, one time, by parsing every
`TREENAV_*`-equivalent environment variable with the rules below.
Every `internal/*` package takes its configuration as a field of
that struct at construction; no package re-reads `os.Getenv` at
runtime.

Two design commitments drive this doc:

1. **Parse once, fail fast.** If an env var is malformed, the
   server refuses to start and prints a message naming the
   variable, the value it saw, and the expected shape. It does
   not start in a half-configured state.
2. **Defaults live in one place.** `internal/config` is the
   single file every spec references for "what does `MAX_DEPTH`
   default to". No default is duplicated into a package constant
   elsewhere.

The environment variable set is the stable user-facing API of
the server. Adding a variable is a minor change (`feat:`);
removing or renaming one is breaking (`feat!:`).

## Go package

`internal/config` — exports `Config`, `Load`, and the per-package
sub-config structs.

```go
package config

type Config struct {
    Docs       DocsConfig
    Code       CodeConfig
    Wiki       WikiConfig
    HTTP       HTTPConfig
    Glossary   GlossaryConfig
}
```

## Public API (Go signatures)

```go
package config

import (
    "errors"
    "fmt"
    "os"
    "strconv"
)

// Config is the full, validated runtime configuration. Every
// field is set; there are no zero-value-means-unset fields
// except where explicitly documented.
type Config struct {
    Docs     DocsConfig
    Code     CodeConfig
    Wiki     WikiConfig
    HTTP     HTTPConfig
    Glossary GlossaryConfig
}

type DocsConfig struct {
    Root          string // DOCS_ROOT
    Glob          string // DOCS_GLOB
    MaxDepth      int    // MAX_DEPTH
    SummaryLength int    // SUMMARY_LENGTH
}

type CodeConfig struct {
    Enabled    bool    // true iff CODE_ROOT is set
    Root       string  // CODE_ROOT
    Collection string  // CODE_COLLECTION
    Weight     float64 // CODE_WEIGHT
    Glob       string  // CODE_GLOB (may be empty → parser default)
}

type WikiConfig struct {
    Enabled            bool    // true iff WIKI_WRITE == "1"
    Root               string  // WIKI_ROOT (resolved absolute)
    DuplicateThreshold float64 // WIKI_DUPLICATE_THRESHOLD
}

type HTTPConfig struct {
    Port int // PORT
}

type GlossaryConfig struct {
    Path string // GLOSSARY_PATH (may be empty → $DOCS_ROOT/glossary.json)
}

// Load parses the environment using os.Getenv for every documented
// variable, validates each value, and returns a fully populated
// Config or an error describing the first failure.
//
// Load never reads from the filesystem beyond os.Stat calls to
// validate "must exist" constraints.
func Load() (Config, error)

// Sentinel errors for env validation failures.
var (
    ErrMissingRequired = errors.New("config: required environment variable missing")
    ErrInvalidValue    = errors.New("config: environment variable has invalid value")
    ErrPathNotFound    = errors.New("config: path does not exist")
)
```

## Key behaviors

### Parse once at startup

`cmd/treenav-mcp/main.go` calls `config.Load()` exactly once,
before constructing any other package. The result is passed by
value to every constructor (`store.New(cfg)`, `indexer.New(cfg)`,
`curator.New(cfg)`, etc.). Packages copy the fields they need and
never re-read `os.Getenv`.

This matters because:

- Tests can set fields on a `Config` struct directly without
  touching the global environment.
- Subcommands (`treenav-mcp serve`, `treenav-mcp index`) can
  override fields programmatically without shelling out.
- Hot-reload is out of scope, but if added later it mutates the
  `Config` through a single code path.

### Fail fast on invalid values

Every parser (`strconv.Atoi`, `strconv.ParseFloat`) returns its
error; `Load` wraps it with the variable name and value:

```go
return Config{}, fmt.Errorf("%w: MAX_DEPTH=%q: %v",
    ErrInvalidValue, raw, err)
```

The user sees:

```
config: environment variable has invalid value: MAX_DEPTH="nine": strconv.Atoi: parsing "nine": invalid syntax
```

Bounds checks (`MAX_DEPTH` must be in `1..10`) are performed
after parse succeeds and produce a separate `ErrInvalidValue`
with a message that includes the allowed range.

### Path validation

Paths marked "must exist" call `os.Stat`:

```go
if _, err := os.Stat(cfg.Docs.Root); err != nil {
    return Config{}, fmt.Errorf("%w: DOCS_ROOT=%q: %v",
        ErrPathNotFound, cfg.Docs.Root, err)
}
```

A non-existent `DOCS_ROOT` is the most common user error on
first run, so its message is prominent in the failure output.

### The full table

| Variable | Default | Parser | Validator | Read by |
|---|---|---|---|---|
| `DOCS_ROOT` | `./docs` | raw string (cleaned via `filepath.Clean`) | must exist as a directory | `internal/indexer`, `internal/mcp` (server), `cmd/treenav-mcp` |
| `DOCS_GLOB` | `**/*.md` | raw string | non-empty; passed to `doublestar.Glob` | `internal/indexer` |
| `MAX_DEPTH` | `6` | `strconv.Atoi` | integer in `1..10` | `internal/indexer` |
| `SUMMARY_LENGTH` | `200` | `strconv.Atoi` | integer `> 0` | `internal/indexer` |
| `PORT` | `3100` | `strconv.Atoi` | integer in `1..65535` | `internal/mcp` (HTTP transport), `cmd/treenav-mcp` |
| `GLOSSARY_PATH` | *(empty; fallback at runtime to `$DOCS_ROOT/glossary.json`)* | raw string | if set, file must be readable | `internal/store` |
| `CODE_ROOT` | *(unset → `Code.Enabled = false`)* | raw string | if set, must exist as a directory | `internal/codeindex` |
| `CODE_COLLECTION` | `code` | raw string | non-empty | `internal/codeindex` |
| `CODE_WEIGHT` | `1.0` | `strconv.ParseFloat` (bitSize 64) | float in `0.0..10.0` | `internal/store` (at load time) |
| `CODE_GLOB` | *(empty → parser default set)* | raw string | if set, non-empty | `internal/codeindex` |
| `WIKI_WRITE` | *(unset)* | `== "1"` | exact string match | `internal/mcp` (tool registration) |
| `WIKI_ROOT` | `$DOCS_ROOT` | raw string, resolved with `filepath.Abs` | if `WIKI_WRITE=1`, must exist as a directory | `internal/curator` |
| `WIKI_DUPLICATE_THRESHOLD` | `0.35` | `strconv.ParseFloat` (bitSize 64) | float in `0.0..1.0` | `internal/curator` |

Every row maps one-to-one to a field on the `Config` struct
above. There are no undocumented env vars read by Go code.
There are no Config fields that aren't driven by an env var
(except `Wiki.Enabled`, which is derived from `WIKI_WRITE`, and
`Code.Enabled`, which is derived from `CODE_ROOT`).

### Precedence and fallback

- No env var has a CLI-flag override in Phase C. Subcommands
  accept no `--max-depth` flag. If this changes, add a column to
  the table and an ADR.
- `GLOSSARY_PATH` is the only variable with a runtime fallback:
  if unset, `store.Load` tries `$DOCS_ROOT/glossary.json` and
  silently ignores a missing file. If set and the file is
  missing, that's a startup error (because the user explicitly
  asked for it).
- `WIKI_ROOT` defaults to `$DOCS_ROOT` only if `WIKI_WRITE=1`.
  If `WIKI_WRITE` is unset, `WIKI_ROOT` is ignored entirely.

### Validation order

`Load` validates in declaration order so the first failure
reported is the earliest misconfiguration. The caller sees one
error at a time; fixing that one and re-running reveals the next.
`errors.Join` is not used here because a single actionable
message is less confusing for operators than a wall of failures.

## Dependencies

- **stdlib:** `errors`, `fmt`, `os`, `strconv`, `path/filepath`.
- **internal:** none. `internal/config` is a leaf in the
  dependency graph; every other package depends on it, nothing
  it depends on.

## Relationship to TS source

- Replaces the scattered `process.env.X || "default"` pattern in
  `src/server.ts:33-49` and `src/server-http.ts:21-40`. The TS
  code reads env vars at the top of the module, which is fine
  there because the module is loaded once; the Go port
  centralizes the same logic in `internal/config`.
- Replaces `parseInt(process.env.MAX_DEPTH || "6")` (which
  silently returns `NaN` on garbage input) with a real
  `strconv.Atoi` + bounds-check pipeline. The Go port refuses to
  start on `MAX_DEPTH=nine`; the TS version starts with `NaN` and
  breaks later in the indexer.
- Replaces the TS `resolve(process.env.WIKI_ROOT || docs_root)`
  at `src/server.ts:66` with the same logic, but the filesystem
  existence check happens at `config.Load` time, not at the
  first write.
- Keeps the env var *names* and *defaults* bit-for-bit identical
  to the TS version, so existing users' MCP configurations need
  no changes on upgrade to v2.0.0.

## Non-goals

- **`.env` file loading.** The server reads the process
  environment; it does not parse `.env` files. Users who want
  `.env` support use `dotenv`-style wrappers outside the binary.
- **CLI flags mirroring every env var.** Phase C exposes exactly
  three CLI flags: `--http`, `--version`, and the positional
  subcommand name. Every other configuration is env-driven.
- **Per-collection env vars for the code indexer.** Only one
  `CODE_ROOT` / `CODE_COLLECTION` pair is supported via env vars.
  Multi-collection configurations (which the underlying types
  support) require a config file, which is out of scope for the
  initial Go port.
- **Hot-reload on env change.** The server does not watch the
  environment. Changing a variable requires a restart.
- **Secret handling.** No env var in the current contract
  carries a secret. If future env vars do, they are marked
  sensitive and excluded from log output; that's a policy
  addition for the ADR that introduces them.
