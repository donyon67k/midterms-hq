import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/press-start-2p/400.css'
import '@fontsource/share-tech-mono/400.css'
import './index.css'
import App from './App.jsx'
import { Analytics } from '@vercel/analytics/react'
import { IS_DESKTOP, routeExternalLinks } from './lib/desktop.js'

routeExternalLinks()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {/* visitor counts for the website only (Vercel Web Analytics); the desktop app sends nothing */}
    {!IS_DESKTOP && <Analytics />}
  </StrictMode>,
)
