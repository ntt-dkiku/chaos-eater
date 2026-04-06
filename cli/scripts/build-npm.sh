#!/usr/bin/env bash
# Build the Rust CLI and package it for npm distribution.
#
# Usage:
#   ./scripts/build-npm.sh          # Build for current platform only
#   ./scripts/build-npm.sh --all    # Cross-compile for all platforms (requires targets)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
NPM_DIR="$CLI_DIR/npm"
VERSION="$(grep '^version' "$CLI_DIR/Cargo.toml" | head -1 | sed 's/.*"\(.*\)"/\1/')"

echo "Building chaos-eater v${VERSION}"

# Detect current platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
esac

build_target() {
  local rust_target="$1"
  local npm_platform="$2"
  local pkg_dir="$NPM_DIR/cli-${npm_platform}/bin"

  echo "  Building for ${npm_platform} (${rust_target})..."

  mkdir -p "$pkg_dir"
  cargo build --release --target "$rust_target" --manifest-path "$CLI_DIR/Cargo.toml"
  cp "$CLI_DIR/target/${rust_target}/release/chaos-eater" "$pkg_dir/chaos-eater"
  chmod +x "$pkg_dir/chaos-eater"

  # Generate checksum
  local checksum
  checksum="$(shasum -a 256 "$pkg_dir/chaos-eater" | cut -d' ' -f1)"
  echo "  Checksum (${npm_platform}): ${checksum}"
  echo "${npm_platform}=${checksum}" >> "$CLI_DIR/checksums.txt"
}

build_current() {
  echo "  Building for current platform (${OS}-${ARCH})..."
  cargo build --release --manifest-path "$CLI_DIR/Cargo.toml"

  local pkg_dir="$NPM_DIR/cli-${OS}-${ARCH}/bin"
  mkdir -p "$pkg_dir"
  cp "$CLI_DIR/target/release/chaos-eater" "$pkg_dir/chaos-eater"
  chmod +x "$pkg_dir/chaos-eater"

  local checksum
  checksum="$(shasum -a 256 "$pkg_dir/chaos-eater" | cut -d' ' -f1)"
  echo "  Checksum: ${checksum}"
}

# Update version in all package.json files
for pkg_json in "$NPM_DIR"/*/package.json; do
  sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" "$pkg_json" 2>/dev/null || true
done

rm -f "$CLI_DIR/checksums.txt"

if [[ "${1:-}" == "--all" ]]; then
  # Cross-compile requires targets: rustup target add <target>
  build_target "aarch64-apple-darwin"  "darwin-arm64"
  build_target "x86_64-apple-darwin"   "darwin-x64"
  build_target "x86_64-unknown-linux-gnu"   "linux-x64"
  build_target "aarch64-unknown-linux-gnu"  "linux-arm64"
else
  build_current
fi

echo ""
echo "Done! Packages ready in ${NPM_DIR}/"
echo ""
echo "To install locally:"
echo "  cd ${NPM_DIR}/cli-${OS}-${ARCH} && npm link"
echo "  cd ${NPM_DIR}/chaos-eater && npm link @chaos-eater/cli-${OS}-${ARCH} && npm link"
echo ""
echo "To pack for distribution:"
echo "  cd ${NPM_DIR}/cli-${OS}-${ARCH} && npm pack"
echo "  cd ${NPM_DIR}/chaos-eater && npm pack"
