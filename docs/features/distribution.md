# Distribution

## Summary

How the Go binary ships. This is the payoff side of ADR 0002 —
the reason we're doing the port at all is that "non-technical
users want to type `brew install treenav-mcp` and be done", and
this doc is where that commitment becomes concrete.

The story in one sentence: one `.goreleaser.yml` file, one GitHub
Actions workflow, one commit to `main`, and five platform binaries
plus a Homebrew formula plus a multi-arch Docker image all appear
on the GitHub Release page with generated release notes.

## Go package

N/A — distribution lives in repo root, not in Go source:

- `.goreleaser.yml` — the release pipeline configuration.
- `.github/workflows/release.yml` — the CI workflow that invokes
  `goreleaser`.
- `cmd/treenav-mcp/main.go` — the Go entry point that `goreleaser`
  compiles.
- `Dockerfile` — rebuilt to be `distroless/static`-based, tiny.

The Go code itself is unchanged by distribution decisions; the
binary is the same regardless of which channel delivered it.

## Public API (Go signatures) — N/A

This is a release-engineering doc.

## Key behaviors

### `goreleaser` as the build orchestrator

`github.com/goreleaser/goreleaser` is the only thing between "tag
a commit" and "users can `brew install`". Its config file lives at
`.goreleaser.yml` in the repo root.

A minimal config fragment (full version in `docs/spec/distribution.md`):

```yaml
# .goreleaser.yml
version: 2
project_name: treenav-mcp

builds:
  - id: treenav-mcp
    main: ./cmd/treenav-mcp
    binary: treenav-mcp
    env:
      - CGO_ENABLED=0
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ignore:
      - goos: windows
        goarch: arm64 # low-priority; drop or keep as an optional matrix entry
    ldflags:
      - -s -w
      - -X main.version={{.Version}}
      - -X main.commit={{.ShortCommit}}
      - -X main.date={{.CommitDate}}
```

`goreleaser` handles: cross-compilation via the stdlib Go toolchain
(no `cross` or CGO headaches because `CGO_ENABLED=0`), archive
packaging, SHA256 checksums, GitHub Release upload, Homebrew
formula rendering, and multi-arch Docker image building — all in
one invocation.

### Target matrix

Five binaries are built on every release:

| OS | Arch | Archive | Notes |
|---|---|---|---|
| linux | amd64 | `treenav-mcp_<version>_linux_amd64.tar.gz` | Primary server target. |
| linux | arm64 | `treenav-mcp_<version>_linux_arm64.tar.gz` | ARM servers, Raspberry Pi, GitHub ARM runners. |
| darwin | amd64 | `treenav-mcp_<version>_darwin_amd64.tar.gz` | Intel Mac. Still ~10% of the user base. |
| darwin | arm64 | `treenav-mcp_<version>_darwin_arm64.tar.gz` | Apple Silicon. Primary Claude Desktop target. |
| windows | amd64 | `treenav-mcp_<version>_windows_amd64.zip` | Claude Desktop on Windows. |

Windows/arm64 is intentionally excluded from the default matrix.
Usage is negligible and the Go toolchain's Windows arm64 support
is newer than the other combinations. It can be added as an
optional matrix entry later.

All binaries are statically linked (`CGO_ENABLED=0`) so they run on
any libc version of the target OS without a shared-library
dependency. The Go runtime is embedded.

### Binary size target

- Unstripped: ~18 MB.
- Stripped (`-s -w`): ~12-15 MB.

Compare to the current Bun image at ~200 MB. This is the single
biggest user-visible win from the port — a user typing
`curl -L ... | tar -xz` gets a 12 MB file, not a 200 MB Docker
pull.

### GitHub Release automation

Semantic-release stays in place. The workflow:

1. Push to `main`.
2. GitHub Actions runs `semantic-release` in dry-run mode to
   compute the next version from conventional commit messages.
3. If a release is warranted, `semantic-release` tags the commit
   as `vX.Y.Z`.
4. The tag push triggers `.github/workflows/release.yml`.
5. That workflow checks out the tag, runs `goreleaser release
   --clean`, which:
   - Builds the five binaries.
   - Produces SHA256 checksums.
   - Uploads all archives + checksums to the GitHub Release
     created for the tag.
   - Renders the Homebrew formula and pushes it to the tap repo.
   - Builds and pushes the multi-arch Docker image.

Release notes are generated from the same conventional commit
messages that drive the version bump, so the user opens the
Release page and sees a grouped changelog by feat/fix/chore.

### Homebrew tap

A `goreleaser` section publishes the formula to
`github.com/joesaby/homebrew-tap`:

```yaml
brews:
  - repository:
      owner: joesaby
      name: homebrew-tap
    name: treenav-mcp
    homepage: https://github.com/joesaby/treenav-mcp
    description: BM25 search and tree navigation over markdown for MCP agents
    license: MIT
    test: |
      system "#{bin}/treenav-mcp", "--version"
```

End users install with:

