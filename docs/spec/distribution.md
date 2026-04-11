# Spec: Distribution

**Feature doc:** [../features/distribution.md](../features/distribution.md)
**TS source:** `Dockerfile`, `package.json` (semantic-release config), `railway.json`, `fly.toml`, `smithery.yaml`
**Go package:** cross-cutting (repo-root config, not Go code)

## Scope

This spec fixes the release pipeline: which files exist in the
repo, what each produces, which platforms are in the matrix,
what channels deliver the output, and where each artifact lands.
It binds:

1. `.goreleaser.yml` — the one-and-only build config.
2. `.github/workflows/release.yml` — the CI workflow that
   invokes `goreleaser`.
3. `Dockerfile` — the post-port container recipe.
4. The Homebrew tap repo layout.
5. The Docker Hub tagging convention.

It does **not** specify the Go build flags for local development
(`go build ./cmd/treenav-mcp` just works), the test workflow
(`test.yml` is separate and unchanged), or the cutover timing
between Bun and Go (see `docs/PORT-PLAN.md` Phase D).

## Rules

### R1. `goreleaser` is the only build orchestrator in CI

The release workflow invokes `goreleaser release --clean` once,
passing a tag. It does not shell out to `go build`, does not
assemble archives manually, and does not call `docker build`.
Everything is driven by `.goreleaser.yml`.

Local development still uses `go build`, `go test`, and
`go install` as normal Go tools. `goreleaser` is a CI concern.

### R2. Targets are fixed at five + optional

The default matrix is exactly:

```yaml
goos: [linux, darwin, windows]
goarch: [amd64, arm64]
ignore:
  - goos: windows
    goarch: arm64
```

Adding a new target is an ADR-worthy decision. Removing one is a
breaking change for whoever depended on it.

### R3. All builds are static

```yaml
env:
  - CGO_ENABLED=0
```

No target uses CGO. No target links libc dynamically. The binary
must run on any kernel that matches the target GOOS, regardless
of libc vendor or version.

Ldflags are fixed:

```yaml
ldflags:
  - -s -w
  - -X main.version={{.Version}}
  - -X main.commit={{.ShortCommit}}
  - -X main.date={{.CommitDate}}
```

- `-s -w` strips the symbol table and DWARF debug info, knocking
  ~30% off the binary size.
- `-X main.version=...` injects the release version string,
  readable via `treenav-mcp --version`.
- `main.commit` and `main.date` give operators a way to identify
  exactly which commit a given binary was cut from.

### R4. The release workflow is tag-triggered

`.github/workflows/release.yml` fires on:

```yaml
on:
  push:
    tags:
      - 'v*'
```

`semantic-release` creates the tag; `release.yml` reacts to it.
The two workflows are separated so a release only happens after
semantic-release has decided there is one.

### R5. `semantic-release` continues to drive versioning

The commit-message-to-version-bump contract stays the same as
the TS version:

| Prefix | Effect |
|---|---|
| `feat:` | Minor bump |
| `fix:` | Patch bump |
| `feat!:` / `BREAKING CHANGE:` | Major bump |
| `chore:`, `docs:`, `ci:`, `test:` | No release |

The Go cutover commit itself uses `feat!:` to cut `v2.0.0`.

### R6. Archive naming is frozen

```yaml
archives:
  - id: default
    name_template: '{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}'
    format: tar.gz
    format_overrides:
      - goos: windows
        format: zip
    files:
      - LICENSE
      - README.md
```

Users scripting the direct-download path rely on these names.
Renaming is a breaking change.

### R7. Checksums are mandatory

```yaml
checksum:
  name_template: 'checksums.txt'
  algorithm: sha256
```

The `checksums.txt` file is uploaded with every release. Users
verify with `sha256sum -c checksums.txt`.

### R8. Homebrew formula is auto-published

```yaml
brews:
  - repository:
      owner: joesaby
      name: homebrew-tap
    name: treenav-mcp
    homepage: https://github.com/joesaby/treenav-mcp
    description: BM25 search and tree navigation over markdown for MCP agents
    license: MIT
    commit_author:
      name: goreleaserbot
      email: bot@goreleaser.com
    test: |
      system "#{bin}/treenav-mcp", "--version"
```

The tap repo lives at `github.com/joesaby/homebrew-tap`. A
fine-grained Personal Access Token with `contents: write` on the
tap repo is stored as `HOMEBREW_TAP_GITHUB_TOKEN` in the
`treenav-mcp` repo's secrets.

