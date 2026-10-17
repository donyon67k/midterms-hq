#!/usr/bin/env bash
# Build the desktop app and replace the installed copy with it.
#   npm run app:ship                 -> installs to "CLAUDE HOME/Midterms HQ.app"
#   DEST=/Applications npm run app:ship  -> installs somewhere else
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${DEST:-$(dirname "$ROOT")}"
APP="Midterms HQ.app"
BUILT="$ROOT/src-tauri/target/release/bundle/macos/$APP"

echo "▶ building release app…"
cd "$ROOT"
npx tauri build --bundles app

if pgrep -xq "midterms-hq"; then
  echo "▶ closing running copy…"
  osascript -e 'quit app "Midterms HQ"' >/dev/null 2>&1 || true
  sleep 1
fi

echo "▶ installing to $DEST/$APP"
rm -rf "${DEST:?}/$APP"
cp -R "$BUILT" "$DEST/"

echo "▶ launching"
open "$DEST/$APP"
echo "✓ shipped $(date '+%H:%M:%S')"
