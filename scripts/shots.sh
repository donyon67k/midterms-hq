#!/bin/bash
# Visual check: builds the site, screenshots the main pages at desktop, tablet and phone widths
# into shots/ (gitignored), and lists anything wider than the screen. Look the images over
# before a release: overlaps, cut-off text, overflow.
#   npm run shots
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npx vite build >/dev/null
# Headless Chrome won't open a window narrower than ~500px, so each size is framed in an iframe.
cat > dist/_frame.html <<'HTML'
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}iframe{border:0;display:block}</style>
<iframe id="f"></iframe><pre id="out" style="display:none"></pre>
<script>
const q = new URLSearchParams(location.search), w = +q.get('w'), h = +q.get('h'), f = document.getElementById('f')
f.style.width = w + 'px'; f.style.height = h + 'px'; f.src = '/' + (q.get('page') || '')
setTimeout(() => {
  const d = f.contentDocument, hits = []
  for (const el of d.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.right <= w + 1 || !r.width || getComputedStyle(el).position === 'fixed') continue
    let p = el.parentElement, clipped = false
    while (p && !clipped) { clipped = /auto|scroll|hidden/.test(getComputedStyle(p).overflowX); p = p.parentElement }
    if (!clipped) hits.push(el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' (right edge ' + Math.round(r.right) + 'px)')
  }
  const out = document.getElementById('out')
  out.textContent = hits.length ? 'OVERFLOW: ' + hits.slice(0, 8).join(', ') : 'ok'
}, 6000)
</script>
HTML
npx vite preview --port 4180 --strictPort >/dev/null 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null; rm -f dist/_frame.html' EXIT
sleep 2
mkdir -p shots
for size in 1440x900 1024x768 390x844; do
  w=${size%x*}; h=${size#*x}
  for page in "" "%23gameday"; do
    name="shots/$( [ -z "$page" ] && echo home || echo gameday )-$size.png"
    url="http://localhost:4180/_frame.html?w=$w&h=$h&page=$page"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=$(( w < 500 ? 500 : w )),$h --virtual-time-budget=8000 --screenshot="$PWD/$name" "$url" >/dev/null 2>&1
    check=$("$CHROME" --headless=new --disable-gpu --window-size=$(( w < 500 ? 500 : w )),$h --virtual-time-budget=8000 --dump-dom "$url" 2>/dev/null | sed -n 's/.*<pre id="out"[^>]*>\(.*\)<\/pre>.*/\1/p')
    echo "$name  ${check:-?}"
  done
done
