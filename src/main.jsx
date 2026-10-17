import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/press-start-2p/400.css'
import '@fontsource/share-tech-mono/400.css'
import './index.css'
import App from './App.jsx'
import { routeExternalLinks } from './lib/desktop.js'

routeExternalLinks()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
