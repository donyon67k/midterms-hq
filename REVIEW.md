# Midterms HQ — app review (Oct 17, 2026)

A sweep of the code, the live data and the UI.

> **Status (later on Oct 17): everything below is done**, except:
> - the Rust build cache (`src-tauri/target`) was kept on purpose so `npm run app:ship` stays fast;
> - "Before going public" is still open (wait for the distribution decision);
> - camera animation was left as-is (no stutter observed).
>
> Extra fixes found while doing it: results parsing (winner ✓ + vote %, verified against the real
> 2024 House/Senate and 2022 governor outcomes), a table-parser bug that cut off rows after a
> stray `|}}` (dropped 7 NJ seats in the 2024 fixture), ranked-choice (Alaska) result tables,
> `[[link|label]]` inside templates, and automatic retry when Wikipedia rate-limits (HTTP 429).

## Top 5 to do first

1. **Fix the per-second re-render** (smoothness, small change)
2. **Fix the `{{endplainlist` candidate-name bug** (visible garbage in 5+ House races)
3. **Show "OPEN SEAT" instead of "None (new seat)" / "Vacant" as an incumbent name**
4. **Tone down the radar sweep** (it washes out the rating colors)
5. **Only re-download Wikipedia pages that actually changed** (refresh drops from ~1.1 MB to ~2 KB when nothing changed)

## What works best — keep

- **Zoom-in state map with 2026 district lines.** The strongest feature. Uses the 120th-Congress lines, so mid-decade redraws (TX, CA, etc.) are correct.
- **Live data with an instant fallback.** The bundled snapshot means the app opens immediately, even offline, then upgrades to live data. Rating shifts get logged (and become notifications in the desktop app).
- **Race file.** Forecast meter, per-forecaster chips, flip flags, poll projection and finance bars read well and are fast.
- **Look and feel.** The spy-HQ / 8-bit style holds together on every screen.
- **Desktop shell.** Small (10 MB), native fetch, disk cache, notifications.

## Broken — fix

| # | Problem | Where | Fix |
|---|---|---|---|
| 1 | `{{endplainlist` leaks into candidate names (MI-2, MI-7, NY-22, NC-8, SC-5…), shown as a fake "(I)" candidate | `parseHousePage` in `src/data/wiki.js` | Strip the `{{endplainlist}}` / `{{end plainlist}}` templates before splitting candidates |
| 2 | 10 districts show "None (new seat)" or "Vacant" as the incumbent's name, in purple, and the race header says "INCUMBENT None (new seat)" | Dossier list, `RaceView` header | Detect these and show `OPEN SEAT` / `VACANT` as a tag |
| 3 | The whole app re-renders every second because the countdown clock lives in `App` | `useClock` in `src/App.jsx` | Move the countdown and "synced X ago" into a small `<Countdown>` component |
| 4 | The radar sweep's light wedge sits over the map and lightens whatever it passes over, so Tilt/Lean colors misread | `.radar-sweep` in `App.css` | Make it much fainter, run it only on the national view, or keep it to the map border |
| 5 | Tile-grid mode doesn't zoom, so it's now the weaker half of the map | `UsMap` | Either make a tile click switch to the geo zoom, or delete tile mode |
| 6 | Candidates are matched to poll/finance rows by last name only, so two candidates with the same surname would cross-wire | `RaceView` `matchBy` | Match on first initial + last name |
| 7 | The Senate bar says "51 FOR CONTROL", which is only true for Democrats (the Vice President breaks ties for Republicans at 50) | `Overview` | Label it "D 51 / R 50 FOR CONTROL" |

## Smoother — performance

- **Refresh cost:** every 3 minutes the app re-downloads and re-parses ~1.1 MB of Wikipedia text (Senate 262 KB, House 366 KB, governors 219 KB, measures 173 KB, ratings 83 KB), even when nothing changed. Ask Wikipedia for revision IDs first (a ~2 KB request) and only fetch the pages that changed.
- **Bundle size:** the main JS file is 1.7 MB because the county map (~800 KB) and the snapshot load up front. Lazy-load the county map the first time you zoom in, so first paint is faster.
- **Camera animation:** while zooming, every frame re-renders the whole map component. Fine today; if it ever stutters (e.g. in California), animate the SVG viewBox directly instead of through React state.

## Delete

- **Unused packages:** `react-simple-maps` and `d3-scale` are installed but nothing uses them.
- **Tile-grid mode,** unless it gets zoom (see #5).
- **Boot sequence on every launch** in the desktop app. It's fun once, but it's skippable and stored only per browser session. Show it on first launch only, or make it faster.
- **Rust build cache:** `src-tauri/target` is 1.3 GB. It's safe to clear (`cargo clean` in `src-tauri`) whenever disk space matters; the next build just takes longer.

## Make it stronger — biggest upgrades

1. **Election-night results mode.** Nov 3 is 17 days away and right now the app only shows forecasts. Wikipedia's race pages fill in results quickly. Parse them and switch states/districts from "rating" colors to "called / leading / % reporting." This is the single most valuable addition.
2. **Search / command bar (⌘K).** Jump straight to "TX-28", "Talarico" or "Prop 50" instead of clicking through the map.
3. **Meaningful county shading.** Counties are currently decorative (one tint). Shade them by the 2024 presidential margin so the county view tells you where each party's votes are.
4. **Watchlist.** Star races, then get notifications only for those (the desktop app already has notifications).
5. **Poll trend lines.** The poll tables have dates, so a small sparkline per race would show momentum, not just the latest average.
6. **Parser health check.** If Wikipedia editors restructure a page, the parsers can silently return fewer races. Compare counts against expected (35 Senate / 36 governor / 435 House) after each refresh and log a warning in the intel feed.
7. **Parser tests.** A few tests that run the parsers against saved copies of the pages would catch regressions like #1 before they ship.

## Before going public (from the distribution discussion)

- Credit Wikipedia (CC BY-SA) and the image sources in an About screen
- Change the app ID from `local.donovan.midtermshq`
- Use a User-Agent with a project contact (needed for Wikipedia's API policy)
- Replace the shared FEC `DEMO_KEY` (a user setting or a small proxy)
