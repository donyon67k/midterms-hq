#!/usr/bin/env node
// Fills the `governor` section of live/money.json from the states' own campaign-finance
// data. Governor candidates report to their state, not the FEC, and only some states
// publish machine-readable data: bulk downloads (CO, NE, OK, PA, IL), a JSON API (MA)
// or an open-data portal (HI). Every other state stays on Wikipedia's tables plus the
// link to its official search.
//
// The window is the 2025–26 cycle (Jan 1, 2025 onward), like the FEC's two-year cycle.
// Each state is fetched on its own: one that fails keeps its last published numbers.
// `npm run gov-money` previews; `-- --publish` pushes money.json to the `live` branch
// (GitHub Actions runs it right after the FEC job, see money.yml).
// GOV_STATES=CO,PA limits a test run.
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { publishLive } from './admin-plugin.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'live/money.json')
const MONEY_URL = 'https://raw.githubusercontent.com/donyon67k/midterms-hq/live/money.json'
const SINCE = '2025-01-01'
// some state servers turn away anything that doesn't look like a browser
const UA = 'Mozilla/5.0 (compatible; ProjectMidterms data builder; +https://github.com/donyon67k/midterms-hq)'
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
const TMP = mkdtempSync(join(tmpdir(), 'gov-money-'))
const snapshot = JSON.parse(readFileSync(join(ROOT, 'src/data/snapshot.json'), 'utf8'))

// ---------- helpers ----------

async function get(url, { browser = false, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': browser ? BROWSER_UA : UA }, signal: AbortSignal.timeout(600_000) })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      return res
    } catch (e) {
      if (i >= tries) throw e
      await new Promise((r) => setTimeout(r, 5000 * i))
    }
  }
}

async function download(url, opts) {
  const file = join(TMP, url.replace(/[^a-z0-9.]+/gi, '_').slice(-120))
  if (!existsSync(file)) await pipeline(Readable.fromWeb((await get(url, opts)).body), createWriteStream(file))
  return file
}

// Streams delimited rows (quotes, embedded newlines) as objects keyed by the header.
async function* rows(input, { delim = ',', quotes = true } = {}) {
  let header = null, row = [], field = '', inQ = false, prev = ''
  const emit = function* () {
    row.push(field); field = ''
    if (!header) header = row.map((h) => h.trim().replace(/^﻿/, ''))
    else if (row.length > 1 || row[0] !== '') yield Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']))
    row = []
  }
  for await (const chunk of input) {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('latin1')
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (inQ) {
        if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else inQ = false }
        else field += ch
      } else if (ch === '"' && quotes && field === '') inQ = true
      else if (ch === delim) { row.push(field); field = '' }
      else if (ch === '\n') { if (prev === '\r') field = field.replace(/\r$/, ''); yield* emit() }
      else field += ch
      prev = ch
    }
  }
  if (field || row.length) yield* emit()
}

// rows of the (single) file inside a zip, via the system unzip
async function* zipRows(file, opts) {
  const p = spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] })
  yield* rows(p.stdout, opts)
}
const fileRows = async function* (file, opts) {
  const { createReadStream } = await import('node:fs')
  yield* rows(createReadStream(file), opts)
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0 }
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean)
// a filing's first name can differ from the ballot name
const ALIASES = { JERRY: ['GERALD', 'JEROME'], MIKE: ['MICHAEL'], JOSH: ['JOSHUA'], JB: ['JAY', 'JAYROBERT'], DAN: ['DANIEL'], ROB: ['ROBERT'], BOB: ['ROBERT'], CINDY: ['CYNTHIA'], CYNDI: ['CYNTHIA'], KEN: ['KENNETH'], TY: ['TYLER'], JIM: ['JAMES'], JEFF: ['JEFFREY'], PHIL: ['PHILIP', 'PHILLIP'], ED: ['EDWARD'], ANDY: ['ANDREW'], TOM: ['THOMAS'], RICK: ['RICHARD'], GREG: ['GREGORY'], CD: [] }
const SUFFIX = new Set(['JR', 'SR', 'II', 'III', 'IV'])

