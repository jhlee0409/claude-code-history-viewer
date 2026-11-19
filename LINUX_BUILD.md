# Building Omnilogue on Linux

This guide explains how to build the Omnilogue application on Linux systems.

## Prerequisites

### System Requirements
- Ubuntu 20.04+ or other Debian-based distributions
- For other distributions, equivalent packages may be needed

### Required Tools
- **Node.js 18+** - JavaScript runtime
- **pnpm** - Package manager
- **Rust toolchain** - Required for Tauri
- **System development libraries** - Required for WebKit/GTK integration

## Installation Steps

### 1. Install Node.js and pnpm

```bash
# Install Node.js (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm
```

### 2. Install Rust

```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### 3. Install System Dependencies

The most critical step for Linux builds is installing the required system libraries:

```bash
# Update package lists
sudo apt update

# Install required system dependencies for Tauri
sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

**Note:** These packages provide:
- `libwebkit2gtk-4.1-dev` - WebKit engine for the webview
- `libgtk-3-dev` - GTK development libraries
- `libayatana-appindicator3-dev` - System tray support
- `librsvg2-dev` - SVG rendering support

### 4. Clone and Build

```bash
# Clone the repository
git clone https://github.com/jhlee0409/omnilogue.git
cd claude-code-history-viewer

# Install Node.js dependencies
pnpm install

# Build for Linux (use this instead of tauri:build which targets macOS)
pnpm tauri:build:linux
```

## Build Output

The build process will create three package formats. Package file names and the application menu entry still use the bundle's product name, `Claude Code History Viewer`:

1. **DEB Package** (Debian/Ubuntu): `src-tauri/target/release/bundle/deb/Claude Code History Viewer_*.deb`
2. **RPM Package** (Red Hat/Fedora): `src-tauri/target/release/bundle/rpm/Claude Code History Viewer-*.rpm`
3. **AppImage** (Portable): `src-tauri/target/release/bundle/appimage/Claude Code History Viewer_*.AppImage`

## Installation

### Using DEB Package (Ubuntu/Debian)
```bash
sudo dpkg -i "src-tauri/target/release/bundle/deb/Claude Code History Viewer_1.0.0-beta.4_amd64.deb"
```

### Using AppImage (Portable)
```bash
chmod +x "src-tauri/target/release/bundle/appimage/Claude Code History Viewer_1.0.0-beta.4_amd64.AppImage"
./Claude\ Code\ History\ Viewer_1.0.0-beta.4_amd64.AppImage
```

### Using RPM Package (Fedora/RHEL)
```bash
sudo rpm -i "src-tauri/target/release/bundle/rpm/Claude Code History Viewer-1.0.0-beta.4-1.x86_64.rpm"
```

## Running the Application

After installation via DEB/RPM package:
```bash
claude-code-history-viewer
```

Or find it in your application menu under "Claude Code History Viewer".

## Flatpak

Each release also ships `Claude.Code.History.Viewer_<version>_x86_64.flatpak`, built by `.github/workflows/flatpak.yml` from the manifest in `packaging/flatpak/`. The Flatpak app id is `io.github.jhlee0409.Omnilogue`.

### Installing the bundle

```bash
flatpak install --user Claude.Code.History.Viewer_<version>_x86_64.flatpak
flatpak run io.github.jhlee0409.Omnilogue
```

The GNOME runtime (`org.gnome.Platform//51`) is installed from Flathub along with it. The bundle is not on Flathub and does not update itself: when the app reports a new version, its update dialog opens the release page, and you install that release's `.flatpak` the same way.

### Building it locally

