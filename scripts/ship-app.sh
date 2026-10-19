#!/usr/bin/env bash
# Build the desktop app and replace the installed copy with it.
#   npm run app:ship                 -> installs to "CLAUDE HOME/Project Midterm.app"
#   DEST=/Applications npm run app:ship  -> installs somewhere else
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${DEST:-$(dirname "$ROOT")}"
APP="Project Midterm.app"
OLD_APP="Midterms HQ.app" # name before the rename; removed on install
BUILT="$ROOT/src-tauri/target/release/bundle/macos/$APP"

echo "▶ building release app…"
cd "$ROOT"
# Local installs skip the signed updater bundle (that needs the release key; CI makes it).
npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'

if pgrep -xq "midterms-hq"; then
  echo "▶ closing running copy…"
  osascript -e 'quit app "Project Midterm"' >/dev/null 2>&1 || true
  osascript -e 'quit app "Midterms HQ"' >/dev/null 2>&1 || true
  sleep 1
fi

echo "▶ installing to $DEST/$APP"
rm -rf "${DEST:?}/$APP" "${DEST:?}/$OLD_APP"
cp -R "$BUILT" "$DEST/"

echo "▶ launching"
open "$DEST/$APP"
echo "✓ shipped $(date '+%H:%M:%S')"