// The ballot candidate a filing belongs to. `office` = the record is already known to be a
// governor filing, so a committee name with just the last name ("Shapiro for Pennsylvania") is enough.
function matchCand(cands, text, { office = false } = {}) {
  const words = norm(text)
  const hits = cands.filter((c) => {
    const parts = norm(c.name).filter((w) => !SUFFIX.has(w))
    const last = parts.at(-1), first = parts[0]
    if (!last || !words.includes(last)) return false
    if (office) return true
    return [first, ...(ALIASES[first] || [])].some((f) => words.includes(f))
  })
  return hits.length === 1 ? hits[0] : null
}

function raceOf(st) { return Object.values(snapshot.governor).find((r) => r.state === st) }

// candidates for the state: every ballot candidate with money, biggest first
function finish(st, totals, extra) {
  const race = raceOf(st)
  const candidates = [...totals.entries()]
    .map(([name, t]) => ({
      name,
      party: race.candidates.find((c) => c.name === name)?.party || null,
      raised: Math.round(t.raised),
      spent: t.spent == null ? null : Math.round(t.spent),
      cash: t.cash == null ? null : Math.round(t.cash),
      url: t.url || null,
    }))
    .filter((c) => c.raised > 0 || c.spent > 0)
    .sort((a, b) => b.raised - a.raised)
  if (!candidates.length) throw new Error(`${st}: no governor candidates matched`)
  return { candidates, ...extra }
}

const bump = (m, name, k, v) => {
  const t = m.get(name) || { raised: 0, spent: 0, cash: null }
  t[k] = (t[k] || 0) + v
  m.set(name, t)
  return t
}
const latest = (a, b) => (!a || (b && b > a) ? b : a)
const isoDate = (s) => {
  const t = String(s || '').trim()
  let m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''
}

// ---------- Tyler Technologies "PublicSite" bulk extracts (CO TRACER, NE NADC, OK Guardian) ----------
// One zip per year per kind; each row is a transaction. Records marked Amended = Y were replaced
// by a later version, so they're skipped. These files have no office column, so each candidate
// is matched by full name and then pinned to their biggest committee (a legislator running
// for governor also has an old legislative committee).
async function tyler(st, base, page, label, { kinds = ['ContributionLoanExtract', 'ExpenditureExtract'], jurisdiction } = {}) {
  const race = raceOf(st)
  const byOrg = new Map() // org id -> { cand, raised, spent }
  let asOf = ''
  for (const year of ['2025', '2026']) {
    for (const kind of kinds) {
      const spend = /Expend/.test(kind)
      const zip = await download(`${base}/${year}_${kind}.csv.zip`, { browser: true })
      for await (const r of zipRows(zip)) {
        if ((r.Amended || '').toUpperCase() === 'Y') continue
        if (jurisdiction && r.Jurisdiction && r.Jurisdiction !== jurisdiction) continue
        const who = r['Candidate Name'] ?? r.CandidateName ?? ''
        if (!who) continue
        const cand = matchCand(race.candidates, who)
        if (!cand) continue
        const date = isoDate(spend ? (r['Expenditure Date'] ?? r.ExpenditureDate) : (r['Receipt Date'] ?? r.ContributionDate))
        if (date < SINCE) continue
        const amt = num(spend ? (r['Expenditure Amount'] ?? r.ExpenditureAmount) : (r['Receipt Amount'] ?? r.ContributionAmount))
        const org = r['Org ID'] ?? r.CO_ID
        const o = byOrg.get(org) || { cand: cand.name, raised: 0, spent: 0 }
        o[spend ? 'spent' : 'raised'] += amt
        byOrg.set(org, o)
        asOf = latest(asOf, isoDate(r['Filed Date'] ?? r.FiledDate))
      }
    }
  }
  const best = new Map()
  for (const o of byOrg.values()) if (!best.has(o.cand) || o.raised > best.get(o.cand).raised) best.set(o.cand, o)
  const totals = new Map([...best].map(([n, o]) => [n, { raised: o.raised, spent: o.spent, cash: null }]))
  return finish(st, totals, { asOf, source: `${label} bulk data, 2025–26 filings`, url: page })
}

