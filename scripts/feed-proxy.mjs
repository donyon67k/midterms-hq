// Dev-server-only proxy so the browser preview can read outlet RSS feeds (publishers
// send no CORS headers; the desktop app fetches them natively). Only URLs on the
// feed lists and Google News searches are fetched, so this is never an open proxy.
import { FEEDS, STATE_FEEDS } from '../src/data/sources.js'

const FEED_URLS = new Set([...FEEDS, ...STATE_FEEDS].map((f) => f.url))
const ALLOWED = { has: (u) => FEED_URLS.has(u) || /^https:\/\/news\.google\.com\/rss\/search\?/.test(u || '') }

export default function feedProxy() {
  return {
    name: 'mhq-feed-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__feed', async (req, res) => {
        const url = new URL(req.url, 'http://x').searchParams.get('u')
        if (!ALLOWED.has(url)) { res.statusCode = 403; return res.end('not a known feed') }
        try {
          const r = await fetch(url, { headers: { 'User-Agent': 'MidtermsHQ/dev (+https://github.com/donyon67k/midterms-hq)' }, signal: AbortSignal.timeout(12000) })
          res.statusCode = r.status
          res.setHeader('Content-Type', 'application/xml; charset=utf-8')
          res.end(await r.text())
        } catch (e) {
          res.statusCode = 502
          res.end(String(e.message))
        }
      })
    },
  }
}
