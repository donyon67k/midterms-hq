import { useEffect, useMemo, useState } from 'react'
import { Clock } from 'pixelarticons/react/Clock.js'
import { Close } from 'pixelarticons/react/Close.js'
import { EyeOff } from 'pixelarticons/react/EyeOff.js'
import { MapPin } from 'pixelarticons/react/MapPin.js'
import { Reload } from 'pixelarticons/react/Reload.js'
import { Scale } from 'pixelarticons/react/Scale.js'
import { Search } from 'pixelarticons/react/Search.js'
import { TrendingUp } from 'pixelarticons/react/TrendingUp.js'
import { Zap } from 'pixelarticons/react/Zap.js'
import { STATES } from '../data/wiki.js'
import { cachedNews, fetchRaceNews, raceIndex, raceKey, searchNews, storyScore, tagRaces } from '../data/news.js'
import { FEEDS, LEAN_LABEL, LEAN_SHORT, STATE_FEEDS, VERDICT, leanOf, outletName, tilt } from '../data/sources.js'
import { raceTitle, ratingClass, timeAgo } from '../lib/util.js'
import { Icon } from './Sprites.jsx'
import Block from './Block.jsx'

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
const leanClass = (l) => (l === 'local' ? 'lean-local' : l == null ? 'lean-none' : `lean-${['l2', 'l1', 'c', 'r1', 'r2'][l + 2]}`)
const leanSort = (d) => (typeof leanOf(d) === 'number' ? leanOf(d) : 9)

// The five lean steps, left to right (diverging: blue, light blue, neutral, light red, red).
const STEPS = [['L', 'LEFT'], ['LL', 'LEAN LEFT'], ['C', 'CENTER'], ['LR', 'LEAN RIGHT'], ['R', 'RIGHT']]
const STEP_FILL = ['#3a78ff', '#94b6ff', '#8c8c99', '#ffa096', '#ff4040']

// Outlet logo (DuckDuckGo's favicon service; only the outlet's domain is sent).
export function Favicon({ domain }) {
  const [ok, setOk] = useState(true)
  if (!domain || !ok) return <span className="favicon none" aria-hidden="true" />
  return <img className="favicon" src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} />
}

function tiltTitle(t) {
  const counts = STEPS.map(([s], i) => `${s} ${t.steps[i]}`).join(' · ')
  return `${VERDICT[t.verdict]} — ${counts}${t.local ? ` · local ${t.local}` : ''}${t.unrated ? ` · unrated ${t.unrated}` : ''}${t.score != null ? ` · balance ${t.score}/100` : ''}`
}

// Pixel meter: a column per lean step, stacked by outlet count, with an arrow at
// the coverage's center of gravity.
function TiltMeter({ t, width = 46 }) {
  const max = Math.max(1, ...t.steps)
  const x = ((t.avg + 2) / 4) * 29
  return (
    <svg className="tilt-svg" width={width} height={(width * 17) / 29} viewBox="0 0 29 17" shapeRendering="crispEdges" aria-hidden="true">
      {t.steps.map((n, i) => {
        const lv = n ? Math.max(1, Math.round((n / max) * 5)) : 0
        return Array.from({ length: 5 }, (_, k) => (
          <rect key={`${i}-${k}`} x={i * 6} y={10 - k * 2.2} width={5} height={1.6} fill={k < lv ? STEP_FILL[i] : '#141c30'} />
        ))
      })}
      {STEP_FILL.map((c, i) => <rect key={c} x={i * 6} y={12.4} width={i < 4 ? 6 : 5} height={1} fill={c} opacity={0.5} />)}
      {t.rated > 0 && <polygon points={`${x - 1.8},17 ${x + 1.8},17 ${x},13.8`} fill="#fff" />}
    </svg>
  )
}

const verdictClass = (v) => `verdict v-${v}`

export function Blindspot({ side }) {
  if (!side) return null
  return (
    <span className={`blindspot ${side}`} title={`Covered almost only by ${side === 'left' ? 'right' : 'left'}-leaning outlets: ${side}-leaning readers may never see it`}>
      <EyeOff width={11} height={11} /> MISSED BY {side.toUpperCase()}
    </span>
  )
}