// ---------- Illinois State Board of Elections: quarterly report totals (D-2) ----------
async function illinois() {
  const race = raceOf('IL')
  const base = 'https://www.elections.il.gov/campaigndisclosuredatafiles'
  const tab = { delim: '\t', quotes: false }
  const cands = new Map() // candidate id -> ballot name
  for await (const r of fileRows(await download(`${base}/Candidates.txt`, { browser: true }), tab)) {
    if (!/^governor/i.test(r.Office?.trim())) continue
    const c = matchCand(race.candidates, `${r.FirstName} ${r.LastName}`)
    if (c) cands.set(r.ID, c.name)
  }
  const cmteCand = new Map()
  for await (const r of fileRows(await download(`${base}/CmteCandidateLinks.txt`, { browser: true }), tab)) {
    if (cands.has(r.CandidateID)) cmteCand.set(r.CommitteeID, cands.get(r.CandidateID))
  }
  // only the candidates' own committees (a link can also point at a party or DGA committee)
  for await (const r of fileRows(await download(`${base}/Committees.txt`, { browser: true }), tab)) {
    if (cmteCand.has(r.ID) && (r.Status?.trim() !== 'A' || /association|party/i.test(r.Name))) cmteCand.delete(r.ID)
  }
  const docs = new Map() // filed doc id -> report period
  for await (const r of fileRows(await download(`${base}/FiledDocs.txt`, { browser: true }), tab)) {
    if (!cmteCand.has(r.CommitteeID) || !/quarterly/i.test(r.DocName)) continue
    const beg = isoDate(r.RptPdBegDate)
    if (beg >= SINCE) docs.set(r.ID, { cmte: r.CommitteeID, beg, end: isoDate(r.RptPdEndDate), filed: r.RcvdDateTime })
  }
  // an amended quarterly replaces the original for the same period: keep the last one filed
  const perPeriod = new Map()
  for await (const r of fileRows(await download(`${base}/D2Totals.txt`, { browser: true }), tab)) {
    const d = docs.get(r.FiledDocID)
    if (!d) continue
    const key = `${d.cmte}|${d.beg}`
    if (!perPeriod.has(key) || d.filed > perPeriod.get(key).d.filed) perPeriod.set(key, { d, r })
  }
  const byCmte = new Map()
  for (const { d, r } of perPeriod.values()) {
    const t = byCmte.get(d.cmte) || { raised: 0, spent: 0, cash: null, end: '' }
    t.raised += num(r.TotalReceipts)
    t.spent += num(r.TotalExpend)
    if (d.end > t.end) { t.end = d.end; t.cash = num(r.EndFundsAvail) }
    byCmte.set(d.cmte, t)
  }
  const totals = new Map()
  let asOf = ''
  for (const [cmte, t] of byCmte) {
    const name = cmteCand.get(cmte)
    if (!totals.has(name) || t.raised > totals.get(name).raised) totals.set(name, t)
    asOf = latest(asOf, t.end)
  }
  return finish('IL', totals, { asOf, source: 'Illinois State Board of Elections quarterly reports, 2025–26', url: 'https://www.elections.il.gov/CampaignDisclosure/' })
}

