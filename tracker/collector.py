"""Topic validation, keyword matching and the background collection loop."""

from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import ai, sources
from .insights import is_stale
from .store import Store, now_iso

log = logging.getLogger("tracker.collector")

DEFAULT_INTERVAL = 30  # minutes
MIN_INTERVAL = 5
AI_EVERY_HOURS = float(os.environ.get("TRACKER_AI_EVERY_HOURS", "6"))


class ValidationError(ValueError):
    pass


def _str_list(value, field: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [v for v in (s.strip() for s in value.replace("\n", ",").split(",")) if v]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValidationError(f"'{field}' must be a list of strings")
    return [v.strip() for v in value if v.strip()]


def normalize_topic(data: dict) -> dict:
    """Validate a topic definition coming from the API or the seed file."""
    if not isinstance(data, dict):
        raise ValidationError("topic must be an object")
    name = str(data.get("name", "")).strip()
    if not name:
        raise ValidationError("'name' is required")

    queries = []
    for q in data.get("queries") or []:
        if isinstance(q, str):
            q = {"q": q, "lang": "en"}
        if not isinstance(q, dict) or not str(q.get("q", "")).strip():
            raise ValidationError("each query needs a non-empty 'q'")
        lang = str(q.get("lang") or "en")
        if lang not in sources.GOOGLE_NEWS_LOCALES:
            raise ValidationError(f"unsupported language '{lang}'; use one of {sorted(sources.GOOGLE_NEWS_LOCALES)}")
        queries.append({"q": str(q["q"]).strip(), "lang": lang})

    match = data.get("match") or []
    if not isinstance(match, list):
        raise ValidationError("'match' must be a list of keyword groups")
    match = [g for g in (_str_list(g, "match") for g in match) if g]

    feeds = _str_list(data.get("feeds"), "feeds")
    for f in feeds:
        if not f.startswith(("http://", "https://")):
            raise ValidationError(f"feed '{f}' must be an http(s) URL")

    who = bool(data.get("who", False))
    if not (queries or feeds or who):
        raise ValidationError("add at least one search query, feed or the WHO source")
    if who and not match:
        raise ValidationError("the WHO source needs 'match' keywords, otherwise every WHO item is kept")

    facets = {}
    raw_facets = data.get("facets") or {}
    if not isinstance(raw_facets, dict):
        raise ValidationError("'facets' must map a name to keywords (and optional lat/lon)")
    for facet_name, value in raw_facets.items():
        facet_name = str(facet_name).strip()
        facet = value if isinstance(value, dict) else {"keywords": value}
        keywords = _str_list(facet.get("keywords"), "facets")
        if not facet_name or not keywords:
            continue
        lat, lon = facet.get("lat"), facet.get("lon")
        try:
            lat = float(lat) if lat not in (None, "") else None
            lon = float(lon) if lon not in (None, "") else None
        except (TypeError, ValueError):
            raise ValidationError(f"facet '{facet_name}': lat/lon must be numbers") from None
        if (lat is None) != (lon is None) or (lat is not None and not (-90 <= lat <= 90 and -180 <= lon <= 180)):
            raise ValidationError(f"facet '{facet_name}': give both lat (-90..90) and lon (-180..180), or neither")
        facets[facet_name] = {"keywords": keywords, "lat": lat, "lon": lon}
    if feeds and not match:
        raise ValidationError("topics with feeds need 'match' keywords, otherwise every feed item is kept")

    try:
        interval = int(data.get("interval_minutes") or DEFAULT_INTERVAL)
    except (TypeError, ValueError):
        raise ValidationError("'interval_minutes' must be a number") from None

    return {
        "name": name,
        "description": str(data.get("description", "")).strip(),
        "queries": queries,
        "feeds": feeds,
        "who": who,
        "match": match,
        "facets": facets,
        "exclude": _str_list(data.get("exclude"), "exclude"),
        "interval_minutes": max(MIN_INTERVAL, interval),
        "enabled": bool(data.get("enabled", True)),
    }


def matches(topic: dict, article: dict) -> bool:
    """Every keyword group must hit at least once (substring, case-insensitive);
    no exclude keyword may appear. Substrings let 'чум' cover 'чума', 'чумы', 'чумой'."""
    text = f"{article.get('title', '')} {article.get('summary', '')}".lower()
    if any(x.lower() in text for x in topic.get("exclude", [])):
        return False
    return all(any(k.lower() in text for k in group) for group in topic.get("match", []))


def jobs_for(topic: dict) -> list[tuple[str, callable]]:
    jobs = []
    for q in topic["queries"]:
        jobs.append((f"google_news[{q['lang']}]: {q['q']}", lambda q=q: sources.fetch_google_news(q["q"], q["lang"])))
    if topic.get("who"):
        jobs.append(("who: disease outbreak news", sources.fetch_who_don))
        jobs.append(("who: news", sources.fetch_who_news))
    for f in topic["feeds"]:
        jobs.append((f"rss: {f}", lambda f=f: sources.fetch_rss(f)))
    return jobs


class Collector:
    def __init__(self, store: Store):
        self.store = store
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._busy: set[int] = set()
        self._busy_lock = threading.Lock()

    def is_busy(self, topic_id: int) -> bool:
        return topic_id in self._busy

    def collect(self, topic: dict) -> dict:
        """Run every source of one topic now. Safe to call from any thread."""
        with self._busy_lock:
            if topic["id"] in self._busy:
                return {"skipped": True}
            self._busy.add(topic["id"])
        summary = {"found": 0, "added": 0, "errors": 0}
        started = now_iso()
        def fetch_one(job):
            label, fetch = job
            try:
                return label, fetch(), None
            except Exception as e:  # one broken source must not stop the others
                return label, None, e

        try:
            # Download every source at the same time (a slow one doesn't hold up the rest),
            # then store the results one by one.
            jobs = jobs_for(topic)
            with ThreadPoolExecutor(max_workers=max(1, min(8, len(jobs)))) as pool:
                results = list(pool.map(fetch_one, jobs))
            for label, items, error in results:
                try:
                    if error:
                        raise error
                    kept = [a for a in items if matches(topic, a)]
                    added = self.store.add_articles(topic["id"], kept)
                    self.store.add_run(topic["id"], label, True, len(kept), added, None, fetched=len(items))
                    summary["found"] += len(kept)
                    summary["added"] += added
                    log.info("%s | %s: %d fetched, %d matched, %d new", topic["name"], label, len(items), len(kept), added)
                except Exception as e:  # one broken source must not stop the others
                    summary["errors"] += 1
                    self.store.add_run(topic["id"], label, False, 0, 0, f"{type(e).__name__}: {e}"[:500])
                    log.warning("%s | %s failed: %s", topic["name"], label, e)
            self.store.mark_run(topic["id"], started, summary["added"])
            if summary["added"] and ai.available():
                self.maybe_analyze(topic)
        finally:
            with self._busy_lock:
                self._busy.discard(topic["id"])
        return summary

    def maybe_analyze(self, topic: dict, force: bool = False) -> dict | None:
        last = self.store.latest_analysis(topic["id"])
        if not force and last and not is_stale(last["created_at"], AI_EVERY_HOURS):
            return None
        try:
            return ai.run(self.store, topic)
        except Exception as e:
            log.warning("%s | AI analysis failed: %s", topic["name"], e)
            self.store.add_run(topic["id"], "ai analysis", False, 0, 0, f"{type(e).__name__}: {e}"[:500])
            return None

    def collect_async(self, topic: dict) -> None:
        threading.Thread(target=self.collect, args=(topic,), daemon=True).start()

    def due(self, topic: dict) -> bool:
        if not topic.get("enabled", True):
            return False
        if not topic.get("last_run_at"):
            return True
        last = datetime.fromisoformat(topic["last_run_at"])
        return datetime.now(timezone.utc) - last >= timedelta(minutes=topic["interval_minutes"])

    def run_forever(self, tick: int = 30) -> None:
        log.info("collector started")
        while not self._stop.is_set():
            for topic in self.store.list_topics():
                if self._stop.is_set():
                    break
                if self.due(topic):
                    self.collect(topic)
            self._wake.wait(tick)
            self._wake.clear()

    def start(self) -> threading.Thread:
        t = threading.Thread(target=self.run_forever, name="collector", daemon=True)
        t.start()
        return t

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
