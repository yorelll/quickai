# Releasing QuickAI

Releases are automated through
[release-please](https://github.com/googleapis/release-please). There is no
manual tagging, no manual changelog editing, and no manual version bumping —
**after the initial release exists** (see [First release](#first-release-manual)).

## Release artifacts

Release artifacts — the NSIS installer and the portable zip — are **only ever
produced by CI**, never locally. The `build-and-release` job in
`.github/workflows/release-please.yml` builds them on a **Windows** runner with
the MSVC toolchain and uploads both to the GitHub Release.

Do not attempt to build release artifacts on a development machine: the local
toolchain (mingw64) cannot link the Tauri `cdylib` and fails with an
`export ordinal too large` error. Local builds are for development only (see
[Local development builds](#local-development-builds)).

## Prerequisites

The release workflow (`.github/workflows/release-please.yml`) authenticates with
`${{ secrets.RELEASE_PLEASE_TOKEN }}`. This secret does **not** exist on a fresh
copy of the repository — create it before the first automated release:

1. Create a **fine-grained personal access token**
   (GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens), scoped to this repository, with these repository
   permissions:
   - **Contents:** Read and write
   - **Pull requests:** Read and write
2. Store it as an Actions secret named `RELEASE_PLEASE_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

**Why a PAT and not the built-in `GITHUB_TOKEN`?** A pull request opened with
the default `GITHUB_TOKEN` does not trigger other workflows, so release-please's
release PR would never run CI. A fine-grained PAT lets the release PR trigger
the PR pipeline like any other pull request.

## First release (manual)

The very first release is created by hand. `.release-please-manifest.json` must
reference a version whose tag already exists before release-please can manage
subsequent releases, so bootstrap `v0.0.1` manually:

1. Confirm the version reads `0.0.1` in `.release-please-manifest.json`,
   `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
   (they are committed this way).
2. Tag the release commit and push the tag:

   ```powershell
   git tag v0.0.1
   git push origin v0.0.1
   ```

3. Create the GitHub Release for `v0.0.1`. Publishing it triggers the release
   workflow (the `release` event), which runs the full quality gate, builds, and
   uploads **both** assets to the release:
   - `QuickAI_0.0.1_x64-setup.exe` — the NSIS installer.
   - `QuickAI_0.0.1_x64_portable.zip` — the portable archive.

   If the workflow does not run automatically (or you want to rebuild the assets
   later), run it on demand instead — see
   [Re-releasing an existing version](#re-releasing-an-existing-version).

Once `v0.0.1` exists, release-please manages every subsequent release
automatically.

## Re-releasing an existing version

To rebuild the assets for a version that already exists — for example after
deleting and re-creating the `v0.0.1` tag and release:

1. Delete the existing GitHub Release **and** its tag. With the GitHub CLI:

   ```powershell
   gh release delete v0.0.1 --yes      # delete the GitHub Release
   git push origin :refs/tags/v0.0.1   # delete the remote tag
   git tag -d v0.0.1                   # delete the local tag
   ```

   Or, in the GitHub UI, delete the release from the repository's **Releases**
   page and the tag from the **Tags** page.

2. Re-create the tag on the commit you want to release:

   ```powershell
   git tag -f v0.0.1 <commit>
   git push origin v0.0.1
   ```

3. Trigger the build in either of two ways:

   - **Publish a GitHub Release for the tag.** Publishing fires the `release`
     event and the workflow builds and uploads the assets automatically. With
     the CLI: `gh release create v0.0.1 --title v0.0.1 --generate-notes`.
   - **Run the workflow on demand.** Go to **Actions → Release Please → Run
     workflow**, and enter the tag (e.g. `v0.0.1`) in the required `tag` input.

Either path runs the full quality gate, builds the NSIS installer and the
portable zip, and uploads both to the release with `--clobber`, so re-running is
safe and idempotent.

## How it works

Every commit merged to `main` that follows
[Conventional Commits](https://www.conventionalcommits.org/) is picked up by
release-please. It continuously maintains an open **release PR** that:

- bumps the version in `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`,
- updates `CHANGELOG.md` with entries grouped by type.

When you merge that PR, the build workflow runs on a **Windows** runner and:

1. Runs the full quality gate — lint, format check, typecheck, and the complete
   test suite with 100% coverage enforcement (frontend via `vitest --coverage`,
   backend via `cargo llvm-cov --fail-under-lines 100`).
2. Builds the app with Tauri (NSIS bundle target).
3. Publishes a GitHub Release containing **two assets**:
   - **`QuickAI_<version>_x64-setup.exe`** — the NSIS installer.
   - **`QuickAI_<version>_x64_portable.zip`** — a portable archive containing
     the standalone `quickai.exe`.

## Commit types and version bumps

| Commit prefix | Example | Version bump |
| :--- | :--- | :--- |
| `feat:` | `feat: add keyboard shortcuts` | Minor (`0.0.1` → `0.1.0`) |
| `fix:` | `fix: hotkey not firing` | Patch (`0.0.1` → `0.0.2`) |
| `feat!:` or `BREAKING CHANGE:` | `feat!: new IPC protocol` | **Minor while pre-1.0** (`0.0.1` → `0.1.0`), because `bump-minor-pre-major` is enabled in `release-please-config.json`; **Major** (`1.0.0` → `2.0.0`) once at `1.0.0` or above |
| `docs:`, `chore:`, `refactor:`, etc. | `docs: update README` | No bump |

## Step by step

1. Merge feature and fix PRs to `main` with conventional commit messages.
2. release-please opens or updates a PR titled `chore(main): release X.Y.Z`.
3. Review the PR to confirm the version and changelog look right.
4. Merge the release PR.
5. The build workflow runs automatically and the GitHub Release is published
   with both the installer and the portable zip.

## Files managed by release-please

Do not edit these by hand:

- `CHANGELOG.md` — written by release-please on every release PR
- `package.json` `"version"`
- `src-tauri/Cargo.toml` `version`
- `src-tauri/tauri.conf.json` `"version"` (kept in lockstep via `extra-files`)
- `.release-please-manifest.json` — tracks the current released version

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
