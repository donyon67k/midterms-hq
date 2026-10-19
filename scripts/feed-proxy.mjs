// News feed fetcher for the website. Publishers send no CORS headers, so browsers can't
// read their RSS directly (the desktop app fetches natively). Only URLs on the feed lists
// and Google News searches are fetched, so this is never an open proxy. Served at
// /api/feed by the dev server and `npm run web`; a hosted site runs the same handler.
import { FEEDS, STATE_FEEDS } from '../src/data/sources.js'

const FEED_URLS = new Set([...FEEDS, ...STATE_FEEDS].map((f) => f.url))
export const allowedFeed = (u) => FEED_URLS.has(u) || /^https:\/\/news\.google\.com\/rss\/search\?/.test(u || '')

export async function handleFeed(req, res) {
  const url = new URL(req.url, 'http://x').searchParams.get('u')
  if (!allowedFeed(url)) { res.statusCode = 403; return res.end('not a known feed') }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'MidtermsHQ/web (+https://github.com/donyon67k/midterms-hq)' }, signal: AbortSignal.timeout(12000) })
    res.statusCode = r.status
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    // The CDN holds each feed for 2 minutes (serving a stale copy while it refreshes), so
    // publishers see one request per feed no matter how many people are on the site.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600')
    res.end(await r.text())
  } catch (e) {
    res.statusCode = 502
    res.end(String(e.message))
  }
}

export default function feedProxy() {
  return {
    name: 'mhq-feed-proxy',
    configureServer(server) { server.middlewares.use('/api/feed', handleFeed) },
    configurePreviewServer(server) { server.middlewares.use('/api/feed', handleFeed) },
  }
}
