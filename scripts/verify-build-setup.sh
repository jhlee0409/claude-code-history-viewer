#!/bin/bash

# Build Setup Verification Script for Claude Code History Viewer
# This script verifies that the build environment is properly configured

set -e

echo "🔍 Verifying build setup for Claude Code History Viewer..."
echo ""

EXIT_CODE=0

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
    # Check if version is 18+
    NODE_MAJOR=$(node -e "console.log(process.version.split('.')[0].substring(1))")
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "⚠️  Warning: Node.js 18+ is recommended (current: $NODE_VERSION)"
    fi
else
    echo "❌ Node.js: Not found"
    EXIT_CODE=1
fi

# Check pnpm
if command -v pnpm &> /dev/null; then
    PNPM_VERSION=$(pnpm --version)
    echo "✅ pnpm: v$PNPM_VERSION"
else
    echo "❌ pnpm: Not found"
    EXIT_CODE=1
fi

# Check Rust
if command -v rustc &> /dev/null; then
    RUST_VERSION=$(rustc --version)
    echo "✅ Rust: $RUST_VERSION"
    
    # Check Cargo
    if command -v cargo &> /dev/null; then
        CARGO_VERSION=$(cargo --version)
        echo "✅ Cargo: $CARGO_VERSION"
    else
        echo "❌ Cargo: Not found"
        EXIT_CODE=1
    fi
else
    echo "❌ Rust: Not found"
    EXIT_CODE=1
fi

# Check Rust targets (macOS specific)
if [[ "$OSTYPE" == "darwin"* ]] && command -v rustup &> /dev/null; then
    echo ""
    echo "🎯 Checking Rust targets for macOS..."
    
    if rustup target list --installed | grep -q "aarch64-apple-darwin"; then
        echo "✅ aarch64-apple-darwin target: Installed"
    else
        echo "⚠️  aarch64-apple-darwin target: Not installed (run: rustup target add aarch64-apple-darwin)"
    fi
    
    if rustup target list --installed | grep -q "x86_64-apple-darwin"; then
        echo "✅ x86_64-apple-darwin target: Installed"
    else
        echo "⚠️  x86_64-apple-darwin target: Not installed (run: rustup target add x86_64-apple-darwin)"
    fi
fi

# Check if dependencies are installed
echo ""
echo "📦 Checking project dependencies..."
if [ -d "node_modules" ]; then
    echo "✅ Node.js dependencies: Installed"
else
    echo "⚠️  Node.js dependencies: Not installed (run: pnpm install)"
fi

# Check Tauri CLI
if command -v pnpm &> /dev/null && [ -f "package.json" ]; then
    if pnpm list @tauri-apps/cli &> /dev/null; then
        echo "✅ Tauri CLI: Available via pnpm"
    else
        echo "⚠️  Tauri CLI: Not found in dependencies"
    fi
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "🎉 Build environment verification complete! You're ready to build."
    echo ""
    echo "Available build commands:"
    echo "  • Development: pnpm tauri:dev"
    echo "  • Production:  pnpm tauri:build"
    if [[ "$OSTYPE" == "linux"* ]]; then
        echo "  • Linux:       pnpm tauri:build:linux"
    fi
    echo ""
    echo "🌍 The app includes full English language support by default."
else
    echo "❌ Build environment verification failed!"
    echo "   Please install the missing dependencies and run this script again."
    echo ""
    echo "💡 Tip: Run './scripts/setup-build-env.sh' to automatically install dependencies."
fi

exit $EXIT_CODE