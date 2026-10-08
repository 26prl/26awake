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
        if "diseaseoutbreaknews" in url:
            return (FIX / "who_don.json").read_bytes()
        if "who.int/rss-feeds" in url:
            return (FIX / "atom.xml").read_bytes()
        raise urllib.error.URLError("offline")

    def collect(self):
        with mock.patch.object(sources, "http_get", self.fake_get):
            return self.collector.collect(self.topic)

    def test_collect_dedupes_across_queries(self):
        result = self.collect()
        # 5 Google queries return the same 2 relevant items; WHO DON adds 1, and the same notice
        # in the WHO news feed is deduplicated by headline.
        self.assertEqual(result["errors"], 0)
        self.assertEqual(self.store.stats(self.topic["id"])["total"], 3)
        self.assertEqual(self.store.stats(self.topic["id"])["latest_official"][:10], "2026-10-04")
        topic = self.store.get_topic(self.topic["id"])
        self.assertEqual(topic["last_run_added"], 3)
        self.assertEqual(len(self.store.latest_found(self.topic["id"], limit=3)), 3)
        self.assertEqual(self.collect()["added"], 0)
        topic = self.store.get_topic(self.topic["id"])
        self.assertIsNotNone(topic["last_run_at"])
        self.assertEqual(topic["last_run_added"], 0)

    def test_sources_are_fetched_in_parallel(self):
        import time

        def slow_get(url):
            time.sleep(0.4)
            return self.fake_get(url)

        topic = self.store.update_topic(self.topic["id"], normalize_topic({**SEED, "who": False}))
        with mock.patch.object(sources, "http_get", slow_get):
            started = time.monotonic()
            result = self.collector.collect(topic)
            elapsed = time.monotonic() - started
        self.assertEqual(result["errors"], 0)
        self.assertLess(elapsed, 1.2)  # five 0.4 s searches, one after another, would take 2 s

    def test_failing_source_is_logged_not_fatal(self):
        def broken(url):
            if "diseaseoutbreaknews" in url:
                raise urllib.error.URLError("boom")
            return self.fake_get(url)

        with mock.patch.object(sources, "http_get", broken):
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
        self.assertEqual(topics[0]["stats"]["total"], 3)
        tid = topics[0]["id"]

        status, page = self.req(f"{base}/api/topics/{tid}/articles?q=%D0%A2%D1%83%D0%B2")  # "Тув"
        self.assertEqual((status, page["total"]), (200, 1))
        status, timeline = self.req(f"{base}/api/topics/{tid}/timeline?days=7")
        self.assertEqual(len(timeline), 7)
        status, page = self.req(f"{base}/api/topics/{tid}/articles?trust=state")  # ria.ru + tass.ru
        self.assertEqual((status, page["total"]), (200, 2))
        self.assertEqual(self.req(f"{base}/api/topics/{tid}/articles?trust=bogus")[0], 400)
        status, ins = self.req(f"{base}/api/topics/{tid}/insights")
        self.assertEqual(status, 200)
        self.assertIn("stories", ins)
        status, legend = self.req(f"{base}/api/trust")
        self.assertEqual(legend[0]["tier"], "official")
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


class TrustTests(unittest.TestCase):
    def setUp(self):
        from tracker.trust import TrustRegistry

        self.reg = TrustRegistry()

    def test_tiers(self):
        self.assertEqual(self.reg.tier("who.int"), "official")
        self.assertEqual(self.reg.tier("04.rospotrebnadzor.ru"), "official")
        self.assertEqual(self.reg.tier("www.reuters.com"), "reputable")
        self.assertEqual(self.reg.tier("tass.ru"), "state")
        self.assertEqual(self.reg.tier("dailymail.co.uk"), "low")
        self.assertEqual(self.reg.tier("random-blog.net"), "unknown")
        self.assertEqual(self.reg.tier(""), "unknown")

    def test_google_news_uses_publisher_domain(self):
        items = sources.parse_google_news((FIX / "google_news.xml").read_bytes(), "ru")
        self.assertEqual([a["domain"] for a in items], ["ria.ru", "afisha.ru", "tass.ru"])

    def test_who_don(self):
        items = sources.parse_who_don((FIX / "who_don.json").read_bytes())
        self.assertEqual(items[0]["url"], "https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON601")
        self.assertEqual(items[0]["domain"], "who.int")
        self.assertIn("Altai Republic", items[0]["summary"])
        topic = normalize_topic(SEED)
        self.assertEqual([matches(topic, a) for a in items], [True, False])


