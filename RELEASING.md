# Releasing QuickAI

Releases are cut **by hand**: bump the version, tag the commit, and publish a
GitHub Release. Publishing the release triggers CI, which builds the two
release assets and uploads them to that release. There is no manual artifact
build and no manual upload.

[release-please](https://github.com/googleapis/release-please) is configured in
the repository (`release-please-config.json`, `.release-please-manifest.json`,
and the `release-please` job in the workflow), and that job runs on **every push
to `main`**, where it opens a release PR proposing the next version bump (which
CI then checks like any other PR). Those PRs are **not** how releases are cut,
though: the version bump, tag, and release are all created manually as described
below, so **close the release PR it opens rather than merging it**.

## Release artifacts

Release artifacts — the NSIS installer and the portable zip — are **only ever
produced by CI**, never locally. The `build-and-release` job in
`.github/workflows/release-please.yml` builds them on a **Windows** runner with
the MSVC toolchain and uploads both to the GitHub Release.

Do not attempt to build release artifacts on a development machine: the local
toolchain (mingw64) cannot link the Tauri `cdylib` and fails with an
`export ordinal too large` error. Local builds are for development only (see
[Local development builds](#local-development-builds)).

### Which runner does what

The pipeline deliberately spans two runner types:

| Job | Runner | Why |
| :--- | :--- | :--- |
| `quality` | `ubuntu-latest` | Lint, format, typecheck, and both 100% coverage gates (frontend via `vitest --coverage`; backend from the lcov export — see below). |
| `windows-backend-tests` | `windows-latest` | Compiles (`cargo check --all-targets`) and runs (`cargo test --lib`) the backend suite on Windows, with **no** coverage gate. |
| `build-and-release` | `windows-latest` | Builds the NSIS installer and the portable zip, then uploads both. Requires both jobs above to succeed. |

The **backend coverage gate runs on Linux by design**: the Win32-only
`#[cfg(target_os = "windows")]` modules (keyboard hooks, GDI `BitBlt`,
`SendInput`, `schtasks`) are not compiled on that runner, so the instrumented set
is limited to unit-testable code. The `windows-backend-tests` job covers the
other path — it proves the Win32 code compiles and its tests pass.

The gate is measured from the **lcov export**: it fails if _any_ instrumented
line has zero executions. It deliberately does **not** use llvm-cov's
`--fail-under-lines` summary, which counts region entries as lines and can
disagree with the actual execution data. The check lives in
`scripts/check-backend-coverage.sh` and is shared by CI and by
`bun run test:backend:coverage` locally; the "100% of lines" intent is unchanged.
The workflow uploads the lcov report as the `backend-lcov` artifact, so a
genuine future failure can be diagnosed from the uncovered lines.

## Prerequisites

The `release-please` job in `.github/workflows/release-please.yml` authenticates
with `${{ secrets.RELEASE_PLEASE_TOKEN }}`. This secret does **not** exist on a
fresh copy of the repository — create it before the workflow runs on `main`:

1. Create a **fine-grained personal access token**
   (GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens), scoped to this repository, with these repository
   permissions:
   - **Contents:** Read and write
   - **Pull requests:** Read and write
2. Store it as an Actions secret named `RELEASE_PLEASE_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

**Why a PAT and not the built-in `GITHUB_TOKEN`?** A pull request opened with
the default `GITHUB_TOKEN` does not trigger other workflows, so a release PR
would never run CI. A fine-grained PAT lets such a PR trigger the PR pipeline
like any other pull request. The manual release path below does not depend on
this job, but it runs on every push to `main`, so the secret should exist to
keep that job green.

## Cutting a release (manual)

Both `v0.0.1`, `v0.0.2`, and `v0.0.3` were cut this way. To release version
`X.Y.Z`:

1. **Bump the version** in every place it is pinned, on the commit you intend to
   release:

   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `[package] version`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.lock` → the `quickai` package entry (run
     `cargo update --package quickai` in `src-tauri`, or edit it by hand)
   - `.release-please-manifest.json` → `"."`
   - `CHANGELOG.md` → add a new `## X.Y.Z (YYYY-MM-DD)` section

   Confirm the version reads identically in all of them before continuing.

2. **Tag the release commit and push the tag:**

   ```powershell
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Write the release notes** to a local file, e.g.
   `task/release-notes-X.Y.Z.md`. Note that `task/` is a **local-only,
   gitignored** directory: the file will not exist on a fresh clone, so author
   it yourself before publishing.

4. **Publish the GitHub Release for `vX.Y.Z`.** Publishing it triggers the
   `release` event, so the workflow runs the full quality gate, builds, and
   uploads **both** assets to the release:

   - `QuickAI_X.Y.Z_x64-setup.exe` — the NSIS installer.
   - `QuickAI_X.Y.Z_x64_portable.zip` — the portable archive.

   With the GitHub CLI, using the notes you wrote in step 3:

   ```powershell
   gh release create vX.Y.Z --title vX.Y.Z --notes-file task/release-notes-X.Y.Z.md
   ```

   If you have no notes file, `--generate-notes` lets GitHub draft them from the
   merged PRs instead (this is what the re-release path below uses).

   If the workflow does not run automatically (or you want to rebuild the assets
   later), run it on demand instead — see
   [Re-releasing an existing version](#re-releasing-an-existing-version).

## Re-releasing an existing version

To rebuild the assets for a version that already exists — for example after
deleting and re-creating the `v0.0.2` tag and release:

1. Delete the existing GitHub Release **and** its tag. With the GitHub CLI:

   ```powershell
   gh release delete v0.0.2 --yes      # delete the GitHub Release
   git push origin :refs/tags/v0.0.2   # delete the remote tag
   git tag -d v0.0.2                   # delete the local tag
   ```

   Or, in the GitHub UI, delete the release from the repository's **Releases**
   page and the tag from the **Tags** page.

2. Re-create the tag on the commit you want to release:

   ```powershell
   git tag -f v0.0.2 <commit>
   git push origin v0.0.2
   ```

3. Trigger the build in either of two ways:

   - **Publish a GitHub Release for the tag.** Publishing fires the `release`
     event and the workflow builds and uploads the assets automatically. With
     the CLI: `gh release create v0.0.2 --title v0.0.2 --generate-notes`.
   - **Run the workflow on demand.** Go to **Actions → Release Please → Run
     workflow**, and enter the tag (e.g. `v0.0.2`) in the required `tag` input.

Either path runs the quality gates (`quality` on Linux and
`windows-backend-tests` on Windows), builds the NSIS installer and the portable
zip, and uploads both to the release with `--clobber`, so re-running is safe and
idempotent.

## How the build workflow runs

The `build-and-release` job runs when a GitHub Release is published (the manual
path above), when the workflow is dispatched on demand with a tag input, or when
the `release-please` job reports it created a release. In every case it:

1. Resolves the target tag, then checks out that tag.
2. Waits on the quality gates:
   - On `ubuntu-latest`, the `quality` job runs lint, format check, typecheck,
     and the complete test suite with 100% coverage enforcement (frontend via
     `vitest --coverage`; backend from the lcov export, failing if any
     instrumented line has zero executions).
   - In parallel, the `windows-backend-tests` job compiles and runs the backend
     suite on `windows-latest` without a coverage gate (see
     [Which runner does what](#which-runner-does-what)).
3. Only if both succeed does the `windows-latest` build job run: it builds the
   app with Tauri (NSIS bundle target) and uploads **two assets** to the
   release:
   - **`QuickAI_<version>_x64-setup.exe`** — the NSIS installer.
   - **`QuickAI_<version>_x64_portable.zip`** — a portable archive containing
     the standalone `quickai.exe`.

## Commit types and version bumps

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) to
keep history readable and to group the changelog. With manual releases, pick the
next version yourself using this guide:

| Commit prefix | Example | Version bump |
| :--- | :--- | :--- |
| `feat:` | `feat: add keyboard shortcuts` | Patch (`0.0.2` → `0.0.3`) |
| `fix:` | `fix: hotkey not firing` | Patch (`0.0.2` → `0.0.3`) |
| `feat!:` or `BREAKING CHANGE:` | `feat!: new IPC protocol` | **Minor while pre-1.0** (`0.0.2` → `0.1.0`); **Major** (`1.0.0` → `2.0.0`) once at `1.0.0` or above |
| `docs:`, `chore:`, `refactor:`, etc. | `docs: update README` | No bump |

## Files that carry the version

Every release bump must update all of these by hand (release-please also opens
a release PR on every push to `main` that bumps them, but that PR is not the
path a release is cut through):

- `package.json` `"version"`
- `src-tauri/Cargo.toml` `version`
- `src-tauri/tauri.conf.json` `"version"`
- `src-tauri/Cargo.lock` (`quickai` package)
- `.release-please-manifest.json` — tracks the current released version
- `CHANGELOG.md` — a new section per release

## Local development builds

Local builds are for development only and do **not** produce publishable release
artifacts (see [Release artifacts](#release-artifacts)):

```powershell
bun install
bun run dev            # run the app in development
bun run build:frontend # type-check and build the frontend bundle only
```

To produce the installer and the portable zip, use CI — publish a GitHub Release
or run the release workflow on demand (see
[Re-releasing an existing version](#re-releasing-an-existing-version)).
