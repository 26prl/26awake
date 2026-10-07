"""Fetchers that turn external sources into a uniform list of article dicts.

Every fetcher returns a list of dicts with the keys:
    url, title, summary, source, published_at (ISO-8601 UTC string), lang, origin
"""

from __future__ import annotations

import email.utils
import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

USER_AGENT = "Mozilla/5.0 (compatible; PlagueWebTracker/0.1; +https://github.com/26prl/plagueweb)"
TIMEOUT = 25

# Google News region settings per language: (hl, gl, ceid)
GOOGLE_NEWS_LOCALES = {
    "en": ("en-US", "US", "US:en"),
    "ru": ("ru", "RU", "RU:ru"),
    "uk": ("uk", "UA", "UA:uk"),
    "de": ("de", "DE", "DE:de"),
    "fr": ("fr", "FR", "FR:fr"),
    "es": ("es-419", "US", "US:es-419"),
    "kk": ("kk", "KZ", "KZ:kk"),
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def clean_text(value: str | None, limit: int = 600) -> str:
    if not value:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", value))
    text = _WS_RE.sub(" ", text).strip()
    return text[:limit]


def to_iso(dt: datetime | None) -> str:
    if dt is None:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def parse_date(value: str | None) -> str:
    """Parse RFC-822 (RSS), ISO-8601 (Atom) or GDELT (20261007T120000Z) dates."""
    if value:
        value = value.strip()
        try:
            return to_iso(email.utils.parsedate_to_datetime(value))
        except (TypeError, ValueError, IndexError):
            pass
        for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
            try:
                return to_iso(datetime.strptime(value, fmt))
            except ValueError:
                continue
        try:
            return to_iso(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            pass
    return to_iso(None)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _child_text(el: ET.Element, *names: str) -> str:
    for name in names:
        c = _child(el, name)
        if c is not None and (c.text or "").strip():
            return c.text.strip()
    return ""


def parse_feed(data: bytes, origin: str, lang: str = "") -> list[dict]:
    """Parse RSS 2.0 or Atom into article dicts."""
    root = ET.fromstring(data)
    items = [e for e in root.iter() if _local(e.tag) in ("item", "entry")]
    feed_title = ""
    channel = _child(root, "channel")
    if channel is not None:
        feed_title = _child_text(channel, "title")
    elif _local(root.tag) == "feed":
        feed_title = _child_text(root, "title")

    out = []
    for it in items:
        title = clean_text(_child_text(it, "title"), 400)
        link = _child_text(it, "link")
        if not link:
            link_el = _child(it, "link")
            if link_el is not None:
                link = link_el.get("href", "")
        if not title or not link:
            continue
        source_el = _child(it, "source")
        source = ""
        if source_el is not None:
            source = (source_el.text or "").strip() or _child_text(source_el, "title")
        summary = clean_text(_child_text(it, "description", "summary", "content"))
        out.append(
            {
                "url": link,
                "title": title,
                "summary": summary,
                "source": source or feed_title or urllib.parse.urlparse(link).netloc,
                "published_at": parse_date(_child_text(it, "pubDate", "published", "updated", "date")),
                "lang": lang,
                "origin": origin,
            }
        )
    return out


# --- Google News -------------------------------------------------------------------------


def google_news_url(query: str, lang: str = "en", window: str = "7d") -> str:
    hl, gl, ceid = GOOGLE_NEWS_LOCALES.get(lang, GOOGLE_NEWS_LOCALES["en"])
    q = f"{query} when:{window}" if window else query
    params = urllib.parse.urlencode({"q": q, "hl": hl, "gl": gl, "ceid": ceid})
    return f"https://news.google.com/rss/search?{params}"


def parse_google_news(data: bytes, lang: str) -> list[dict]:
    articles = parse_feed(data, origin="google_news", lang=lang)
    for a in articles:
        # Google appends " - Source Name" to every headline; strip it.
        suffix = f" - {a['source']}"
        if a["source"] and a["title"].endswith(suffix):
            a["title"] = a["title"][: -len(suffix)].strip()
        # The description only repeats the headline + source, so drop it when redundant.
        if a["summary"].startswith(a["title"]):
            a["summary"] = ""
    return articles


def fetch_google_news(query: str, lang: str = "en") -> list[dict]:
    return parse_google_news(http_get(google_news_url(query, lang)), lang)


# --- GDELT (global news index, updated every 15 minutes) --------------------------------


def gdelt_url(query: str, timespan: str = "3d", max_records: int = 100) -> str:
    params = urllib.parse.urlencode(
        {
            "query": query,
            "mode": "artlist",
            "format": "json",
            "maxrecords": str(max_records),
            "timespan": timespan,
            "sort": "datedesc",
        }
    )
    return f"https://api.gdeltproject.org/api/v2/doc/doc?{params}"


GDELT_LANGS = {"russian": "ru", "english": "en", "ukrainian": "uk", "german": "de", "french": "fr"}


def parse_gdelt(data: bytes) -> list[dict]:
    text = data.decode("utf-8", "replace").strip()
    if not text.startswith("{"):
        # GDELT answers errors (bad query, rate limit) with plain text.
        raise ValueError(f"GDELT: {text[:200]}")
    payload = json.loads(text)
    out = []
    for a in payload.get("articles", []) or []:
        if not a.get("url") or not a.get("title"):
            continue
        out.append(
            {
                "url": a["url"],
                "title": clean_text(a["title"], 400),
                "summary": "",
                "source": a.get("domain", ""),
                "published_at": parse_date(a.get("seendate")),
                "lang": GDELT_LANGS.get((a.get("language") or "").lower(), (a.get("language") or "")[:2].lower()),
                "origin": "gdelt",
            }
        )
    return out


def fetch_gdelt(query: str) -> list[dict]:
    return parse_gdelt(http_get(gdelt_url(query)))


# --- Arbitrary RSS / Atom feed (filtered by keywords later) -----------------------------


def fetch_rss(url: str) -> list[dict]:
    return parse_feed(http_get(url), origin="rss")
