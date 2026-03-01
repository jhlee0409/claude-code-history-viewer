#!/bin/sh
# install-server.sh — One-line installer for cchv-server (Claude Code History Viewer)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jhlee0409/claude-code-history-viewer/main/install-server.sh | sh
#
# Environment variables:
#   INSTALL_DIR  — Installation directory (default: /usr/local/bin)
#   VERSION      — Specific version to install (default: latest)

set -e

REPO="jhlee0409/claude-code-history-viewer"
BINARY_NAME="cchv-server"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf '  \033[1;34m→\033[0m %s\n' "$1"; }
ok()    { printf '  \033[1;32m✔\033[0m %s\n' "$1"; }
err()   { printf '  \033[1;31m✘\033[0m %s\n' "$1" >&2; exit 1; }

need_cmd() {
    if ! command -v "$1" > /dev/null 2>&1; then
        err "Required command not found: $1"
    fi
}

# ---------------------------------------------------------------------------
# Detect OS and architecture
# ---------------------------------------------------------------------------

detect_platform() {
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Linux)  OS_TAG="linux" ;;
        Darwin) OS_TAG="macos" ;;
        *)      err "Unsupported OS: $OS (only Linux and macOS are supported)" ;;
    esac

    case "$ARCH" in
        x86_64|amd64)   ARCH_TAG="x64" ;;
        aarch64|arm64)  ARCH_TAG="arm64" ;;
        *)              err "Unsupported architecture: $ARCH (only x64 and arm64 are supported)" ;;
    esac

    PLATFORM="${OS_TAG}-${ARCH_TAG}"
}

# ---------------------------------------------------------------------------
# Resolve version
# ---------------------------------------------------------------------------

resolve_version() {
    if [ -n "${VERSION:-}" ]; then
        TAG="v${VERSION#v}"
    else
        need_cmd curl
        TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
            | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')
        if [ -z "$TAG" ]; then
            err "Failed to fetch latest release tag from GitHub"
        fi
    fi
}

# ---------------------------------------------------------------------------
# Download and install
# ---------------------------------------------------------------------------

install() {
    ARTIFACT="cchv-server-${PLATFORM}.tar.gz"
    CHECKSUM_FILE="CHECKSUMS.sha256"
    URL="https://github.com/${REPO}/releases/download/${TAG}/${ARTIFACT}"
    CHECKSUM_URL="https://github.com/${REPO}/releases/download/${TAG}/${CHECKSUM_FILE}"
    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"' EXIT

    info "Downloading ${BINARY_NAME} ${TAG} for ${PLATFORM}..."
    curl -fsSL "$URL" -o "${TMPDIR}/${ARTIFACT}" || err "Download failed. Check that ${TAG} has a ${PLATFORM} build."

    # Verify checksum if CHECKSUMS.sha256 is available in the release
    if curl -fsSL "$CHECKSUM_URL" -o "${TMPDIR}/${CHECKSUM_FILE}" 2>/dev/null; then
        info "Verifying checksum..."
        EXPECTED=$(grep "${ARTIFACT}" "${TMPDIR}/${CHECKSUM_FILE}" | awk '{print $1}')
        if [ -n "$EXPECTED" ]; then
            if command -v sha256sum > /dev/null 2>&1; then
                ACTUAL=$(sha256sum "${TMPDIR}/${ARTIFACT}" | awk '{print $1}')
            elif command -v shasum > /dev/null 2>&1; then
                ACTUAL=$(shasum -a 256 "${TMPDIR}/${ARTIFACT}" | awk '{print $1}')
            else
                info "Warning: no sha256sum or shasum found, skipping verification"
                ACTUAL="$EXPECTED"
            fi
            if [ "$ACTUAL" != "$EXPECTED" ]; then
                err "Checksum mismatch! Expected ${EXPECTED}, got ${ACTUAL}. The download may be corrupted or tampered with."
            fi
            ok "Checksum verified"
        else
            info "Warning: artifact not found in checksum file, skipping verification"
        fi
    else
        info "Warning: CHECKSUMS.sha256 not available for this release, skipping verification"
    fi

    info "Extracting..."
    tar xzf "${TMPDIR}/${ARTIFACT}" -C "$TMPDIR"

    info "Installing to ${INSTALL_DIR}/${BINARY_NAME}..."
    if [ -w "$INSTALL_DIR" ]; then
        mv "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    else
        info "Elevated permissions required to install to ${INSTALL_DIR}"
        sudo mv "${TMPDIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
    fi
    chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    printf '\n\033[1m  Claude Code History Viewer — Server Installer\033[0m\n\n'

    need_cmd curl
    need_cmd tar
    need_cmd uname

    detect_platform
    resolve_version
    install

    ok "Installed ${BINARY_NAME} ${TAG} to ${INSTALL_DIR}/${BINARY_NAME}"
    printf '\n'
    info "Quick start:"
    printf '    %s --serve --host 0.0.0.0\n' "$BINARY_NAME"
    printf '\n'
    info "Options:"
    printf '    --port <number>    Server port (default: 3727)\n'
    printf '    --token <value>    Custom auth token\n'
    printf '    --no-auth          Disable authentication\n'
    printf '\n'
    info "systemd service template: https://github.com/${REPO}/blob/main/contrib/cchv.service"
    printf '\n'
}

main
