import copy
import datetime as dt
import gzip
import json
import sys
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from fixtures_espn import collect_league


class ESPNCalendarTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,10,26,10,tzinfo=ZoneInfo("Europe/Sofia"))
        self.end=dt.date(2026,11,25)
        self.event={"id":"1","date":"2026-10-30T17:30Z","competitions":[{
            "id":"1","date":"2026-10-30T17:30Z","timeValid":True,
            "status":{"type":{"name":"STATUS_SCHEDULED","state":"pre","completed":False}},
            "competitors":[{"homeAway":"away","score":"0","team":{"displayName":"Away"}},
                           {"homeAway":"home","score":"0","team":{"displayName":"Home"}}]}]}

    def board(self,events=(),calendar=()):
        return {"leagues":[{"slug":"ger.2","calendarType":"day","calendarIsWhitelist":True,
                            "calendar":list(calendar)}],"events":list(events)}

    def collect(self,download):
        return collect_league(download,"D2","ger.2",("Germany","2. Bundesliga"),self.now,self.end)

    def test_requests_only_published_days_inside_the_window_and_deduplicates_events(self):
        calls=[]
        def download(url):
            calls.append(url)
            return json.dumps(self.board([self.event],
                ["2026-10-25T07:00Z","2026-10-30T07:00Z","2026-12-01T08:00Z"])).encode()
        rows=self.collect(download)
        self.assertEqual(len(calls),2)
        self.assertTrue(calls[0].endswith("dates=20261026"))
        self.assertTrue(calls[1].endswith("dates=20261030"))
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0][4:7],["19:30","Home","Away"])
        self.assertEqual(rows[0][7:13],[None]*6)
        self.assertIn("ESPN",rows[0][13])

    def test_finished_live_postponed_and_cancelled_events_are_not_fixtures(self):
        events=[]
        for i,(state,completed,name) in enumerate([
            ("post",True,"STATUS_FINAL"),("in",False,"STATUS_IN_PROGRESS"),
            ("pre",False,"STATUS_POSTPONED"),("pre",False,"STATUS_CANCELED")]):
            e=copy.deepcopy(self.event);e["id"]=str(i)
            e["competitions"][0]["status"]["type"]={"state":state,"completed":completed,"name":name}
            events.append(e)
        self.assertEqual(self.collect(lambda _:json.dumps(self.board(events)).encode()),[])

    def test_unconfirmed_time_stays_missing_and_an_unconfirmed_date_is_excluded(self):
        a=copy.deepcopy(self.event);a["competitions"][0]["timeValid"]=False
        b=copy.deepcopy(self.event);b["competitions"][0]["dateValid"]=False
        rows=self.collect(lambda _:json.dumps(self.board([a,b])).encode())
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0][4],"")
        self.assertIn("unconfirmed",rows[0][13])

    def test_one_failed_match_day_rejects_the_refresh_instead_of_publishing_a_partial_league(self):
        def download(url):
            if url.endswith("20261026"):
                return json.dumps(self.board([self.event],["2026-10-30T07:00Z"])).encode()
            raise OSError("day unavailable")
        with self.assertRaises(OSError):self.collect(download)

    def test_wrong_league_and_missing_day_calendar_are_rejected(self):
        wrong=self.board();wrong["leagues"][0]["slug"]="eng.2"
        with self.assertRaises(ValueError):self.collect(lambda _:json.dumps(wrong).encode())
        missing=self.board();missing["leagues"][0]["calendarIsWhitelist"]=False
        with self.assertRaises(ValueError):self.collect(lambda _:json.dumps(missing).encode())

    def test_gzipped_response_and_successful_empty_calendar_are_supported(self):
        data=gzip.compress(json.dumps(self.board()).encode())
        self.assertEqual(self.collect(lambda _:data),[])

    def test_sofia_date_crosses_midnight_with_the_actual_summer_offset(self):
        self.now=dt.datetime(2026,10,24,10,tzinfo=ZoneInfo("Europe/Sofia"))
        event=copy.deepcopy(self.event);event["competitions"][0]["date"]="2026-10-24T21:30Z"
        rows=self.collect(lambda _:json.dumps(self.board([event])).encode())
        self.assertEqual(rows[0][3:5],["2026-10-25","00:30"])

    def test_expired_provider_season_is_not_a_successful_empty_calendar(self):
        board=self.board();board['leagues'][0]['calendarEndDate']='2026-06-01T03:59Z'
        with self.assertRaisesRegex(ValueError,'expired season'):
            self.collect(lambda _:json.dumps(board).encode())
