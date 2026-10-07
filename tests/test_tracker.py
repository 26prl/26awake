import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from tracker import sources
from tracker.collector import Collector, ValidationError, matches, normalize_topic
from tracker.server import serve
from tracker.store import Store, url_key

FIX = Path(__file__).parent / "fixtures"
SEED = json.loads((Path(__file__).parent.parent / "topics.json").read_text(encoding="utf-8"))[0]


class ParserTests(unittest.TestCase):
    def test_google_news_strips_source_suffix_and_redundant_summary(self):
        items = sources.parse_google_news((FIX / "google_news.xml").read_bytes(), "ru")
        self.assertEqual(len(items), 3)
        first = items[0]
        self.assertEqual(first["title"], "В Республике Алтай выявили случай бубонной чумы")
        self.assertEqual(first["source"], "РИА Новости")
        self.assertEqual(first["summary"], "")
        self.assertEqual(first["published_at"], "2026-10-05T09:12:00+00:00")
        self.assertEqual(first["lang"], "ru")

    def test_gdelt(self):
        items = sources.parse_gdelt((FIX / "gdelt.json").read_bytes())
        self.assertEqual(items[0]["published_at"], "2026-10-06T08:15:00+00:00")
        self.assertEqual(items[0]["lang"], "en")
        self.assertEqual(items[0]["source"], "example.com")

    def test_gdelt_error_text(self):
        with self.assertRaises(ValueError):
            sources.parse_gdelt(b"Please limit requests to one every 5 seconds")

    def test_atom(self):
        items = sources.parse_feed((FIX / "atom.xml").read_bytes(), origin="rss")
        self.assertEqual(items[0]["url"], "https://who.example/don/1")
        self.assertEqual(items[0]["source"], "WHO news")
        self.assertIn("plague near the Russian border", items[0]["summary"])

    def test_google_news_url_is_encoded(self):
        url = sources.google_news_url("чума Россия", "ru")
        self.assertIn("hl=ru", url)
        self.assertIn("when%3A7d", url)
        self.assertNotIn(" ", url)


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.topic = normalize_topic(SEED)

    def test_seed_topic_filters_noise(self):
        items = sources.parse_google_news((FIX / "google_news.xml").read_bytes(), "ru")
        kept = [a["title"] for a in items if matches(self.topic, a)]
        self.assertEqual(len(kept), 2)
        self.assertNotIn("Чумовой концерт в Москве", kept)

    def test_rss_needs_both_groups(self):
        items = sources.parse_feed((FIX / "atom.xml").read_bytes(), origin="rss")
        self.assertEqual([matches(self.topic, a) for a in items], [True, False])

    def test_validation(self):
        with self.assertRaises(ValidationError):
            normalize_topic({"name": "x"})
        with self.assertRaises(ValidationError):
            normalize_topic({"name": "x", "feeds": ["https://a/rss"]})  # feeds need match keywords
        with self.assertRaises(ValidationError):
            normalize_topic({"name": "x", "queries": [{"q": "a", "lang": "zz"}]})
        t = normalize_topic({"name": "x", "queries": ["bird flu"], "interval_minutes": 1})
        self.assertEqual(t["queries"], [{"q": "bird flu", "lang": "en"}])
        self.assertEqual(t["interval_minutes"], 5)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(str(Path(self.tmp.name) / "t.db"))
        self.topic = self.store.create_topic(normalize_topic(SEED))

    def tearDown(self):
        self.tmp.cleanup()

    def test_dedupe_by_url_and_title(self):
        a = {"url": "https://x.ru/a?utm_source=tg", "title": "Чума на Алтае", "published_at": "2026-10-05T00:00:00+00:00"}
        b = dict(a, url="https://www.x.ru/a/")  # same page, different spelling
        c = dict(a, url="https://y.ru/copy")  # syndicated copy with the same headline
        self.assertEqual(self.store.add_articles(self.topic["id"], [a, b, c]), 1)
        self.assertEqual(url_key(a["url"]), url_key(b["url"]))

    def test_future_dates_are_clamped(self):
        a = {"url": "https://x.ru/f", "title": "Чума", "published_at": "2099-01-01T00:00:00+00:00"}
        self.store.add_articles(self.topic["id"], [a])
        items, _ = self.store.articles(self.topic["id"])
        self.assertLess(items[0]["published_at"], "2099")

    def test_search_is_case_insensitive_for_cyrillic(self):
        a = {"url": "https://x.ru/b", "title": "ЧУМА на Алтае", "published_at": "2026-10-05T00:00:00+00:00"}
        self.store.add_articles(self.topic["id"], [a])
        self.assertEqual(self.store.articles(self.topic["id"], q="чума")[1], 1)

    def test_slug_unique(self):
        again = self.store.create_topic(normalize_topic(SEED))
        self.assertNotEqual(again["slug"], self.topic["slug"])


class CollectorAndApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(str(Path(self.tmp.name) / "t.db"))
        self.topic = self.store.create_topic(normalize_topic(SEED))
        self.collector = Collector(self.store)

    def tearDown(self):
        self.tmp.cleanup()

    def fake_get(self, url):
        if "news.google.com" in url:
            return (FIX / "google_news.xml").read_bytes()
        if "gdeltproject" in url:
            return (FIX / "gdelt.json").read_bytes()
        raise urllib.error.URLError("offline")

    def collect(self):
        with mock.patch.object(sources, "http_get", self.fake_get), mock.patch("tracker.collector.GDELT_PAUSE", 0):
            return self.collector.collect(self.topic)

    def test_collect_dedupes_across_queries(self):
        result = self.collect()
        # 5 Google queries return the same 2 relevant items; GDELT adds 1 real + 1 sports false-positive.
        self.assertEqual(result["errors"], 0)
        self.assertEqual(self.store.stats(self.topic["id"])["total"], 4)
        self.assertEqual(self.collect()["added"], 0)
        self.assertIsNotNone(self.store.get_topic(self.topic["id"])["last_run_at"])

    def test_failing_source_is_logged_not_fatal(self):
        def broken(url):
            if "gdelt" in url:
                raise urllib.error.URLError("boom")
            return self.fake_get(url)

        with mock.patch.object(sources, "http_get", broken), mock.patch("tracker.collector.GDELT_PAUSE", 0):
            result = self.collector.collect(self.topic)
        self.assertEqual(result["errors"], 1)
        runs = self.store.runs(self.topic["id"])
        self.assertTrue(any(not r["ok"] and "boom" in r["error"] for r in runs))

    def _server(self, token=None):
        httpd = serve(self.store, self.collector, "127.0.0.1", 0, token)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return f"http://127.0.0.1:{httpd.server_address[1]}"

    def req(self, url, method="GET", body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_api(self):
        self.collect()
        base = self._server()
        status, topics = self.req(f"{base}/api/topics")
        self.assertEqual(status, 200)
        self.assertEqual(topics[0]["stats"]["total"], 4)
        tid = topics[0]["id"]

        status, page = self.req(f"{base}/api/topics/{tid}/articles?q=%D0%A2%D1%83%D0%B2")  # "Тув"
        self.assertEqual((status, page["total"]), (200, 1))
        status, timeline = self.req(f"{base}/api/topics/{tid}/timeline?days=7")
        self.assertEqual(len(timeline), 7)
        self.assertEqual(self.req(f"{base}/api/topics/999")[0], 404)
        self.assertEqual(self.req(f"{base}/api/topics", "POST", {"name": ""})[0], 400)

        with mock.patch.object(Collector, "collect_async"):
            status, created = self.req(f"{base}/api/topics", "POST", {"name": "Bird flu", "queries": ["H5N1"]})
        self.assertEqual((status, created["slug"]), (200, "bird-flu"))
        self.assertEqual(self.req(f"{base}/api/topics/{created['id']}", "DELETE")[0], 200)

        with urllib.request.urlopen(f"{base}/") as resp:
            self.assertIn(b"PlagueWeb", resp.read())
        self.assertEqual(self.req(f"{base}/api/nope")[0], 404)
        with self.assertRaises(urllib.error.HTTPError):
            urllib.request.urlopen(f"{base}/../tracker/store.py")

    def test_token_protects_writes(self):
        base = self._server(token="s3cret")
        self.assertEqual(self.req(f"{base}/api/topics")[0], 200)
        self.assertEqual(self.req(f"{base}/api/topics/{self.topic['id']}", "DELETE")[0], 401)
        ok = self.req(f"{base}/api/topics/{self.topic['id']}", "DELETE", headers={"Authorization": "Bearer s3cret"})
        self.assertEqual(ok[0], 200)


if __name__ == "__main__":
    unittest.main()
