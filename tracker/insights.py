"""Deterministic analysis of collected articles: story clusters with a confidence level,
trend, region (facet) breakdown with map coordinates, and verified case counts (see counts.py)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from . import counts
from .trust import SCORES, TIERS, TRUSTED

_WORD = re.compile(r"[^\W\d_]{4,}", re.U)
STOPWORDS = {
    "that", "this", "with", "from", "have", "were", "after", "into", "about", "says", "said", "over", "amid",
    "новости", "после", "также", "может", "были", "было", "будет", "этом", "года", "году", "которые",
}

CONFIDENCE = {
    "confirmed": "Reported by an official health authority",
    "corroborated": "Reported by several independent trusted outlets",
    "single_source": "Reported by one trusted outlet only",
    "unverified": "Only state media, unknown or unreliable sources",
}


def _tokens(text: str) -> set[str]:
    # A 5-letter prefix is a crude stemmer: it folds most Russian case endings
    # ("бубонной"/"бубонная" → "бубон") and English plurals.
    return {w[:5] for w in _WORD.findall(text.lower()) if w not in STOPWORDS}


def _similar(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def cluster(articles: list[dict], threshold: float = 0.6) -> list[dict]:
    """Group headlines about the same story (greedy single pass, newest first)."""
    clusters: list[dict] = []
    for a in sorted(articles, key=lambda x: x["published_at"], reverse=True):
        toks = _tokens(a["title"])
        best, best_sim = None, 0.0
        for c in clusters:
            sim = _similar(toks, c["_tokens"])
            if sim > best_sim:
                best, best_sim = c, sim
        if best is not None and best_sim >= threshold:
            best["articles"].append(a)
        else:
            clusters.append({"_tokens": toks, "articles": [a]})

    out = []
    for c in clusters:
        arts = c["articles"]
        domains: dict[str, str] = {}
        for a in arts:
            domains.setdefault(a.get("domain") or a["source"], a["trust"])
        tiers = list(domains.values())
        n_trusted = sum(t in TRUSTED for t in tiers)
        if "official" in tiers:
            level = "confirmed"
        elif n_trusted >= 2:
            level = "corroborated"
        elif n_trusted == 1:
            level = "single_source"
        else:
            level = "unverified"
        lead = max(arts, key=lambda a: (SCORES.get(a["trust"], 0), a["published_at"]))
        out.append(
            {
                "title": lead["title"],
                "url": lead["url"],
                "lead_source": lead["source"],
                "lead_trust": lead["trust"],
                "level": level,
                "level_text": CONFIDENCE[level],
                "first_seen": min(a["published_at"] for a in arts),
                "last_seen": max(a["published_at"] for a in arts),
                "n_articles": len(arts),
                "n_sources": len(domains),
                "tiers": {t: tiers.count(t) for t in TIERS if t in tiers},
                "article_ids": [a["id"] for a in arts if "id" in a],
            }
        )
    rank = {"confirmed": 0, "corroborated": 1, "single_source": 2, "unverified": 3}
    out.sort(key=lambda c: c["last_seen"], reverse=True)
    out.sort(key=lambda c: rank[c["level"]])  # stable: best-confirmed first, newest first within a level
    return out


def trend(timeline: list[dict]) -> dict:
    """Compare the last 3 days with the 7 days before that."""
    counts = [d["count"] for d in timeline]
    recent, before = counts[-3:], counts[-10:-3]
    recent_avg = sum(recent) / max(len(recent), 1)
    before_avg = sum(before) / max(len(before), 1)
    if recent_avg == 0 and before_avg == 0:
        direction = "quiet"
    elif before_avg == 0:
        direction = "new"
    else:
        ratio = recent_avg / before_avg
        direction = "rising" if ratio >= 1.5 else "falling" if ratio <= 0.67 else "stable"
    return {"direction": direction, "recent_daily_avg": round(recent_avg, 1), "previous_daily_avg": round(before_avg, 1)}


def facet_defs(topic: dict) -> dict[str, dict]:
    """Facets as {name: {keywords, lat, lon}}; older topics stored a plain keyword list."""
    out = {}
    for name, value in (topic.get("facets") or {}).items():
        facet = value if isinstance(value, dict) else {"keywords": value}
        out[name] = {"keywords": facet.get("keywords", []), "lat": facet.get("lat"), "lon": facet.get("lon")}
    return out


def facets(topic: dict, articles: list[dict], region_counts: dict | None = None) -> list[dict]:
    """Mentions of each configured facet (e.g. region) across all vs. trusted articles, with map
    coordinates and the verified counts attributed to that region."""
    out = []
    for name, facet in facet_defs(topic).items():
        kws = [k.lower() for k in facet["keywords"]]
        hits = [a for a in articles if any(k in f"{a['title']} {a.get('summary', '')}".lower() for k in kws)]
        if not hits:
            continue
        trusted = [a for a in hits if a["trust"] in TRUSTED and not a.get("is_repeat")]
        best = max(hits, key=lambda a: (SCORES.get(a["trust"], 0), a["published_at"]))
        out.append(
            {
                "name": name,
                "lat": facet["lat"],
                "lon": facet["lon"],
                "count": len(hits),
                "trusted": len(trusted),
                "official": sum(a["trust"] == "official" for a in hits),
                "last_seen": max(a["published_at"] for a in hits),
                "top": {k: best[k] for k in ("title", "url", "source", "trust", "published_at")},
                "counts": (region_counts or {}).get(name),
            }
        )
    out.sort(key=lambda f: (-f["trusted"], -f["count"]))
    return out


def build(store, topic: dict, days: int = 14) -> dict:
    window = store.recent(topic["id"], days=counts.WINDOW_DAYS, limit=5000)
    case_counts = counts.build(window, facet_defs(topic), corrections=counts.load_corrections(topic["name"]))
    track_counts(store, topic, case_counts)
    articles = [a for a in window if a["published_at"] >= _since(days)]
    timeline = store.timeline(topic["id"], days=30)
    clusters = cluster(articles)
    official = [a for a in articles if a["trust"] == "official"][:8]
    levels = {k: sum(c["level"] == k for c in clusters) for k in CONFIDENCE}
    return {
        "window_days": days,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "n_articles": len(articles),
        "trend": trend(timeline),
        "levels": levels,
        "level_text": CONFIDENCE,
        "stories": clusters[:40],
        "official_updates": official,
        "latest": store.latest_found(topic["id"], limit=10, since=topic.get("last_run_started")),
        "facets": facets(topic, window, case_counts["regions"]),
        "facets_window_days": counts.WINDOW_DAYS,
        "counts": case_counts,
        "tier_counts": store.tier_counts(topic["id"]),
    }


def track_counts(store, topic: dict, result: dict) -> None:
    """Keep figures from silently disappearing, and log every change.

    A figure whose supporting reports have simply aged out of the counting window is carried over from the
    last recorded state. A drop for any other reason (a correction, a pin, an excluded article, a trust
    change) is a real revision and is applied. Every change is written to count_history with its reason."""
    last = store.last_counts(topic["id"])
    since = _since(counts.WINDOW_DAYS)
    for metric in ("deaths", "cases"):
        m, prev = result[metric], last.get(metric)
        if prev and prev["value"] > m["value"] and not m.get("revised"):
            backing = prev["detail"].get("reported", {}).get("sources", [])
            if backing and all(s["published_at"] < since for s in backing if s.get("published_at")):
                result[metric] = {**prev["detail"], "carried_over": True}
                continue
        state = (m["value"], m["confirmed"]["value"])
        if prev and (prev["value"], prev["confirmed"]) == state:
            continue
        if m.get("revised"):
            reason = f"{m['revised']['reason']}: {m['revised']['from']} → {m['revised']['to']}"
        elif metric == "cases" and result["deaths"].get("revised") and prev and m["value"] < prev["value"]:
            r = result["deaths"]["revised"]
            reason = f"follows deaths ({r['reason']}): {prev['value']} → {m['value']}"
        elif not prev:
            reason = "first record"
        else:
            reason = "new reports" if m["value"] > prev["value"] else "recounted"
        store.record_counts(topic["id"], metric, m["value"], m["confirmed"]["value"], reason, m)
    # Everyone who died of a (suspected) infection was infected, carried-over figures included.
    if result["deaths"]["value"] > result["cases"]["value"]:
        result["cases"] = {**result["cases"], "value": result["deaths"]["value"],
                           "suspected_only": result["deaths"]["value"] > result["cases"]["confirmed"]["value"]}
    result["history"] = store.count_history(topic["id"], limit=50)


def _since(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def is_stale(iso: str | None, hours: float) -> bool:
    if not iso:
        return True
    return datetime.now(timezone.utc) - datetime.fromisoformat(iso) > timedelta(hours=hours)