// ---------- Pennsylvania Department of State: yearly full export ----------
async function pennsylvania() {
  const race = raceOf('PA')
  const reports = new Map() // report id -> { filer, cand, beginning, unitemized, key, submitted }
  const keep = new Map() // filer|year|cycle -> report id (an amendment replaces the earlier copy)
  const zips = {}
  for (const year of ['2025', '2026']) {
    zips[year] = await download(`https://www.pa.gov/content/dam/copapwp-pagov/en/dos/resources/voting-and-elections/campaign-finance/campaign-finance-data/${year}.zip`, { browser: true })
    for await (const r of zipMember(zips[year], `filer_${year}.txt`)) {
      if (r.OFFICE?.trim() !== 'GOV') continue
      const cand = matchCand(race.candidates, r.FILERNAME, { office: true })
      if (!cand) continue
      const id = r.CampaignfinanceID ?? r.CampaignFinanceID
      const key = `${r.FILERID}|${r.EYEAR}|${r.CYCLE}`
      reports.set(id, { filer: r.FILERID, cand: cand.name, beginning: num(r.BEGINNING), unitemized: num(r.MONETARY), key, submitted: r.SubmittedDate, raised: 0, spent: 0 })
      const prev = keep.get(key)
      if (!prev || r.SubmittedDate >= reports.get(prev).submitted) keep.set(key, id)
    }
  }
  const kept = new Set(keep.values())
  for (const year of ['2025', '2026']) {
    for await (const r of zipMember(zips[year], `contrib_${year}.txt`)) {
      const rep = kept.has(r.CampaignFinanceID) && reports.get(r.CampaignFinanceID)
      if (rep) rep.raised += num(r.CONTAMT1) + num(r.CONTAMT2) + num(r.CONTAMT3)
    }
    for await (const r of zipMember(zips[year], `receipt_${year}.txt`)) {
      const rep = kept.has(r.CampaignFinanceID) && reports.get(r.CampaignFinanceID)
      if (rep) rep.raised += num(r.RECAMT)
    }
    for await (const r of zipMember(zips[year], `expense_${year}.txt`)) {
      const rep = kept.has(r.CampaignFinanceID) && reports.get(r.CampaignFinanceID)
      if (rep) rep.spent += num(r.EXPAMT)
    }
  }
  // per filer: totals across its reports, cash at the end of its latest report
  const byFiler = new Map()
  let asOf = ''
  for (const id of kept) {
    const rep = reports.get(id)
    rep.raised += rep.unitemized
    const f = byFiler.get(rep.filer) || { cand: rep.cand, raised: 0, spent: 0, cash: null, last: '' }
    f.raised += rep.raised
    f.spent += rep.spent
    if (rep.submitted > f.last) { f.last = rep.submitted; f.cash = rep.beginning + rep.raised - rep.spent }
    byFiler.set(rep.filer, f)
    asOf = latest(asOf, isoDate(rep.submitted))
  }
  const totals = new Map()
  for (const f of byFiler.values()) if (!totals.has(f.cand) || f.raised > totals.get(f.cand).raised) totals.set(f.cand, f)
  return finish('PA', totals, { asOf, source: 'Pennsylvania Department of State campaign finance export, 2025–26 reports', url: 'https://www.pa.gov/agencies/dos/resources/voting-and-elections-resources/campaign-finance-data' })
}
async function* zipMember(file, member) {
  const p = spawn('unzip', ['-p', file, member, `*/${member}`], { stdio: ['ignore', 'pipe', 'ignore'] })
  yield* rows(p.stdout)
}

// ---------- Massachusetts OCPF: statewide candidates' year-to-date bank reports ----------
async function massachusetts() {
  const race = raceOf('MA')
  const totals = new Map()
  let asOf = ''
  for (const year of ['2025', '2026']) {
    const j = await (await get(`https://api.ocpf.us/reports/statewide/ytd/${year}?onBallot=false`, { browser: true })).json()
    for (const r of j.reports || []) {
      if (!/governor$/i.test(r.officeSought || '') || /lieutenant/i.test(r.officeSought)) continue
      const cand = matchCand(race.candidates, r.filerName)
      if (!cand) continue
      const t = bump(totals, cand.name, 'raised', num(r.receiptsYtdNumeric))
      t.spent += num(r.expendituresYtdNumeric)
      if (year === '2026' || t.cash == null) t.cash = num(r.currentCashOnHandNumeric)
      asOf = latest(asOf, isoDate(r.bankReportEndDate))
    }
  }
  return finish('MA', totals, { asOf, source: 'Massachusetts OCPF depository reports, 2025–26', url: 'https://www.ocpf.us/' })
}

