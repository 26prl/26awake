# 26awake

A personal site for fun — games, art, music — with one serious side project: **Plague Watch**, a live news tracker.
Most of this README is about the tracker.

A small self-hosted website that keeps watching the internet for the topics you define
(for example, **plague cases in Russia**), rates every source for trustworthiness, and shows:

* **Case count** — approximate numbers of infected, deaths, lab-confirmed cases and people in quarantine,
  taken **only from verified reports**: a figure counts if an official health authority reported it, or at
  least two independent reputable outlets did. Suspected vs. lab-confirmed and official denials are shown
  next to the numbers; bigger figures from tabloids or single reports are listed separately as unverified.
* **Map** — regions in the news, coloured by how well their reports are verified, with per-region counts.
* **What can be trusted** — stories grouped as *confirmed* (official health authority),
  *corroborated* (several independent reputable outlets), *single trusted source* or *unverified*.
* **Statistics** — mentions per day split by source trust, trend (rising / stable / falling),
  share of trusted coverage, spike alerts, regions mentioned, top sources, languages.
* **Official updates** — WHO, Rospotrebnadzor and other health authorities.
* **Latest updates** — the articles found most recently, with how many were new in the last update,
  and a **countdown to the next update** in the header.
* **AI situation brief** (optional, paid; off unless you add an API key — everything else is free) — Claude reads the last 14 days of articles and writes a summary that
  keeps confirmed facts apart from unverified claims, with a citation for each point.

The tracker uses the Python standard library only (3.10+). The AI brief additionally needs `pip install anthropic`.

## Quick start

```bash
python -m tracker            # dashboard on http://127.0.0.1:8000
```

On first start the topics in `topics.json` are loaded (a ready-made *Plague in Russia* topic),
and a background collector checks each topic every `interval_minutes` (default 30).

| Flag / env var | Meaning |
| --- | --- |
| `--host` / `HOST`, `--port` / `PORT` | where to listen (default `127.0.0.1:8000`) |
| `--db` / `TRACKER_DB` | SQLite file (default `data/tracker.db`) |
| `--seed` / `TRACKER_SEED` | starter topics file, used only when the DB has no topics |
| `--trust` / `TRACKER_TRUST` | source ratings file (default `trust.json`) |
| `TRACKER_TOKEN` | if set, creating/editing/deleting/refreshing topics requires this token (set it whenever the site is public) |
| `ANTHROPIC_API_KEY` | enables the AI situation brief |
| `TRACKER_AI_EVERY_HOURS` | regenerate the brief at most this often, after new articles arrive (default 6) |
| `--once` | collect every topic once and exit |
| `--sync-topics` | apply `topics.json` to an existing database (update by name, add new) |
| `--export DIR` | write a static copy of the dashboard to `DIR` (combine with `--once`) |
| `--no-collector` | serve the dashboard without fetching |
| `TRACKER_SCHEDULE_MINUTES` | for `--export` run by cron: the cron minutes (e.g. `0,10,20,…`), so the static page can count down to the next check |
| `TRACKER_LIVE_REPO`, `TRACKER_LIVE_BRANCH` | for `--export`: public GitHub repo and branch the page reads fresh data from between deployments |

## Where the data comes from

| Source | What it covers |
| --- | --- |
| **WHO** | Disease Outbreak News (official outbreak notices) and WHO news releases |
| **Google News RSS** | search per query and language/region (`ru`, `en`, `uk`, `de`, `fr`, `es`, `kk`), last 7 days; the real publisher is recorded, not news.google.com |
| **Any RSS/Atom feed** | e.g. regional news sites or a health agency's feed |

Every result is filtered by the topic's keyword rules and de-duplicated (by normalised URL
and by headline, so syndicated copies and the same story found by several queries count once).

## How trust is decided

Each article is rated by its publisher's domain using `trust.json`:

