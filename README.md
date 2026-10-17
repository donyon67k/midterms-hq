# MIDTERMS HQ

8-bit spy-HQ intelligence dashboard for the 2026 U.S. midterms: Senate (incl. FL/OH specials),
governor, all 435 House seats, and statewide ballot measures on an interactive map.

## Run

    npm install
    npm run dev        # http://localhost:5173
    npm test           # parser tests (2024/2022 results fixtures + 2026 snapshot checks)

## Using it

- **Click a state** to zoom in: House shows 2026 district lines, everything else shows counties
  shaded by the 2024 presidential margin. Click a district to open it. **Esc** backs out a level.
- **⌘K** (or **/**) searches states, races, districts (`TX-28`), candidates and ballot measures.
- **☆ WATCH** on any race pins it to *My Watchlist* in the situation room. Once you have a
  watchlist, desktop alerts only fire for starred races (otherwise: Senate/Governor news).
- **FORECAST / RESULTS** switches the map lens. Results mode turns on by itself once Wikipedia
  starts marking winners after polls close on Nov 3: called races take the winner's color,
  flips get a blip, uncalled seats stay gray. The app polls every minute during election week.
- Poll projections include a **trend sparkline** per candidate when a race has 3+ dated polls.
- In dev, `mhqSimulateResults()` in the browser console fills in fake calls to preview results mode.

## Desktop app (Tauri)

    npm run app        # native window with hot reload: save a file, the window updates
    npm run app:ship   # release build -> replaces "CLAUDE HOME/Midterms HQ.app" and relaunches it
    DEST=/Applications npm run app:ship   # install somewhere else

The workflow: tweak things live in `npm run app`, then `npm run app:ship` when you want the
installed app to have the changes. The first build compiles Rust dependencies (several minutes),
and later builds are much faster.

What the desktop build adds over the browser version (`src/lib/desktop.js`, `src-tauri/`):

- Native HTTP for every data request: no CORS limits, so any data source can be added
  (allowed hosts are listed in `src-tauri/capabilities/default.json`)
- Disk cache (`cache.json` in the app's data folder) instead of the ~5 MB localStorage cap
- macOS notifications when a forecast rating shifts
- External links open in your default browser; window size/position is remembered;
  opening it again focuses the running copy

## Live updates without a new version (HQ Admin)

Content changes don't need an app update. `npm run admin` opens a local admin page
(dev server only, never shipped) for the **live control file**:

- broadcast banner (info / alert, optional link)
- HQ picks: featured races at the top of the Situation Room
- HQ notes: your analysis on any race's file
- rating overrides and election-night result overrides (backup if Wikipedia lags)
- minimum version: older copies show an "update required" banner

**SAVE DRAFT** writes `live/control.json` (gitignored) and the dev app previews it right away.
**PUBLISH TO EVERYONE** pushes it as `control.json` to the repo's `live` branch, so it never
touches code on `main`. Installed apps read it on every refresh (raw.githubusercontent.com
caches ~5 min). The app treats the file as data only: unknown fields, bad labels and
non-https links are dropped.

Code changes (layout, features) still ship as a release (below). Installed copies download the
new version in the background and show **RESTART TO UPDATE**.

## Releasing (installers)

| Platform | Installer | How it's built |
|---|---|---|
| Mac (Apple Silicon) | `release/Midterms HQ_<ver>_aarch64.dmg` | `npm run app:dmg` on this Mac |
| Mac (universal: Apple Silicon + Intel) | `Midterms.HQ_<ver>_universal.dmg` | GitHub Actions (`.github/workflows/release.yml`) |
| Windows 10/11 | `Midterms.HQ_<ver>_x64-setup.exe` (+ `.msi`) | GitHub Actions |

Release steps once the project is on GitHub: bump `version` in `package.json` and
`src-tauri/tauri.conf.json`, then `git tag v1.0.1 && git push origin v1.0.1`. The workflow runs the
tests, builds both platforms and attaches the installers to a **draft** release to review and publish.

Until the app is code-signed, first launch shows a warning (Mac: System Settings → Privacy &
Security → "Open Anyway"; Windows SmartScreen: "More info" → "Run anyway"). Signing secrets are
listed at the top of the workflow file.



| Data | Source | Refresh |
|---|---|---|
| Ratings (Cook, Sabato, IE, DDHQ, Economist, Silver, Split Ticket, FPO, Fox, RCP), candidates, incumbents, PVI, ballot measures, generic ballot, **results** (winner ✓ and vote % once called) | Wikipedia's 2026 election overview pages, parsed from wikitext (`src/data/wiki.js`) | Revision check every 3 min (1 min election week); a page is only re-downloaded when it was edited |
| Per-race polls, polling averages, fundraising | The individual race article for that race | Fetched when you open a race, cached 10 min |
| Candidate bios, photos, platform/issue positions | Wikipedia candidate articles | On demand, cached 6 h |
| Live federal finance totals | OpenFEC API (`⟳ PULL LIVE FEC TOTALS`) | On demand, cached 1 h |
| Congressional district boundaries (2026 / 120th Congress lines, incl. mid-decade redraws) | U.S. Census TIGERweb ArcGIS service | When a state's district map opens, cached 7 days |
| County boundaries | `us-atlas` (bundled, loaded on first zoom) | Static |
| City labels (places with 10K+ people) | U.S. Census Gazetteer + Vintage 2024 population estimates → `src/data/cities.json` | Static; rebuild with `npm run data:cities` (needs `unzip`) |
| 2024 presidential results by county | [tonmcg/US_County_Level_Election_Results_08-24](https://github.com/tonmcg/US_County_Level_Election_Results_08-24) → `src/data/county2024.json` | Static; rebuild with `npm run data:counties`. Connecticut's 2024 data uses planning regions, so its counties show "no data" |

`src/data/snapshot.json` is a bundled fallback so the app loads instantly and still works offline.
Refresh it with `npm run data`.

After every refresh a **data health check** compares what was parsed against what should exist
(33+ Senate, 36 governor, 435 House races, no leftover wiki markup in names). Problems show up
as `DATA HEALTH` lines in the intel log, so a Wikipedia page restructure can't silently drop races.

**FEC rate limits:** the app uses the shared `DEMO_KEY` by default (about 30 requests/hour).
Get a free key at https://api.data.gov/signup and put it in `.env.local`:

    VITE_FEC_API_KEY=your_key_here

## Layout

- `src/data/wiki.js`: wikitext parsers, shared by the browser and the snapshot script
- `src/data/live.js`: Wikipedia + FEC fetching and caching
- `src/components/`: map (`UsMap`, which zooms into a selected state; `StateMap` draws its counties or 2026 House districts), situation room (`Overview`), state file (`Dossier`), race intel (`RaceView`), candidate cards, pixel sprites
- `src/lib/view.js`: shared tab/district/layer state so the zoomed map and the dossier stay in sync
- `src/components/CommandBar.jsx`: ⌘K search
- `tests/`: parser tests; `tests/fixtures/` holds saved finished-election pages with known outcomes
- `scripts/build-data.mjs`: snapshot builder
