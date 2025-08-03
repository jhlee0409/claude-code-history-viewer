#!/bin/bash

# Build Environment Setup Script for Claude Code History Viewer
# This script sets up the development environment for building the app

set -e

echo "🔧 Setting up build environment for Claude Code History Viewer..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check if pnpm is installed, install if not
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    npm install -g pnpm
else
    echo "✅ pnpm found: $(pnpm --version)"
fi

# Check if Rust is installed
if ! command -v rustc &> /dev/null; then
    echo "🦀 Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo "✅ Rust found: $(rustc --version)"
fi

# Ensure Rust environment is loaded
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

# Add required Rust targets for universal macOS builds
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🎯 Adding required Rust targets for macOS universal builds..."
    rustup target add x86_64-apple-darwin 2>/dev/null || true
    rustup target add aarch64-apple-darwin 2>/dev/null || true
    echo "✅ Rust targets configured for universal macOS builds"
fi

# Install project dependencies
echo "📥 Installing project dependencies..."
pnpm install

echo ""
echo "🎉 Build environment setup complete!"
echo ""
echo "Next steps:"
echo "  • For development: pnpm tauri:dev"
echo "  • For production build: pnpm tauri:build"
echo "  • For Linux build: pnpm tauri:build:linux"
echo ""
echo "📚 The app includes full English language support by default."
echo "   Additional languages: Korean, Japanese, Chinese (Simplified & Traditional)"