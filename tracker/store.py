"""SQLite persistence for topics, articles and collection runs."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import urllib.parse
from datetime import datetime, timedelta, timezone

from .sources import domain_of
from .trust import TRUSTED, TrustRegistry

SCHEMA = """
CREATE TABLE IF NOT EXISTS topics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    config      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    last_run_at TEXT
);
CREATE TABLE IF NOT EXISTS articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id     INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    url          TEXT NOT NULL,
    url_key      TEXT NOT NULL,
    title_key    TEXT NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT '',
    lang         TEXT NOT NULL DEFAULT '',
    origin       TEXT NOT NULL DEFAULT '',
    domain       TEXT NOT NULL DEFAULT '',
    trust        TEXT NOT NULL DEFAULT 'unknown',
    published_at TEXT NOT NULL,
    fetched_at   TEXT NOT NULL,
    UNIQUE (topic_id, url_key),
    UNIQUE (topic_id, title_key)
);
CREATE INDEX IF NOT EXISTS idx_articles_topic_pub ON articles(topic_id, published_at DESC);
CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    source      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    fetched     INTEGER NOT NULL DEFAULT 0,
    found       INTEGER NOT NULL DEFAULT 0,
    added       INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_topic ON runs(topic_id, id DESC);
CREATE TABLE IF NOT EXISTS analyses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    model       TEXT NOT NULL,
    n_articles  INTEGER NOT NULL,
    result      TEXT NOT NULL
);
"""

# Columns added after the first release; added in place to databases created before them.
MIGRATIONS = {
    "topics": [
        ("last_run_started", "TEXT"),
        ("last_run_added", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "runs": [
        ("fetched", "INTEGER NOT NULL DEFAULT 0"),
    ],
    "articles": [
        ("domain", "TEXT NOT NULL DEFAULT ''"),
        ("trust", "TEXT NOT NULL DEFAULT 'unknown'"),
    ],
}

_TRACKING_PARAMS = re.compile(r"^(utm_|fbclid|gclid|yclid|ref$|rss$|from$)", re.I)
_NON_WORD = re.compile(r"[\W_]+", re.U)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(name: str) -> str:
    slug = _NON_WORD.sub("-", name.lower()).strip("-")
    return slug[:60] or "topic"


def url_key(url: str) -> str:
    p = urllib.parse.urlsplit(url.strip())
    query = urllib.parse.urlencode(
        [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not _TRACKING_PARAMS.match(k)]
    )
    host = p.netloc.lower().removeprefix("www.").removeprefix("m.")
    norm = f"{host}{p.path.rstrip('/')}?{query}"
    return hashlib.sha1(norm.encode()).hexdigest()


def title_key(title: str) -> str:
    return hashlib.sha1(_NON_WORD.sub(" ", title.lower()).strip().encode()).hexdigest()


class Store:
    def __init__(self, path: str, trust: TrustRegistry | None = None):
        self.path = path
        self.trust = trust or TrustRegistry()
        self._lock = threading.Lock()
        c = self._conn()
        try:
            with c:
                c.executescript(SCHEMA)
                for table, cols in MIGRATIONS.items():
                    have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
                    for name, decl in cols:
                        if name not in have:
                            c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
                c.execute("CREATE INDEX IF NOT EXISTS idx_articles_topic_trust ON articles(topic_id, trust)")
        finally:
            c.close()
        self.reclassify()

    def reclassify(self) -> int:
        """Re-rate every stored article, so edits to trust.json apply to history too."""

        def op(c):
            rows = c.execute("SELECT id, domain, url, trust FROM articles").fetchall()
            changed = 0
            for r in rows:
                domain = r["domain"] or domain_of(r["url"])
                tier = self.trust.tier(domain)
                if tier != r["trust"] or domain != r["domain"]:
                    c.execute("UPDATE articles SET trust = ?, domain = ? WHERE id = ?", (tier, domain, r["id"]))
                    changed += 1
            return changed

        return self._write(op)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        # SQLite's LIKE/lower() only fold ASCII; this makes search case-insensitive for Cyrillic too.
        c.create_function("ulower", 1, lambda s: s.lower() if isinstance(s, str) else s, deterministic=True)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        return c

    def _read(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        c = self._conn()
        try:
            return c.execute(sql, args).fetchall()
        finally:
            c.close()

    def _write(self, fn):
        with self._lock:
            c = self._conn()
            try:
                with c:
                    return fn(c)
            finally:
                c.close()

    # --- topics ------------------------------------------------------------------------

    @staticmethod
    def _topic(row: sqlite3.Row) -> dict:
        t = json.loads(row["config"])
        t.update(
            id=row["id"],
            slug=row["slug"],
            created_at=row["created_at"],
            last_run_at=row["last_run_at"],
            last_run_started=row["last_run_started"],
            last_run_added=row["last_run_added"],
        )
        return t

    def list_topics(self) -> list[dict]:
        return [self._topic(r) for r in self._read("SELECT * FROM topics ORDER BY id")]

    def get_topic(self, topic_id: int) -> dict | None:
        rows = self._read("SELECT * FROM topics WHERE id = ?", (topic_id,))
        return self._topic(rows[0]) if rows else None

    def create_topic(self, config: dict) -> dict:
        def op(c):
            base = slugify(config["name"])
            slug, n = base, 2
            while c.execute("SELECT 1 FROM topics WHERE slug = ?", (slug,)).fetchone():
                slug, n = f"{base}-{n}", n + 1
            cur = c.execute(
                "INSERT INTO topics (slug, config, created_at) VALUES (?, ?, ?)",
                (slug, json.dumps(config, ensure_ascii=False), now_iso()),
            )
            return cur.lastrowid

        return self.get_topic(self._write(op))

    def update_topic(self, topic_id: int, config: dict) -> dict | None:
        self._write(
            lambda c: c.execute(
                "UPDATE topics SET config = ? WHERE id = ?", (json.dumps(config, ensure_ascii=False), topic_id)
            )
        )
        return self.get_topic(topic_id)

    def delete_topic(self, topic_id: int) -> None:
        self._write(lambda c: c.execute("DELETE FROM topics WHERE id = ?", (topic_id,)))

    def mark_run(self, topic_id: int, started: str | None = None, added: int = 0) -> None:
        self._write(
            lambda c: c.execute(
                "UPDATE topics SET last_run_at = ?, last_run_started = ?, last_run_added = ? WHERE id = ?",
                (now_iso(), started or now_iso(), added, topic_id),
            )
        )

    # --- articles ----------------------------------------------------------------------

    def add_articles(self, topic_id: int, articles: list[dict]) -> int:
        fetched = now_iso()

        def op(c):
            added = 0
            for a in articles:
                cur = c.execute(
                    """INSERT OR IGNORE INTO articles
                       (topic_id, url, url_key, title_key, title, summary, source, lang, origin,
                        domain, trust, published_at, fetched_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        topic_id,
                        a["url"],
                        url_key(a["url"]),
                        title_key(a["title"]),
                        a["title"],
                        a.get("summary", ""),
                        a.get("source", ""),
                        a.get("lang", ""),
                        a.get("origin", ""),
                        (domain := a.get("domain") or domain_of(a["url"])),
                        self.trust.tier(domain),
                        min(a["published_at"], fetched),  # never trust future dates
                        fetched,
                    ),
                )
                added += cur.rowcount
            return added

        return self._write(op)

    def articles(
        self,
        topic_id: int,
        q: str = "",
        lang: str = "",
        since: str = "",
        tiers: list[str] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        where, args = ["topic_id = ?"], [topic_id]
        if tiers:
            where.append(f"trust IN ({','.join('?' * len(tiers))})")
            args += list(tiers)
        if q:
            where.append("(ulower(title) LIKE ? OR ulower(summary) LIKE ? OR ulower(source) LIKE ?)")
            args += [f"%{q.lower()}%"] * 3
        if lang:
            where.append("lang = ?")
            args.append(lang)
        if since:
            where.append("published_at >= ?")
            args.append(since)
        clause = " AND ".join(where)
        total = self._read(f"SELECT COUNT(*) FROM articles WHERE {clause}", tuple(args))[0][0]
        rows = self._read(
            f"""SELECT id, url, title, summary, source, lang, origin, domain, trust, published_at, fetched_at
                FROM articles WHERE {clause} ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?""",
            tuple(args + [limit, offset]),
        )
        return [dict(r) for r in rows], total

    def timeline(self, topic_id: int, days: int = 30) -> list[dict]:
        """Articles per day, total and split by trust tier."""
        start = (datetime.now(timezone.utc) - timedelta(days=days - 1)).date()
        rows = self._read(
            """SELECT substr(published_at, 1, 10) AS day, trust, COUNT(*) AS n FROM articles
               WHERE topic_id = ? AND published_at >= ? GROUP BY day, trust""",
            (topic_id, start.isoformat()),
        )
        by_day: dict[str, dict] = {}
        for r in rows:
            by_day.setdefault(r["day"], {})[r["trust"]] = r["n"]
        out = []
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            tiers = by_day.get(d, {})
            out.append({"day": d, "count": sum(tiers.values()), "tiers": tiers})
        return out

    def latest_found(self, topic_id: int, limit: int = 10, since: str | None = None) -> list[dict]:
        """Articles found in the latest update (since its start) first, newest published first;
        then the most recently found older ones."""
        rows = self._read(
            """SELECT id, url, title, summary, source, lang, origin, domain, trust, published_at, fetched_at
               FROM articles WHERE topic_id = ?
               ORDER BY fetched_at >= ? DESC, CASE WHEN fetched_at >= ? THEN published_at END DESC,
                        fetched_at DESC, published_at DESC
               LIMIT ?""",
            (topic_id, since or "9999", since or "9999", limit),
        )
        return [dict(r) for r in rows]

    def recent(self, topic_id: int, days: int = 14, limit: int = 1000) -> list[dict]:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        rows = self._read(
            """SELECT id, url, title, summary, source, lang, origin, domain, trust, published_at, fetched_at
               FROM articles WHERE topic_id = ? AND published_at >= ? ORDER BY published_at DESC LIMIT ?""",
            (topic_id, since, limit),
        )
        return [dict(r) for r in rows]

    def top_sources(self, topic_id: int, limit: int = 15) -> list[dict]:
        rows = self._read(
            """SELECT source, MAX(trust) AS trust, COUNT(*) AS n FROM articles WHERE topic_id = ? AND source != ''
               GROUP BY source ORDER BY n DESC LIMIT ?""",
            (topic_id, limit),
        )
        return [{"source": r["source"], "trust": r["trust"], "count": r["n"]} for r in rows]

    def tier_counts(self, topic_id: int) -> dict[str, int]:
        rows = self._read("SELECT trust, COUNT(*) AS n FROM articles WHERE topic_id = ? GROUP BY trust", (topic_id,))
        return {r["trust"]: r["n"] for r in rows}

    def languages(self, topic_id: int) -> list[dict]:
        rows = self._read(
            "SELECT lang, COUNT(*) AS n FROM articles WHERE topic_id = ? GROUP BY lang ORDER BY n DESC", (topic_id,)
        )
        return [{"lang": r["lang"] or "?", "count": r["n"]} for r in rows]

    def stats(self, topic_id: int) -> dict:
        now = datetime.now(timezone.utc)
        day_ago = (now - timedelta(days=1)).isoformat()
        week_ago = (now - timedelta(days=8)).isoformat()
        r = self._read(
            f"""SELECT COUNT(*) AS total,
                      SUM(published_at >= ?) AS last24h,
                      SUM(published_at >= ? AND published_at < ?) AS prev7d,
                      SUM(trust IN ({','.join('?' * len(TRUSTED))})) AS trusted,
                      SUM(published_at >= ? AND trust IN ({','.join('?' * len(TRUSTED))})) AS trusted24h,
                      MAX(published_at) AS latest,
                      MAX(CASE WHEN trust = 'official' THEN published_at END) AS latest_official
               FROM articles WHERE topic_id = ?""",
            (day_ago, week_ago, day_ago, *TRUSTED, day_ago, *TRUSTED, topic_id),
        )[0]
        last24h, prev7d = r["last24h"] or 0, r["prev7d"] or 0
        baseline = prev7d / 7
        # A "spike" is a day with clearly more coverage than the previous week's daily average.
        spike = last24h >= 5 and last24h >= 2 * max(baseline, 1)
        return {
            "total": r["total"],
            "last24h": last24h,
            "daily_avg_prev7d": round(baseline, 1),
            "latest": r["latest"],
            "latest_official": r["latest_official"],
            "trusted": r["trusted"] or 0,
            "trusted24h": r["trusted24h"] or 0,
            "spike": spike,
        }

    # --- runs --------------------------------------------------------------------------

    def add_run(
        self, topic_id: int, source: str, ok: bool, found: int, added: int, error: str | None, fetched: int = 0
    ) -> None:
        self._write(
            lambda c: c.execute(
                """INSERT INTO runs (topic_id, source, started_at, ok, fetched, found, added, error)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (topic_id, source, now_iso(), int(ok), fetched, found, added, error),
            )
        )

    def runs(self, topic_id: int, limit: int = 30) -> list[dict]:
        rows = self._read("SELECT * FROM runs WHERE topic_id = ? ORDER BY id DESC LIMIT ?", (topic_id, limit))
        return [dict(r) for r in rows]

    # --- AI analyses -------------------------------------------------------------------

    def add_analysis(self, topic_id: int, model: str, n_articles: int, result: dict) -> None:
        self._write(
            lambda c: c.execute(
                "INSERT INTO analyses (topic_id, created_at, model, n_articles, result) VALUES (?,?,?,?,?)",
                (topic_id, now_iso(), model, n_articles, json.dumps(result, ensure_ascii=False)),
            )
        )

    def latest_analysis(self, topic_id: int) -> dict | None:
        rows = self._read("SELECT * FROM analyses WHERE topic_id = ? ORDER BY id DESC LIMIT 1", (topic_id,))
        if not rows:
            return None
        r = dict(rows[0])
        r["result"] = json.loads(r["result"])
        return r
