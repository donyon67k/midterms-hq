import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import adminPlugin from './scripts/admin-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  // adminPlugin only exists on the dev server (npm run admin); builds never include it
  plugins: [react(), adminPlugin()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
