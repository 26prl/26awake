"""Entry point: `python -m tracker`."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

from .collector import Collector, normalize_topic
from .server import serve
from .store import Store

ROOT = Path(__file__).resolve().parent.parent


def seed(store: Store, path: Path) -> None:
    """Load starter topics from a JSON file the first time the database is created."""
    if store.list_topics() or not path.exists():
        return
    for raw in json.loads(path.read_text(encoding="utf-8")):
        store.create_topic(normalize_topic(raw))
        logging.info("seeded topic %r", raw.get("name"))


def main() -> None:
    p = argparse.ArgumentParser(description="PlagueWeb — keep tracking topics across the internet.")
    p.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    p.add_argument("--db", default=os.environ.get("TRACKER_DB", str(ROOT / "data" / "tracker.db")))
    p.add_argument("--seed", default=os.environ.get("TRACKER_SEED", str(ROOT / "topics.json")))
    p.add_argument("--no-collector", action="store_true", help="serve the dashboard only, do not fetch")
    p.add_argument("--once", action="store_true", help="collect every topic once and exit (for cron)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    store = Store(args.db)
    seed(store, Path(args.seed))
    collector = Collector(store)

    if args.once:
        for topic in store.list_topics():
            if topic.get("enabled", True):
                print(topic["name"], collector.collect(topic))
        return

    token = os.environ.get("TRACKER_TOKEN") or None
    if args.host not in ("127.0.0.1", "localhost", "::1") and not token:
        logging.warning("listening on %s without TRACKER_TOKEN: anyone can add or delete topics", args.host)

    if not args.no_collector:
        collector.start()
    httpd = serve(store, collector, args.host, args.port, token)
    logging.info("dashboard on http://%s:%d", args.host, args.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        collector.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
