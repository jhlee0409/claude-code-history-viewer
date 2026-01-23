set dotenv-load
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
[windows]
frontend-build: sync-version
    pnpm exec tsc --build
    pnpm exec vite build
[unix]
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

# Setup work environment for a GitHub issue
issue ISSUE_NUMBER:
    ./scripts/setup-issue-work.sh {{ISSUE_NUMBER}}

# List open issues
issues:
    gh issue list --state open --limit 20

# ===== Rust Testing Commands =====

# Run Rust tests with cargo test
rust-test:
    cd src-tauri && cargo test

# Run Rust tests with nextest (faster, parallel)
rust-nextest:
    cd src-tauri && cargo nextest run

# Run Rust tests with coverage
rust-coverage:
    cd src-tauri && cargo llvm-cov nextest --html

# Open Rust coverage report
rust-coverage-open:
    cd src-tauri && cargo llvm-cov nextest --html --open

# Run Rust tests in CI profile
rust-test-ci:
    cd src-tauri && cargo nextest run --profile ci

# Run Rust clippy lints
rust-lint:
    cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings

# Check Rust formatting
rust-fmt-check:
    cd src-tauri && cargo fmt --all -- --check

# Format Rust code
rust-fmt:
    cd src-tauri && cargo fmt --all

# Run Rust benchmarks
rust-bench:
    cd src-tauri && cargo bench

# Run Rust security audit
rust-audit:
    cd src-tauri && cargo audit

# Run all Rust checks (lint, format, test)
rust-check-all: rust-fmt-check rust-lint rust-test

# Watch and run Rust tests on changes
rust-watch:
    cd src-tauri && cargo watch -x test

# Generate Rust documentation
rust-doc:
    cd src-tauri && cargo doc --no-deps --document-private-items --open

# Run property-based tests only
rust-proptest:
    cd src-tauri && cargo test proptest

# Review snapshot changes (insta)
rust-snapshot-review:
    cd src-tauri && cargo insta review

# Install Rust testing tools
rust-tools-install:
    cargo install cargo-nextest --locked
    cargo install cargo-llvm-cov --locked
    cargo install cargo-watch --locked
    cargo install cargo-audit --locked
    cargo install cargo-insta --locked
    cargo install cargo-mutants --locked
