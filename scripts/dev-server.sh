#!/usr/bin/env bash
# Dev server for `npm run app`: reuse one already running on :5199, else start it.
if curl -s -o /dev/null http://localhost:5199; then
  echo "dev server already running on :5199 — reusing it"
  exec tail -f /dev/null
fi
exec npx vite --port 5199 --strictPort
