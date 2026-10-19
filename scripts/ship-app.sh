#!/usr/bin/env bash
# Build the desktop app and replace the installed copy with it.
#   npm run app:ship                 -> installs to "CLAUDE HOME/Project Midterms.app"
#   DEST=/Applications npm run app:ship  -> installs somewhere else
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${DEST:-$(dirname "$ROOT")}"
APP="Project Midterms.app"
OLD_APPS=("Midterms HQ.app" "Project Midterm.app") # earlier names; removed on install
BUILT="$ROOT/src-tauri/target/release/bundle/macos/$APP"

echo "▶ building release app…"
cd "$ROOT"
# Local installs skip the signed updater bundle (that needs the release key; CI makes it).
npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'

if pgrep -xq "midterms-hq"; then
  echo "▶ closing running copy…"
  for name in "Project Midterms" "Project Midterm" "Midterms HQ"; do
    osascript -e "quit app \"$name\"" >/dev/null 2>&1 || true
  done
  sleep 1
fi

echo "▶ installing to $DEST/$APP"
rm -rf "${DEST:?}/$APP"
for old in "${OLD_APPS[@]}"; do rm -rf "${DEST:?}/$old"; done
cp -R "$BUILT" "$DEST/"

echo "▶ launching"
open "$DEST/$APP"
echo "✓ shipped $(date '+%H:%M:%S')"