The manifest repackages the binary from the Tauri `.deb` onto the GNOME runtime (the approach in [Tauri's Flatpak guide](https://v2.tauri.app/distribute/flatpak/)), so build the `.deb` first:

```bash
pnpm tauri build --bundles deb --config '{"bundle":{"createUpdaterArtifacts":false}}'
cp src-tauri/target/release/bundle/deb/*.deb packaging/flatpak/claude-code-history-viewer.deb

flatpak install --user flathub org.flatpak.Builder org.gnome.Platform//51 org.gnome.Sdk//51
flatpak run org.flatpak.Builder --user --install --force-clean \
  packaging/flatpak/build-dir packaging/flatpak/io.github.jhlee0409.Omnilogue.yml
flatpak run io.github.jhlee0409.Omnilogue
```

Run the workflow by hand from the Actions tab (**Flatpak → Run workflow**) to build a branch; the bundle is kept as the `flatpak-bundle` artifact. Naming an existing release tag in the run's `tag` field also attaches the bundle to that release.

### Sandbox permissions

The app reads history that other tools write all over the home folder, so the sandbox is shaped around what the code reads and writes (each permission is explained next to it in the manifest):

- **Read: the whole home folder (`--filesystem=home:ro`).** Per-assistant folders would not be enough. Every session records the project folder it ran in, and a project whose folder the app cannot see is listed under unavailable projects with its resume command disabled. Aider and Crush are found by scanning the home folder and code folders under it. Claude Code's project settings and `.mcp.json` are read from the project folder.
- **Write: only where the app writes.** `~/.claude` (Claude Code session rename, delete and move; the settings editor), `~/.codex` (Codex rename and delete), `~/.cursor` (Cursor Agent CLI delete), `~/.forge` (ForgeCode rename and delete), `~/.local/share/opencode` (OpenCode rename), `~/.claude-history-viewer` (the app's metadata, archives and presets), the app's settings folders, and Downloads (exports and screenshots).
- **Network:** the update check against GitHub releases.

The app's settings live in `~/.config/com.claude.history-viewer` and `~/.local/share/com.claude.history-viewer`, the same folders as the `.deb`, `.rpm` and AppImage, so switching between them keeps your settings. (The launcher `packaging/flatpak/omnilogue.sh` points the XDG folders back at the host's, because several assistants are found through them.)

### What differs from the other Linux builds

- **Deleting a session** moves it to the system trash through the desktop's Trash portal, as on the other builds; Claude Code sessions still fall back to a permanent delete when the trash fails, other assistants report the error.
- **Cursor conversations cannot be deleted.** Cursor must be closed for that, and the sandbox cannot see whether it is running, so the app refuses with an explanation and Cursor's data stays read-only. Delete them in Cursor, or with another build.
- **Files outside those folders are read-only:** saving project-scoped Claude Code settings (`<project>/.claude/settings.local.json`, `<project>/.mcp.json`) or MCP servers kept in `~/.claude.json`, and restoring a file from Recent Edits, fail with a read-only file system error. Exports can only be saved to Downloads.
- **No project git log:** the GNOME runtime has no `git` binary, so the project's commit list stays empty.
- **History in a custom location** outside the home folder (for example `CLAUDE_CONFIG_DIR` or `CODEX_HOME` on another disk) is not visible until you grant it.

To lift these limits, grant more with `flatpak override`, e.g. write access to the whole home folder (this gives up most of the sandbox's protection):

```bash
flatpak override --user --filesystem=home io.github.jhlee0409.Omnilogue
# or just one extra folder
flatpak override --user --filesystem=/mnt/data/claude io.github.jhlee0409.Omnilogue
```

### Flathub

The app is not on Flathub. A Flathub submission would have to build from source inside `flatpak-builder` (with the cargo and pnpm dependencies vendored through [flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools)) rather than repackage the release `.deb`, and Flathub reviews the broad home-folder read access above.

## Troubleshooting

### Common Issues

1. **Missing JavaScriptCore library error**
   ```
   The system library `javascriptcoregtk-4.1` required by crate `javascriptcore-rs-sys` was not found.
   ```
   **Solution:** Install the webkit development package:
   ```bash
   sudo apt install libwebkit2gtk-4.1-dev
   ```

2. **Build fails with GTK errors**
   **Solution:** Ensure all GTK development libraries are installed:
   ```bash
   sudo apt install libgtk-3-dev
   ```

3. **Permission denied when running AppImage**
   **Solution:** Make the AppImage executable:
   ```bash
   chmod +x Claude\ Code\ History\ Viewer_*.AppImage
   ```

### For Other Linux Distributions

**Fedora/RHEL:**
```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel libayatana-appindicator3-devel librsvg2-devel
```

**Arch Linux:**
```bash
sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg
```

## Notes

- The original `pnpm tauri:build` script is configured for macOS (`universal-apple-darwin` target)
- Use `pnpm tauri:build:linux` for Linux builds or `pnpm tauri build` for cross-platform builds
- The signing key warning at the end of the build is normal and doesn't affect functionality
- Large conversation histories may require additional system memory during the build process

## Contributing

When contributing Linux-specific changes:
1. Test on multiple distributions if possible
2. Update this documentation for any new requirements
3. Consider adding distribution-specific installation instructions

## Data Privacy

The application runs completely locally and only reads from your `~/.claude` directory. No data is sent to external servers.