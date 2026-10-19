import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import adminPlugin from './scripts/admin-plugin.mjs'
import feedProxy from './scripts/feed-proxy.mjs'

// https://vite.dev/config/
export default defineConfig({
  // adminPlugin (dev) and feedProxy (dev + preview) are server middleware; builds never include them
  plugins: [react(), adminPlugin(), feedProxy()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
