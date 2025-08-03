# Building Claude Code History Viewer on Linux

This guide explains how to build the Claude Code History Viewer application on Linux systems.

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
git clone https://github.com/jhlee0409/claude-code-history-viewer.git
cd claude-code-history-viewer

# Install Node.js dependencies
pnpm install

# Build for Linux (use this instead of tauri:build which targets macOS)
pnpm tauri:build:linux
```

## Build Output

The build process will create three package formats:

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