import datetime as dt
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from fixtures_fallback import collect

LEAGUES = {"E0": ("England", "Premier League")}

class FixtureFeedTests(unittest.TestCase):
    def test_future_with_correct_local_timezone_and_source(self):
        target = dt.date(2026, 10, 22)
        items = [{"DateUtc": "2026-10-24 16:30:00Z", "HomeTeam": "Arsenal",
                  "AwayTeam": "Everton", "HomeTeamScore": None, "AwayTeamScore": None}]
        def fake(url):
            if "epl-2026" in url:
                return json.dumps(items).encode()
            raise ValueError("unavailable")
        rows, counts, errs = collect(fake,target,LEAGUES)
        self.assertEqual(counts.get("E0"), 1)
        self.assertEqual((rows[0][3], rows[0][4]), ("2026-10-24", "19:30"))
        self.assertEqual(rows[0][7:9], [None,None])
        self.assertIn("FixtureDownload", rows[0][13])
        self.assertGreater(len(errs), 0)

    def test_completed_matches_not_future(self):
        done = [{"DateUtc":"2026-10-25 13:00:00Z", "HomeTeam":"Arsenal",
                 "AwayTeam":"Everton", "HomeTeamScore":2,"AwayTeamScore":1}]
        def fake(url):
            if "epl-2026" in url: return json.dumps(done).encode()
            raise ValueError("unavailable")
        rows, counts, _ = collect(fake,dt.date(2026,10,22),LEAGUES)
        self.assertEqual(rows, [])
        self.assertEqual(counts.get("E0"), 0)

    def test_html_or_error_feed_not_used(self):
        rows, counts, errors = collect(lambda url:b"<html></html>",dt.date(2026,10,22),LEAGUES)
        self.assertEqual(rows, [])
        self.assertEqual(counts, {})
        self.assertTrue(errors)

if __name__ == "__main__": unittest.main()
