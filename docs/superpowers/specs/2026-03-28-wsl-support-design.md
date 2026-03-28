# WSL Support Design Spec

**Issue**: #42
**Date**: 2026-03-28
**Status**: Approved

## Problem

Windows users who run Claude Code (and other AI coding assistants) inside WSL cannot see their WSL conversation history in the app. The app only scans the native Windows home directory.

## Solution

Extend the existing provider system so each provider can discover its data inside WSL distros, controlled by a user-facing toggle in settings.

## Architecture

### New Module: `src-tauri/src/wsl.rs`

Windows-only module (`cfg(target_os = "windows")`). Responsibilities:

1. **`is_wsl_available() -> bool`** — Check if WSL is installed (registry key `HKCU\...\Lxss` exists)
2. **`detect_distros() -> Vec<WslDistro>`** — Read `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Lxss` via `winreg` crate to enumerate installed distros
3. **`resolve_home_path(distro: &str) -> Result<PathBuf>`** — Try UNC access to common home paths (`/home/{username}` from registry `DefaultUid`). Fall back to `wsl -d {distro} -e sh -c "echo $HOME"` only if needed. Handle UTF-16LE encoding from `wsl.exe` output.
4. **`build_unc_path(distro: &str, linux_path: &Path) -> PathBuf`** — Convert a Linux path to a Windows UNC path. Try `\\wsl.localhost\{distro}\{path}` first, fall back to `\\wsl$\{distro}\{path}`.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WslDistro {
    pub name: String,       // e.g. "Ubuntu"
    pub version: u32,       // 1 or 2
    pub is_default: bool,
}
```

### Provider Changes (Minimal)

Existing provider `detect()` / `get_base_path()` signatures remain unchanged. No modifications to individual provider modules.

Instead, WSL scanning is handled in `scan_all_projects()` (in `multi_provider.rs`). When WSL is enabled:
1. Call `wsl::detect_distros()` once
2. For Claude provider only, compute the WSL equivalent path using `wsl::build_unc_path()`
3. If the path exists, scan it as an additional source
4. Label resulting projects with `"WSL: {distro}"` via `custom_directory_label`

Other CLI providers (Codex, Gemini, OpenCode) are excluded from WSL scanning because their `load_sessions`/`load_messages` functions use native base paths internally — WSL projects would be visible but not loadable. Extending these providers requires base-path-aware loaders (tracked as a follow-up).

### Settings

Add to user settings:

```rust
pub struct WslSettings {
    pub enabled: bool,                  // default: false
    pub excluded_distros: Vec<String>,  // user can exclude specific distros
}
```

Frontend: Show a "WSL History Scanning" toggle in settings, visible only on Windows (`!isTauri() || isWindows` check). When enabled, display detected distros with individual checkboxes.

### Project Labeling

Add `source_label: Option<String>` to `ProviderInfo` struct. WSL-sourced projects get `"WSL: {distro}"` (e.g., `"WSL: Ubuntu"`). For Claude projects, also set `custom_directory_label` for backward compatibility. Native projects leave this as `None`.

### Tauri Commands

Add two commands:

```rust
#[tauri::command]
async fn detect_wsl_distros() -> Result<Vec<WslDistro>, String>

#[tauri::command]
async fn is_wsl_available() -> bool
```

On non-Windows, `detect_wsl_distros` returns empty vec, `is_wsl_available` returns false.

### i18n Keys

New keys in `settings` namespace (all 5 locales):

- `settings.wsl.title` — "WSL History Scanning"
- `settings.wsl.description` — "Scan for AI assistant history inside WSL distributions"
- `settings.wsl.enable` — "Enable WSL scanning"
- `settings.wsl.distros` — "Detected distributions"
- `settings.wsl.noDistros` — "No WSL distributions found"
- `settings.wsl.scanning` — "Scanning WSL..."
- `settings.wsl.slowWarning` — "WSL file access may be slower than native"

## Dependencies

| Crate | Version | Condition | Purpose |
|-------|---------|-----------|---------|
| `winreg` | latest | `[target.'cfg(windows)'.dependencies]` | Read WSL registry entries |

## Error Handling

| Scenario | Behavior |
|----------|----------|
| WSL not installed | Hide toggle in settings, `detect_wsl_distros` returns empty vec |
| Distro not running | Log warning, skip distro, continue scanning others |
| UNC path inaccessible | Log warning, skip path, continue scanning |
| `wsl.exe` command fails | Fall back to registry-only detection (skip home path resolution) |
| Distro auto-start delay | Avoid `wsl -e` when possible; prefer UNC path probing. If `wsl -e` is needed, set a 5s timeout |
| UTF-16LE parsing failure | Log error, try UTF-8 fallback |
| Slow file access | Frontend shows loading indicator (existing behavior) |

## Testing

- **Unit tests** (`wsl.rs`): Registry parsing mock, UNC path construction, UTF-16LE decoding
- **Provider tests**: WSL paths included in results when feature enabled
- **Compile gate**: Verify `cfg(windows)` — macOS/Linux builds must succeed without `winreg`
- **i18n**: `pnpm run i18n:validate` passes with new keys

## Out of Scope

- Running a server process inside WSL (VS Code approach) — too complex for read-only access
- WSL 1 vs WSL 2 behavioral differences — same UNC path access works for both
- Writing files to WSL filesystem — app is read-only
- Automatic WSL distro startup — user must have WSL running
