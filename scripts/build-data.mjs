// Builds src/data/snapshot.json from live Wikipedia data.
// The app ships with this snapshot and then refreshes live in the browser.
// Usage: npm run data
import { writeFileSync } from 'node:fs'
import { PAGES } from '../src/data/wiki.js'
import { buildDataset } from '../src/data/live.js'

const API = 'https://en.wikipedia.org/w/api.php'

async function get(title) {
  const url = `${API}?action=query&prop=revisions&rvprop=content|timestamp|ids&rvslots=main&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(title)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'MidtermsHQ-build/1.0 (+https://github.com/donyon67k/midterms-hq)' } })
  const j = await res.json()
  const page = j.query.pages[0]
  const rev = page.revisions[0]
  return { text: rev.slots.main.content, timestamp: rev.timestamp, revid: rev.revid, title: page.title }
}

const [senate, governor, house, houseRatings, measures] = await Promise.all(
  [PAGES.senate, PAGES.governor, PAGES.house, PAGES.houseRatings, PAGES.measures].map(get),
)
const data = buildDataset({ senate, governor, house, houseRatings, measures })
const out = new URL('../src/data/snapshot.json', import.meta.url)
writeFileSync(out, JSON.stringify(data))
const n = (o) => Object.values(o).flat().length
console.log(`snapshot written: ${Object.keys(data.senate).length} senate, ${Object.keys(data.governor).length} governor, ${n(data.house)} house, ${n(data.measures)} measures`)
