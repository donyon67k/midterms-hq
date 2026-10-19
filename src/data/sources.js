// Political lean of news outlets, for coverage-balance bars and blindspot flags.
// HQ's own approximate ratings of each outlet's overall news coverage, drawn from the
// broad consensus of public media-bias ratings: -2 left, -1 lean left, 0 center,
// 1 lean right, 2 right. Unlisted outlets are "unrated"; local TV/papers are "local".
const LEAN = {
  '-2': `msnbc.com ms.now motherjones.com thenation.com huffpost.com dailykos.com jacobin.com democracynow.org
    theintercept.com alternet.org rawstory.com newrepublic.com slate.com salon.com thedailybeast.com vox.com
    commondreams.org truthout.org prospect.org meidastouch.com occupydemocrats.com crooksandliars.com
    talkingpointsmemo.com currentaffairs.org inthesetimes.com thebulwark.com democracydocket.com commoncause.org
    democrats.org dccc.org dscc.org dga.org`,
  '-1': `nytimes.com washingtonpost.com cnn.com nbcnews.com cbsnews.com abcnews.go.com abcnews.com npr.org politico.com
    theatlantic.com latimes.com bostonglobe.com theguardian.com time.com newyorker.com usatoday.com axios.com
    businessinsider.com insider.com nymag.com vanityfair.com bloomberg.com pbs.org yahoo.com aol.com msn.com
    independent.co.uk apnews.com propublica.org mediaite.com sfchronicle.com seattletimes.com ajc.com startribune.com
    inquirer.com miamiherald.com denverpost.com azcentral.com theconversation.com 19thnews.org notus.org
    nbcnewyork.com nbcwashington.com today.com people.com rollingstone.com esquire.com theroot.com thegrio.com
    gothamist.com boston.com`,
  0: `reuters.com thehill.com newsweek.com cnbc.com wsj.com forbes.com marketwatch.com bbc.com bbc.co.uk csmonitor.com
    natesilver.net cookpolitical.com centerforpolitics.org ballotpedia.org rollcall.com nationaljournal.com upi.com
    fortune.com barrons.com theweek.com semafor.com tangle.media newsnationnow.com straightarrownews.com
    chicagotribune.com dallasnews.com 270towin.com electionbettingodds.com votebeat.org stateline.org
    cbs.com abc.com c-span.org texastribune.org san.com apnorc.org floridapolitics.com`,
  1: `washingtonexaminer.com nypost.com washingtontimes.com dailymail.co.uk dailymail.com nationalreview.com
    thedispatch.com reason.com realclearpolitics.com realclearpolling.com foxbusiness.com justthenews.com
    freepress.org thefp.com spectator.co.uk deseret.com nationalinterest.org rasmussenreports.com unionleader.com`,
  2: `foxnews.com breitbart.com dailywire.com townhall.com redstate.com thefederalist.com newsmax.com dailycaller.com
    theblaze.com oann.com thegatewaypundit.com pjmedia.com westernjournal.com americanthinker.com hotair.com
    twitchy.com bizpacreview.com freerepublic.com theepochtimes.com thepostmillennial.com thenationalpulse.com
    wnd.com lifesitenews.com bongino.com frontpagemag.com newsbusters.org cnsnews.com dailysignal.com spectator.org
    amgreatness.com freebeacon.com washingtonfreebeacon.com conservativebrief.com
    rumble.com louderwithcrowder.com notthebee.com headlineusa.com gop.com nrcc.org nrsc.org rga.org`,
}

const BY_DOMAIN = {}
for (const [lean, list] of Object.entries(LEAN)) for (const d of list.split(/\s+/)) if (d) BY_DOMAIN[d] = +lean

// Call-letter domains (wsbtv.com, kare11.com, fox5ny.com) and local papers are local news.
const LOCAL_LIST = new Set('adn.com alaskapublic.org mlive.com nola.com al.com cleveland.com pennlive.com nj.com oregonlive.com syracuse.com masslive.com silive.com wral.com wcnc.com kare11.com 9news.com wfaa.com khou.com wusa9.com 11alive.com wthr.com ktla.com wgal.com wmur.com news12.com local10.com localmemphis.com ourquadcities.com turnto10.com'.split(' '))
// Public radio and TV stations (wamc.org, nhpr.org, cpr.org, denver7.com) are local too.
const LOCAL = /^(?:[kw][a-z]{2,3}(?:tv|\d+|news\d*|-tv)?\.com|(?:fox|nbc|abc|cbs)[a-z]*\d*[a-z]*\.com|[a-z]*\d+[a-z]*\.com|[a-z]+(?:news|tv)\d+\.com|clickon[a-z]+\.com|[kw][a-z]{2,3}\.org|[a-z]*(?:public|radio|publicmedia|pr)\.org|.*(?:gazette|tribune|times|herald|journal|post|courier|register|sentinel|observer|chronicle|dispatch|press|star|news|democrat|republic|statesman|bee|record|eagle|telegram|citizen|daily|today|ledger|examiner|beacon|enterprise|online|homepage)[a-z]*\.com|[a-z.]+\.news)$/

