"""Export the dashboard as a static site (HTML + JSON) for Vercel, GitHub Pages or any static host."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import insights
from .server import STATIC_DIR
from .store import Store

MAX_ARTICLES = 1500  # per topic; the static page filters these in the browser


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
            "trust": store.trust.legend(),
            "topics": topics,
        },
    )
    return out
