import datetime as dt
import importlib
import sys
import tempfile
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import update
import update_calendar


class CalendarOnlyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base=Path(self.temp.name)
        self.old_fix,self.old_stat,self.old_hist=update.FIX,update.STAT,update.HIST
        update.FIX=base/'fixtures.json'
        update.STAT=base/'status.json'
        update.HIST=base/'history.json'
        self.old_collect=update_calendar.collect_secondary_fixtures
        self.addCleanup(self.restore)
        update.writejson(update.HIST,[])
        update.writejson(update.STAT,{"history_count":26558,"last_history_success_utc":"2026-10-23T12:00:00Z"})
        update.writejson(update.FIX,[
            ["D2","Germany","Bundesliga 2","2026-10-27","12:00","A","B",None,None,None,None,1.8,2.0],
            ["E0","England","Premier League","2026-10-29","14:00","OLD","OldAway",None,None,None,None,None,None,"FixtureDownload / UTC→Europe-Sofia"],
            ["F1","France","Ligue 1","2026-10-22","14:00","Past","FC",None,None,None,None,None,None,"FixtureDownload / UTC→Europe-Sofia"],
        ])
    def restore(self):
        update.FIX,update.STAT,update.HIST=self.old_fix,self.old_stat,self.old_hist
        update_calendar.collect_secondary_fixtures=self.old_collect

    def test_only_calendar_feed_no_historical_fetch(self):
        h0=update.HIST.read_bytes()
        fresh=["E0","England","Premier League","2026-10-27","19:00","Fresh","Opponent",None,None,None,None,None,None,"FixtureDownload / UTC→Europe-Sofia"]
        update_calendar.collect_secondary_fixtures=lambda downloader,today,leagues,horizon_days:([fresh],{"E0":1},[])
        def forbidden_fetch(url):
            raise AssertionError("Unexpected network or Football-Data URL "+url)
        status=update_calendar.run(downloader=forbidden_fetch,now=dt.date(2026,10,25))
        out=update.readjson(update.FIX,[])
        self.assertEqual(len(out),2)
        self.assertTrue(any(x[5]=="Fresh" for x in out))
        self.assertTrue(any(x[5]=="A" for x in out))
        self.assertFalse(any(x[5]=="OLD" for x in out))
        self.assertEqual(update.HIST.read_bytes(),h0)
        self.assertEqual(status["history_count"],26558)
        self.assertEqual(status["fixtures_feed_status"],"ok_secondary")

    def test_stale_fallback_visible_and_no_data_loss(self):
        update_calendar.collect_secondary_fixtures=lambda *args,**kwargs:([],{},["no feed"])
        status=update_calendar.run(downloader=lambda *_:None,now=dt.date(2026,10,25))
        self.assertEqual(status["fixtures_feed_status"],"stale_secondary")
        self.assertEqual(status["history_count"],26558)
        self.assertEqual(len(update.readjson(update.FIX,[])),2)

    def test_partial_failure_preserves_only_the_failed_leagues_cache(self):
        fresh=["F1","France","Ligue 1","2026-10-28","19:00","Fresh","Opponent",None,None,None,None,None,None,"FixtureDownload / UTC→Europe-Sofia"]
        update_calendar.collect_secondary_fixtures=lambda *args,**kwargs:([fresh],{"F1":1},["E0 unavailable"])
        history_before=update.HIST.read_bytes()
        status=update_calendar.run(downloader=lambda *_:None,now=dt.date(2026,10,25))
        out=update.readjson(update.FIX,[])
        self.assertTrue(any(r[5]=="OLD" for r in out))
        self.assertTrue(any(r[5]=="Fresh" for r in out))
        self.assertEqual(status["stale_secondary_leagues"],["E0"])
        self.assertEqual(status["fixtures_feed_status"],"partial_secondary")
        self.assertEqual(update.HIST.read_bytes(),history_before)

    def test_successful_empty_feed_clears_its_outdated_schedule(self):
        update_calendar.collect_secondary_fixtures=lambda *args,**kwargs:([],{"E0":0},[])
        status=update_calendar.run(downloader=lambda *_:None,now=dt.date(2026,10,25))
        out=update.readjson(update.FIX,[])
        self.assertEqual(len(out),1)
        self.assertEqual(out[0][0],"D2")
        self.assertEqual(status["fixtures_feed_status"],"ok_secondary")

    def test_confirmed_sofia_time_replaces_unknown_csv_clock_and_keeps_odds(self):
        primary=["F2","France","Ligue 2","2026-10-26","19:45","Montpellier","Red Star",None,None,None,None,1.8,2.0]
        fresh=[*primary[:13],"FixtureDownload / UTC→Europe-Sofia"]
        fresh[4]="21:45";fresh[5]="Montpellier Hérault SC";fresh[6]="Red Star FC"
        update.writejson(update.FIX,[primary])
        update_calendar.collect_secondary_fixtures=lambda *args,**kwargs:([fresh],{"F2":1},[])
        update_calendar.run(downloader=lambda *_:None,now=dt.date(2026,10,26))
        out=update.readjson(update.FIX,[])
        self.assertEqual(len(out),1)
        self.assertEqual(out[0][4],"21:45")
        self.assertEqual(out[0][11:13],[1.8,2.0])
        self.assertIn("Sofia",out[0][13])
        self.assertIn("fixturedownload.com",out[0][13])

    def test_successful_empty_league_also_clears_its_old_primary_schedule(self):
        primary=["D2","Germany","2. Bundesliga","2026-10-27","12:00","A","B",None,None,None,None,None,None]
        update.writejson(update.FIX,[primary])
        update_calendar.collect_secondary_fixtures=lambda *args,**kwargs:([],{"D2":0},[])
        update_calendar.run(downloader=lambda _:None,now=dt.date(2026,10,26))
        self.assertEqual(update.readjson(update.FIX,[]),[])

    def test_failed_espn_league_preserves_its_cache_during_a_partial_refresh(self):
        cached=["D2","Germany","2. Bundesliga","2026-10-27","19:00","A","B",None,None,None,None,None,None,"ESPN / UTC→Europe-Sofia"]
        update.writejson(update.FIX,[cached])
        update_calendar.collect_secondary_fixtures=lambda *args,**kwargs:([],{"F1":0},["D2 ESPN day unavailable"])
        status=update_calendar.run(downloader=lambda _:None,now=dt.date(2026,10,26))
        self.assertEqual(update.readjson(update.FIX,[]),[cached])
        self.assertEqual(status["stale_secondary_leagues"],["D2"])

    def test_full_refresh_keeps_a_failed_leagues_secondary_schedule(self):
        from unittest import mock
        cached=["D2","Germany","2. Bundesliga","2026-10-27","19:00","A","B",None,None,None,None,None,None,"ESPN / UTC→Europe-Sofia"]
        played=["D2","Germany","2. Bundesliga","2026-10-20","19:00","A","B",1,0,None,None,None,None]
        update.writejson(update.HIST,[played]);update.writejson(update.FIX,[cached])
        with mock.patch.multiple(update,CSV_LEAGUES={},EXTRA={}),mock.patch.object(update,"collect_secondary_fixtures",return_value=([],{},["D2 unavailable"])):
            status=update.run(online=True,downloader=lambda _:b"Div,Date,Time,HomeTeam,AwayTeam\nF1,27/10/2026,19:00,C,D\n",now=dt.date(2026,10,26),sleeper=lambda _:None)
        self.assertIn(cached,update.readjson(update.FIX,[]))
        self.assertEqual(len(update.readjson(update.FIX,[])),2)
        self.assertEqual(status["stale_secondary_leagues"],["D2"])
        self.assertEqual(status["fixtures_feed_status"],"partial_secondary")


if __name__=='__main__':unittest.main()
