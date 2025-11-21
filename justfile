set dotenv-load
set positional-arguments
set windows-shell := ['busybox', 'sh', '-euc']

# Put pnpm bin tools on PATH
export PATH := "./node_modules/.bin:" + env_var('PATH')

@default:
  just --list --unsorted

# setup build environment
setup: _pre-setup && _post-setup
    # install devtools
    mise install

    pnpm install

# OS-specific setup
[windows]
_pre-setup:
    #!powershell -nop
    winget install busybox
    winget install mise
[linux]
_pre-setup:
[macos]
_pre-setup:

[windows]
_post-setup:
[linux]
_post-setup:
[macos]
_post-setup:
    # Add required Rust targets for universal macOS builds
    rustup target add x86_64-apple-darwin 2>/dev/null || true
    rustup target add aarch64-apple-darwin 2>/dev/null || true

# Run live-reload dev server
dev:
    tauri dev

# Run vite dev server (will not work without tauri, do not run directly)
vite-dev:
    vite

lint:
    eslint .

# Preview production build
vite-preview:
    vite preview

# Build frontend
frontend-build: sync-version
    tsc -b
    vite build

[windows]
tauri-build:
    tauri build
[linux]
tauri-build:
    tauri build
[macos]
tauri-build:
    tauri build --target universal-apple-darwin

# Copy version number from package.json to Cargo.toml
sync-version:
    node scripts/sync-version.cjs

# Run Tauri CLI
tauri *ARGS:
    tauri {{ARGS}}

test:
    vitest

# Run tests once with verbose output
test-run:
    vitest run --reporter=verbose

# Run tests with UI
test-ui:
    vitest --ui

# Run simple tests only
test-simple:
    vitest run simple
