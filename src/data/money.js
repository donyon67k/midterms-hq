// Money data published to the repo's `live` branch as money.json by scripts/build-money.mjs
// (GitHub Actions, every 6 hours): FEC campaign totals and outside spending (Schedule E)
// for federal races, so no copy of the app needs its own FEC key.
// Like control.json it is plain data, so it updates every copy without a release.
import { REPO_URL, cacheGet, cacheSet, netFetch } from '../lib/desktop.js'
import { useEffect, useState } from 'react'

export const MONEY_URL = `${REPO_URL.replace('github.com', 'raw.githubusercontent.com')}/live/money.json`
const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV

// Official campaign-finance search for each state with a 2026 governor race.
// Governors report to these agencies, not the FEC.
export const STATE_PORTALS = {
  AL: ['Alabama Secretary of State · FCPA', 'https://fcpa.alabamavotes.gov/PublicSite/'],
  AK: ['Alaska Public Offices Commission', 'https://aws.state.ak.us/ApocReports/'],
  AZ: ['Arizona Secretary of State · See The Money', 'https://seethemoney.az.gov/'],
  AR: ['Arkansas Secretary of State', 'https://ethics-disclosures.sos.arkansas.gov/'],
  CA: ['California Secretary of State · Power Search', 'https://powersearch.sos.ca.gov/'],
  CO: ['Colorado Secretary of State · TRACER', 'https://tracer.sos.colorado.gov/'],
  CT: ['Connecticut SEEC · eCRIS', 'https://seec.ct.gov/Portal/eCRIS/eCrisSearch'],
  FL: ['Florida Division of Elections', 'https://dos.elections.myflorida.com/campaign-finance/'],
  GA: ['Georgia Ethics Commission · PeachFile', 'https://peachfile.ethics.ga.gov/'],
  HI: ['Hawaii Campaign Spending Commission', 'https://ags.hawaii.gov/campaign/'],
  ID: ['Idaho Secretary of State · Sunshine', 'https://sunshine.sos.idaho.gov/'],
  IL: ['Illinois State Board of Elections', 'https://www.elections.il.gov/CampaignDisclosure/'],
  IA: ['Iowa Ethics & Campaign Disclosure Board', 'https://ethics.iowa.gov/'],
  KS: ['Kansas Public Disclosure Commission', 'https://kpdc.kansas.gov/'],
  ME: ['Maine Ethics Commission', 'https://www.maine.gov/ethics/'],
  MD: ['Maryland State Board of Elections', 'https://campaignfinance.maryland.gov/'],
  MA: ['Massachusetts OCPF', 'https://www.ocpf.us/'],
  MI: ['Michigan Secretary of State', 'https://www.michigan.gov/sos/elections/disclosure/cfr'],
  MN: ['Minnesota Campaign Finance Board', 'https://cfb.mn.gov/'],
  NE: ['Nebraska Accountability & Disclosure Commission', 'https://nadc.nebraska.gov/'],
  NV: ['Nevada Secretary of State', 'https://www.nvsos.gov/sos/elections/campaign-finance'],
  NH: ['New Hampshire Secretary of State', 'https://cfs.sos.nh.gov/'],
  NM: ['New Mexico Secretary of State · CFIS', 'https://login.cfis.sos.state.nm.us/'],
  NY: ['New York State Board of Elections', 'https://publicreporting.elections.ny.gov/'],
  OH: ['Ohio Secretary of State', 'https://www.ohiosos.gov/campaign-finance/'],
  OK: ['Oklahoma Ethics Commission · Guardian', 'https://guardian.ok.gov/'],
  OR: ['Oregon Secretary of State · ORESTAR', 'https://sos.oregon.gov/elections/get-involved/pages/orestar.aspx'],
  PA: ['Pennsylvania Department of State', 'https://www.pa.gov/agencies/dos/programs/voting-and-elections/campaign-finance'],
  RI: ['Rhode Island Board of Elections', 'https://ricampaignfinance.com/'],
  SC: ['South Carolina Ethics Commission', 'https://ethicsfiling.sc.gov/'],
  SD: ['South Dakota Secretary of State', 'https://sdsos.gov/elections-voting/campaign-finance/'],
  TN: ['Tennessee Registry of Election Finance', 'https://apps.tn.gov/tncamp/'],
  TX: ['Texas Ethics Commission', 'https://www.ethics.state.tx.us/search/cf/'],
  VT: ['Vermont Secretary of State', 'https://campaignfinance.vermont.gov/'],
  WI: ['Wisconsin Ethics Commission · CFIS', 'https://campaignfinance.wi.gov/'],
  WY: ['Wyoming Secretary of State', 'https://www.wycampaignfinance.gov/'],
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v) => (Number.isFinite(+v) && v !== '' && v != null ? +v : null)
const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s"<>]+$/.test(v) ? v : null)
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const arr = (v) => (Array.isArray(v) ? v : [])
const party = (v) => (['D', 'R', 'I', 'L', 'G'].includes(v) ? v : null)

