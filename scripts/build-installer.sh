#!/usr/bin/env bash
# Build the Mac installer (.dmg) and drop it in ./release
#   npm run app:dmg
# Windows installers are built in the cloud by .github/workflows/release.yml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npx tauri build --bundles dmg
mkdir -p release
cp src-tauri/target/release/bundle/dmg/*.dmg release/
ls -lh release/*.dmg