// ---------- Hawaii Campaign Spending Commission: open data (Socrata) ----------
async function hawaii() {
  const race = raceOf('HI')
  const base = 'https://hicscdata.hawaii.gov/resource'
  const q = async (id, select) => {
    const p = new URLSearchParams({ $select: `candidate_name,${select}`, $where: `office='Governor' AND date >= '${SINCE}'`, $group: 'candidate_name', $limit: '100' })
    return (await get(`${base}/${id}.json?${p}`)).json()
  }
  const totals = new Map()
  let asOf = ''
  for (const [id, k] of [['jexd-xbcg', 'raised'], ['ue3d-efjr', 'raised'], ['yf4f-x3r4', 'raised'], ['3maa-4fgr', 'spent']]) {
    for (const r of await q(id, 'sum(amount) as total,max(date) as last')) {
      const cand = matchCand(race.candidates, r.candidate_name)
      if (!cand) continue
      bump(totals, cand.name, k, num(r.total))
      asOf = latest(asOf, isoDate(r.last))
    }
  }
  return finish('HI', totals, { asOf, source: 'Hawaii Campaign Spending Commission data, 2025–26 receipts', url: 'https://hicscdata.hawaii.gov/' })
}

const STATES = {
  CO: () => tyler('CO', 'https://tracer.sos.colorado.gov/PublicSite/Docs/BulkDataDownloads', 'https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx', 'Colorado TRACER', { kinds: ['ContributionData', 'ExpenditureData'], jurisdiction: 'STATEWIDE' }),
  NE: () => tyler('NE', 'https://nadc-e.nebraska.gov/PublicSite/Docs/BulkDataDownloads', 'https://nadc-e.nebraska.gov/PublicSite/DataDownload.aspx', 'Nebraska NADC'),
  OK: () => tyler('OK', 'https://guardian.ok.gov/PublicSite/Docs/BulkDataDownloads', 'https://guardian.ok.gov/PublicSite/DataDownload.aspx', 'Oklahoma Ethics Commission'),
  IL: illinois,
  PA: pennsylvania,
  MA: massachusetts,
  HI: hawaii,
}

async function main() {
  let prev = {}
  try { prev = JSON.parse(readFileSync(OUT, 'utf8')) } catch {
    prev = await (await get(MONEY_URL)).json()
  }
  const only = process.env.GOV_STATES?.split(',').map((s) => s.trim().toUpperCase())
  const governor = { ...(prev.governor || {}) }
  const failed = []
  for (const [st, run] of Object.entries(STATES)) {
    if (only && !only.includes(st)) continue
    const t0 = Date.now()
    try {
      governor[st] = await run()
      const top = governor[st].candidates.slice(0, 3).map((c) => `${c.name} $${(c.raised / 1e6).toFixed(2)}M`).join(', ')
      console.log(`${st}: ${top} (through ${governor[st].asOf}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    } catch (e) {
      failed.push(st)
      console.log(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}${st} failed, keeping the last copy: ${e.message}`)
    }
  }
  const out = { ...prev, governor, governorAt: new Date().toISOString() }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out) + '\n')
  rmSync(TMP, { recursive: true, force: true })
  console.log(`Wrote live/money.json: governor money for ${Object.keys(governor).length} states${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`)
  if (process.argv.includes('--publish')) console.log(await publishLive(ROOT, ['money.json']))
}

main().catch((e) => {
  rmSync(TMP, { recursive: true, force: true })
  console.error(process.env.GITHUB_ACTIONS ? `::error::${String(e.stack || e.message).replace(/\n/g, '%0A')}` : e.message)
  process.exit(1)
})