```bash
brew install joesaby/tap/treenav-mcp
```

The formula is refreshed on every release automatically. No
manual tap maintenance.

### Docker image

The `Dockerfile` is rewritten to a multi-stage build that produces
a `gcr.io/distroless/static-debian12` image (or `scratch` if we
decide no CA certs are needed — the current code base does not
make outbound HTTPS calls, so `scratch` is viable):

```dockerfile
FROM scratch
COPY treenav-mcp /treenav-mcp
ENV PORT=3100
EXPOSE 3100
ENTRYPOINT ["/treenav-mcp", "serve", "--http"]
```

`goreleaser` builds this image for both `linux/amd64` and
`linux/arm64` and pushes a multi-arch manifest to Docker Hub
as:

- `joesaby/treenav-mcp:latest`
- `joesaby/treenav-mcp:v<major>`
- `joesaby/treenav-mcp:v<major>.<minor>`
- `joesaby/treenav-mcp:v<major>.<minor>.<patch>`

Final image size: ~12-15 MB (binary only) vs the current ~200 MB
`oven/bun` image. Pull time goes from tens of seconds to
sub-second on a warm registry.

### Checksums and signing

`goreleaser` produces a `checksums.txt` with SHA256 hashes of
every archive. It is uploaded as a release asset. A release is
valid iff every archive matches its checksum; users can verify
with:

```bash
sha256sum -c checksums.txt
```

Cosign signing is optional in Phase D — the config scaffolding is
in `.goreleaser.yml` behind a feature flag so we can turn it on
once we decide whether to host a signing key. Not required for
the v2.0.0 release but mentioned here so the toolchain is in
place.

### Install instructions for end users

Four channels, documented in `README.md` after Phase D:

**Homebrew (macOS, Linux):**

```bash
brew install joesaby/tap/treenav-mcp
```

**Direct download (any platform):**

```bash
# Linux amd64 example
curl -L https://github.com/joesaby/treenav-mcp/releases/latest/download/treenav-mcp_linux_amd64.tar.gz \
  | tar -xz
sudo mv treenav-mcp /usr/local/bin/
```

**Docker:**

```bash
docker run --rm -v $PWD/docs:/docs -e DOCS_ROOT=/docs \
  joesaby/treenav-mcp:latest
```

**`go install` (for Go developers):**

```bash
go install github.com/joesaby/treenav-mcp/cmd/treenav-mcp@latest
```

## Dependencies

- **`github.com/goreleaser/goreleaser`** — release orchestrator.
  Invoked as a CLI tool from the GitHub Actions workflow, not
  imported as a Go library.
- **`semantic-release`** — already in use for version bumping.
  Kept because commit-message-driven versioning works equally
  well for Go releases.
- **GitHub Actions** — CI / CD host. No self-hosted runners.
- **Docker Buildx** — used by `goreleaser` for multi-arch image
  builds.
- **Homebrew tap repo** — `github.com/joesaby/homebrew-tap`,
  already exists for the TS version; reused for Go.

## Relationship to TS source

- Replaces the `Dockerfile` at repo root (currently `FROM
  oven/bun:1.3.8`). The new Dockerfile is ~4 lines and runs on
  `scratch` or `distroless`.
- Replaces the ad-hoc install instructions in `README.md` that
  boil down to "install Bun, then `bun install -g`".
- Keeps the `semantic-release` configuration (`package.json`
  devDependencies) — the TS and Go releases share the versioning
  pipeline. During Phase D the versioning authority moves from
  `package.json` to a Go build tag and `package.json` is archived.
- The existing `railway.json` and `fly.toml` files continue to
  deploy the HTTP server variant; they will switch their start
  command from `bun run serve:http` to `./treenav-mcp serve --http`
  once the Go binary is the default.
- The `smithery.yaml` manifest is updated to invoke the Go binary
  directly rather than `bun run src/server.ts`.

## Non-goals

- **Distributing via `npm`.** The Go binary is not published to
  npm. Users who want the Bun version will still find it on the
  `legacy` branch with its existing `bun install -g` workflow.
- **Distributing via `apt`, `yum`, `snap`, or Flatpak.** Each
  adds maintenance burden for a small incremental audience. The
  direct-download path covers Linux users who want a binary; the
  Docker image covers containerized deployments.
- **Windows installers (`.msi`, Chocolatey, Scoop).** Claude
  Desktop on Windows users download the `.zip` and drop the
  `.exe` in a folder. If Chocolatey demand materializes post-v2
  it can be added as a `goreleaser` output.
- **Static analysis / SBOM at release time.** Nice to have but
  out of scope for the initial Go cutover. Adding a syft / trivy
  step to the `release.yml` workflow is a follow-up PR.
- **Reproducible builds.** Go builds are *mostly* reproducible
  out of the box, but full bit-for-bit reproducibility across
  different CI runners requires `-trimpath` plus controlled
  timestamps plus locked toolchain versions. Configured but not
  promised in v2.0.0.
