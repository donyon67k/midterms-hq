// Dev-server-only endpoints behind the local admin page (admin.html).
// Never part of a build: Vite only runs `configureServer` for `vite dev`.
//   GET  /__admin/control   -> live/control.json
//   POST /__admin/control   -> overwrite live/control.json
//   POST /__admin/publish   -> push live/control.json to the `live` branch (money.json untouched)
// The control file lives on its own branch so publishing never touches code on main.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILE = 'live/control.json' // local draft (gitignored on main)
const BRANCH = 'live'

// git with stdin (for mktree)
const git = (root, args, input) => new Promise((resolve, reject) => {
  const p = spawn('git', args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  let out = ''
  let err = ''
  p.stdout.on('data', (d) => { out += d })
  p.stderr.on('data', (d) => { err += d })
  p.on('close', (code) => (code ? reject(new Error(err.trim() || `git ${args[0]} failed`)) : resolve(out.trim() + (err.trim() ? `\n${err.trim()}` : ''))))
  if (input != null) p.stdin.end(input)
  else p.stdin.end()
})

// Files on the `live` branch. Each publisher sends only its own file and every other
// file keeps its published copy (the admin page never overwrites the money data that
// GitHub Actions refreshes, and vice versa).
const LIVE_FILES = ['control.json', 'money.json']

const NO_DEPLOY = '{ "git": { "deploymentEnabled": false } }\n'

// Commit live/<files> onto the `live` branch without checking it out, then push.
export async function publishLive(root, files = ['control.json']) {
  await git(root, ['fetch', 'origin', BRANCH]).catch(() => {}) // branch may not exist yet
  const parent = await git(root, ['rev-parse', '--verify', '--quiet', `origin/${BRANCH}`]).catch(() => '')
  let entries = ''
  for (const name of LIVE_FILES) {
    const local = join(root, 'live', name)
    let blob = ''
    if (files.includes(name)) {
      try { readFileSync(local); blob = await git(root, ['hash-object', '-w', local]) } catch { /* no draft */ }
    }
    if (!blob && parent) blob = await git(root, ['rev-parse', '--verify', '--quiet', `${parent}:${name}`]).catch(() => '')
    if (blob) entries += `100644 blob ${blob}\t${name}\n`
  }
  // the live branch is data only: tell Vercel not to build it as the website
  entries += `100644 blob ${await git(root, ['hash-object', '-w', '--stdin'], NO_DEPLOY)}\tvercel.json\n`
  const tree = await git(root, ['mktree'], entries)
  if (parent) {
    const prevTree = await git(root, ['rev-parse', `${parent}^{tree}`])
    if (prevTree === tree) return 'Nothing new to publish — GitHub already has this version.'
  }
  const msg = `HQ live update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
  const commit = await git(root, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', msg])
  const out = await git(root, ['push', 'origin', `${commit}:refs/heads/${BRANCH}`])
  return `Published. Every copy of the app picks this up within ~5 minutes.\n${out}`
}

const readBody = (req) => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', (c) => { s += c; if (s.length > 256 * 1024) reject(new Error('too large')) })
  req.on('end', () => resolve(s))
  req.on('error', reject)
})

export default function adminPlugin() {
  return {
    name: 'mhq-admin',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const path = join(root, FILE)
      server.middlewares.use('/__admin', async (req, res) => {
        const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
        // Browsers can't send a custom header cross-site without a CORS preflight we never
        // answer, so this blocks other websites from poking the local admin API.
        if (req.headers['x-mhq-admin'] !== '1') return send(403, { error: 'forbidden' })
        try {
          if (req.method === 'GET' && req.url === '/control') {
            let text = '{}'
            try { text = readFileSync(path, 'utf8') } catch { /* first run */ }
            return send(200, JSON.parse(text))
          }
          if (req.method === 'POST' && req.url === '/control') {
            const data = JSON.parse(await readBody(req))
            data.updatedAt = new Date().toISOString()
            mkdirSync(dirname(path), { recursive: true })
            writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
            return send(200, { ok: true, updatedAt: data.updatedAt })
          }
          if (req.method === 'POST' && req.url === '/publish') {
            return send(200, { ok: true, output: await publishLive(root) })
          }
          send(404, { error: 'not found' })
        } catch (e) {
          send(500, { error: (e.stderr || e.message || String(e)).toString().trim() })
        }
      })
    },
  }
}