| Tier | Examples | Counts as trusted |
| --- | --- | --- |
| Official | who.int, rospotrebnadzor.ru (and regional offices), cdc.gov, ecdc.europa.eu, `*.gov.ru` | ✔ |
| Expert | ProMED, CIDRAP, anti-plague institutes, medical journals | ✔ |
| Reputable | Reuters, AP, BBC, Interfax, Kommersant, RBC, Meduza | ✔ |
| State media | TASS, RIA Novosti, RT, Xinhua — usually accurate when relaying officials, but editorially controlled | ✘ |
| Unverified | anything not in the list | ✘ |
| Unreliable | tabloids, user-post platforms, known fabricators | ✘ |

A story's confidence comes from **who** reports it, not how often: headlines about the same event are grouped,
and the group is *confirmed* if an official source is in it, *corroborated* with two or more independent trusted
outlets, *single trusted source* with one, and *unverified* otherwise. Edit `trust.json` to add or move sources;
existing articles are re-rated when the tracker restarts.

These ratings are a starting point, not a verdict on any outlet; check the links before relying on a report.

### How the case count works

`tracker/counts.py` reads the headlines (and summaries, when a source provides them) of the last 30 days and
picks out statements such as "lab worker dies", "2 cases", "второй случай", "dozens quarantined", and denials
like "no plague cases" or "Роспотребнадзор опроверг". For each figure it takes the highest number that is
backed by an official/expert source or by at least two different trusted outlets. "Suspected" means no
laboratory confirmation; "officially disputed" means trusted or state media report that the authorities deny it.
Sentences about history ("Black Death") or worldwide yearly statistics are ignored. It is pattern matching,
not reading comprehension, so treat the result as approximate and follow the links.

### Corrections and the revision trail

Counts are recomputed from every stored article on each check, so a later, better source changes them:

* **Official correction** — an official/expert source (WHO, Rospotrebnadzor, …) states an exact lower figure
  *after* the figure was verified: the figure drops to the official one. "1 new case"-style increments don't count.
* **Ruled out** — after the figure was verified, an official/expert source, or two independent trusted outlets,
  report it wasn't plague (tests negative, ruled out, "did not die of plague", опроверг…): the figure drops to 0.
  "Not confirmed yet" / "пока не подтвержден" is not a correction.
* The corrected figure moves to the "higher figures, not verified" list, with links; the correcting source becomes
  the figure's backing.
* **No silent drops** — when the reports behind a figure simply get older than the 30-day window, the last
  recorded figure is kept instead of falling to 0.
* **Revision trail** — every change of the deaths/cases figures is stored (`count_history` table) with time and
  reason ("new reports", "official figure: 2 → 1", "ruled out: 1 → 0", "pinned by hand"…) and exported as
  `insights.counts.history` in `data/topic-N.json`.

**Fixing or reverting by hand:** edit `corrections.json` (it applies on the next check):

```json
{"topics": {"Plague in Russia": {
  "exclude_urls": ["https://example.com/wrong-article"],
  "exclude_domains": ["fake-news.example"],
  "pin": {"deaths": {"value": 1, "note": "WHO DON 2026-10-09", "url": "https://www.who.int/…", "until": "2026-12-31"}}
}}}
```

`exclude_*` throws articles out of the counts; `pin` overrides a figure (optional `until` date, `"confirmed": false`
to show it as suspected). Remove the entry to go back to the computed figure.

## Home page, game and music

`/` is the home page (`static/index.html`): a white page with the logo in the middle and links (music, game, plague) scattered at random spots in random colours (`static/scatter.js`). The other pages have a randomly placed "go back" link the same way.
Each thing has its own page, all styled by `static/site.css` (white, system font):

