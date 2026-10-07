# PlagueWeb — internet topic tracker

A small self-hosted website that keeps watching the internet for the topics you define
(for example, **plague cases in Russia**), stores every matching article, and shows a live
dashboard: mentions per day, coverage-spike alerts, top sources, languages and a searchable feed.

No dependencies beyond Python 3.10+ (standard library only: `sqlite3`, `urllib`, `http.server`).

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
| `TRACKER_TOKEN` | if set, creating/editing/deleting/refreshing topics requires this token (set it whenever the site is public) |
| `--once` | collect every topic once and exit — use with cron instead of the built-in scheduler |
| `--no-collector` | serve the dashboard without fetching |

Docker:

```bash
docker build -t plagueweb .
docker run -d -p 8000:8000 -v plagueweb-data:/data -e TRACKER_TOKEN=change-me plagueweb
```

## Where the data comes from

| Source | What it covers |
| --- | --- |
| **Google News RSS** | search per query and language/region (`ru`, `en`, `uk`, `de`, `fr`, `es`, `kk`), last 7 days |
| **GDELT DOC API** | global news index updated every 15 minutes, many languages (throttled to 1 request / 6 s) |
| **Any RSS/Atom feed** | e.g. Rospotrebnadzor, WHO Disease Outbreak News, regional news sites |

Every result is filtered by the topic's keyword rules and de-duplicated (by normalised URL
and by headline, so syndicated copies and the same story found by several queries count once).

## Defining a topic

Use **+ New topic** in the UI, or put it in `topics.json`:

```json
{
  "name": "Plague in Russia",
  "queries": [{ "q": "чума Россия", "lang": "ru" }, { "q": "plague Russia", "lang": "en" }],
  "gdelt":   ["plague (Russia OR Altai OR Tuva)"],
  "feeds":   [],
  "match":   [["чум", "plague", "бубон"], ["росси", "russia", "алта", "altai", "тыв", "tuva"]],
  "exclude": ["чумовой", "plague inc"],
  "interval_minutes": 30
}
```

* `match` — a list of keyword groups. **Every group must hit** at least one of its keywords
  (case-insensitive substring), so word stems like `чум` cover `чума / чумы / чумой`.
* `exclude` — drop an article if any of these appear (filters slang like *«чумовой»* or games).
* Feeds require `match` rules, otherwise every item in the feed would be kept.

A **spike** is flagged when the last 24 h has ≥ 5 articles and at least twice the previous
week's daily average.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/topics` | topics with stats |
| POST | `/api/topics` | create (JSON body as above) |
| PUT / DELETE | `/api/topics/{id}` | update / delete |
| POST | `/api/topics/{id}/refresh` | collect now |
| GET | `/api/topics/{id}/articles?q=&lang=&since=&limit=&offset=` | feed |
| GET | `/api/topics/{id}/timeline?days=30` | mentions per day |
| GET | `/api/topics/{id}/breakdown` | top sources and languages |
| GET | `/api/topics/{id}/runs` | collection log (errors per source) |

Write endpoints need `Authorization: Bearer $TRACKER_TOKEN` when a token is configured.

## Tests

```bash
python -m unittest -v
```

Tests run offline against recorded Google News / GDELT / Atom fixtures.