// Network data: keep only known fields with sane types.
export function sanitizeMoney(raw) {
  const r = obj(raw)
  const outside = Object.fromEntries(Object.entries(obj(r.outside)).map(([id, v]) => {
    const x = obj(v)
    const candidates = arr(x.candidates).map((c) => ({
      id: str(c.id, 12), name: str(c.name, 80), party: party(c.party),
      support: num(c.support) || 0, oppose: num(c.oppose) || 0,
    })).filter((c) => c.name).slice(0, 12)
    const spenders = arr(x.spenders).map((s) => ({
      id: str(s.id, 12), name: str(s.name, 120), type: str(s.type, 40), candidate: str(s.candidate, 80),
      cid: str(s.cid, 12), so: s.so === 'O' ? 'O' : 'S', total: num(s.total) || 0,
    })).filter((s) => s.name && s.total > 0).slice(0, 25)
    return [str(id, 40), { total: num(x.total) || 0, candidates, spenders }]
  }).filter(([id, v]) => id && v.total > 0))
  const governor = Object.fromEntries(Object.entries(obj(r.governor)).map(([st, v]) => {
    const x = obj(v)
    const candidates = arr(x.candidates).map((c) => ({
      name: str(c.name, 80), party: party(c.party), raised: num(c.raised), spent: num(c.spent), cash: num(c.cash), url: https(c.url),
    })).filter((c) => c.name && c.raised != null).slice(0, 10)
    return [str(st, 2), { candidates, asOf: str(x.asOf, 40), source: str(x.source, 120), url: https(x.url) }]
  }).filter(([st, v]) => /^[A-Z]{2}$/.test(st) && v.candidates.length))
  const totals = Object.fromEntries(Object.entries(obj(r.totals)).map(([id, v]) => {
    const x = obj(v)
    const candidates = arr(x.candidates).map((c) => ({
      id: str(c.id, 12), name: str(c.name, 80), party: party(c.party), raised: num(c.raised), spent: num(c.spent), cash: num(c.cash), through: str(c.through, 10),
    })).filter((c) => c.name && c.raised != null).slice(0, 8)
    return [str(id, 40), { through: str(x.through, 10), candidates }]
  }).filter(([id, v]) => id && v.candidates.length))
  return { generatedAt: str(r.generatedAt, 40) || null, totals, outside, governor }
}

let pending
export function fetchMoney() {
  pending ||= (async () => {
    try {
      const res = DEV ? await fetch(`/live/money.json?t=${Date.now()}`) : await netFetch(MONEY_URL)
      if (!res.ok) throw new Error(String(res.status))
      const m = sanitizeMoney(await res.json())
      cacheSet('money', m)
      return m
    } catch {
      return sanitizeMoney(await cacheGet('money')) // offline or not published yet
    }
  })()
  return pending
}

export function useMoney() {
  const [m, setM] = useState(null)
  useEffect(() => { let on = true; fetchMoney().then((x) => on && setM(x)); return () => { on = false } }, [])
  return m
}

export const fecCandidateUrl = (id) => `https://www.fec.gov/data/candidate/${id}/?cycle=2026&election_full=true`
export const fecCommitteeUrl = (id) => `https://www.fec.gov/data/committee/${id}/?cycle=2026`
export const fecOutsideUrl = (id) => `https://www.fec.gov/data/independent-expenditures/?data_type=processed&candidate_id=${id}&cycle=2026`
