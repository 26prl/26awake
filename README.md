# PlagueWeb — internet topic tracker

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
| `TRACKER_SCHEDULE_MINUTES` | for `--export` run by cron: the cron minutes (e.g. `7,37`), so the static page can count down to the next update |

## Where the data comes from

| Source | What it covers |
| --- | --- |
| **WHO** | Disease Outbreak News (official outbreak notices) and WHO news releases |
| **Google News RSS** | search per query and language/region (`ru`, `en`, `uk`, `de`, `fr`, `es`, `kk`), last 7 days; the real publisher is recorded, not news.google.com |
| **GDELT DOC API** | global news index updated every 15 minutes, many languages (throttled to 1 request / 6 s) |
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
  "gdelt":   ["plague (Russia OR Altai OR Tuva)"],
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

The tracker needs to **run continuously** (to collect every 11 minutes) and **keep its database**.
Vercel can't do either: functions stop after each request and have no persistent disk. Two options:

### Option A — Vercel (free): GitHub Actions collects, Vercel serves

`.github/workflows/collect.yml` runs every 11 minutes on GitHub's servers, collects the news, keeps the
database, and pushes a static copy of the dashboard to a branch named `site`. Vercel serves that branch.

1. Merge this code into the repository's **default branch** (GitHub only runs scheduled workflows from there).
2. GitHub → **Actions** → *Collect and publish* → **Run workflow** once. This creates the `site` branch.
3. Optional: GitHub → Settings → Secrets and variables → Actions → add `ANTHROPIC_API_KEY` for the AI brief.
4. [vercel.com](https://vercel.com) → **Add New… → Project** → import this repository →
   Framework preset **Other**, leave the build command empty → **Deploy**.
5. Vercel project → **Settings → Git → Production Branch** → `site`. Don't press "Redeploy" (it rebuilds the
   code branch); instead run the workflow again (step 2) or wait for the next run, and Vercel deploys `site`.
   While Vercel still shows the code branch you'll see a setup page with these instructions instead of a 404.

From then on the workflow checks every 11 minutes and pushes to `site` only when there is something to show:
new articles, changed site files, or once an hour. That keeps Vercel under its free limit of 100 deployments a
day. The page is read-only: to add or change topics or source ratings, edit `topics.json` / `trust.json` on the
default branch — the next published run applies them (`--sync-topics`). GitHub's cron is often a few minutes
late, and GitHub pauses scheduled workflows in repositories with no activity for 60 days.

**GitHub Actions minutes:** public repositories run Actions for free without limit. A private repository gets
2,000 free minutes a month, and every run counts as at least one minute: checking every 11 minutes needs about
4,300 a month, so in a private repository the checks stop around mid-month. Make the repository public
(Settings → General → Danger Zone → Change visibility), or change the cron line in
`.github/workflows/collect.yml` to `"7,37 * * * *"` (every 30 minutes, ~1,450 minutes a month) and set
`TRACKER_SCHEDULE_MINUTES` to `"7,37"`.

GitHub Pages works the same way: Settings → Pages → Deploy from branch → `site` / root.

### Option B — Full app on a server (live editing, refresh button)

Any host that runs Docker with a persistent disk: Render, Railway, Fly.io, or a small VPS.

```bash
docker build -t plagueweb .
docker run -d -p 8000:8000 -v plagueweb-data:/data \
  -e TRACKER_TOKEN=change-me -e ANTHROPIC_API_KEY=sk-ant-... plagueweb
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

Tests run offline against recorded Google News / GDELT / WHO / Atom fixtures; the Claude call is mocked.
