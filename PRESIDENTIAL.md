# Presidential edition: first plan (Nov 3, 2026)

Start after the midterm counts finish and Donovan's design fixes are in. Nothing here is built yet.

## Recommendation: one codebase, two editions
Keep this repo and add an **edition** setting (`midterms-2026`, `president-2028`) that picks the
offices, calendar, thresholds and wording. Same map, race files, scout, NBC reader, HQ Admin,
money, news desk, alerts, share cards, picks and simulator. The 2026 edition stays online as an
archive. The new edition gets its own name (e.g. "PROJECT: 2028"), site and app ID so installs don't collide.

## What the 2028 cycle needs
| Phase | When | What HQ shows |
|---|---|---|
| Invisible primary | 2027 | Candidate field (declared / exploring / declined), national + early-state polls, FEC money (presidential committees are P-prefixed; the FEC code already works), endorsements, debate calendar and qualifying rules |
| Primaries + caucuses | Jan–Jun 2028 | Calendar map, state-by-state winners, **delegate tracker** toward each party's majority (D: proportional with a 15% threshold; R: rules vary by state, many winner-take-all), drop-out log, results nights with the NBC reader |
| Conventions | Summer 2028 | Nominees, running mates, platform highlights |
| General | Sep–Nov 2028 | **Electoral College map and path to 270** (reuses the path-to-majority simulator), state forecast consensus, swing-state dossiers, early-vote tracking, county 2024 shading for comparison |
| Election night | Nov 7, 2028 | Same Gameday: poll closings, NBC/AP calls, call bursts, a 270 celebration, the prediction game and share cards |

## Reuse vs. new
- **Reuse as is:** map + county layers, race files, Gameday, NBC reader + scout, HQ Admin/live branch, alerts, share cards, picks, analysis/learn, news desk.
- **Generalize:** "race" becomes a contest with any office; the seat math (51/218) becomes edition config (270 electoral votes; delegate majorities); the poll-closing calendar becomes a primary calendar plus Election Day.
- **New:** delegate math per party and state, candidate field and drop-outs, debate tracker, electoral-vote weights (2020 census apportionment), Nebraska/Maine district electoral votes.

## Fix first (from the midterm review)
1. Rely less on Wikipedia for ratings, candidates and polls; prefer forecaster pages, state candidate lists, FEC.
2. A hosted results reader, so calls don't depend on one Mac staying awake.
3. Apple signing/notarization for the Mac app (needs the $99/year Apple Developer account).
4. Donovan's design fixes.

## Questions for Donovan
- One app with an edition switch, or a separate 2028 app/site?
- Start date: track the invisible primary in 2027, or launch for the first debates?
- Which parts of the college course to turn into Learn content?
