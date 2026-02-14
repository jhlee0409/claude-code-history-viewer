# Spec: Homebrew support for macOS (Issue #123)

## Classification
- **Type:** MAJOR
- **Reasoning:** Delivering Homebrew support is not a one-file tweak. It requires packaging strategy decisions (core vs custom tap), release artifact compatibility checks, CI/release flow adjustments for checksums and formula updates, and multi-README installation documentation updates. Expected impact is 5+ files across docs, release automation, and packaging metadata.

## Problem Description
macOS users currently install Claude Code History Viewer by manually downloading a `.dmg` from GitHub Releases. There is no Homebrew installation path (`brew install ...`), which adds friction for users who prefer CLI-based install/upgrade workflows and automation.

Current pain points:
- No standard Homebrew command for installation/upgrades.
- Harder to automate setup in developer environments.
- Users must discover and select assets manually from Releases.

## Root Cause Analysis
1. **No Homebrew formula exists** for this project (in Homebrew/core or a custom tap).
2. **No tap repository strategy is documented** (naming, ownership, maintenance workflow).
3. **Release process is optimized for desktop updater metadata**, not Homebrew formula lifecycle.
4. **README installation docs do not include Homebrew instructions**, so discoverability is low.

## Proposed Solution
Implement Homebrew distribution via a **custom tap** (recommended) and document optional future path to Homebrew/core.

### Why custom tap first
- This project is a GUI desktop app packaged via Tauri (`.dmg` on macOS), and Homebrew/core acceptance can be stricter/slower.
- A custom tap gives maintainers immediate control over formula updates aligned with each release.
- Fastest path to satisfy issue request without blocking on upstream review timelines.

### Packaging approach
- Create a formula named `claude-code-history-viewer` in a tap repo (e.g., `jhlee0409/homebrew-tap`).
- Formula should download the macOS release artifact from GitHub Releases and install the `.app` bundle into Homebrew Caskroom/App path (cask-like behavior may be more appropriate than a standard formula; choose based on Homebrew policy validation).
- Ensure checksum is tied to release artifact and updated per release.

### Release workflow integration
- Add/extend release automation so each tagged release produces data required for Homebrew update:
  - stable asset URL
  - SHA256 checksum
  - version string
- Optionally automate PR/update commit in tap repo when new release is published.

### Documentation
- Add Homebrew install/upgrade/uninstall commands to README installation section.
- Mirror the same minimal Homebrew instructions in localized READMEs (or reference canonical English section if localization policy prefers).

## Specific File Changes (planned)
> Note: This spec does not implement changes; it defines expected implementation scope.

1. **`README.md`**
   - Add Homebrew install section:
     - `brew tap jhlee0409/tap` (or `jhlee0409/homebrew-tap` naming decided by maintainer)
     - `brew install --cask claude-code-history-viewer` (or formula command per chosen package type)
   - Add upgrade/uninstall examples.

2. **`README.ko.md`**
   - Add localized Homebrew install guidance consistent with README.md.

3. **`README.ja.md`**
   - Add localized Homebrew install guidance consistent with README.md.

4. **`README.zh-CN.md`**
   - Add localized Homebrew install guidance consistent with README.md.

5. **`README.zh-TW.md`**
   - Add localized Homebrew install guidance consistent with README.md.

6. **`.github/workflows/updater-release.yml`** (or new workflow)
   - Add step(s) to compute/publish checksum metadata usable by Homebrew update flow.
   - Optional: trigger/update tap repository automation after release publish.

7. **New documentation file (optional): `docs/HOMEBREW.md`**
   - Maintainer-facing runbook for tap update process, checksum refresh, rollback procedure.

8. **External repository (new): `jhlee0409/homebrew-tap`**
   - Add cask/formula file for `claude-code-history-viewer`.
   - Add CI validation (`brew audit`, `brew style`) in tap repo.

## Affected Files List
- `README.md`
- `README.ko.md`
- `README.ja.md`
- `README.zh-CN.md`
- `README.zh-TW.md`
- `.github/workflows/updater-release.yml` (or a new dedicated workflow file)
- `docs/HOMEBREW.md` (optional)
- External tap repo files (new repository)

## Testing Plan
1. **Formula/Cask validation**
   - Run `brew style` and `brew audit --strict` against the new package definition.

2. **Install test (clean environment)**
   - `brew tap <tap-name>`
   - `brew install <formula-or-cask-name>`
   - Verify app launches and reads `~/.claude` as expected.

3. **Upgrade test**
   - Publish or simulate newer version, update checksum/version in tap.
   - `brew upgrade <formula-or-cask-name>` succeeds.

4. **Uninstall test**
   - `brew uninstall <formula-or-cask-name>` removes installed app cleanly.

5. **Release pipeline verification**
   - Confirm release workflow outputs stable artifact URLs and checksum data used by tap update process.

6. **Documentation verification**
   - README commands are copy-paste valid.
   - Localized README entries remain consistent with canonical instructions.

## Risks and Mitigations
- **Risk:** Homebrew/core/cask acceptance delay/rejection.
  - **Mitigation:** Ship via custom tap first.
- **Risk:** Checksum drift when artifacts are re-uploaded.
  - **Mitigation:** enforce immutable release assets once published.
- **Risk:** Multi-language docs drift.
  - **Mitigation:** include release checklist item to sync installation sections.

## Rollout Plan
1. Create tap repo and first package definition.
2. Add README installation instructions.
3. Add/adjust release automation for checksum + tap update workflow.
4. Validate with fresh macOS install.
5. Announce availability in release notes and close issue after successful verification.