class InsightTests(unittest.TestCase):
    def art(self, i, title, domain, trust, day="2026-10-05"):
        return {"id": i, "title": title, "url": f"https://{domain}/{i}", "source": domain, "domain": domain,
                "trust": trust, "summary": "", "published_at": f"{day}T10:00:00+00:00"}

    def test_cluster_levels(self):
        from tracker.insights import cluster

        arts = [
            self.art(1, "В Республике Алтай выявили случай бубонной чумы", "rospotrebnadzor.ru", "official"),
            self.art(2, "В Республике Алтай выявили случай бубонной чумы у подростка", "tass.ru", "state"),
            self.art(3, "Russia confirms bubonic plague case in Altai", "reuters.com", "reputable"),
            self.art(4, "Russia confirms bubonic plague case in Altai teenager", "apnews.com", "reputable"),
            self.art(5, "Plague spreads to Kazakhstan border, sources say", "blog.example", "unknown"),
        ]
        stories = cluster(arts)
        self.assertEqual(len(stories), 3)
        level = {c["title"].split()[0]: c["level"] for c in stories}
        self.assertEqual(level, {"В": "confirmed", "Russia": "corroborated", "Plague": "unverified"})

    def test_trend(self):
        from tracker.insights import trend

        tl = [{"count": 1}] * 7 + [{"count": 5}] * 3
        self.assertEqual(trend(tl)["direction"], "rising")
        self.assertEqual(trend([{"count": 0}] * 10)["direction"], "quiet")


class UpgradeAndExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "t.db")

    def test_old_database_is_migrated_and_rated(self):
        import sqlite3

        c = sqlite3.connect(self.db)
        c.executescript("""
            CREATE TABLE topics (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, config TEXT NOT NULL,
                                 created_at TEXT NOT NULL, last_run_at TEXT);
            CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER NOT NULL, url TEXT NOT NULL,
                url_key TEXT NOT NULL, title_key TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '',
                published_at TEXT NOT NULL, fetched_at TEXT NOT NULL);
            INSERT INTO topics VALUES (1, 'old', '{"name":"old","queries":[],"gdelt":[],"feeds":[],"match":[],"exclude":[],"interval_minutes":30,"enabled":true}', '2026-01-01', NULL);
            INSERT INTO articles (topic_id, url, url_key, title_key, title, published_at, fetched_at)
                VALUES (1, 'https://www.reuters.com/x', 'k', 't', 'Plague', '2026-10-01', '2026-10-01');
        """)
        c.close()
        store = Store(self.db)
        items, _ = store.articles(1)
        self.assertEqual((items[0]["domain"], items[0]["trust"]), ("reuters.com", "reputable"))

    def test_export(self):
        from tracker.export import export_site

        store = Store(self.db)
        topic = store.create_topic(normalize_topic(SEED))
        store.add_articles(topic["id"], [{"url": "https://who.int/x", "title": "Plague in Altai", "published_at": "2026-10-05T00:00:00+00:00"}])
        out = export_site(store, Path(self.tmp.name) / "site")
        site = json.loads((out / "data" / "site.json").read_text(encoding="utf-8"))
        data = json.loads((out / "data" / f"topic-{topic['id']}.json").read_text(encoding="utf-8"))
        self.assertTrue((out / "index.html").exists())
        self.assertIsNone(site["schedule"])
        self.assertIsNone(site["live"])
        env = {"TRACKER_SCHEDULE_MINUTES": "37,7", "TRACKER_LIVE_REPO": "me/repo", "TRACKER_LIVE_BRANCH": "data"}
        with mock.patch.dict("os.environ", env):
            check = {"started_at": "2026-10-07T18:00:00+00:00", "finished_at": "2026-10-07T18:01:00+00:00", "added": 3, "errors": 0}
            site = json.loads((export_site(store, out, check) / "data" / "site.json").read_text(encoding="utf-8"))
        self.assertEqual(site["schedule"]["minutes"], [7, 37])
        self.assertEqual(site["live"], {"repo": "me/repo", "branch": "data"})
        self.assertEqual(site["last_check"]["added"], 3)
        self.assertEqual(site["topics"][0]["stats"]["total"], 1)
        self.assertEqual(data["articles"][0]["trust"], "official")
        self.assertEqual(len(data["timeline"]), 90)


