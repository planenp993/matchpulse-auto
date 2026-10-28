import copy
import datetime as dt
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from scripts import data_sync as sync
from scripts import match_registry as reg
from scripts import update as u

NOW = dt.datetime(2026, 10, 27, 18, tzinfo=dt.timezone.utc)
STAMP = sync.iso(NOW)


def row(day="2026-10-27", score=None, clock="18:00", home="Arsenal", away="Chelsea"):
    return ["E0", "England", "Premier League", day, clock, home, away,
            *(score if score is not None else [None, None]), None, None, None, None,
            {} if score is not None else "FixtureDownload / UTC→Europe-Sofia"]


class DataSyncTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        for name, value in [("history", []), ("fixtures", []), ("status", {})]:
            u.writejson(self.root/f"docs/data/{name}.json", value)

    def batch(self, **work):
        return {"schema": 1, "observed_at_utc": STAMP,
                "plan": {"history": False, "full": False, "calendar": False, "quotes": False, **work},
                "request_id": None, "history": [], "observations": [], "checks": {}, "errors": [],
                "calendar": None, "quotes": None}

    def read(self, name):
        return json.loads((self.root/name).read_text())

    def test_delayed_tick_catches_full_history_without_exact_cron_match(self):
        planned = sync.plan({"last_history_attempt_utc": "2026-10-24T19:29:05+00:00"}, "auto", NOW)
        self.assertTrue(planned["history"])
        self.assertTrue(planned["full"])
        self.assertEqual(planned["history_targets"], 42)
        status = {"last_full_history_success_utc": STAMP, "last_current_history_success_utc": "2026-10-26T08:00:00+00:00"}
        self.assertEqual(sync.plan(status, "auto", NOW)["history_targets"], 24)
        status["last_history_attempt_utc"] = "2026-10-27T17:01:00+00:00"
        self.assertFalse(sync.plan(status, "auto", NOW)["history"])

    def test_quote_windows_follow_uk_dst_not_bulgarian_offset(self):
        self.assertEqual(sync.quote_window(dt.datetime.fromisoformat("2026-07-07T12:09:00+00:00")), "2026-07-03")
        self.assertEqual(sync.quote_window(dt.datetime.fromisoformat("2026-07-07T12:10:00+00:00")), "2026-07-07")
        self.assertEqual(sync.quote_window(dt.datetime.fromisoformat("2026-10-27T13:09:00+00:00")), "2026-10-23")
        self.assertEqual(sync.quote_window(dt.datetime.fromisoformat("2026-10-27T13:10:00+00:00")), "2026-10-27")
        self.assertEqual(sync.quote_window(dt.datetime.fromisoformat("2026-10-30T17:10:00+00:00")), "2026-10-30")

    def test_regular_eight_hour_ticks_allow_queue_drift_but_friday_quote_tick_skips_feeds(self):
        first = dt.datetime.fromisoformat('2026-10-30T05:57:00+00:00')
        status = {key: sync.iso(first) for key in ['last_fixture_attempt_utc', 'last_results_attempt_utc', 'last_europe_attempt_utc', 'last_standings_attempt_utc']}
        for hour in [13, 21]:
            tick = first.replace(hour=hour, minute=47)
            planned = sync.plan(status, 'auto', tick)
            for feed in ['calendar', 'results', 'europe', 'standings']:
                self.assertTrue(planned[feed], feed)
            for key in status:
                status[key] = sync.iso(tick)
            if hour == 13:
                quote = sync.plan(status, 'auto', tick.replace(hour=17))
                self.assertTrue(quote['quotes'])
                self.assertFalse(any(quote[k] for k in ['calendar', 'results', 'europe', 'standings']))

    def test_full_collector_validates_42_sources_before_any_publication(self):
        def download(url):
            if url.endswith("fixtures.csv"):
                return b"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,B365>2.5,B365<2.5\nE0,28/10/2026,Arsenal,Chelsea,,,1.85,2.0\n"
            division = url.rsplit("/", 1)[-1].removesuffix(".csv")
            year = "2025" if "/2526/" in url else "2026"
            return f"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HxG,AxG\n{division},01/10/{year},Arsenal,Chelsea,2,1,12,9,1.5,0.8\n".encode()
        before = (self.root/"docs/data/history.json").read_bytes()
        with patch.object(sync, "calendars", return_value=([], {"E0": 0}, [])):
            batch = sync.collect(self.root, "full", NOW, download=download)
        self.assertEqual(len(batch["checks"]), 42)
        self.assertEqual(batch["errors"], [])
        self.assertTrue(all(c["status"] == "ok" and len(c["sha256"]) == 64 for c in batch["checks"].values()))
        self.assertEqual((self.root/"docs/data/history.json").read_bytes(), before)
        sync.apply(self.root, batch)
        self.assertEqual(self.read("docs/data/status.json")["last_full_history_success_utc"], STAMP)
        self.assertEqual(len(self.read("docs/data/history.json")), 42)

    def test_old_calendar_patch_cannot_replace_newer_calendar(self):
        newer = row("2026-11-10")
        older = row("2026-10-28")
        u.writejson(self.root/"docs/data/fixtures.json", [newer])
        u.writejson(self.root/"docs/data/status.json", {"last_fixture_attempt_utc": "2026-10-28T10:00:00+00:00",
                   "last_build_utc": "2026-10-28T10:00:00+00:00"})
        batch = self.batch(calendar=True)
        batch["calendar"] = {"rows": [older], "counts": {"E0": 1}, "errors": []}
        sync.apply(self.root, batch)
        self.assertEqual(self.read("docs/data/fixtures.json"), [newer])
        self.assertEqual(self.read(sync.HEALTH)["checked_utc"], "2026-10-28T10:00:00+00:00")

    def test_push_collection_never_contacts_a_provider(self):
        mode, identity = sync.requested_mode(self.root, "push", "full")
        self.assertEqual((mode, identity), ("publish", None))
        def fail(url):
            raise AssertionError("Unexpected provider request " + url)
        batch = sync.collect(self.root, mode, NOW, download=fail)
        self.assertFalse(batch["plan"]["history"])
        self.assertFalse(batch["plan"]["calendar"])
        self.assertFalse(batch["plan"]["quotes"])

    def test_calendar_only_uses_no_football_data_and_preserves_successful_empty(self):
        def fake(download, today, leagues, observer):
            download("https://fixturedownload.com/example")
            return [], {"E0": 0}, []
        calls = []
        with patch.object(sync, "calendars", fake):
            batch = sync.collect(self.root, "calendar", NOW, download=lambda url: calls.append(url))
        self.assertEqual(batch["calendar"]["counts"], {"E0": 0})
        self.assertFalse(any("football-data.co.uk" in x for x in calls))

    def test_partial_download_is_not_a_full_success_receipt(self):
        batch = self.batch(history=True, full=True, history_targets=2)
        batch["checks"] = {"E0-2627": {"status": "ok", "rows": 1, "attempt_utc": STAMP},
                            "D1-2627": {"status": "error", "attempt_utc": STAMP}}
        sync.apply(self.root, batch)
        status = self.read("docs/data/status.json")
        self.assertEqual(status["history_refresh_status"], "partial")
        self.assertNotIn("last_history_success_utc", status)
        self.assertNotIn("last_full_history_success_utc", status)

    def test_rebase_never_overwrites_newer_stats_or_drops_unrelated_results(self):
        original = row(score=[2, 1])
        original[13] = {"HS": 12, "AS": 8}
        latest = copy.deepcopy(original)
        latest[13].update(HS=16, HC=7)
        unrelated = row("2026-10-26", [1, 0], home="Liverpool", away="Everton")
        u.writejson(self.root/"docs/data/history.json", [latest, unrelated])
        incoming = copy.deepcopy(original)
        incoming[13].update(HS=14, HY=3)
        batch = self.batch()
        batch["history"] = [{"row": incoming, "base_sha256": reg.digest(original)}]
        sync.apply(self.root, batch)
        history = {reg.row_key(r): r for r in self.read("docs/data/history.json")}
        self.assertEqual(len(history), 2)
        self.assertEqual(history[reg.row_key(original)][13], {"HS": 16, "AS": 8, "HC": 7, "HY": 3})
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*.json")}
        sync.apply(self.root, batch)
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*.json")})

    def test_conflicting_score_keeps_published_record_and_quarantines_once(self):
        old, incoming = row(score=[2, 1]), row(score=[3, 1])
        u.writejson(self.root/"docs/data/history.json", [old])
        batch = self.batch(history=True, full=True, history_targets=1)
        batch["history"] = [{"row": incoming, "base_sha256": reg.digest(old)}]
        batch["checks"] = {"E0-2627": {"status": "ok", "rows": 1, "attempt_utc": STAMP}}
        sync.apply(self.root, batch)
        sync.apply(self.root, batch)
        self.assertEqual(self.read("docs/data/history.json"), [old])
        self.assertEqual(len(self.read(sync.REGISTRY)["conflicts"]), 1)
        self.assertEqual(self.read("docs/data/status.json")["history_refresh_status"], "partial")

    def test_missing_fixture_retained_in_registry_then_result_and_stats_enrich(self):
        fixture = row("2026-10-25")
        u.writejson(self.root/"docs/data/fixtures.json", [fixture])
        batch = self.batch(calendar=True)
        batch["calendar"] = {"rows": [], "counts": {"E0": 0}, "errors": []}
        sync.apply(self.root, batch)
        self.assertEqual(self.read("docs/data/fixtures.json"), [])
        book = self.read(sync.REGISTRY)
        match = next(iter(book["matches"].values()))
        self.assertEqual(match["state"], "awaiting_result")
        self.assertIn("E0", self.read(sync.HEALTH)["pending_over_24h"])
        final = row("2026-10-25", [0, 0])
        batch["history"] = [{"row": final, "base_sha256": reg.digest(None)}]
        sync.apply(self.root, batch)
        match = next(iter(self.read(sync.REGISTRY)["matches"].values()))
        self.assertEqual(match["state"], "final_awaiting_stats")
        self.assertEqual(match["result"], [0, 0])
        self.assertEqual(match["kickoff_utc"], "2026-10-25T16:00:00+00:00")
        self.assertEqual(self.read("docs/data/history.json")[0][13], {})
        final[13] = {k: 0 for k in ("HS", "AS", "HST", "AST", "HC", "AC", "HY", "AY", "HR", "AR")}
        batch["history"] = [{"row": final, "base_sha256": reg.digest(self.read("docs/data/history.json")[0])}]
        sync.apply(self.root, batch)
        self.assertEqual(next(iter(self.read(sync.REGISTRY)["matches"].values()))["state"], "final")

    def test_provider_id_keeps_identity_across_date_changes_and_no_guessing(self):
        book = reg.empty()
        old, new = row("2026-10-25"), row("2026-11-10")
        reg.observe(book, [{"row": old, "provider_id": "ESPN:eng.1:123"}], STAMP)
        identity = next(iter(book["matches"]))
        reg.observe(book, [{"row": new, "provider_id": "ESPN:eng.1:123"}], STAMP)
        self.assertEqual(list(book["matches"]), [identity])
        self.assertEqual(len(book["matches"][identity]["legacy_keys"]), 2)
        self.assertEqual(reg.links(book)["matches"][reg.row_key(old)]["current_key"], reg.row_key(new))
        unrelated = row("2026-11-20")
        reg.observe(book, [{"row": unrelated}], STAMP)
        self.assertEqual(len(book["matches"]), 2)
        reg.observe(book, [{"row": row(home="Tottenham"), "provider_id": "ESPN:eng.1:123"}], STAMP)
        self.assertEqual(len(book["conflicts"]), 1)

    def test_generic_export_keeps_round_and_missing_on_target_is_still_pending(self):
        book = reg.empty()
        fixture = row()
        reg.observe(book, [{"row": fixture, "phase": "League stage", "round": 4}], STAMP)
        reg.observe(book, [{"row": fixture}], STAMP)
        match = next(iter(book["matches"].values()))
        self.assertEqual((match["phase"], match["round"]), ("League stage", 4))
        final = row(score=[2, 1])
        final[13] = {k: 1 for k in ("HS", "AS", "HC", "AC", "HY", "AY", "HR", "AR")}
        reg.reconcile(book, [final], [], STAMP)
        self.assertEqual(match["state"], "final_awaiting_stats")

    def test_complete_provider_failure_is_error_and_keeps_last_good_receipt(self):
        previous = "2026-10-24T12:00:00+00:00"
        u.writejson(self.root/"docs/data/status.json", {"last_history_success_utc": previous})
        batch = self.batch(history=True, full=True, history_targets=1)
        batch["checks"] = {"E0-2627": {"status": "error", "attempt_utc": STAMP}}
        sync.apply(self.root, batch)
        status = self.read("docs/data/status.json")
        self.assertEqual(status["history_refresh_status"], "error")
        self.assertEqual(status["last_history_success_utc"], previous)

    def test_revised_provider_date_links_to_actual_history_without_duplicate(self):
        old, new = row("2026-10-25"), row("2026-10-27")
        book = reg.empty()
        reg.observe(book, [{"row": old, "provider_id": "FD:E0:2026:100"}], "2026-10-24T10:00:00+00:00")
        u.writejson(self.root/sync.REGISTRY, book)
        batch = self.batch()
        batch["observations"] = [{"row": new, "provider_id": "FD:E0:2026:100"}]
        final = row("2026-10-27", [2, 1])
        batch["history"] = [{"row": final, "base_sha256": reg.digest(None)}]
        sync.apply(self.root, batch)
        book = self.read(sync.REGISTRY)
        self.assertEqual(len(book["matches"]), 1)
        match = next(iter(book["matches"].values()))
        self.assertEqual(match["result_key"], reg.row_key(final))
        self.assertEqual(match["kickoff_utc"], "2026-10-27T16:00:00+00:00")

    def test_kickoff_uses_sofia_dst_and_refuses_ambiguous_clocks(self):
        self.assertEqual(reg.kickoff(row("2026-07-01")), "2026-07-01T15:00:00+00:00")
        self.assertEqual(reg.kickoff(row("2026-10-27")), "2026-10-27T16:00:00+00:00")
        self.assertIsNone(reg.kickoff(row("2026-10-25", clock="03:30")))
        self.assertIsNone(reg.kickoff(row("2026-03-29", clock="03:30")))

    def test_successful_empty_clears_only_its_view_and_failed_feed_stays(self):
        e0 = row("2026-10-28")
        d1 = copy.deepcopy(e0)
        d1[0] = "D1"
        u.writejson(self.root/"docs/data/fixtures.json", [e0, d1])
        batch = self.batch(calendar=True)
        batch["calendar"] = {"rows": [], "counts": {"E0": 0}, "errors": ["D1 failed"]}
        sync.apply(self.root, batch)
        self.assertEqual([r[0] for r in self.read("docs/data/fixtures.json")], ["D1"])
        self.assertIn("D1", self.read("docs/data/status.json")["stale_secondary_leagues"])
        self.assertEqual(len(self.read(sync.REGISTRY)["matches"]), 2)

    def test_request_only_commit_is_explicit_and_idempotent(self):
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for key, value in [("user.name", "Test"), ("user.email", "test@example.invalid")]:
            subprocess.run(["git", "-C", str(self.root), "config", key, value], check=True)
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "Base"], check=True)
        u.writejson(self.root/"ops/sync_request.json", {"id": "test-42", "mode": "full"})
        subprocess.run(["git", "-C", str(self.root), "add", "ops/sync_request.json"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "[data-sync] full refresh"], check=True)
        self.assertEqual(sync.requested_mode(self.root, "push", "auto", "HEAD"), ("full", "test-42"))
        u.writejson(self.root/"docs/data/status.json", {"processed_sync_requests": ["test-42"]})
        batch = sync.collect(self.root, "full", NOW, download=lambda _: self.fail("duplicate request"), request_id="test-42")
        self.assertEqual(batch["plan"]["mode"], "publish")