export function leanOf(domain = '') {
  const d = domain.toLowerCase().replace(/^(www|m|amp|edition|news)\./, '')
  if (d in BY_DOMAIN) return BY_DOMAIN[d]
  const parent = d.split('.').slice(-2).join('.')
  if (parent in BY_DOMAIN) return BY_DOMAIN[parent]
  return LOCAL_LIST.has(d) || LOCAL_LIST.has(parent) || STATE_DOMAINS.has(d) || LOCAL.test(d) ? 'local' : null
}

export const LEAN_LABEL = { '-2': 'LEFT', '-1': 'LEAN LEFT', 0: 'CENTER', 1: 'LEAN RIGHT', 2: 'RIGHT', local: 'LOCAL', null: 'UNRATED' }
export const LEAN_SHORT = { '-2': 'L', '-1': 'LL', 0: 'C', 1: 'LR', 2: 'R', local: 'LOC', null: '?' }

// Left / center / right counts for a set of outlets, plus a blindspot flag when
// one side carries the story and the other barely touches it.
export function balance(domains) {
  const b = { left: 0, center: 0, right: 0, local: 0, unrated: 0 }
  for (const d of domains) {
    const l = leanOf(d)
    if (l === 'local') b.local++
    else if (l == null) b.unrated++
    else if (l < 0) b.left++
    else if (l > 0) b.right++
    else b.center++
  }
  const rated = b.left + b.center + b.right
  const sides = (b.left > 0) + (b.center > 0) + (b.right > 0)
  // Blindspot: at least 3 outlets on one side and next to none on the other.
  let blindspot = null
  if (b.right >= 3 && b.left <= b.right * 0.15) blindspot = 'left' // the left isn't covering it
  else if (b.left >= 3 && b.right <= b.left * 0.15) blindspot = 'right'
  return { ...b, rated, sides, blindspot }
}

// HQ TILT: where a story's coverage sits on the spectrum, in plain words.
// steps = outlets at each lean step (L, LL, C, LR, R); avg = the coverage's center
// of gravity (-2..2); score = 0-100 for how evenly both sides carry it.
export function tilt(domains) {
  const steps = [0, 0, 0, 0, 0]
  for (const d of domains) { const l = leanOf(d); if (typeof l === 'number') steps[l + 2]++ }
  const b = balance(domains)
  const avg = b.rated ? steps.reduce((sum, n, i) => sum + n * (i - 2), 0) / b.rated : 0
  const even = b.rated ? 1 - Math.abs(b.left - b.right) / b.rated : 0
  const score = b.rated ? Math.round(100 * even * (0.6 + (0.4 * b.sides) / 3)) : null
  const side = avg < 0 ? 'left' : 'right'
  const verdict = b.rated === 0 ? (b.local ? 'local' : 'unrated') : b.rated === 1 ? 'single' : Math.abs(avg) <= 0.4 ? 'balanced' : Math.abs(avg) <= 1 ? `leans-${side}` : `heavy-${side}`
  return { ...b, steps, avg, score, verdict }
}

export const VERDICT = {
  local: 'LOCAL PRESS', unrated: 'UNRATED', single: '1 RATED', balanced: 'BALANCED',
  'leans-left': 'LEANS LEFT', 'leans-right': 'LEANS RIGHT',
  'heavy-left': 'LEFT-HEAVY', 'heavy-right': 'RIGHT-HEAVY',
}

