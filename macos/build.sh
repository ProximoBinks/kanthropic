#!/usr/bin/env bash
# Build Kanthropic.app (menu bar). Called from `kanthropic app` or `npm run app`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/macos/build/Kanthropic.app"
SDK="$(xcrun --show-sdk-path)"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  TARGET="arm64-apple-macos13"
else
  TARGET="x86_64-apple-macos13"
fi

if ! command -v swiftc >/dev/null; then
  echo "swiftc not found — install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

echo "bundling engine.js"
mkdir -p "$ROOT/macos/Resources"
if command -v npx >/dev/null; then
  npx --no-install esbuild "$ROOT/src/core/engine.mjs" \
    --bundle --format=iife --global-name=Kanthropic \
    --platform=neutral --target=es2020 \
    --outfile="$ROOT/macos/Resources/engine.js"
else
  echo "npx not found; expecting a prebuilt macos/Resources/engine.js" >&2
  [ -f "$ROOT/macos/Resources/engine.js" ] || exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$ROOT/macos/Info.plist" "$OUT/Contents/Info.plist"
cp "$ROOT/macos/Resources/engine.js" "$OUT/Contents/Resources/engine.js"
cp "$ROOT/src/core/grok-hook.sh" "$OUT/Contents/Resources/grok-hook.sh"
chmod 755 "$OUT/Contents/Resources/grok-hook.sh"
# Pre-recorded phrase audio (scripts/build-audio.mjs), so phrases play offline.
if [ -d "$ROOT/web/public/audio" ]; then
  cp -R "$ROOT/web/public/audio" "$OUT/Contents/Resources/audio"
fi
if [ -f "$ROOT/assets/fonts/kana.ttf" ]; then
  cp "$ROOT/assets/fonts/kana.ttf" "$OUT/Contents/Resources/kana.ttf"
fi

echo "compiling Swift ($TARGET)"
# shellcheck disable=SC2046
swiftc -parse-as-library -module-name Kanthropic \
  -target "$TARGET" \
  -sdk "$SDK" \
  -O \
  -framework SwiftUI \
  -framework AppKit \
  -framework JavaScriptCore \
  -framework AVFoundation \
  -framework ServiceManagement \
  -framework Combine \
  $(ls "$ROOT"/macos/Sources/*.swift) \
  -o "$OUT/Contents/MacOS/Kanthropic"

echo "built $OUT"