### R9. Docker image is multi-arch and tiny

Dockerfile (post-port):

```dockerfile
FROM scratch
COPY treenav-mcp /treenav-mcp
ENV PORT=3100
EXPOSE 3100
ENTRYPOINT ["/treenav-mcp", "serve", "--http"]
```

Note: `FROM scratch` is viable if and only if the binary makes
no HTTPS calls and needs no timezone database. Phase B verifies
both; if either becomes false, switch to
`gcr.io/distroless/static-debian12` (adds ~2 MB for CA certs +
zoneinfo).

`goreleaser` builds this image for `linux/amd64` and
`linux/arm64` via Docker Buildx and assembles a manifest list:

```yaml
dockers:
  - image_templates:
      - 'joesaby/treenav-mcp:{{ .Version }}-amd64'
      - 'joesaby/treenav-mcp:latest-amd64'
    use: buildx
    build_flag_templates:
      - '--platform=linux/amd64'
    goos: linux
    goarch: amd64
  - image_templates:
      - 'joesaby/treenav-mcp:{{ .Version }}-arm64'
      - 'joesaby/treenav-mcp:latest-arm64'
    use: buildx
    build_flag_templates:
      - '--platform=linux/arm64'
    goos: linux
    goarch: arm64

docker_manifests:
  - name_template: 'joesaby/treenav-mcp:{{ .Version }}'
    image_templates:
      - 'joesaby/treenav-mcp:{{ .Version }}-amd64'
      - 'joesaby/treenav-mcp:{{ .Version }}-arm64'
  - name_template: 'joesaby/treenav-mcp:latest'
    image_templates:
      - 'joesaby/treenav-mcp:latest-amd64'
      - 'joesaby/treenav-mcp:latest-arm64'
```

### R10. The `cmd/treenav-mcp` entry point is a single binary with subcommands

The Go binary exposes subcommands rather than separate binaries:

```
treenav-mcp serve          # stdio MCP server (default)
treenav-mcp serve --http   # HTTP MCP server
treenav-mcp index          # debug: dump indexed output to stdout
treenav-mcp --version      # print version, commit, build date
```

This mirrors the TS split of `server.ts`, `server-http.ts`, and
`cli-index.ts` without shipping three separate binaries.

## Types

N/A — this is a pipeline spec. No Go types are declared.

## Patterns

### P1 — `release.yml` skeleton

```yaml
name: release

on:
  push:
    tags:
      - 'v*'

jobs:
  goreleaser:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: goreleaser/goreleaser-action@v6
        with:
          version: latest
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          HOMEBREW_TAP_GITHUB_TOKEN: ${{ secrets.HOMEBREW_TAP_GITHUB_TOKEN }}
```

### P2 — Version injection

`cmd/treenav-mcp/main.go` declares:

```go
var (
    version = "dev"
    commit  = "none"
    date    = "unknown"
)
```

These are overwritten by the `ldflags` in R3 at link time. A
local `go build` leaves them as the defaults; a `goreleaser`
build fills them in.

### P3 — Release-time checksum manifest upload

`goreleaser` uploads `checksums.txt` alongside the archives. The
release body includes a snippet the user can copy:

```
sha256sum -c checksums.txt
```

No manual step.

## Invariants

1. **I1 — One-file builds.** No release step builds anything not
   specified in `.goreleaser.yml`.
2. **I2 — Five platforms minimum.** Every successful release
   produces at least the five archives in R2 plus `checksums.txt`.
3. **I3 — Homebrew freshness.** After a successful release, the
   Homebrew tap contains a formula whose SHA256 matches the
   published darwin archives within one CI run.
4. **I4 — Docker image parity.** The multi-arch image on Docker
   Hub for tag `v<X>.<Y>.<Z>` contains the same binary as the
   tarball `treenav-mcp_<X>.<Y>.<Z>_linux_<arch>.tar.gz`.
5. **I5 — Versioning trail.** Every published binary reports
   `version` matching its Git tag, `commit` matching the tag's
   commit, and `date` matching the commit timestamp.

## Concurrency

N/A.

## Fixture data

N/A — the release pipeline is verified end-to-end by a dry-run
`goreleaser release --snapshot --clean` in the CI test workflow.
That dry run produces artifacts in `dist/` without uploading,
which Phase B asserts are the expected shape. No JSON fixture
is captured from the TS oracle because there is no TS equivalent
of a goreleaser build.