* `/2048.html` — **2048** (`static/games.js`, rules in `static/g2048-core.js`) with a ranking (`static/api/scores.js`).
  (`/game.html` and `/game1.html` forward here.)
  Players get a number automatically (no names); the server deals each game's tiles from its own seed and replays
  the moves when the game ends, so scores can't be faked. Shows rank, best, games, total points, biggest tile and
  the top 20. A **recovery code** (player number + key, under the ranking) brings the same player back on another
  browser or device, or after site data was cleared. Each player can set a **nickname** once (final, unique,
  2–20 letters/numbers/spaces/_ . -); it stays with the player number. **To switch it on:** Vercel → your project → **Storage** → **Create** → **Upstash for Redis** (free) →
  connect it to the project (it adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`) → redeploy. Without it the game
  works and the best score stays on the device.
* `/gifs.html` — a wall of GIFs listed in `static/gifs.json` (`{"gifs": ["https://…gif", …]}`, shown in a new random order on every visit; .gif/.webp/.mp4 links, giphy.com links, or tenor.com page links — the "Resolve GIF links" workflow turns Tenor pages into direct links (`tools/resolve_gifs.py`) and republishes).
* `/minesweeper.html` — **minesweeper** (`/game2.html` forwards here) (`static/mines.js`, rules in `static/mines-core.js`): easy 9×9/10, medium 16×16/40,
  hard 30×16/99 (turned upright on phones). The first click is always safe; leaving the page pauses the game
  (board covered, clocks stopped) until Continue, also after a reload; mines come from a server seed and the
  server replays the opened cells and times the game itself; ranking = fastest win per difficulty. Players,
  nicknames and recovery codes are shared by all games (`static/players.js`).
* `/sudoku.html` — **sudoku** (`/game3.html` forwards here) (`static/sudoku.js`, rules and puzzle maker in `static/sudoku-core.js`): easy/medium/hard
  (38/30/~24 givens, always exactly one solution), pencil notes, keyboard. Nothing is timed until Start; leaving
  the page pauses the game (board covered, clocks stopped) until Continue, also after a reload. Puzzles come
  from a server seed; the server rebuilds the puzzle, checks the finished grid and times the solve.
* **Visitor count** — the home page shows "N people here today · M all time" (`static/api/visits.js`, same
  Redis). Each browser gets a random anonymous id (no IPs or names stored) and counts once per UTC day; visits to
  every page except the tracker count. Each id is stored once (Redis sets), so the counts are exact.
* `/restricted.html` — password-locked (`RESTRICTED_PASSWORD` in Vercel; 3 wrong tries lock that connection out for an
  hour). Shows the site's **traffic** (`static/traffic.js`): page views, visitors, top pages, where visitors came from,
  countries/cities, browsers/devices, languages, and the latest visits with IP addresses. Every page view on the
  pages that load `visits.js` is logged by `static/api/visits.js` (Vercel's location headers, IP, user agent,
  referrer); only the newest 5,000 are kept. The tracker page doesn't load it, so it isn't counted. The **ai** part
  is "under construction"; its code (a password-locked chat with Ollama on your own computer and your own rules,
  `static/restricted.js` + `static/api/agent.js`) is kept for later.
* `/nothing.html` — coffee link, contacts and a BTC address with its QR code, from `static/nothing.json`. The QR is
  a static SVG (`static/btc-qr.svg`) made once from the address with the Python `qrcode` package.
* `/music.html` — what I'm listening to on Spotify plus the players/tracks in `music.json` (`static/music.js`).
* `/watch.html` — the plague tracker (`/watch.html#2` opens topic 2). It has its own `style.css` and is not
  touched by home page changes.

* **Spotify players** — add share links (track, album, playlist, artist or podcast) to `static/music.json`:
  `{"spotify": ["https://open.spotify.com/playlist/…"]}`. They show as Spotify's player; visitors logged in to
  Spotify hear full songs, others 30-second previews.
* **Music files** — put MP3/OGG files in `static/music/` and list them in `static/music.json`:
  `{"tracks": [{"src": "music/track.mp3", "title": "Song", "artist": "Artist"}]}`. Keep files reasonably small
  (Vercel's free plan serves them fine, but each visitor downloads what they play).

### Your Spotify on the page (now playing, recently played, top artists and tracks)

`static/api/spotify.js` becomes a Vercel serverless function at `/api/spotify`. It reads your listening data with
your own Spotify login, so the secrets live only in Vercel, never in this repo:

1. Go to <https://developer.spotify.com/dashboard>, log in, **Create app**. Any name/description; Redirect URI:
   `https://YOUR-SITE/api/spotify` (for example `https://twenty6.net/api/spotify`); API: **Web API**. Save.
2. In the app's **Settings** copy the **Client ID** and **Client secret**.
3. In Vercel → the project → **Settings → Environment Variables**, add `SPOTIFY_CLIENT_ID` and
   `SPOTIFY_CLIENT_SECRET` (Production), then redeploy (Deployments → ⋯ → Redeploy).
4. Open `https://YOUR-SITE/api/spotify?setup`, log in to Spotify and agree. The page shows a refresh token.
5. Add it in Vercel as `SPOTIFY_REFRESH_TOKEN` and redeploy once more. Setup switches itself off; the music
   page now shows what you're playing (refreshed every minute) and your month's favourites.

If the site uses a different domain than the one Spotify redirects to, set `SPOTIFY_REDIRECT_URI` to the exact URI
you registered. The local Python server doesn't run this function, so the card only appears on Vercel.

## GIF stickers

The page has eight spots for GIFs: `header`, `sidebar`, `latest` (next to Latest updates), `trust` (next to
What can be trusted), `map` (under the map), `official` (next to Official updates), `articles` (next to All
articles) and `footer`. The case-count panel deliberately has none. They stay empty until GIFs are listed in `static/stickers.json`. Put the files in `static/gifs/`
and copy `stickers.example.json` to `static/stickers.json`: each entry has a `slot`, a `src` (file path or URL),
an `alt` description, optional `captions` (clicking cycles through them) and `size` (`xs`, `sm`, `md`).
Visitors can hide them with **Hide stickers** in the sidebar. Only use GIFs you have the right to publish.

## Defining a topic

Use **+ New topic** in the UI, or put it in `topics.json`:

```json
{
  "name": "Plague in Russia",
  "queries": [{ "q": "чума Россия", "lang": "ru" }, { "q": "plague Russia", "lang": "en" }],
  "who":     true,
  "feeds":   [],
  "match":   [["чум", "plague", "бубон"], ["росси", "russia", "алта", "altai", "тыв", "tuva"]],
  "exclude": ["чумовой", "plague inc"],
  "facets":  { "Tuva": { "keywords": ["тыв", "tuva"], "lat": 51.72, "lon": 94.45 } },
  "interval_minutes": 30
}
```

* `match` — keyword groups. **Every group must hit** at least one of its keywords
  (case-insensitive substring), so word stems like `чум` cover `чума / чумы / чумой`.
* `exclude` — drop an article if any of these appear (filters slang like *«чумовой»* or games).
* `facets` — regions: `{"Tuva": {"keywords": ["тыв", "tuva"], "lat": 51.72, "lon": 94.45}}`. Keywords are counted in
  the regions table; coordinates put the region on the map.
* WHO and feeds require `match` rules, otherwise every item would be kept.

`topics.json` is read into a new, empty database. To push edits from the file into an existing database
(update topics by name, add new ones), run with `--sync-topics`.

## Deploying

The tracker needs to **run continuously** (to check every 10 minutes) and **keep its database**.
Vercel can't do either: functions stop after each request and have no persistent disk. Two options:

### Option A — Vercel (free): GitHub Actions collects, pages update themselves live

`.github/workflows/collect.yml` runs every 10 minutes on GitHub's servers and collects the news. Each check
pushes its results to a branch named **`data`**; the static dashboard goes to a branch named **`site`**, which
Vercel serves.

Open pages count down to the next check, show a glowing progress bar while it runs, then fetch the new data
straight from the `data` branch on GitHub and update everything in place — no reload, and no Vercel deployment
per check. This needs a **public** repository (pages read GitHub without logging in, within GitHub's limit of
60 requests an hour per visitor; when that runs out the page falls back to the deployed copy for 15 minutes).
`site` is only republished when the site's files change, or once an hour as a fallback (about 24 deployments a
day, well inside Vercel's free 100), and the `data` branch tells Vercel not to deploy it.

1. Merge this code into the repository's **default branch** (GitHub only runs scheduled workflows from there),
   and make the repository public.
2. GitHub → **Actions** → *Collect and publish* → **Run workflow** once. This creates the `site` and `data` branches.
3. Optional: GitHub → Settings → Secrets and variables → Actions → add `ANTHROPIC_API_KEY` for the AI brief.
4. [vercel.com](https://vercel.com) → **Add New… → Project** → import this repository →
   Framework preset **Other**, leave the build command empty → **Deploy**.
5. Vercel project → **Settings → Git → Production Branch** → `site`. Don't press "Redeploy" (it rebuilds the
   code branch); instead run the workflow again (step 2), and Vercel deploys `site`.
   While Vercel still shows the code branch you'll see a setup page with these instructions instead of a 404.

The page is read-only: to add or change topics or source ratings, edit `topics.json` / `trust.json` on the
default branch — the next check applies them (`--sync-topics`). GitHub's scheduler often starts runs a few
minutes late and can skip runs when it is busy; the page then says the check is late and the next one catches
up. GitHub also pauses scheduled workflows in repositories with no activity for 60 days. To change the
interval, edit the cron line and `TRACKER_SCHEDULE_MINUTES` in the workflow together (GitHub's minimum is 5
minutes). Public repositories run Actions for free; a private one would use up its 2,000 free minutes a month
at this rate.

#### Reliable automatic checks (cron-job.org)

GitHub's built-in scheduler is "best effort": runs are often late, sometimes skipped, and new schedules can take
hours to start. For checks that really happen every 10 minutes, let a free outside scheduler start the workflow
through GitHub's API (GitHub's own schedule stays on as a backup; a second run within 3 minutes skips itself).

1. **Create a token** that can only start this workflow: GitHub → avatar → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token. Repository access: *Only select
   repositories* → this repository. Permissions → Repository permissions → **Actions: Read and write** (nothing
   else). Pick an expiration, generate, and copy the token. Keep it secret.
2. **Create the job** at [cron-job.org](https://cron-job.org) (free account) → *Create cronjob*:
   - URL: `https://api.github.com/repos/OWNER/REPO/actions/workflows/collect.yml/dispatches`
   - Schedule: every 10 minutes — custom, minutes `0,10,20,30,40,50`, every hour, every day
   - Advanced → Request method **POST**, headers
     `Accept: application/vnd.github+json`, `Authorization: Bearer YOUR_TOKEN`,
     `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`,
     and request body `{"ref":"DEFAULT_BRANCH"}` (the repository's default branch name)
   - Save, then *Test run*: the answer should be **204 No Content**, and a new run appears under GitHub → Actions.

When the token expires, cron-job.org shows failed runs (401) — generate a new token and paste it into the job.

GitHub Pages works the same way: Settings → Pages → Deploy from branch → `site` / root.

### Option B — Full app on a server (live editing, refresh button)

Any host that runs Docker with a persistent disk: Render, Railway, Fly.io, or a small VPS.

```bash
docker build -t 26awake .
docker run -d -p 8000:8000 -v 26awake-data:/data \
  -e TRACKER_TOKEN=change-me -e ANTHROPIC_API_KEY=sk-ant-... 26awake
```

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/topics` | topics with stats |
| POST | `/api/topics` | create (JSON body as above) |
| PUT / DELETE | `/api/topics/{id}` | update / delete |
| POST | `/api/topics/{id}/refresh` | collect now |
| GET | `/api/topics/{id}/articles?q=&lang=&trust=&since=&limit=&offset=` | feed; `trust=trusted` or e.g. `trust=official,expert` |
| GET | `/api/topics/{id}/insights` | stories with confidence, case counts, trend, regions (with coordinates), official updates |
| GET | `/api/topics/{id}/analysis` · POST `/analyze` | latest AI brief · generate a new one |
| GET | `/api/topics/{id}/timeline?days=30` | mentions per day, split by trust tier |
| GET | `/api/topics/{id}/breakdown` | top sources and languages |
| GET | `/api/topics/{id}/runs` | collection log (errors per source) |
| GET | `/api/trust` | trust tiers and their descriptions |

Write endpoints need `Authorization: Bearer $TRACKER_TOKEN` when a token is configured.

## Tests

```bash
python -m unittest -v
```

Tests run offline against recorded Google News / WHO / Atom fixtures; the Claude call is mocked.
