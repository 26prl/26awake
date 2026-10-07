"""Export the dashboard as a static site (HTML + JSON) for Vercel, GitHub Pages or any static host."""

from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import insights
from .server import STATIC_DIR
from .store import Store

MAX_ARTICLES = 1500  # per topic; the static page filters these in the browser


def schedule_from_env() -> dict | None:
    """When the export is refreshed by a cron job (e.g. GitHub Actions at minutes 7 and 37),
    TRACKER_SCHEDULE_MINUTES="7,37" lets the page count down to the next refresh."""
    raw = os.environ.get("TRACKER_SCHEDULE_MINUTES", "").strip()
    if not raw:
        return None
    minutes = sorted({int(m) % 60 for m in raw.split(",") if m.strip().isdigit()})
    if not minutes:
        return None
    # Typical time from the scheduled minute until the new data is online.
    delay = int(os.environ.get("TRACKER_PUBLISH_DELAY_MINUTES", "2"))
    return {"minutes": minutes, "publish_delay_minutes": delay}


def _dump(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def live_from_env() -> dict | None:
    """Where open pages can fetch fresh data between deployments: the GitHub branch the workflow pushes
    every check to (TRACKER_LIVE_REPO=owner/repo, TRACKER_LIVE_BRANCH). The repository must be public."""
    repo = os.environ.get("TRACKER_LIVE_REPO", "").strip()
    if not repo:
        return None
    return {"repo": repo, "branch": os.environ.get("TRACKER_LIVE_BRANCH", "data").strip() or "data"}


def export_site(store: Store, out_dir: str | Path, last_check: dict | None = None) -> Path:
    out = Path(out_dir)
    data = out / "data"
    if data.exists():
        shutil.rmtree(data)
    data.mkdir(parents=True)
    shutil.copytree(STATIC_DIR, out, dirs_exist_ok=True)

    topics = []
    for t in store.list_topics():
        stats = store.stats(t["id"])
        topics.append({**t, "stats": stats, "collecting": False})
        articles, total = store.articles(t["id"], limit=MAX_ARTICLES)
        _dump(
            data / f"topic-{t['id']}.json",
            {
                "timeline": store.timeline(t["id"], days=90),
                "breakdown": {"sources": store.top_sources(t["id"]), "languages": store.languages(t["id"])},
                "insights": insights.build(store, t),
                "analysis": {"available": False, "running": False, "latest": store.latest_analysis(t["id"])},
                "runs": store.runs(t["id"]),
                "articles": articles,
                "articles_total": total,
            },
        )
    _dump(
        data / "site.json",
        {
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "schedule": schedule_from_env(),
            "live": live_from_env(),
            "last_check": last_check,
            "trust": store.trust.legend(),
            "topics": topics,
        },
    )
    return out