// Outlets read directly through their public RSS feeds, picked for an even spread
// across the spectrum (lean comes from the table above via the domain).
export const FEEDS = [
  ['HuffPost', 'huffpost.com', 'https://chaski.huffpost.com/us/auto/vertical/politics'],
  ['Vox', 'vox.com', 'https://www.vox.com/rss/politics/index.xml'],
  ['Mother Jones', 'motherjones.com', 'https://www.motherjones.com/politics/feed/'],
  ['Slate', 'slate.com', 'https://slate.com/feeds/news-and-politics.rss'],
  ['The Nation', 'thenation.com', 'https://www.thenation.com/feed/?post_type=article'],
  ['TPM', 'talkingpointsmemo.com', 'https://talkingpointsmemo.com/feed'],
  ['New York Times', 'nytimes.com', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml'],
  ['NPR', 'npr.org', 'https://feeds.npr.org/1014/rss.xml'],
  ['NBC News', 'nbcnews.com', 'https://feeds.nbcnews.com/nbcnews/public/politics'],
  ['CBS News', 'cbsnews.com', 'https://www.cbsnews.com/latest/rss/politics'],
  ['ABC News', 'abcnews.com', 'https://abcnews.com/abcnews/politicsheadlines'],
  ['Politico', 'politico.com', 'https://rss.politico.com/politics-news.xml'],
  ['The Guardian', 'theguardian.com', 'https://www.theguardian.com/us-news/us-politics/rss'],
  ['LA Times', 'latimes.com', 'https://www.latimes.com/politics/rss2.0.xml'],
  ['The Hill', 'thehill.com', 'https://thehill.com/homenews/campaign/feed/'],
  ['BBC', 'bbc.com', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml'],
  ['CS Monitor', 'csmonitor.com', 'https://rss.csmonitor.com/feeds/usa'],
  ['Roll Call', 'rollcall.com', 'https://rollcall.com/feed/'],
  ['NewsNation', 'newsnationnow.com', 'https://www.newsnationnow.com/feed/'],
  ['Straight Arrow News', 'san.com', 'https://san.com/feed/'],
  ['New York Post', 'nypost.com', 'https://nypost.com/politics/feed/'],
  ['Washington Examiner', 'washingtonexaminer.com', 'https://www.washingtonexaminer.com/section/politics/feed/'],
  ['Washington Times', 'washingtontimes.com', 'https://www.washingtontimes.com/rss/headlines/news/politics/'],
  ['National Review', 'nationalreview.com', 'https://www.nationalreview.com/feed/'],
  ['The Dispatch', 'thedispatch.com', 'https://thedispatch.com/feed/'],
  ['RealClearPolitics', 'realclearpolitics.com', 'https://www.realclearpolitics.com/index.xml'],
  ['Fox News', 'foxnews.com', 'https://moxie.foxnews.com/google-publisher/politics.xml'],
  ['Breitbart', 'breitbart.com', 'https://feeds.feedburner.com/breitbart'],
  ['Daily Wire', 'dailywire.com', 'https://www.dailywire.com/feeds/rss.xml'],
  ['Daily Caller', 'dailycaller.com', 'https://dailycaller.com/feed/'],
  ['The Federalist', 'thefederalist.com', 'https://thefederalist.com/feed/'],
  ['The Blaze', 'theblaze.com', 'https://www.theblaze.com/feeds/feed.rss'],
  ['Free Beacon', 'freebeacon.com', 'https://freebeacon.com/feed/'],
  ['PJ Media', 'pjmedia.com', 'https://pjmedia.com/feed'],
].map(([name, domain, url]) => ({ name, domain, url }))

// One statehouse newsroom per state (mostly the nonprofit States Newsroom network),
// for the state and local coverage national desks skip: governor and House races
// especially. Counted as local press, not rated left or right.
export const STATE_FEEDS = [
  ['AL', 'Alabama Reflector', 'alabamareflector.com', 'https://alabamareflector.com/feed/'],
  ['AK', 'Alaska Beacon', 'alaskabeacon.com', 'https://alaskabeacon.com/feed/'],
  ['AZ', 'Arizona Mirror', 'azmirror.com', 'https://azmirror.com/feed/'],
  ['AR', 'Arkansas Advocate', 'arkansasadvocate.com', 'https://arkansasadvocate.com/feed/'],
  ['CA', 'CalMatters', 'calmatters.org', 'https://calmatters.org/feed/'],
  ['CO', 'Colorado Newsline', 'coloradonewsline.com', 'https://coloradonewsline.com/feed/'],
  ['CT', 'CT Mirror', 'ctmirror.org', 'https://ctmirror.org/feed/'],
  ['DE', 'Spotlight Delaware', 'spotlightdelaware.org', 'https://spotlightdelaware.org/feed/'],
  ['FL', 'Florida Phoenix', 'floridaphoenix.com', 'https://floridaphoenix.com/feed/'],
  ['GA', 'Georgia Recorder', 'georgiarecorder.com', 'https://georgiarecorder.com/feed/'],
  ['HI', 'Civil Beat', 'civilbeat.org', 'https://www.civilbeat.org/feed/'],
  ['ID', 'Idaho Capital Sun', 'idahocapitalsun.com', 'https://idahocapitalsun.com/feed/'],
  ['IL', 'Capitol News Illinois', 'capitolnewsillinois.com', 'https://capitolnewsillinois.com/feed/'],
  ['IN', 'Indiana Capital Chronicle', 'indianacapitalchronicle.com', 'https://indianacapitalchronicle.com/feed/'],
  ['IA', 'Iowa Capital Dispatch', 'iowacapitaldispatch.com', 'https://iowacapitaldispatch.com/feed/'],
  ['KS', 'Kansas Reflector', 'kansasreflector.com', 'https://kansasreflector.com/feed/'],
  ['KY', 'Kentucky Lantern', 'kentuckylantern.com', 'https://kentuckylantern.com/feed/'],
  ['LA', 'Louisiana Illuminator', 'lailluminator.com', 'https://lailluminator.com/feed/'],
  ['ME', 'Maine Morning Star', 'mainemorningstar.com', 'https://mainemorningstar.com/feed/'],
  ['MD', 'Maryland Matters', 'marylandmatters.org', 'https://marylandmatters.org/feed/'],
  ['MA', 'CommonWealth Beacon', 'commonwealthbeacon.org', 'https://commonwealthbeacon.org/feed/'],
  ['MI', 'Michigan Advance', 'michiganadvance.com', 'https://michiganadvance.com/feed/'],
  ['MN', 'Minnesota Reformer', 'minnesotareformer.com', 'https://minnesotareformer.com/feed/'],
  ['MS', 'Mississippi Today', 'mississippitoday.org', 'https://mississippitoday.org/feed/'],
  ['MO', 'Missouri Independent', 'missouriindependent.com', 'https://missouriindependent.com/feed/'],
  ['MT', 'Daily Montanan', 'dailymontanan.com', 'https://dailymontanan.com/feed/'],
  ['NE', 'Nebraska Examiner', 'nebraskaexaminer.com', 'https://nebraskaexaminer.com/feed/'],
  ['NV', 'Nevada Current', 'nevadacurrent.com', 'https://nevadacurrent.com/feed/'],
  ['NH', 'New Hampshire Bulletin', 'newhampshirebulletin.com', 'https://newhampshirebulletin.com/feed/'],
  ['NJ', 'New Jersey Monitor', 'newjerseymonitor.com', 'https://newjerseymonitor.com/feed/'],
  ['NM', 'Source NM', 'sourcenm.com', 'https://sourcenm.com/feed/'],
  ['NY', 'New York Focus', 'nysfocus.com', 'https://nysfocus.com/feed/'],
  ['NC', 'NC Newsline', 'ncnewsline.com', 'https://ncnewsline.com/feed/'],
  ['ND', 'North Dakota Monitor', 'northdakotamonitor.com', 'https://northdakotamonitor.com/feed/'],
  ['OH', 'Ohio Capital Journal', 'ohiocapitaljournal.com', 'https://ohiocapitaljournal.com/feed/'],
  ['OK', 'Oklahoma Voice', 'oklahomavoice.com', 'https://oklahomavoice.com/feed/'],
  ['OR', 'Oregon Capital Chronicle', 'oregoncapitalchronicle.com', 'https://oregoncapitalchronicle.com/feed/'],
  ['PA', 'Pennsylvania Capital-Star', 'penncapital-star.com', 'https://penncapital-star.com/feed/'],
  ['RI', 'Rhode Island Current', 'rhodeislandcurrent.com', 'https://rhodeislandcurrent.com/feed/'],
  ['SC', 'SC Daily Gazette', 'scdailygazette.com', 'https://scdailygazette.com/feed/'],
  ['SD', 'South Dakota Searchlight', 'southdakotasearchlight.com', 'https://southdakotasearchlight.com/feed/'],
  ['TN', 'Tennessee Lookout', 'tennesseelookout.com', 'https://tennesseelookout.com/feed/'],
  ['TX', 'Texas Tribune', 'texastribune.org', 'https://feeds.texastribune.org/feeds/main/'],
  ['UT', 'Utah News Dispatch', 'utahnewsdispatch.com', 'https://utahnewsdispatch.com/feed/'],
  ['VT', 'VTDigger', 'vtdigger.org', 'https://vtdigger.org/feed/'],
  ['VA', 'Virginia Mercury', 'virginiamercury.com', 'https://virginiamercury.com/feed/'],
  ['WA', 'Washington State Standard', 'washingtonstatestandard.com', 'https://washingtonstatestandard.com/feed/'],
  ['WV', 'West Virginia Watch', 'westvirginiawatch.com', 'https://westvirginiawatch.com/feed/'],
  ['WI', 'Wisconsin Examiner', 'wisconsinexaminer.com', 'https://wisconsinexaminer.com/feed/'],
  ['WY', 'WyoFile', 'wyofile.com', 'https://wyofile.com/feed/'],
].map(([state, name, domain, url]) => ({ state, name, domain, url }))
const STATE_DOMAINS = new Set(STATE_FEEDS.map((f) => f.domain))

const NAMES = Object.fromEntries([...FEEDS, ...STATE_FEEDS].map((f) => [f.domain, f.name]))
export const outletName = (domain) => NAMES[domain] || domain