class AiTests(unittest.TestCase):
    def test_brief_keeps_only_valid_citations(self):
        from types import SimpleNamespace

        from tracker import ai

        brief = {"summary": "s", "status": "isolated_cases", "confidence": "medium",
                 "confirmed_facts": [{"fact": "one case", "ids": [1, 999]}], "unverified_claims": [],
                 "key_figures": [], "locations": [], "watch_next": [], "background": ""}
        response = SimpleNamespace(stop_reason="end_turn", model="claude-opus-5-5",
                                   content=[SimpleNamespace(type="text", text=json.dumps(brief))])
        fake = mock.MagicMock()
        fake.Anthropic.return_value.beta.messages.create.return_value = response
        arts = [{"id": 1, "title": "Чума на Алтае", "url": "https://who.int/1", "source": "WHO", "trust": "official",
                 "summary": "", "published_at": "2026-10-05T00:00:00+00:00"}]
        with mock.patch.dict("sys.modules", {"anthropic": fake}):
            out, model = ai.analyze({"name": "t"}, arts)
        kwargs = fake.Anthropic.return_value.beta.messages.create.call_args.kwargs
        self.assertEqual(kwargs["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(out["confirmed_facts"][0]["ids"], [1])
        self.assertIn("1", out["cited"])
        self.assertEqual(model, "claude-opus-5-5")

    def test_refusal_raises(self):
        from types import SimpleNamespace

        from tracker import ai

        fake = mock.MagicMock()
        fake.Anthropic.return_value.beta.messages.create.return_value = SimpleNamespace(stop_reason="refusal", content=[])
        arts = [{"id": 1, "title": "x", "url": "u", "source": "s", "trust": "unknown", "summary": "", "published_at": "2026"}]
        with mock.patch.dict("sys.modules", {"anthropic": fake}), self.assertRaises(ai.AnalysisError):
            ai.analyze({"name": "t"}, arts)


class SyncTopicsTests(unittest.TestCase):
    def test_sync_updates_by_name_and_adds(self):
        from tracker.__main__ import sync_topics

        with tempfile.TemporaryDirectory() as tmp:
            store = Store(str(Path(tmp) / "t.db"))
            old = store.create_topic(normalize_topic({**SEED, "who": False, "interval_minutes": 60}))
            seed_file = Path(tmp) / "topics.json"
            seed_file.write_text(json.dumps([SEED, {"name": "Bird flu", "queries": ["H5N1"]}]), encoding="utf-8")
            sync_topics(store, seed_file)
            topics = {t["name"]: t for t in store.list_topics()}
            self.assertEqual(topics["Plague in Russia"]["id"], old["id"])
            self.assertTrue(topics["Plague in Russia"]["who"])
            self.assertEqual(topics["Plague in Russia"]["interval_minutes"], SEED["interval_minutes"])
            self.assertIn("Bird flu", topics)


class HttpRetryTests(unittest.TestCase):
    def test_retries_once_on_429(self):
        import io

        calls = []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_urlopen(req, timeout):
            calls.append(1)
            if len(calls) == 1:
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "0"}, None)
            return Resp(b"ok")

        with mock.patch("urllib.request.urlopen", fake_urlopen), mock.patch("time.sleep"):
            self.assertEqual(sources.http_get("https://api.example.org/x"), b"ok")
        self.assertEqual(len(calls), 2)

    def test_other_errors_are_not_retried(self):
        def fake_urlopen(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

        with mock.patch("urllib.request.urlopen", fake_urlopen), self.assertRaises(urllib.error.HTTPError):
            sources.http_get("https://example.com/x")


class CountTests(unittest.TestCase):
    """Built from real headlines collected for the 2026 Irkutsk lab-worker case."""

    def art(self, i, title, domain, trust, day="2026-10-06"):
        return {"id": i, "title": title, "url": f"https://{domain}/{i}", "source": domain, "domain": domain,
                "trust": trust, "summary": "", "published_at": f"{day}T10:00:00+00:00"}

    def test_extract(self):
        from tracker.counts import extract

        def first(text, metric, tier="reputable"):
            return next((c for c in extract(text, tier) if c["metric"] == metric), None)

        c = first("Russian lab worker dies of suspected plague in Siberia; US monitoring case", "deaths")
        self.assertEqual((c["value"], c["qualifier"]), (1, "suspected"))
        self.assertEqual(first("WHO questions Russia on reported second plague lab death", "deaths")["value"], 2)
        self.assertEqual(first("Второй случай чумы в России? В лаборатории, вероятно, заболел еще один сотрудник", "cases")["value"], 2)
        self.assertEqual(first("Роспотребнадзор: 2 случая чумы зарегистрированы в Туве", "cases", "official")["qualifier"], "confirmed")
        self.assertEqual(first("12 new plague cases confirmed in Altai", "cases")["value"], 12)
        self.assertEqual(first("Dozens quarantined in Siberia after plague institute lab worker dies", "quarantined")["vague"], "dozens")
        # Denials are recorded, and never counted as a case.
        claims = extract("Россия сообщила ВОЗ об отсутствии случаев чумы в Иркутске", "reputable")
        self.assertEqual([(c["metric"], c["denial"]) for c in claims], [("cases", True)])
        self.assertTrue(first("Russia says no plague found in contacts of Siberian lab worker who died", "cases")["denial"])
        # History and global statistics are ignored.
        self.assertEqual(extract("The Black Death killed 25 million people in Europe", "reputable"), [])
        self.assertEqual(extract("Plague infects 2,000 people worldwide each year", "reputable"), [])

    def test_only_verified_figures_count(self):
        from tracker.counts import build

        arts = [
            self.art(1, "Russian lab worker dies of suspected plague in Siberia", "reuters.com", "reputable"),
            self.art(2, "Russia reports suspected plague death of lab worker", "apnews.com", "reputable"),
            self.art(3, "WHO questions Russia on reported second plague lab death", "nbcnews.com", "reputable"),
            self.art(4, "Чума в России: подозревают госпитализацию почти 200 пациентов", "blog.example", "unknown"),
            self.art(5, "Второй случай чумы? Вероятно, заболел еще один сотрудник", "meduza.io", "reputable"),
            self.art(6, "WHO seeks details about reported second illness", "forbes.com", "reputable"),
            self.art(7, "Россия сообщила ВОЗ об отсутствии случаев чумы в Иркутске", "dw.com", "reputable"),
            self.art(8, "50 people died of plague in Moscow, insiders say", "tabloid.example", "low"),
        ]
        with mock.patch("tracker.counts.datetime") as dt:
            from datetime import datetime as real_dt, timezone as tz
            dt.now.return_value = real_dt(2026, 10, 7, tzinfo=tz.utc)
            r = build(arts, {"Irkutsk": {"keywords": ["иркутск"]}})
        self.assertEqual(r["deaths"]["value"], 1)            # the second death has one source only
        self.assertTrue(r["deaths"]["suspected_only"])
        self.assertEqual(r["cases"]["value"], 2)             # second suspected case: two reputable outlets
        self.assertEqual(r["cases"]["confirmed"]["value"], 0)
        self.assertTrue(r["cases"]["disputed"])
        self.assertEqual(r["cases"]["unverified_max"], 200)
        self.assertEqual(r["deaths"]["unverified_max"], 50)
        self.assertEqual(r["regions"]["Irkutsk"]["denials"], 1)

    def test_official_source_alone_verifies(self):
        from tracker.counts import build

        arts = [self.art(1, "Роспотребнадзор: 2 случая чумы зарегистрированы в Туве", "rospotrebnadzor.ru", "official", "2026-10-06")]
        with mock.patch("tracker.counts.datetime") as dt:
            from datetime import datetime as real_dt, timezone as tz
            dt.now.return_value = real_dt(2026, 10, 7, tzinfo=tz.utc)
            r = build(arts)
        self.assertEqual((r["cases"]["value"], r["cases"]["confirmed"]["value"]), (2, 2))

    def test_facets_with_coordinates(self):
        t = normalize_topic({"name": "x", "queries": ["a"], "facets": {"Tuva": {"keywords": ["tuva"], "lat": "51.7", "lon": 94.4}, "Old": ["kw"]}})
        self.assertEqual(t["facets"]["Tuva"], {"keywords": ["tuva"], "lat": 51.7, "lon": 94.4})
        self.assertEqual(t["facets"]["Old"]["lat"], None)
        with self.assertRaises(ValidationError):
            normalize_topic({"name": "x", "queries": ["a"], "facets": {"Bad": {"keywords": ["k"], "lat": 99, "lon": 1}}})


class RepeatTests(unittest.TestCase):
    def test_same_outlet_repeats_are_not_counted_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(str(Path(tmp) / "t.db"))
            topic = store.create_topic(normalize_topic(SEED))

            def art(i, title, domain, day):
                return {"url": f"https://{domain}/{i}", "title": title, "domain": domain, "source": domain,
                        "published_at": f"2026-10-0{day}T10:00:00+00:00"}

            store.add_articles(topic["id"], [
                art(1, "Russian lab worker dies of suspected plague", "reuters.com", 1),
                art(2, "Russian lab worker dies of suspected plague in Siberia, officials say", "reuters.com", 2),
                art(3, "Suspected plague kills Russian lab worker", "apnews.com", 2),
                art(4, "Russian lab worker dies of suspected plague: five days on", "reuters.com", 6),
            ])
            items, _ = store.articles(topic["id"], limit=10)
            repeat = {(a["domain"], a["published_at"][:10]): a["is_repeat"] for a in items}
            self.assertEqual(repeat[("reuters.com", "2026-10-01")], 0)  # first report
            self.assertEqual(repeat[("reuters.com", "2026-10-02")], 1)  # same outlet, same story, next day
            self.assertEqual(repeat[("apnews.com", "2026-10-02")], 0)   # another outlet: real corroboration
            self.assertEqual(repeat[("reuters.com", "2026-10-06")], 0)  # outside the 3-day window

            stats = store.stats(topic["id"])
            self.assertEqual((stats["trusted"], stats["repeats"]), (3, 1))
            self.assertEqual(store.articles(topic["id"], tiers=["reputable"])[1], 3)
            self.assertEqual(store.tier_counts(topic["id"]), {"reputable": 3, "repeat": 1})

    def test_topic_words_alone_do_not_make_a_repeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(str(Path(tmp) / "t.db"))
            topic = store.create_topic(normalize_topic(SEED))
            filler = [{"url": f"https://site{i}.example/{i}", "title": f"Случаи чумы в России: новость номер {i}",
                       "domain": f"site{i}.example", "published_at": "2026-10-03T08:00:00+00:00"} for i in range(40)]
            bbc = [
                {"url": "https://bbc.com/1", "title": "Возможна ли в России эпидемия чумы?", "domain": "bbc.com",
                 "published_at": "2026-10-04T10:00:00+00:00"},
                {"url": "https://bbc.com/2", "title": "США и Европа обеспокоены сообщениями о возможном случае смерти от чумы в России",
                 "domain": "bbc.com", "published_at": "2026-10-05T10:00:00+00:00"},
            ]
            store.add_articles(topic["id"], filler + bbc)
            items, _ = store.articles(topic["id"], q="", limit=100)
            self.assertEqual([a["is_repeat"] for a in items if a["domain"] == "bbc.com"], [0, 0])