// Compact TILT reading for a story row.
export function Tilt({ outlets }) {
  const t = tilt(outlets)
  return (
    <span className="tilt" title={tiltTitle(t)}>
      <TiltMeter t={t} />
      <span className={verdictClass(t.verdict)}>{VERDICT[t.verdict]}</span>
    </span>
  )
}

// Full TILT card: who's covering a race or a search, step by step.
export function TiltCard({ outlets, label = 'HQ TILT' }) {
  const t = tilt(outlets)
  const max = Math.max(1, ...t.steps)
  return (
    <div className="tilt-card" title={tiltTitle(t)}>
      <div className="tilt-card-head">
        <span className="pixel tilt-label"><Scale width={12} height={12} /> {label}</span>
        <span className={`${verdictClass(t.verdict)} big`}>{VERDICT[t.verdict]}</span>
        {t.score != null && <span className="tilt-score"><b>{t.score}</b>/100 BALANCE</span>}
      </div>
      <div className="tilt-cols">
        {STEPS.map(([s, name], i) => (
          <div key={s} className="tilt-col" title={`${name}: ${t.steps[i]} outlet${t.steps[i] === 1 ? '' : 's'}`}>
            <span className="tilt-n">{t.steps[i]}</span>
            <span className="tilt-well"><span className="tilt-bar" style={{ height: `${t.steps[i] ? Math.max(12, (t.steps[i] / max) * 100) : 0}%`, '--c': STEP_FILL[i] }} /></span>
            <span className="tilt-step">{s}</span>
          </div>
        ))}
      </div>
      <div className="tilt-track" aria-hidden="true">
        <span>◀ LEFT</span>
        <i>{t.rated > 0 && <b style={{ left: `${((t.avg + 2) / 4) * 100}%` }} />}</i>
        <span>RIGHT ▶</span>
      </div>
      <div className="tilt-foot dim">
        {t.rated} rated outlet{t.rated === 1 ? '' : 's'}{t.local ? ` · +${t.local} local` : ''}{t.unrated ? ` · +${t.unrated} unrated` : ''}
        <Blindspot side={t.blindspot} />
      </div>
    </div>
  )
}

// Thumbnail: the story's photo, or a pixel placard for its race type.
function Thumb({ s, tags, big }) {
  const [ok, setOk] = useState(true)
  const type = tags?.[0]?.type || (s.beats || []).find((b) => b !== 'all') || 'news'
  if (s.image && ok) return <img className="story-img" src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} />
  return (
    <div className={`story-img placard p-${type}`} aria-hidden="true">
      <Icon name={type} size={big ? 44 : 26} color="#00ff41" />
      <Favicon domain={s.domain} />
    </div>
  )
}

