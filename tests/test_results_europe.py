import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from scripts import europe_archive as e, results_bridge as b, data_sync as sync, match_registry as reg, update as u

NOW=dt.datetime(2026,10,27,18,tzinfo=dt.timezone.utc)
CLUBS={'1':{'name':'Home','country':'ENG','source_names':['Home'],'resolution':'official_club_id'},'2':{'name':'Away','country':'SCO','source_names':['Away'],'resolution':'official_club_id'}}

def game(**kw):
    result={'id':'10','competition':{'id':'1'},'seasonYear':'2022','status':'FINISHED',
      'homeTeam':{'id':'1'},'awayTeam':{'id':'2'},'kickOffTime':{'dateTime':'2022-05-01T19:00:00Z'},
      'competitionPhase':'TOURNAMENT','score':{'regular':{'home':2,'away':1},'total':{'home':3,'away':1},'aggregate':{'home':6,'away':5}}}
    result.update(kw);return result

def record(g=None):return e.parse_match(g or game(),'UCL',2022,CLUBS,NOW,{'url':'official','sha256':'a'*64})

class EuropeTests(unittest.TestCase):
    def test_explicit_regulation_not_extra_time_or_two_leg_aggregate(self):
        r=record();self.assertEqual(e.view_row(r)[7:9],[2,1]);self.assertEqual(r['scores']['after_play'],[3,1]);self.assertEqual(r['scores']['extra_time_goals'],[1,0]);self.assertEqual(r['scores']['aggregate'],[6,5])
        self.assertIsNone(e.view_row(r)[9]);self.assertNotIn('HS',e.view_row(r)[13])

    def test_aggregate_winner_reason_on_first_leg_does_not_invent_extra_time(self):
        g=game(winner={'aggregate':{'reason':'WIN_ON_EXTRA_TIME'}},type='FIRST_LEG');g['score']['total']=g['score']['regular']
        self.assertIsNone(record(g)['scores']['extra_time_goals'])

    def test_shootout_is_stored_separately_from_regulation(self):
        g=game();g['score']={'regular':{'home':1,'away':1},'total':{'home':1,'away':1},'penalty':{'home':5,'away':4}}
        r=record(g);self.assertEqual(e.view_row(r)[7:9],[1,1]);self.assertEqual(r['scores']['penalties'],[5,4])

    def test_administrative_placeholder_zero_is_not_a_played_draw(self):
        g=game(status='ABANDONED');g['score']={'regular':{'home':0,'away':0},'total':{'home':0,'away':3}}
        r=record(g);self.assertIsNone(e.view_row(r));self.assertEqual(r['scores']['administrative'],[0,3]);self.assertIsNone(r['scores']['extra_time_goals'])

    def test_cancelled_date_only_kept_without_inventing_kickoff(self):
        r=record(game(status='CANCELED',score=None,kickOffTime={'date':'2022-03-17'}))
        self.assertIsNone(r['kickoff_utc']);self.assertFalse(r['analysis_eligible'])

    def test_wrong_season_future_and_missing_regulation_are_rejected(self):
        for kw in ({'seasonYear':'2023'},{'competition':{'id':'14'}},{'kickOffTime':{'dateTime':'2027-01-01T18:00:00Z'}},{'score':{'total':{'home':1,'away':0}}}):
            with self.subTest(kw=kw),self.assertRaises(ValueError):record(game(**kw))

    def test_complete_official_goal_timeline_checks_own_goals_and_period(self):
        g=game();g['score']['regular']={'home':3,'away':1}
        g['playerEvents']={'scorers':[
            {'teamId':'2','goalType':'OWN','phase':'FIRST_HALF'},
            {'teamId':'1','goalType':'SCORED','phase':'SECOND_HALF'},
            {'teamId':'2','goalType':'SCORED','phase':'SECOND_HALF'},
            {'teamId':'1','goalType':'PENALTY','phase':'EXTRA_TIME_SECOND_HALF'}]}
        r=record(g);self.assertEqual(r['scores']['regulation'],[2,1]);self.assertEqual(r['score_resolution']['reported_regulation'],[3,1])
        g['playerEvents']['scorers'].pop();self.assertIsNone(e.event_regulation(g,[3,1]))
        g['playerEvents']['scorers'].append({'teamId':'9','goalType':'SCORED','phase':'SECOND_HALF'});self.assertIsNone(e.event_regulation(g,[3,1]))

    def test_unbalanced_timeline_cannot_arbitrate_inconsistent_scores(self):
        g=game();g['score']['regular']={'home':4,'away':1};g['playerEvents']={'scorers':[]}
        with self.assertRaises(ValueError):record(g)

    def test_identities_prefer_domestic_exact_labels_and_respect_country(self):
        t={'id':'1','internationalName':'Leipzig','countryCode':'GER','translations':{'displayOfficialName':{'EN':'RB Leipzig'},'countryName':{'EN':'Germany'}}}
        rows=[['D1','Germany','Bundesliga','2026-01-01','','RB Leipzig','Bayern']]
        fixtures=[['UCL','Europe','Champions League','2026-11-01','','Leipzig','Bayern']]
        clubs=e.choose_clubs([{'homeTeam':t}],rows,fixtures);self.assertEqual(clubs['1']['name'],'RB Leipzig')
        foreign={'id':'2','internationalName':'Rangers','countryCode':'AND','translations':{'countryName':{'EN':'Andorra'}}}
        domestic=[['SC0','Scotland','League','2026-01-01','','Rangers','Celtic']]
        clubs=e.choose_clubs([{'homeTeam':foreign}],domestic,[])
        self.assertEqual(clubs['2']['resolution'],'official_club_id')

    def test_archive_apply_is_idempotent_and_score_conflict_retains_old(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);r=record();r['base_sha256']=reg.digest(None)
            batch={'clubs':CLUBS,'schedule':[],'groups':[{'division':'UCL','season_year':2022,'records':[r],'receipts':[],'coverage':'needs_review','closed_expected_main':125}],'errors':[]}
            book=reg.empty();rows,_,receipt=e.apply(root,batch,book,sync.iso(NOW));self.assertEqual(rows[0][7:9],[2,1]);self.assertFalse(receipt['complete'])
            before={p.relative_to(root):p.read_bytes() for p in root.rglob('*.json')}
            self.assertEqual(e.apply(root,batch,book,sync.iso(NOW))[2]['changed'],0)
            self.assertEqual(before,{p.relative_to(root):p.read_bytes() for p in root.rglob('*.json')})
            batch['groups'][0]['records'][0]['scores']['regulation']=[3,1]
            self.assertEqual(e.apply(root,batch,book,sync.iso(NOW))[2]['conflicts'],1)
            self.assertEqual(u.readjson(root/e.VIEW,[])[0][7:9],[2,1]);self.assertEqual(len(book['conflicts']),1)

    def test_official_both_labels_and_date_link_existing_calendar(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);clubs=copy.deepcopy(CLUBS);clubs['1']['source_names']+=['Home FC']
            fixture=['UCL','Europe','League','2022-05-01','22:00','Home FC','Away',None,None,None,None,None,None,'FixtureDownload / Sofia']
            book=reg.empty();reg.observe(book,[{'row':fixture}],sync.iso(NOW));rows=[e.view_row(record())]
            aliases=e.registry_aliases(book,rows,clubs,sync.iso(NOW));reg.reconcile(book,rows,[],sync.iso(NOW),aliases)
            self.assertEqual(reg.links(book)['matches'][reg.row_key(fixture)]['result_key'],reg.row_key(rows[0]))
            self.assertEqual(reg.links(book)['matches'][reg.row_key(fixture)]['state'],'final')

    def test_corrupt_shard_is_never_reinitialized(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=root/'data/europe/UCL/2022.json';path.parent.mkdir(parents=True);path.write_text('{broken')
            batch={'clubs':CLUBS,'schedule':[],'groups':[{'division':'UCL','season_year':2022,'records':[],'receipts':[],'coverage':'needs_review','closed_expected_main':125}],'errors':[]}
            with self.assertRaises(ValueError):e.apply(root,batch,reg.empty(),sync.iso(NOW))
            self.assertEqual(path.read_text(),'{broken')

    def test_explicit_administrative_result_voids_pending_fixture_without_scoring_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);r=record(game(status='CANCELED',score=None));r['base_sha256']=reg.digest(None)
            batch={'clubs':CLUBS,'schedule':[],'groups':[{'division':'UCL','season_year':2022,'records':[r],'receipts':[],'coverage':'needs_review','closed_expected_main':125}],'errors':[]}
            fixture=['UCL','Europe','League','2022-05-01','22:00','Home','Away',None,None,None,None,None,None,'FixtureDownload / Sofia']
            book=reg.empty();reg.observe(book,[{'row':fixture}],sync.iso(NOW));e.apply(root,batch,book,sync.iso(NOW));e.reconcile_administrative(root,book,CLUBS)
            reg.reconcile(book,[],[],sync.iso(NOW));m=next(iter(book['matches'].values()));self.assertEqual(m['state'],'cancelled');self.assertIsNone(m['result'])

    def test_manual_and_publish_modes_keep_provider_boundaries(self):
        for mode in ('calendar','fixtures','publish'):
            p=sync.plan({},mode,NOW);self.assertFalse(p['results']);self.assertFalse(p['europe'])
        p=sync.plan({},'europe',NOW);self.assertTrue(p['europe_full']);self.assertFalse(p['history']);self.assertFalse(p['quotes'])
        p=sync.plan({'last_europe_backfill_success_utc':sync.iso(NOW)},'results',NOW);self.assertFalse(p['europe_full']);self.assertTrue(p['results'])

    def test_pagination_must_terminate_and_never_repeat_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            with __import__('unittest.mock',fromlist=['patch']).patch.object(e,'PAGE_SIZE',1):
                batch=e.collect(lambda url:json.dumps([game(seasonYear='2027')]).encode(),Path(folder),NOW)
            self.assertFalse(batch['groups']);self.assertEqual(len(batch['errors']),3)
            self.assertTrue(all('pagination' in x for x in batch['errors']))

