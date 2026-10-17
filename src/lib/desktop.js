/* global __APP_VERSION__ */
// Bridges to the native shell when running as the Tauri desktop app.
// In a plain browser every helper falls back to the web equivalent.

export const IS_DESKTOP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const REPO_URL = 'https://github.com/donyon67k/midterms-hq'
// Identifies the app to Wikipedia & co. as their API etiquette asks (contact = project page).
export const USER_AGENT = `MidtermsHQ/${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'} (+${REPO_URL})`

// Native HTTP: no CORS limits, real User-Agent, same Response API as fetch().
let httpFetch
export async function netFetch(url, init = {}) {
  // Browsers can't set User-Agent; Wikimedia reads Api-User-Agent instead.
  if (!IS_DESKTOP) return fetch(url, /wiki[mp]edia\.org/.test(url) ? { ...init, headers: { 'Api-User-Agent': USER_AGENT, ...init.headers } } : init)
  httpFetch ||= (await import('@tauri-apps/plugin-http')).fetch
  return httpFetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } })
}

// Disk-backed cache (no ~5 MB localStorage ceiling) on desktop.
let storePromise
const store = () => (storePromise ||= import('@tauri-apps/plugin-store').then((m) => m.load('cache.json', { autoSave: 2000, defaults: {} })))

export async function cacheGet(key) {
  if (IS_DESKTOP) return (await store()).get(key)
  try {
    const raw = localStorage.getItem(`mhq:${key}`)
    return raw ? JSON.parse(raw) : undefined
  } catch { return undefined }
}

export async function cacheSet(key, value) {
  if (IS_DESKTOP) return (await store()).set(key, value)
  try { localStorage.setItem(`mhq:${key}`, JSON.stringify(value)) } catch { /* quota */ }
}

// Native notification (desktop only), asking for permission the first time.
export async function notify(title, body) {
  if (!IS_DESKTOP) return
  try {
    const n = await import('@tauri-apps/plugin-notification')
    let ok = await n.isPermissionGranted()
    if (!ok) ok = (await n.requestPermission()) === 'granted'
    if (ok) n.sendNotification({ title, body })
  } catch { /* notifications unavailable */ }
}

// External links open in the default browser instead of inside the app window.
export function routeExternalLinks() {
  if (!IS_DESKTOP) return
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href^="http"]')
    if (!a || e.defaultPrevented) return
    e.preventDefault()
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    openUrl(a.href)
  })
}
