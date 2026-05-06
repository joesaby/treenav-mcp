# Semantic Release + Versioned Docker Tags

**Date:** 2026-03-08

## Goal

Automatically create GitHub Releases with generated release notes and push versioned Docker image tags on every merge to main, driven by conventional commits.

## Approach

Single combined GitHub Actions workflow (`release.yml`) replaces the existing `docker-publish.yml`. Two sequential steps:

1. **semantic-release** — analyzes commits since last tag, determines version bump, creates GitHub Release + git tag, outputs the new version
2. **Docker build** — runs only when a new release was published, pushes both `:latest` and `:<version>` tags

## Workflow Structure

```
push to main
  ├── Step 1: semantic-release
  │     → bumps version from conventional commits
  │     → creates GitHub Release + git tag (e.g., v1.1.0)
  │     → outputs: new_release_published, new_release_version
  │
  └── Step 2: Docker build (only if new_release_published == 'true')
        → builds linux/amd64 + linux/arm64
        → pushes joesaby/treenav-mcp:latest
        → pushes joesaby/treenav-mcp:1.1.0
```

## semantic-release Config (`.releaserc.json`)

Plugins used:
- `@semantic-release/commit-analyzer` — determines version bump
- `@semantic-release/release-notes-generator` — generates release body
- `@semantic-release/github` — creates GitHub Release + tag

Not used: `@semantic-release/npm` (no npm publish), `@semantic-release/changelog` (no CHANGELOG.md file).

## Version Bump Rules

| Commit prefix | Bump |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `BREAKING CHANGE` footer | major |
| `ci:`, `docs:`, `chore:` | no release |

## Secrets

| Secret | Source |
|---|---|
| `GITHUB_TOKEN` | Auto-available in Actions |
| `DOCKERHUB_USERNAME` | Already configured |
| `DOCKERHUB_TOKEN` | Already configured |

## Files Changed

- `.github/workflows/docker-publish.yml` → replaced by `.github/workflows/release.yml`
- `.releaserc.json` → new semantic-release config
- `package.json` → add `semantic-release` and plugins as devDependencies