export function StoryRow({ s, lead, card, tags = [], onPick, compact }) {
  const [open, setOpen] = useState(false)
  const t = tilt(s.outlets)
  return (
    <article className={`story ${lead ? 'lead' : ''} ${card ? 'card' : ''} ${compact ? 'compact' : ''}`}>
      {(lead || card) && <Thumb s={s} tags={tags} big={lead} />}
      <div className="story-body">
        <a className="story-title" href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
        <div className="story-meta">
          <span className={`story-src ${leanClass(leanOf(s.domain))}`}><Favicon domain={s.domain} />{outletName(s.domain)}</span>
          <span className="story-time"><Clock width={10} height={10} />{timeAgo(s.at)}</span>
        </div>
        <div className="story-meta">
          <Tilt outlets={s.outlets} />
          <Blindspot side={t.blindspot} />
          {s.outlets.length > 1 && (
            <button type="button" className="story-more" onClick={() => setOpen(!open)} aria-expanded={open}>
              {s.outlets.length} SOURCES {open ? '▴' : '▾'}
            </button>
          )}
          {tags.map((r) => (
            <button key={r.id} type="button" className={`story-tag ${ratingClass(r.consensus?.label)}`} onClick={() => onPick?.(r)} title="Open race file">
              {raceTitle(r, STATES)}
            </button>
          ))}
        </div>
        {open && (
          <ul className="story-sources">
            {[...s.articles].sort((x, y) => leanSort(x.domain) - leanSort(y.domain)).map((a) => (
              <li key={a.url}>
                <span className={`lean-chip ${leanClass(leanOf(a.domain))}`} title={LEAN_LABEL[leanOf(a.domain)]}>{LEAN_SHORT[leanOf(a.domain)]}</span>
                <span className="src-name"><Favicon domain={a.domain} />{outletName(a.domain)}</span>
                <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

// Headlines you pinned in HQ Admin.
function Pinned({ items }) {
  return items.map((n) => (
    <article key={n.url} className="story pinned">
      <div className="story-body">
        <a className="story-title" href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
        <div className="story-meta"><span className="pixel hq-mark">◆ HQ</span><span className="story-src"><Favicon domain={host(n.url)} />{host(n.url)}</span></div>
      </div>
    </article>
  ))
}

export function useRaceNews(race, urgent = true) {
  const [feed, setFeed] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!race) return undefined
    let live = true
    setFeed(null)
    setErr(null)
    let retry
    cachedNews(raceKey(race)).then((c) => live && c && setFeed((f) => f || c))
    const early = (v) => live && setFeed((f) => (f && !f.pending && f.stories.length >= v.stories.length ? f : v))
    const load = () => fetchRaceNews(race, { urgent, onFeeds: early }).then((v) => {
      if (!live) return
      setFeed(v)
      // The search half failed: try again in a bit.
      if (v.partial) retry = setTimeout(load, 2.5 * 60 * 1000)
    }).catch((e) => live && setErr(e.message))
    load()
    return () => { live = false; clearTimeout(retry) }
  }, [race?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { feed, err }
}

function FeedStatus({ feed, err, empty }) {
  if (err && !feed) return <div className="dim">News wire unavailable ({err}).</div>
  if (!feed) return <div className="dim blink">Pulling the wire…</div>
  if (feed.pending) return <div className="dim news-explain blink">{feed.stories.length ? 'Searching every outlet…' : 'Searching state and local coverage…'}</div>
  if (!feed.stories.length) return <div className="dim">{feed.partial ? 'Nothing in the outlet feeds yet, and the wider search didn’t answer. Retrying in a few minutes.' : empty}</div>
  if (feed.partial) return <div className="dim news-explain">Wider search unavailable; showing outlet and statehouse feeds only for now.</div>
  return null
}

const RACE_EMPTY = 'No coverage naming these candidates in the last 14 days.'

// Breaking: a story about this race from the last 3 hours that several outlets are
// already carrying, or that reports a race-changing event.
const BREAKING_AGE = 3 * 3600e3
const BIG_NEWS = /\b(breaking|drops? out|withdraw\w*|suspends?|suspended|ends? (?:his|her|their) campaign|indict\w*|arrest\w*|charged|resign\w*|dies|died|concedes?|conceded|projected|declared (?:the )?winner|wins (?:the )?(?:race|seat|election|primary)|recount|lawsuit|court rules?|ruling|disqualif\w*|scandal)\b/i
export function breaking(stories = [], now = Date.now()) {
  return stories.find((s) => now - Date.parse(s.at) < BREAKING_AGE && (s.outlets.length >= 3 || BIG_NEWS.test(s.title))) || null
}

// Banner at the top of a race file, shown only for breaking news about the race.
// Clicking jumps to the news wire at the bottom.
export function NewsBar({ wire, onOpen }) {
  const s = breaking(wire.feed?.stories)
  if (!s) return null
  return (
    <button type="button" className="news-bar" onClick={onOpen} title="Jump to the news wire">
      <span className="pixel news-bar-tag blink">● BREAKING</span>
      <span className="news-bar-title">{s.title}</span>
      <span className="news-bar-meta dim"><Favicon domain={s.domain} />{outletName(s.domain)} · {timeAgo(s.at)}{s.outlets.length > 1 ? ` · ${s.outlets.length} outlets` : ''}</span>
      <span className="news-bar-more">WIRE ▾</span>
    </button>
  )
}

// The NEWS WIRE section inside a race file, below the hard numbers.
export function RaceNews({ race, wire, id }) {
  const { feed, err } = wire
  const [all, setAll] = useState(false)
  const mine = race.hqNews || []
  const stories = feed?.stories || []
  const shown = all ? stories : stories.slice(0, 4)
  return (
    <Block title={<>▣ NEWS WIRE · CONTEXT{feed ? ` · ${timeAgo(feed.at)}` : ''}</>} closed className="news-block" id={id}>
      <p className="dim news-explain">
        Headlines add context to the data above, they don&apos;t replace it. Ratings, polls and money come from forecasters,
        pollsters and official filings; news coverage is shown with its lean so you can weigh it.
      </p>
      {stories.length > 0 && <TiltCard outlets={stories.flatMap((s) => s.outlets)} label="RACE COVERAGE" />}
      <Pinned items={mine} />
      {shown.map((s) => <StoryRow key={s.url} s={s} compact />)}
      {stories.length > 4 && (
        <button type="button" className="btn-mini" onClick={() => setAll(!all)}>{all ? 'SHOW FEWER' : `+${stories.length - 4} MORE`}</button>
      )}
      {!mine.length && <FeedStatus feed={feed} err={err} empty={RACE_EMPTY} />}
    </Block>
  )
}

const FILTERS = [['all', 'ALL'], ['senate', 'SENATE'], ['governor', 'GOVERNOR'], ['house', 'HOUSE']]
const VIEWS = [['top', 'TOP', TrendingUp], ['latest', 'LATEST', Zap], ['blind', 'BLINDSPOTS', EyeOff]]
const SPREAD = FEEDS.reduce((o, f) => { const l = leanOf(f.domain); o[l] = (o[l] || 0) + 1; return o }, {})
const close = (r) => Math.abs(r?.consensus?.score ?? 9)

// Races whose name, state or candidates match every word of a search.
function matchRaces(races, q) {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1)
  if (!terms.length) return []
  // A candidate's last name alone also counts, so nicknames ("Tom" for Thomas) still find them.
  const lastName = (c) => c.name.toLowerCase().replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/, '').split(' ').pop()
  return races.filter((r) => {
    const hay = `${raceTitle(r, STATES)} ${STATES[r.state]} ${r.state} ${r.type} ${r.candidates.map((c) => c.name).join(' ')}`.toLowerCase()
    return terms.every((t) => hay.includes(t)) || r.candidates.some((c) => (c.party === 'D' || c.party === 'R') && terms.at(-1) === lastName(c))
  }).sort((a, b) => close(a) - close(b)).slice(0, 10)
}

// Full-width news desk: the day's biggest stories plus a per-race wire.
export default function NewsDesk({ data, news, onRefresh, control, watch, onPick, onClose, query = '', onQuery }) {
  const races = useMemo(() => [...Object.values(data.senate), ...Object.values(data.governor), ...Object.values(data.house).flat()], [data])
  const byId = useMemo(() => Object.fromEntries(races.map((r) => [r.id, r])), [races])
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('top')
  const [draft, setDraft] = useState(query)
  useEffect(() => { setDraft(query) }, [query])

  // Nationwide search.
  const [found, setFound] = useState(null)
  const [searchErr, setSearchErr] = useState(null)
  useEffect(() => {
    setFound(null)
    setSearchErr(null)
    if (!query) return undefined
    let live = true
    searchNews(query, { races }).then((v) => live && setFound(v)).catch((e) => live && setSearchErr(e.message))
    return () => { live = false }
  }, [query, races])
  const raceHits = useMemo(() => (query ? matchRaces(races, query) : []), [races, query])

  // Tag stories with the races they name; stories about close races rank higher.
  const idx = useMemo(() => raceIndex(races), [races])
  const top = useMemo(() => {
    const now = Date.now()
    return ((query ? found?.stories : news?.stories) || []).map((s) => {
      const tags = (s.raceIds ? s.raceIds.map((id) => byId[id]).filter(Boolean) : tagRaces(s.title, idx)).sort((a, b) => close(a) - close(b)).slice(0, 3)
      const near = tags.some((r) => close(r) < 1.5)
      return { s, tags, score: storyScore(s, now) * (near ? 1.6 : tags.length ? 1.2 : 1) }
    })
  }, [news, found, query, byId, idx])
  const shown = useMemo(() => {
    let list = filter === 'all' ? top : top.filter((x) => x.tags.some((r) => r.type === filter) || x.s.beats?.includes(filter))
    if (view === 'blind') list = list.filter((x) => tilt(x.s.outlets).blindspot)
    return [...list].sort(view === 'latest' ? (a, b) => (b.s.at > a.s.at ? 1 : -1) : (a, b) => b.score - a.score)
  }, [top, filter, view])

  // Race wire: your picks and watchlist first, then the closest races.
  const wire = useMemo(() => {
    const statewide = races.filter((r) => r.type !== 'house' && close(r) <= 1).sort((a, b) => close(a) - close(b))
    const house = races.filter((r) => r.type === 'house' && close(r) < 0.6).sort((a, b) => close(a) - close(b))
    const ids = [...(control?.featured || []), ...watch.ids, ...statewide.map((r) => r.id), ...house.map((r) => r.id)]
    return [...new Set(ids)].map((id) => byId[id]).filter(Boolean).slice(0, 24)
  }, [races, byId, control, watch.ids])
  const [pick, setPick] = useState(null)
  const race = byId[pick] || wire[0]
  const { feed, err } = useRaceNews(race)
  // A race picked from search results joins the chips.
  const wireChips = race && !wire.some((r) => r.id === race.id) ? [race, ...wire] : wire

  const pinned = control?.news || []
  const general = pinned.filter((n) => !n.race)
  const submit = (e) => { e.preventDefault(); onQuery(draft.trim()) }
  const loading = query ? !found && !searchErr : !news

  return (
    <section className="news-desk" aria-label="News desk">
      <div className="dossier-head">
        <div>
          <div className="stamp">NEWS DESK // LIVE WIRE</div>
          <h2 className="pixel glow-amber"><Icon name="news" size={18} color="#ffd700" /> {query ? 'NEWS SEARCH' : 'TOP STORIES'}</h2>
          <div className="dossier-meta">
            {news?.feeds ? `${news.feeds.ok}/${news.feeds.total}` : FEEDS.length} national outlets
            {' '}(<span className="party-d">{(SPREAD[-2] || 0) + (SPREAD[-1] || 0)} left</span> / {SPREAD[0] || 0} center / <span className="party-r">{(SPREAD[1] || 0) + (SPREAD[2] || 0)} right</span>)
            {' '}· local press via Google News · {STATE_FEEDS.length} statehouse newsrooms in race files
            {news?.at && <> · updated {timeAgo(news.at)}</>}
            {news?.error && <span className="party-r"> · {news.error}</span>}
          </div>
        </div>
        <div className="race-head-right">
          <button type="button" className="btn-mini icon-btn" onClick={onRefresh}><Reload width={12} height={12} /> REFRESH</button>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close news desk">✕</button>
        </div>
      </div>

      <div className="news-grid">
        <div className="news-col">
          <form className="news-search" onSubmit={submit} role="search">
            <Search width={16} height={16} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search all U.S. election news: a candidate, state, district or issue…" aria-label="Search news" />
            {query && <button type="button" className="news-search-x" onClick={() => onQuery('')} aria-label="Clear search"><Close width={14} height={14} /></button>}
            <button type="submit" className="btn-mini">SEARCH</button>
          </form>

          {query && (
            <div className="search-head">
              <div>
                <span className="pixel">RESULTS FOR “{query.toUpperCase()}”</span>
                <span className="dim"> · {found ? `${found.stories.length} stories · last 7 days` : 'searching…'}</span>
              </div>
              {raceHits.length > 0 && (
                <div className="wire-chips">
                  <span className="dim chip-label"><MapPin width={11} height={11} /> RACES</span>
                  {raceHits.map((r) => (
                    <button key={r.id} type="button" className="wire-chip" onClick={() => setPick(r.id)} title="Show in the race wire">
                      {raceTitle(r, STATES)} <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
              {found?.stories?.length > 0 && <TiltCard outlets={found.stories.flatMap((s) => s.outlets)} label="WHO'S COVERING IT" />}
            </div>
          )}

          {!query && general.length > 0 && (
            <Block title="◆ HQ BRIEFING">
              <Pinned items={general} />
            </Block>
          )}
          <div className="news-controls">
            <span className="sm-toggle" role="group" aria-label="Sort stories">
              {VIEWS.map(([k, l, I]) => <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}><I width={10} height={10} /> {l}</button>)}
            </span>
            <span className="sm-toggle" role="group" aria-label="Filter by race type">
              {FILTERS.map(([k, l]) => <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </span>
          </div>
          {view === 'blind' && <p className="dim news-explain">Stories one side of the spectrum is covering and the other mostly isn&apos;t. Worth reading to see what your usual sources skip.</p>}
          {loading && <div className="dim blink">{query ? 'Searching every outlet…' : 'Pulling the wire…'}</div>}
          {query && searchErr && <div className="dim">Search unavailable ({searchErr}).</div>}
          {!query && news?.error && !news.stories.length && <div className="dim">News wire unavailable ({news.error}).</div>}
          {!loading && !shown.length && <div className="dim">Nothing here right now.</div>}
          <div className="story-grid">
            {shown.slice(0, 48).map(({ s, tags }, i) => (
              <StoryRow key={s.url} s={s} tags={tags} lead={i === 0 && view === 'top'} card={i < 13} onPick={onPick} />
            ))}
          </div>
          <TiltLegend />
        </div>

        <div className="news-col">
          <h4 className="pixel news-col-head"><MapPin width={12} height={12} /> RACE WIRE</h4>
          <div className="wire-chips">
            {wireChips.map((r) => (
              <button key={r.id} type="button" className={`wire-chip ${race?.id === r.id ? 'on' : ''}`} onClick={() => setPick(r.id)}>
                <Icon name={r.type} size={11} color={race?.id === r.id ? '#ffd700' : '#00ff41'} />
                {watch.ids.includes(r.id) ? '★ ' : ''}{raceTitle(r, STATES)}
                <span className={ratingClass(r.consensus?.label)}>{r.consensus?.label || '—'}</span>
              </button>
            ))}
          </div>
          {race && (
            <>
              <div className="wire-head">
                <span className="pixel">{raceTitle(race, STATES).toUpperCase()}</span>
                <button type="button" className="btn-mini" onClick={() => onPick(race)}>OPEN RACE FILE ▸</button>
              </div>
              {feed?.stories?.length > 0 && <TiltCard outlets={feed.stories.flatMap((s) => s.outlets)} label="RACE COVERAGE" />}
              <Pinned items={pinned.filter((n) => n.race === race.id)} />
              {(feed?.stories || []).map((s) => <StoryRow key={s.url} s={s} compact />)}
              <FeedStatus feed={feed} err={err} empty={RACE_EMPTY} />
            </>
          )}
          <div className="source-line">Race coverage: the national outlet feeds, the state&apos;s statehouse newsroom, and local papers and TV found through Google News.</div>
        </div>
      </div>
    </section>
  )
}

// How to read a TILT meter.
function TiltLegend() {
  return (
    <div className="tilt-legend">
      <div className="pixel tilt-label"><Scale width={12} height={12} /> READING THE TILT METER</div>
      <div className="tilt-legend-row">
        <TiltMeter t={{ steps: [1, 2, 3, 2, 1], avg: 0, rated: 9 }} width={58} />
        <span>Each column is a lean step: <b className="lean-l2">L</b> · <b className="lean-l1">LL</b> · <b className="lean-c">C</b> · <b className="lean-r1">LR</b> · <b className="lean-r2">R</b>. Taller means more outlets from that side carried the story. The white arrow marks where the coverage centers.</span>
      </div>
      <div className="tilt-legend-row verdicts">
        {['balanced', 'leans-left', 'leans-right', 'heavy-left', 'heavy-right'].map((v) => <span key={v} className={verdictClass(v)}>{VERDICT[v]}</span>)}
        <Blindspot side="left" />
      </div>
      <p className="source-line">
        Lean ratings are HQ&apos;s approximate read of each outlet&apos;s overall coverage, not of any single article. Statehouse
        newsrooms and local papers and TV count as local and sit outside the meter. MISSED BY LEFT/RIGHT flags a story one side&apos;s
        outlets are carrying and the other&apos;s barely touch. BALANCE (0–100) scores how evenly both sides cover it.
      </p>
    </div>
  )
}