class BridgeTests(unittest.TestCase):
    def test_goal_only_bridge_preserves_richer_old_rows_and_quarantines_conflicts(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);row=['NOR','Norway','League','2026-10-24','','Home','Away',2,1,None,None,None,None,{'HS':12}]
            history={u.key(row):copy.deepcopy(row)};incoming=copy.deepcopy(row);incoming[13]={'SRC':'bridge'}
            item={'row':incoming,'provider_id':'ESPN:nor.1:123','source':{'url':'official','sha256':'a'*64}}
            batch={'records':[item]};book=reg.empty()
            self.assertEqual(b.apply(root,batch,history,book,sync.iso(NOW)),([],0));self.assertEqual(history[u.key(row)][13],{'HS':12})
            b.apply(root,batch,history,book,sync.iso(NOW));self.assertEqual(len(u.readjson(root/b.PROVENANCE,{})['matches']),1)
            incoming[7]=3;self.assertEqual(b.apply(root,batch,history,book,sync.iso(NOW))[1],1);self.assertEqual(history[u.key(row)][7],2)

    def test_bridge_follows_existing_provider_identity_after_reschedule(self):
        with tempfile.TemporaryDirectory() as folder:
            row=['NOR','Norway','League','2026-10-24','18:00','Home','Away',None,None,None,None,None,None,'ESPN / Sofia']
            moved=copy.deepcopy(row);moved[3]='2026-10-25';moved[7:9]=[1,0];moved[13]={}
            book=reg.empty();reg.observe(book,[{'row':row,'provider_id':'ESPN:nor.1:1'}],sync.iso(NOW))
            history={};b.apply(Path(folder),{'records':[{'row':moved,'provider_id':'ESPN:nor.1:1','source':{}}]},history,book,sync.iso(NOW))
            reg.reconcile(book,list(history.values()),[],sync.iso(NOW))
            self.assertEqual(len(book['matches']),1);self.assertEqual(reg.links(book)['matches'][reg.row_key(row)]['result_key'],reg.row_key(moved))

    def test_bridge_imports_only_explicit_completed_regulation_and_no_placeholders(self):
        def board(slug):
            def ev(identity,name='STATUS_FULL_TIME',period=2,completed=True):
                return {'id':identity,'date':'2026-10-24T16:00:00Z','status':{'period':period,'type':{'state':'post','completed':completed,'name':name}},
                    'competitions':[{'id':identity,'competitors':[{'homeAway':'home','team':{'id':'111','displayName':'Home'},'score':'2'},{'homeAway':'away','team':{'id':'222','displayName':'Away'},'score':'1'}]}]}
            return {'leagues':[{'slug':slug,'calendarType':'day','calendarIsWhitelist':True,'calendar':[],'calendarEndDate':'2026-12-31'}],
                    'events':[ev('1'),ev('2','STATUS_FINAL_AET',4),ev('3',period=4),ev('4',completed=False)]}
        def download(url,**kwargs):
            if 'espn.com' in url:
                slug=url.split('/soccer/')[1].split('/')[0];return json.dumps(board(slug)).encode()
            raise ValueError('test only supplies ESPN')
        history=[[div,*u.LEAGUES[div],'2026-10-18','','Home','Away',0,0,None,None,None,None] for div in u.EXTRA]
        result=b.collect(download,history,NOW);self.assertEqual(len(result['records']),4)
        self.assertTrue(all(r['provider_id'].endswith(':1') and r['row'][7:9]==[2,1] for r in result['records']))
