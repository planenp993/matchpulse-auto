import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import standings as s, data_sync as sync, update as u

NOW=dt.datetime(2026,10,27,18,tzinfo=dt.timezone.utc)
STAMP=sync.iso(NOW)


def row(i=1,**kw):
    r={'rank':i,'team_id':str(i),'name':'Club '+str(i),'club_key':'club '+str(i),'provider_id':'ESPN:E0:'+str(i),
       'played':4,'won':2,'drawn':1,'lost':1,'gf':6,'ga':4,'gd':2,'points':7,'points_adjustment':0}
    r.update(kw);return r


def table(div='E0',count=20):
    return {'division':div,'season':'2026/27','provider':'ESPN','observed_at_utc':STAMP,'receipts':[],
            'source_url':'https://www.espn.com/soccer/standings/_/league/eng.1',
            'groups':[{'id':'regular','name':'Regular Season','phase_id':'1','rows':[row(i) for i in range(1,count+1)]}]}


def raw_espn():
    entries=[]
    for i in range(1,21):
        values={field:row(i)[key] for key,field in s.STATS.items()}
        entries.append({'team':{'id':str(i),'displayName':'Club '+str(i)},'stats':[{'name':k,'value':float(v)} for k,v in values.items()]})
    return {'season':{'year':2026,'startDate':'2026-07-01','endDate':'2027-07-01'},
            'children':[{'id':'1','name':'League','standings':{'season':2026,'seasonType':1,
                'links':[{'href':'https://www.espn.com/soccer/table/_/league/eng.1'}],'entries':entries}}]}


