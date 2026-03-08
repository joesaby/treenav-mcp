# Semantic Release + Versioned Docker Tags Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On every push to main, automatically determine version from conventional commits, create a GitHub Release with notes, and push Docker images tagged with both `:latest` and the new version number.

**Architecture:** A single `release.yml` workflow replaces `docker-publish.yml`. semantic-release runs first and outputs the new version; Docker build runs conditionally only when a release is published. `.releaserc.json` configures semantic-release with GitHub and release-notes plugins only (no npm publish).

**Tech Stack:** GitHub Actions, semantic-release, @semantic-release/github, @semantic-release/commit-analyzer, @semantic-release/release-notes-generator, docker/build-push-action

---

### Task 1: Install semantic-release devDependencies

**Files:**
- Modify: `package.json`

**Step 1: Add devDependencies**

Run:
```bash
bun add -d semantic-release @semantic-release/commit-analyzer @semantic-release/release-notes-generator @semantic-release/github
```

**Step 2: Verify package.json updated**

Run:
```bash
grep -A4 '"devDependencies"' package.json
```
Expected: `semantic-release` and the three plugins appear under `devDependencies`.

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add semantic-release devDependencies"
```

---

### Task 2: Create `.releaserc.json`

**Files:**
- Create: `.releaserc.json`

**Step 1: Create the config**

Create `.releaserc.json` with this exact content:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github"
  ]
}
```

**Step 2: Verify the file is valid JSON**

Run:
```bash
bun -e "JSON.parse(require('fs').readFileSync('.releaserc.json','utf8')); console.log('valid')"
```
Expected: `valid`

**Step 3: Commit**

```bash
git add .releaserc.json
git commit -m "chore: add semantic-release config"
```

---

### Task 3: Create the combined `release.yml` workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Delete: `.github/workflows/docker-publish.yml`

**Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Run semantic-release
        id: release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          bunx semantic-release
          # Capture outputs for Docker step
          if [ -f .semantic-release-output ]; then
            source .semantic-release-output
          fi

      - name: Set up QEMU
        if: env.NEW_RELEASE_PUBLISHED == 'true'
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        if: env.NEW_RELEASE_PUBLISHED == 'true'
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        if: env.NEW_RELEASE_PUBLISHED == 'true'
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push Docker image
        if: env.NEW_RELEASE_PUBLISHED == 'true'
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            joesaby/treenav-mcp:latest
            joesaby/treenav-mcp:${{ env.NEW_RELEASE_VERSION }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Note on version passing:** semantic-release does not natively export env vars to subsequent steps. We need a different mechanism. Use a script step to write version to `$GITHUB_ENV` instead. Replace the "Run semantic-release" step with:

```yaml
      - name: Run semantic-release
        id: release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          OUTPUT=$(bunx semantic-release --dry-run 2>&1 || true)
          bunx semantic-release
        # semantic-release sets process.env internally but not $GITHUB_ENV
        # Use @semantic-release/exec or a wrapper — see Task 4
```

**Step 2: Delete the old workflow**

```bash
rm .github/workflows/docker-publish.yml
```

**Step 3: Commit (partial — Task 4 will revise this file)**

Skip commit here; continue to Task 4 which finalizes version passing.

---

### Task 4: Fix version passing from semantic-release to Docker step

semantic-release doesn't write to `$GITHUB_ENV` by default. The cleanest solution is to add `@semantic-release/exec` to run a shell command that writes the version to `$GITHUB_ENV`.

**Files:**
- Modify: `package.json` (add `@semantic-release/exec`)
- Modify: `.releaserc.json`
- Modify: `.github/workflows/release.yml`

**Step 1: Install @semantic-release/exec**

```bash
bun add -d @semantic-release/exec
```

**Step 2: Update `.releaserc.json`**

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/exec",
      {
        "successCmd": "echo 'NEW_RELEASE_PUBLISHED=true' >> $GITHUB_ENV && echo 'NEW_RELEASE_VERSION=${nextRelease.version}' >> $GITHUB_ENV"
      }
    ],
    "@semantic-release/github"
  ]
}
```

**Step 3: Simplify the release step in `release.yml`**

Replace the "Run semantic-release" step with:

```yaml
      - name: Run semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bunx semantic-release
```

The `@semantic-release/exec` plugin will write `NEW_RELEASE_PUBLISHED=true` and `NEW_RELEASE_VERSION=x.y.z` to `$GITHUB_ENV` automatically on successful release, making them available to subsequent steps via `${{ env.NEW_RELEASE_VERSION }}`.

**Step 4: Verify `.releaserc.json` is valid JSON**

```bash
bun -e "JSON.parse(require('fs').readFileSync('.releaserc.json','utf8')); console.log('valid')"
```

**Step 5: Commit everything**

```bash
git add .github/workflows/release.yml .github/workflows/  .releaserc.json package.json bun.lockb
git commit -m "ci: add semantic-release with versioned Docker tags"
```

---

### Task 5: Verify the workflow is syntactically valid

**Step 1: Lint the workflow YAML (optional, if actionlint is available)**

```bash
# If actionlint is installed:
actionlint .github/workflows/release.yml

# Otherwise, validate YAML structure with bun:
bun -e "
const fs = require('fs');
// Just check it's parseable — use a YAML check if available
console.log('File exists:', fs.existsSync('.github/workflows/release.yml'));
console.log('Bytes:', fs.statSync('.github/workflows/release.yml').size);
"
```

**Step 2: Confirm docker-publish.yml is gone**

```bash
ls .github/workflows/
```
Expected: only `release.yml` listed.

**Step 3: Review the full workflow**

```bash
cat .github/workflows/release.yml
```
Check:
- `fetch-depth: 0` is present (semantic-release needs full git history)
- `permissions: contents: write` is present (needed to push tags)
- Docker steps have `if: env.NEW_RELEASE_PUBLISHED == 'true'`
- Tags block has both `joesaby/treenav-mcp:latest` and `joesaby/treenav-mcp:${{ env.NEW_RELEASE_VERSION }}`

**Step 4: Push to main and observe the Actions run**

```bash
git push origin main
```

Then open: https://github.com/joesaby/treenav-mcp/actions

Expected on first run (since current HEAD has `feat:` commits not yet tagged):
- semantic-release creates a new GitHub Release
- Docker build runs and pushes both `:latest` and the new version tag
- Docker Hub shows the new version tag at: https://hub.docker.com/r/joesaby/treenav-mcp/tags

---

### Task 6: Add `fetch-depth: 0` guard note (informational)

semantic-release requires the full git history to find the last tag and compute commits since then. The `fetch-depth: 0` in the checkout step is critical. Without it, `actions/checkout@v4` does a shallow clone and semantic-release will fail to detect previous versions.

This is already included in Task 3's workflow template — just verify it's present after all edits.

---

## Success Criteria

- Pushing a `feat:` commit to main creates a minor version bump GitHub Release
- Pushing a `fix:` commit creates a patch bump
- Pushing a `ci:` or `docs:` commit creates no release (Docker does not run)
- Docker Hub shows both `:latest` and `:<version>` tags after a release
- GitHub Releases page shows auto-generated release notes from commit messages
