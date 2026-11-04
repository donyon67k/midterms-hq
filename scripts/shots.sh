#!/bin/bash
# Visual check: builds the site, then screenshots the main pages at desktop and phone widths
# into shots/ (gitignored). Look them over before a release: overlaps, cut-off text, overflow.
#   npm run shots
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npx vite build >/dev/null
npx vite preview --port 4180 --strictPort >/dev/null 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null' EXIT
sleep 2
mkdir -p shots
for size in 1440,900 1024,768 390,844; do
  for page in "" "#gameday"; do
    name="shots/$(echo "${page:-home}" | tr -d '#')-${size/,/x}.png"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=$size --virtual-time-budget=6000 \
      --screenshot="$PWD/$name" "http://localhost:4180/$page" >/dev/null 2>&1
    echo "$name"
  done
done
