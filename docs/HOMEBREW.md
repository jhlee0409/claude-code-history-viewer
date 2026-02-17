# Homebrew Cask Maintainer Guide

## Architecture

```
GitHub Release (tag push)
    ↓ updater-release.yml
    ├── Build (macOS, Linux, Windows)
    ├── Generate latest.json (auto-updater)
    └── Trigger Homebrew tap update
            ↓ repository_dispatch
        jhlee0409/homebrew-tap
            └── update-cask.yml
                ├── Update version in Cask
                ├── Update sha256 in Cask
                └── Commit & push
```

### In-app Updater Compatibility

The app has a built-in Tauri auto-updater that checks `latest.json` from GitHub Releases. The Cask includes `auto_updates true` to handle this:

- The in-app "Update" button works regardless of installation method (Homebrew or manual)
- The Tauri updater replaces the `.app` bundle in `/Applications/` directly — no conflicts with Homebrew
- `brew upgrade` skips this app by default (defers to the built-in updater)
- `brew upgrade --greedy` forces Homebrew to check and update the Cask version
- Homebrew's version tracking may become stale after an in-app update (cosmetic only, no functional impact)

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Cask definition | `jhlee0409/homebrew-tap/Casks/claude-code-history-viewer.rb` | Homebrew install recipe |
| Auto-update workflow | `jhlee0409/homebrew-tap/.github/workflows/update-cask.yml` | Receives dispatch, updates Cask |
| Release trigger | `.github/workflows/updater-release.yml` | Computes SHA256, sends dispatch |

### Required Secret

`HOMEBREW_TAP_TOKEN` must be configured in the **claude-code-history-viewer** repository settings:

1. Go to GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Create a token with:
   - Repository access: `jhlee0409/homebrew-tap`
   - Permissions: Contents (Read and write)
3. Add the token as a repository secret named `HOMEBREW_TAP_TOKEN` in `jhlee0409/claude-code-history-viewer`

## Manual Cask Update

If the automated workflow fails, update the Cask manually:

### 1. Download the DMG

```bash
VERSION="1.3.0"
curl -sL "https://github.com/jhlee0409/claude-code-history-viewer/releases/download/v${VERSION}/Claude.Code.History.Viewer_${VERSION}_universal.dmg" \
  -o /tmp/cchv.dmg
```

### 2. Compute SHA256

```bash
shasum -a 256 /tmp/cchv.dmg
# Output: <sha256>  /tmp/cchv.dmg
```

### 3. Update the Cask

```bash
git clone https://github.com/jhlee0409/homebrew-tap.git /tmp/homebrew-tap
cd /tmp/homebrew-tap

# Edit Casks/claude-code-history-viewer.rb
# Update: version "<VERSION>"
# Update: sha256 "<SHA256>"

git add Casks/claude-code-history-viewer.rb
git commit -m "chore: update claude-code-history-viewer to v${VERSION}"
git push
```

### 4. Verify

```bash
brew tap jhlee0409/tap
brew info --cask claude-code-history-viewer
brew audit --cask claude-code-history-viewer
```

## Verification Commands

```bash
# Check Cask info
brew info --cask claude-code-history-viewer

# Audit Cask (lint check)
brew audit --cask claude-code-history-viewer

# Test install (dry run)
brew install --cask claude-code-history-viewer --dry-run

# Full install
brew install --cask claude-code-history-viewer

# Verify installed app
ls "/Applications/Claude Code History Viewer.app"
```

## Troubleshooting

### `HOMEBREW_TAP_TOKEN` not configured

**Symptom**: Release workflow completes but Cask is not updated.

**Fix**: Add the `HOMEBREW_TAP_TOKEN` secret (see Required Secret section above).

### SHA256 mismatch after install

**Symptom**: `brew install` fails with checksum error.

**Fix**: Re-download the DMG and recompute the checksum:

```bash
curl -sL "<dmg-url>" -o /tmp/cchv.dmg
shasum -a 256 /tmp/cchv.dmg
# Update the Cask with the correct checksum
```

### Cask not found after `brew tap`

**Symptom**: `brew install --cask claude-code-history-viewer` returns "Cask not found".

**Fix**:

```bash
# Force re-tap
brew untap jhlee0409/tap
brew tap jhlee0409/tap

# Verify Cask exists
brew info --cask claude-code-history-viewer
```

### Rollback to previous version

```bash
# In the tap repository
git log --oneline Casks/claude-code-history-viewer.rb
git revert <commit-hash>
git push
```

## User Installation

```bash
brew tap jhlee0409/tap
brew install --cask claude-code-history-viewer
```

Upgrade:

```bash
brew upgrade --cask claude-code-history-viewer
```

Uninstall:

```bash
brew uninstall --cask claude-code-history-viewer
```
