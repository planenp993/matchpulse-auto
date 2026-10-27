import copy
import datetime as dt
import json
import sys
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from fixtures_official import collect_pol, collect_sfl, pol_props, SFL_HOME, SFL_RPC, SFL_ACCOUNT
from provider_clubs import ENTRIES, resolve
from club_identity import club_key


def flight(props):
    # Encoded Next Flight JSON is parsed as data, never executed.
    text='1:'+json.dumps({'children':props},ensure_ascii=False)+'\n'
    return ('<script>self.__next_f.push('+json.dumps([1,text])+')</script>').encode()


class OfficialCalendarTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,10,27,10,tzinfo=ZoneInfo('Europe/Sofia'));self.end=dt.date(2026,11,26)
        self.game={'matchId':'test-match','status':'fixture','showsScore':False,'postponed':False,
                   'homeTeam':{'id':'unknown-home','name':'Home'},'awayTeam':{'id':'unknown-away','name':'Away'},
                   'homeScore':0,'awayScore':0,'date':'2026-10-30','localTime':'18:00:00',
                   'matchDatetime':'2026-10-30T18:00:00+01:00','week':1,'stage':'Regular Season'}
        self.props={'seasonSlug':'2026-2027','weekNumber':1,'totalRounds':2,
                    'rounds':[{'number':1,'slug':'kolejka-1'},{'number':2,'slug':'kolejka-2'}],
                    'enrichedMatches':[self.game],'enrichedPostponedMatches':[]}

    def download_pol(self, url):
        props=copy.deepcopy(self.props)
        if 'kolejka-2' in url:
            props['weekNumber']=2;props['enrichedMatches'][0].update(matchId='future-round',date='2026-11-28',matchDatetime=None,localTime='None')
        return flight(props)

    def test_polish_rounds_stop_at_horizon_and_zero_placeholders_are_not_scores(self):
        calls=[];observed=[]
        def download(url):calls.append(url);return self.download_pol(url)
        rows=collect_pol(download,('Poland','Ekstraklasa'),self.now,self.end,observer=observed.append)
        self.assertEqual(len(calls),2);self.assertEqual(len(rows),1);self.assertEqual(rows[0][3:5],['2026-10-30','19:00'])
        self.assertEqual(rows[0][7:13],[None]*6);self.assertEqual(observed[0]['provider_id'],'Ekstraklasa:test-match')

    def test_polish_failures_or_a_stale_season_reject_the_entire_league(self):
        with self.assertRaises(ValueError):pol_props(flight({**self.props,'seasonSlug':'2025-2026'}),'2026-2027')
        def fail(url):
            if 'kolejka-2' in url:raise OSError('missing page')
            return self.download_pol(url)
        with self.assertRaises(OSError):collect_pol(fail,('Poland','Ekstraklasa'),self.now,self.end)
        with self.assertRaises(ValueError):pol_props(b'<html>unavailable</html>','2026-2027')

    def test_polish_rescheduling_uses_the_new_instant_but_retains_provider_id(self):
        self.game.update(postponed=True,postponedDatetime='2026-11-05T20:30:00+01:00',postponedLocalTime='20:30:00')
        rows=collect_pol(self.download_pol,('Poland','Ekstraklasa'),self.now,self.end)
        self.assertEqual(rows[0][3:5],['2026-11-05','21:30'])
        self.game.update(matchDatetime=None,postponedDatetime=None)
        self.assertEqual(collect_pol(self.download_pol,('Poland','Ekstraklasa'),self.now,self.end),[])

    def test_polish_played_and_undated_round_placeholders_are_excluded(self):
        self.game.update(status='played',showsScore=True,homeScore=2)
        self.assertEqual(collect_pol(self.download_pol,('Poland','Ekstraklasa'),self.now,self.end),[])
        self.game.update(status='fixture',showsScore=False,matchDatetime=None,localTime=None)
        self.assertEqual(collect_pol(self.download_pol,('Poland','Ekstraklasa'),self.now,self.end),[])

    def sfl(self, **changes):
        game={'providerId':'swiss-test','competitionId':'internal','date':'2026-10-31T00:00:00.000Z','time':'17:00:00Z',
              'homeTeamName':'Home','awayTeamName':'Away','homeTeamProviderId':'h','awayTeamProviderId':'a',
              'gameStatus':'pre-game','homeScore':0,'awayScore':0,'stage':'Regular Season','week':'12',**changes}
        tail={**game,'providerId':'future','date':'2026-12-01T00:00:00.000Z'}
        page={'props':{'pageProps':{'calendar':{'competitions':[{'name':'Super League','providerId':'comp','internalId':'internal'}]},
                                  'seasons':[{'name':'2026/2027','providerId':'season','competitionProviderId':'comp'}]}}}
        def download(url,headers=None):
            if url==SFL_HOME:return ('<script id="__NEXT_DATA__" type="application/json">'+json.dumps(page)+'</script>').encode()
            self.assertTrue(url.startswith(SFL_RPC));self.assertEqual(headers,{'x-account-key':SFL_ACCOUNT})
            return json.dumps({'result':{'data':[game,tail]}}).encode()
        return download

    def test_swiss_utc_times_and_official_match_ids(self):
        observed=[];rows=collect_sfl(self.sfl(),('Switzerland','Super League'),self.now,self.end,observer=observed.append)
        self.assertEqual(rows[0][3:5],['2026-10-31','19:00']);self.assertEqual(rows[0][7:13],[None]*6)
        self.assertEqual(observed[0]['provider_id'],'SwissFootballLeague:swiss-test')

    def test_swiss_wrong_competition_unknown_clock_and_finished_matches(self):
        with self.assertRaises(ValueError):collect_sfl(self.sfl(competitionId='another'),('Switzerland','Super League'),self.now,self.end)
        for kwargs in [{'gameStatus':'post-game'},{'time':None},{'time':'00:00:00Z'},{'gameStatus':'postponed'}]:
            self.assertEqual(collect_sfl(self.sfl(**kwargs),('Switzerland','Super League'),self.now,self.end),[])

    def test_reviewed_source_ids_are_scoped_and_names_cannot_silently_change(self):
        entry=next(e for e in ENTRIES if e['source_name']=='AGF')
        self.assertEqual(resolve('DNK','ESPN',entry['team_id'],'AGF'),'Aarhus')
        self.assertEqual(resolve('AUT','ESPN',entry['team_id'],'AGF'),'AGF')
        with self.assertRaises(ValueError):resolve('DNK','ESPN',entry['team_id'],'Unrelated club')

    def test_every_added_club_has_three_exact_archived_games_against_two_opponents(self):
        history=json.loads((Path(__file__).resolve().parents[1]/'docs/data/history.json').read_text())
        keys={(r[0],r[3],club_key(r[5]),club_key(r[6]),r[7],r[8]) for r in history}
        self.assertEqual({e['division'] for e in ENTRIES},{'NOR','SWE','DNK','POL','AUT','SWZ'})
        for entry in ENTRIES:
            evidence=entry['evidence'];self.assertGreaterEqual(len({e['event_id'] for e in evidence}),3)
            self.assertGreaterEqual(len({e['away'] if e['home']==entry['target'] else e['home'] for e in evidence}),2)
            for e in evidence:self.assertIn((entry['division'],e['date'],club_key(e['home']),club_key(e['away']),*e['score']),keys)
