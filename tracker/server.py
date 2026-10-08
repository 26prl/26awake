"""HTTP server: JSON API under /api and the static dashboard."""

from __future__ import annotations

import hmac
import json
import logging
import mimetypes
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import ai, insights
from .collector import Collector, ValidationError, normalize_topic
from .store import Store
from .trust import TIERS, TRUSTED

log = logging.getLogger("tracker.server")
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
mimetypes.add_type("application/manifest+json", ".webmanifest")
MAX_BODY = 64 * 1024


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _int(params: dict, key: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(params.get(key, [default])[0])))
    except ValueError:
        raise ApiError(400, f"'{key}' must be an integer") from None


def parse_tiers(params: dict) -> list[str] | None:
    """`?trust=trusted` (official+expert+reputable) or a comma list such as `?trust=official,state`."""
    raw = params.get("trust", [""])[0].strip()
    if not raw or raw == "all":
        return None
    if raw == "trusted":
        return list(TRUSTED)
    tiers = [t for t in raw.split(",") if t]
    bad = [t for t in tiers if t not in TIERS]
    if bad:
        raise ApiError(400, f"unknown trust tier(s): {', '.join(bad)}")
    return tiers


def make_handler(store: Store, collector: Collector, token: str | None):
    routes: list[tuple[str, re.Pattern, callable, bool]] = []
    analyzing: set[int] = set()

    def route(method: str, pattern: str, write: bool = False):
        def deco(fn):
            routes.append((method, re.compile(f"^{pattern}$"), fn, write))
            return fn

        return deco

    def topic_or_404(tid: str) -> dict:
        topic = store.get_topic(int(tid))
        if not topic:
            raise ApiError(404, "topic not found")
        return topic

    def with_stats(topic: dict) -> dict:
        return {**topic, "stats": store.stats(topic["id"]), "collecting": collector.is_busy(topic["id"])}

    @route("GET", r"/api/health")
    def health(_p, _b):
        return {"ok": True, "write_protected": bool(token), "ai": ai.available(), "static": False}

    @route("GET", r"/api/trust")
    def trust_legend(_p, _b):
        return store.trust.legend()

    @route("GET", r"/api/topics")
    def list_topics(_p, _b):
        return [with_stats(t) for t in store.list_topics()]

    @route("POST", r"/api/topics", write=True)
    def create_topic(_p, body):
        topic = store.create_topic(normalize_topic(body))
        collector.collect_async(topic)
        return with_stats(topic)

    @route("GET", r"/api/topics/(\d+)")
    def get_topic(_p, _b, tid):
        return with_stats(topic_or_404(tid))

    @route("PUT", r"/api/topics/(\d+)", write=True)
    def update_topic(_p, body, tid):
        topic_or_404(tid)
        return with_stats(store.update_topic(int(tid), normalize_topic(body)))

    @route("DELETE", r"/api/topics/(\d+)", write=True)
    def delete_topic(_p, _b, tid):
        topic_or_404(tid)
        store.delete_topic(int(tid))
        return {"deleted": int(tid)}

    @route("POST", r"/api/topics/(\d+)/refresh", write=True)
    def refresh(_p, _b, tid):
        topic = topic_or_404(tid)
        if collector.is_busy(topic["id"]):
            return {"started": False, "reason": "already collecting"}
        collector.collect_async(topic)
        return {"started": True}

    @route("GET", r"/api/topics/(\d+)/articles")
    def articles(p, _b, tid):
        topic_or_404(tid)
        items, total = store.articles(
            int(tid),
            q=p.get("q", [""])[0].strip(),
            lang=p.get("lang", [""])[0].strip(),
            since=p.get("since", [""])[0].strip(),
            tiers=parse_tiers(p),
            limit=_int(p, "limit", 50, 1, 200),
            offset=_int(p, "offset", 0, 0, 10**9),
        )
        return {"total": total, "items": items}

    @route("GET", r"/api/topics/(\d+)/timeline")
    def timeline(p, _b, tid):
        topic_or_404(tid)
        return store.timeline(int(tid), _int(p, "days", 30, 1, 365))

    @route("GET", r"/api/topics/(\d+)/breakdown")
    def breakdown(_p, _b, tid):
        topic_or_404(tid)
        return {"sources": store.top_sources(int(tid)), "languages": store.languages(int(tid))}

    @route("GET", r"/api/topics/(\d+)/insights")
    def topic_insights(p, _b, tid):
        return insights.build(store, topic_or_404(tid), days=_int(p, "days", 14, 1, 90))

    @route("GET", r"/api/topics/(\d+)/analysis")
    def analysis(_p, _b, tid):
        topic_or_404(tid)
        return {
            "available": ai.available(),
            "running": int(tid) in analyzing,
            "latest": store.latest_analysis(int(tid)),
        }

    @route("POST", r"/api/topics/(\d+)/analyze", write=True)
    def analyze(_p, _b, tid):
        topic = topic_or_404(tid)
        if not ai.available():
            raise ApiError(400, "AI analysis needs the 'anthropic' package and ANTHROPIC_API_KEY")
        if topic["id"] in analyzing:
            return {"started": False, "reason": "already running"}
        analyzing.add(topic["id"])

        def work():
            try:
                collector.maybe_analyze(topic, force=True)
            finally:
                analyzing.discard(topic["id"])

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    @route("GET", r"/api/topics/(\d+)/runs")
    def runs(_p, _b, tid):
        topic_or_404(tid)
        return store.runs(int(tid))

    class Handler(BaseHTTPRequestHandler):
        server_version = "26awake/0.1"

        def log_message(self, fmt, *args):
            log.debug("%s - %s", self.address_string(), fmt % args)

        def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status: int, payload):
            self._send(status, json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8",
                       {"Cache-Control": "no-store"})

        def _authorized(self) -> bool:
            if not token:
                return True
            given = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            return hmac.compare_digest(given.encode(), token.encode())

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ApiError(413, "request body too large")
            if not length:
                return {}
            try:
                return json.loads(self.rfile.read(length))
            except json.JSONDecodeError:
                raise ApiError(400, "body must be JSON") from None

        def _api(self, method: str, path: str, params: dict):
            for m, pattern, fn, write in routes:
                match = pattern.match(path)
                if match and m == method:
                    if write and not self._authorized():
                        raise ApiError(401, "missing or wrong token")
                    body = self._body() if method in ("POST", "PUT") else {}
                    return fn(params, body, *match.groups())
            if any(p.match(path) for _, p, _, _ in routes):
                raise ApiError(405, "method not allowed")
            raise ApiError(404, "not found")

        def _dispatch(self, method: str):
            url = urlsplit(self.path)
            if url.path.startswith("/api/"):
                try:
                    self._json(200, self._api(method, url.path, parse_qs(url.query)))
                except ApiError as e:
                    self._json(e.status, {"error": str(e)})
                except ValidationError as e:
                    self._json(400, {"error": str(e)})
                except Exception:
                    log.exception("API error")
                    self._json(500, {"error": "internal error"})
            elif method in ("GET", "HEAD"):
                self._static(url.path)
            else:
                self._json(405, {"error": "method not allowed"})

        def _static(self, path: str):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            file = (STATIC_DIR / rel).resolve()
            if STATIC_DIR not in file.parents or not file.is_file():
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
            ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            self._send(200, file.read_bytes(), ctype, {"Cache-Control": "no-cache"})

        def do_GET(self):
            self._dispatch("GET")

        def do_HEAD(self):
            self._dispatch("HEAD")

        def do_POST(self):
            self._dispatch("POST")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_DELETE(self):
            self._dispatch("DELETE")

    return Handler


def serve(store: Store, collector: Collector, host: str, port: int, token: str | None) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), make_handler(store, collector, token))
    httpd.daemon_threads = True
    return httpd
