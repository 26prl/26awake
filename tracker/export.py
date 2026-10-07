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
    # Time for the job to run and the host to publish the new files.
    delay = int(os.environ.get("TRACKER_PUBLISH_DELAY_MINUTES", "4"))
    return {"minutes": minutes, "publish_delay_minutes": delay}


def _dump(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def export_site(store: Store, out_dir: str | Path) -> Path:
    out = Path(out_dir)
    data = out / "data"
    if data.exists():
        shutil.rmtree(data)
    data.mkdir(parents=True)
    for f in STATIC_DIR.iterdir():
        if f.is_file():
            shutil.copy2(f, out / f.name)

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
            "trust": store.trust.legend(),
            "topics": topics,
        },
    )
    return out