class StandingsTests(unittest.TestCase):
    def test_source_order_and_penalty_points_are_preserved(self):
        d=raw_espn();d['children'][0]['standings']['entries'][0]['stats'].append({'name':'deductions','value':-3})
        for stat in d['children'][0]['standings']['entries'][0]['stats']:
            if stat['name']=='points':stat['value']=4
        groups,_=s.parse_espn(json.dumps(d).encode(),'E0',NOW.date())
        with tempfile.TemporaryDirectory() as folder:
            groups=s.link_clubs(groups,'E0','ESPN',Path(folder),NOW.date())
        t=table();t['groups']=groups;s.validate(t)
        self.assertEqual(groups[0]['rows'][0]['points'],4);self.assertEqual(groups[0]['rows'][0]['points_adjustment'],-3)
        self.assertEqual(groups[0]['rows'][0]['reported_deductions'],-3);self.assertEqual(groups[0]['rows'][1]['rank'],2)

    def test_expired_or_wrong_season_and_league_are_rejected(self):
        for change in ('root','group','league'):
            d=raw_espn()
            if change=='root':d['season']['year']=2025
            if change=='group':d['children'][0]['standings']['season']=2025
            if change=='league':d['children'][0]['standings']['links'][0]['href']='https://www.espn.com/soccer/table/_/league/ger.1'
            with self.subTest(change=change),self.assertRaises(ValueError):s.parse_espn(json.dumps(d).encode(),'E0',NOW.date())

    def test_noninteger_and_missing_values_do_not_become_zero(self):
        for value in (None,True,1.25,float('nan')):
            with self.subTest(value=value),self.assertRaises(ValueError):s.integer(value)
        d=raw_espn();d['children'][0]['standings']['entries'][0]['stats'].pop()
        with self.assertRaises(ValueError):s.parse_espn(json.dumps(d).encode(),'E0',NOW.date())

    def test_groups_and_carry_over_points_are_separate(self):
        t=table('DNK',12);rows=t['groups'][0]['rows'];rows[0].update(points=4,points_adjustment=-3)
        t['groups']=[{'id':'champ','name':'Championship Group','phase_id':'2','rows':rows[:6]},
                     {'id':'releg','name':'Relegation Group','phase_id':'2','rows':[{**r,'rank':i+1} for i,r in enumerate(rows[6:])]}]
        self.assertIs(s.validate(t),t);self.assertEqual(t['groups'][0]['rows'][0]['points'],4)
        self.assertEqual(t['groups'][1]['rows'][0]['rank'],1)

    def test_duplicate_or_truncated_or_incoherent_tables_are_rejected(self):
        for issue in ('duplicate','truncate','played','goals','order'):
            t=table();r=t['groups'][0]['rows']
            if issue=='duplicate':r[1]['team_id']=r[0]['team_id']
            if issue=='truncate':t['groups'][0]['rows']=r[:2]
            if issue=='played':r[0]['played']=99
            if issue=='goals':r[0]['gd']=8
            if issue=='order':r.reverse()
            with self.subTest(issue=issue),self.assertRaises(ValueError):s.validate(t)

    def test_provider_failure_preserves_last_table_and_real_success_time(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);batch={'tables':{'E0':table()},'errors':{},'observed_at_utc':STAMP}
            s.apply(root,batch,STAMP)
            later='2026-10-28T18:00:00+00:00'
            doc=s.apply(root,{'tables':{},'errors':{'E0':'provider unavailable'},'observed_at_utc':later},later)
            self.assertEqual(doc['tables']['E0'],{**table(),'archive_ahead':[]});self.assertEqual(doc['checks']['E0']['success_utc'],STAMP)
            self.assertEqual(doc['checks']['E0']['status'],'error')

    def test_old_patch_cannot_replace_a_newer_table(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);later='2026-10-28T18:00:00+00:00';new=table();new['observed_at_utc']=later
            s.apply(root,{'tables':{'E0':new},'errors':{},'observed_at_utc':later},later)
            doc=s.apply(root,{'tables':{'E0':table()},'errors':{},'observed_at_utc':STAMP},later)
            self.assertEqual(doc['tables']['E0']['observed_at_utc'],later)

    def test_same_observation_replay_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);batch={'tables':{'E0':table()},'errors':{},'observed_at_utc':STAMP}
            s.apply(root,batch,STAMP);before=(root/s.VIEW).read_bytes();s.apply(root,batch,STAMP)
            self.assertEqual(before,(root/s.VIEW).read_bytes())

    def test_corrupt_table_archive_blocks_and_never_resets(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);p=root/s.VIEW;p.parent.mkdir(parents=True);p.write_text('{broken')
            with self.assertRaises(ValueError):s.apply(root,None,STAMP)
            self.assertEqual(p.read_text(),'{broken')

    def test_swiss_missing_goals_are_missing_but_official_difference_is_preserved(self):
        rankings=[{'ranking':i,'teamId':str(i),'points':7,'gamesPlayed':4,'gamesWon':2,'gamesDraw':1,'gamesLost':1,'goalDifference':2} for i in range(1,13)]
        raw=json.dumps({'result':{'data':{'competitionId':'official','rankings':[{'stageName':'Regular Season','rankings':rankings}]}}}).encode()
        games=[{'competitionId':'internal','homeTeamProviderId':str(i),'homeTeamName':'Club '+str(i),'awayTeamProviderId':str(i+1),'awayTeamName':'Club '+str(i+1)} for i in range(1,12)]
        events=json.dumps({'result':{'data':games}}).encode();groups=s.parse_sfl(raw,events,'official','internal')
        self.assertIsNone(groups[0]['rows'][0]['gf']);self.assertIsNone(groups[0]['rows'][0]['ga']);self.assertEqual(groups[0]['rows'][0]['gd'],2)
        with self.assertRaises(ValueError):s.parse_sfl(raw,events,'different','internal')

    def test_unknown_or_ambiguous_club_does_not_guess_a_highlight(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);groups=table()['groups'];groups[0]['rows'][0]['labels']=['Unreviewed Club']
            for r in groups[0]['rows'][1:]:r['labels']=[r['name']]
            mapped=s.link_clubs(groups,'E0','ESPN',root,NOW.date())
            self.assertIsNone(mapped[0]['rows'][0]['club_key'])

    def test_season_keys_use_sofia_date_and_distinguish_annual_leagues(self):
        today=u.today_sofia(dt.datetime.fromisoformat('2026-12-31T22:30:00+00:00'))
        self.assertEqual(s.season_key('NOR',today),'2027');self.assertEqual(s.season_key('E0',today),'2026/27')
        self.assertEqual(s.season_key('E0',dt.date(2027,7,1)),'2027/28')

    def test_rollover_retains_old_season_without_counting_it_current(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);old=table('NOR',16);old['season']='2026';s.apply(root,{'tables':{'NOR':old},'errors':{},'observed_at_utc':STAMP},STAMP)
            doc=s.apply(root,None,'2027-01-02T18:00:00+00:00');self.assertIn('NOR',doc['tables']);self.assertEqual(doc['coverage']['available_current_season'],0)

    def test_manual_standings_and_publish_keep_model_data_and_football_data_untouched(self):
        work=sync.plan({},'standings',NOW)
        self.assertTrue(work['standings']);self.assertTrue(all(not work[k] for k in ('history','quotes','calendar','europe','results')))
        self.assertFalse(sync.plan({},'publish',NOW)['standings'])
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);u.writejson(root/'docs/data/history.json',[]);u.writejson(root/'docs/data/status.json',{})
            def fail(url,**kwargs):raise AssertionError('Provider request from publish')
            batch=sync.collect(root,'publish',NOW,download=fail);self.assertIsNone(batch['standings'])

    def test_failed_standings_retry_at_next_tick_while_success_uses_eight_hours(self):
        status={'last_standings_attempt_utc':'2026-10-27T14:00:00+00:00','standings_refresh_status':'ok'}
        self.assertFalse(sync.plan(status,'auto',NOW)['standings']);status['standings_refresh_status']='partial'
        self.assertTrue(sync.plan(status,'auto',NOW)['standings'])

    def test_lagging_table_is_flagged_when_new_results_overtake_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);history=[['E0','England','League',f'2026-10-{i:02d}','','Club 1','Club 2',2,1,None,None,None,None] for i in range(1,6)]
            doc=s.apply(root,{'tables':{'E0':table()},'errors':{},'observed_at_utc':STAMP},STAMP,history=history)
            self.assertEqual(doc['coverage']['lagging'],['E0']);self.assertEqual(doc['tables']['E0']['groups'][0]['rows'][0]['points'],7)
