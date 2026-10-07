"""Entry point: `python -m tracker`."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

from .collector import Collector, normalize_topic
from .export import export_site
from .server import serve
from .store import Store, now_iso
from .trust import TrustRegistry

ROOT = Path(__file__).resolve().parent.parent


def seed(store: Store, path: Path) -> None:
    """Load starter topics from a JSON file the first time the database is created."""
    if store.list_topics() or not path.exists():
        return
    for raw in json.loads(path.read_text(encoding="utf-8")):
        store.create_topic(normalize_topic(raw))
        logging.info("seeded topic %r", raw.get("name"))


def sync_topics(store: Store, path: Path) -> None:
    """Make the database match the topics file: update by name, add new ones (never deletes)."""
    existing = {t["name"]: t for t in store.list_topics()}
    for raw in json.loads(path.read_text(encoding="utf-8")):
        config = normalize_topic(raw)
        current = existing.get(config["name"])
        if current is None:
            store.create_topic(config)
            logging.info("added topic %r", config["name"])
        elif any(current.get(k) != v for k, v in config.items()):
            store.update_topic(current["id"], config)
            logging.info("updated topic %r", config["name"])


def main() -> None:
    p = argparse.ArgumentParser(description="PlagueWeb — keep tracking topics across the internet.")
    p.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    p.add_argument("--db", default=os.environ.get("TRACKER_DB", str(ROOT / "data" / "tracker.db")))
    p.add_argument("--seed", default=os.environ.get("TRACKER_SEED", str(ROOT / "topics.json")))
    p.add_argument("--no-collector", action="store_true", help="serve the dashboard only, do not fetch")
    p.add_argument("--once", action="store_true", help="collect every topic once and exit (for cron)")
    p.add_argument("--export", metavar="DIR", help="write a static copy of the dashboard to DIR and exit")
    p.add_argument("--trust", default=os.environ.get("TRACKER_TRUST", str(ROOT / "trust.json")))
    p.add_argument("--sync-topics", action="store_true",
                   help="apply the seed file to an existing database (update topics by name, add new ones)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    store = Store(args.db, TrustRegistry(args.trust))
    if args.sync_topics:
        sync_topics(store, Path(args.seed))
    else:
        seed(store, Path(args.seed))
    collector = Collector(store)

    if args.once or args.export:
        last_check = None
        if args.once:
            started = now_iso()
            total_added = total_errors = 0
            for topic in store.list_topics():
                if topic.get("enabled", True):
                    result = collector.collect(topic)
                    total_added += result.get("added", 0)
                    total_errors += result.get("errors", 0)
                    print(topic["name"], result)
            print(f"TOTAL_ADDED={total_added}")  # read by the GitHub workflow
            last_check = {"started_at": started, "finished_at": now_iso(), "added": total_added, "errors": total_errors}
        if args.export:
            print("exported to", export_site(store, args.export, last_check))
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
