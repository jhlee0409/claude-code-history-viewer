#!/usr/bin/env bash
# Build the two artifacts a capture run serves:
#   1. the frontend bundle  (vite build, no typecheck) -> <out-dist>
#   2. the debug WebUI server binary (cargo build --features webui-server) -> <out-bin>
#
# usage: build.sh <repo-dir> <out-dist> <out-bin> [<cargo-target-dir>]
#
# <repo-dir> may be the main checkout or a temporary worktree of a base ref.
# Builds live in a script on purpose: the run is invoked from run.mjs, never
# typed inline. Sharing <cargo-target-dir> between the checkout and a worktree
# reuses every compiled dependency, so a base build only recompiles this crate.
set -euo pipefail

repo_dir="$(cd "$1" && pwd)"
out_dist="$2"
out_bin="$3"
target_dir="${4:-$repo_dir/src-tauri/target}"

if [[ ! -f "$repo_dir/package.json" || ! -f "$repo_dir/src-tauri/Cargo.toml" ]]; then
  echo "build.sh: $repo_dir is not a claude-code-history-viewer checkout" >&2
  exit 2
fi

echo "▸ frontend: vite build ($repo_dir) -> $out_dist"
(
  cd "$repo_dir"
  # A worktree of a base ref has no node_modules yet; pnpm links from the
  # shared store, so this is fast and mostly offline.
  if [[ ! -d node_modules ]]; then
    env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline
  fi
  pnpm exec vite build --outDir "$out_dist" --emptyOutDir --logLevel error
)

echo "▸ server: cargo build --features webui-server ($repo_dir) [target: $target_dir]"
# rust-embed checks at compile time that ../dist exists; the binary is always
# run with --dist, so an empty placeholder is enough for a fresh checkout.
mkdir -p "$repo_dir/dist"
CARGO_TARGET_DIR="$target_dir" cargo build \
  --manifest-path "$repo_dir/src-tauri/Cargo.toml" \
  --features webui-server \
  --quiet

mkdir -p "$(dirname "$out_bin")"
# Copy right away: another checkout building into the same target dir would
# overwrite target/debug/<bin>.
# Copy to a temp file beside <out-bin>, then rename it into place. `cp` over an
# existing <out-bin> rewrites the same inode, and macOS keeps the old code
# signature cached for that inode, so the next exec is SIGKILLed ("invalid
# code signature"). A rename gives <out-bin> a fresh inode every build.
tmp_bin="$(mktemp "$(dirname "$out_bin")/.$(basename "$out_bin").XXXXXX")"
trap 'rm -f "$tmp_bin"' EXIT
cp "$target_dir/debug/claude-code-history-viewer" "$tmp_bin"
chmod 755 "$tmp_bin"
mv -f "$tmp_bin" "$out_bin"
trap - EXIT
echo "▸ server binary: $out_bin"
