import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import adminPlugin from './scripts/admin-plugin.mjs'
import feedProxy from './scripts/feed-proxy.mjs'

// https://vite.dev/config/
// link previews need an absolute image URL; Vercel provides the production domain at build time
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://midterms-hq.vercel.app'
const siteUrlPlugin = () => ({
  name: 'site-url',
  transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
})

export default defineConfig({
  // adminPlugin (dev) and feedProxy (dev + preview) are server middleware; builds never include them
  plugins: [react(), adminPlugin(), feedProxy(), siteUrlPlugin()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
