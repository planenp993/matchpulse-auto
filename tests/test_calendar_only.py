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


if __name__=='__main__':unittest.main()
