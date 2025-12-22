set dotenv-load
set positional-arguments
set windows-powershell := true

# Put pnpm and mise tools to PATH
export PATH := justfile_directory() + '/node_modules/.bin' + PATH_VAR_SEP + justfile_directory() + '/.mise/shims' + PATH_VAR_SEP + env_var('PATH')

# Uncomment these if you do not already use mise, if you do not have it configured in your shell or $PATH.
# This will run an isolated, local mise environment, exclusive to this project.

# export MISE_CONFIG_DIR := justfile_directory() + '/.mise'
# export MISE_DATA_DIR := justfile_directory() + '/.mise'

@default:
  just --list --unsorted

# setup build environment
setup: _pre-setup && _post-setup
    # install devtools
    mise install || true

    pnpm install

# OS-specific setup
[windows]
_pre-setup:
    #!powershell -nop
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
    pnpm exec tsc --build .
    pnpm exec vite build

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
