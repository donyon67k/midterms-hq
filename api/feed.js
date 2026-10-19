// Vercel serverless function: the website's news feed fetcher (/api/feed?u=…).
// Same allow-listed handler the dev and preview servers use.
export { handleFeed as default } from '../scripts/feed-proxy.mjs'
