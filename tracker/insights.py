"""Deterministic analysis of collected articles: story clusters with a confidence level,
trend, region (facet) breakdown and figures reported by trusted sources."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .trust import SCORES, TIERS, TRUSTED

_WORD = re.compile(r"[^\W\d_]{4,}", re.U)
STOPWORDS = {
    "that", "this", "with", "from", "have", "were", "after", "into", "about", "says", "said", "over", "amid",
    "новости", "после", "также", "может", "были", "было", "будет", "этом", "года", "году", "которые",
}

# "12 cases", "3 случая", "двое заболевших" is not handled — digits only, to stay precise.
_NUMBER_PATTERNS = [
    (re.compile(r"(\d[\d\s,.]{0,8})\s*(?:new\s+|confirmed\s+|suspected\s+)?(cases?|deaths?|dead|patients?|"
                r"people|infected|hospitali[sz]ed)\b", re.I), "en"),
    (re.compile(r"(\d[\d\s]{0,8})\s*(случа[йяев]{1,2}|заболевш\w*|заразивш\w*|умерш\w*|погибш\w*|смерт\w*|"
                r"человек\w*|пациент\w*|госпитализ\w*|контактн\w*)", re.I), "ru"),
]

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


def facets(topic: dict, articles: list[dict]) -> list[dict]:
    """Count mentions of each configured facet (e.g. region) across all vs. trusted articles."""
    out = []
    for name, keywords in (topic.get("facets") or {}).items():
        kws = [k.lower() for k in keywords]
        hits = [a for a in articles if any(k in f"{a['title']} {a.get('summary', '')}".lower() for k in kws)]
        if not hits:
            continue
        trusted = [a for a in hits if a["trust"] in TRUSTED]
        out.append(
            {
                "name": name,
                "count": len(hits),
                "trusted": len(trusted),
                "official": sum(a["trust"] == "official" for a in hits),
                "last_seen": max(a["published_at"] for a in hits),
            }
        )
    out.sort(key=lambda f: (-f["trusted"], -f["count"]))
    return out


def reported_figures(articles: list[dict], limit: int = 12) -> list[dict]:
    """Numbers like '3 cases' / '2 случая' found in trusted headlines and summaries."""
    out, seen = [], set()
    for a in sorted(articles, key=lambda x: x["published_at"], reverse=True):
        if a["trust"] not in TRUSTED:
            continue
        text = f"{a['title']}. {a.get('summary', '')}"
        for pattern, _lang in _NUMBER_PATTERNS:
            for m in pattern.finditer(text):
                raw = re.sub(r"[\s,.]", "", m.group(1))
                if not raw.isdigit() or len(raw) > 7 or (len(raw) == 4 and raw.startswith(("19", "20"))):
                    continue  # skip years and junk
                start = max(0, m.start() - 60)
                snippet = text[start : m.end() + 60].strip()
                key = (raw, m.group(2).lower()[:5], a.get("domain"))
                if key in seen:
                    continue
                seen.add(key)
                out.append(
                    {
                        "value": int(raw),
                        "what": m.group(2).lower(),
                        "snippet": ("…" if start else "") + snippet + "…",
                        "source": a["source"],
                        "trust": a["trust"],
                        "url": a["url"],
                        "published_at": a["published_at"],
                    }
                )
    return out[:limit]


def build(store, topic: dict, days: int = 14) -> dict:
    articles = store.recent(topic["id"], days=days)
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
        "facets": facets(topic, articles),
        "figures": reported_figures(articles),
        "tier_counts": store.tier_counts(topic["id"]),
    }


def is_stale(iso: str | None, hours: float) -> bool:
    if not iso:
        return True
    return datetime.now(timezone.utc) - datetime.fromisoformat(iso) > timedelta(hours=hours)
