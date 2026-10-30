import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from scripts import data_sync as sync
from scripts import soccerway as sw
from scripts import match_registry as registry
from scripts import provider_archive
from scripts import update as u

NOW = dt.datetime(2026, 10, 30, 18, tzinfo=dt.timezone.utc)
STAMP = sync.iso(NOW)
CATALOG = json.loads((u.ROOT/sw.CATALOG).read_text())
CONFIG = {'schema': 1, 'provider': 'Soccerway', 'interval_minutes': 30}


def event(identity='final001', clock='2026-10-29T14:00:00+00:00', state='3', stage='3', score=('0','1'), home='Arsenal', away='Chelsea'):
    epoch = str(int(dt.datetime.fromisoformat(clock).timestamp())) if clock else ''
    fields = {'AA':identity, 'AD':epoch, 'AB':state, 'AC':stage,
        'AE':home, 'AF':away, 'FH':home, 'FK':away,
        'PX':'arsenal1', 'PY':'chelsea1', 'JA':'lineup01', 'JB':'lineup02',
        'AG':score[0], 'AH':score[1], 'ER':'Round 12'}
    return '¬'.join(k+'÷'+v for k,v in fields.items())


def page(results=None, fixtures=None, total=None, div='E0'):
    c=CATALOG[div]
    def feed(kind, events):
        data='SA÷1¬~ZEE÷'+c['template']+'¬ZL÷'+c['path']+'¬ZAF÷'+c['country']+'¬~'+'¬~'.join(events)
        return "cjs.initialFeeds['"+kind+"'] = {data: `"+data+'`, allEventsCount: '+str(len(events) if total is None else total)+'};'
    return ('tournamentTemplateId: "'+c['template']+'"; <div class="heading__info">2026/2027</div>'+
        'cjs.initialFeeds["summary-fixtures"]={data:`DECOY`,allEventsCount:999};'+
        feed('results', [event()] if results is None else results)+
        feed('fixtures',[event('future01','2026-10-31T20:00:00+00:00','1','1',('',''))] if fixtures is None else fixtures)).encode()


def row(day='2026-10-01', goals=(2,1), home='Arsenal', away='Chelsea', clock='16:00'):
    return ['E0','England','Premier League',day,clock,home,away,*goals,None,None,None,None,{'HS':12}]


class SoccerwayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        for name,value in [('docs/data/history.json',[row()]),('docs/data/fixtures.json',[]),
            ('docs/data/status.json',{}),(sw.CATALOG,CATALOG),('ops/calendar_source.json',CONFIG)]:
            u.writejson(self.root/name,value)

    def read(self,path):
        return json.loads((self.root/path).read_text())

    def batch(self,raw=None,now=NOW):
        return sw.collect(self.root,now,download=lambda url:raw or page(),divisions=['E0'])

    def patch(self,batch,stamp=STAMP):
        return {'schema':1,'observed_at_utc':stamp,'plan':{'history':False,'full':False,
            'calendar':True,'quotes':False,'calendar_provider':'Soccerway'},'history':[],
            'observations':[],'checks':{},'errors':[],'calendar':None,'quotes':None,
            'soccerway':batch,'trigger':{'event':'schedule','run_id':'123','run_attempt':'1'}}

    def test_large_feeds_ignore_summary_and_use_club_not_lineup_ids(self):
        events=[event('f'+str(i).zfill(7),'2026-11-01T20:00:00+00:00','1','1',('','')) for i in range(20)]
        records,feeds=sw.parse(page(fixtures=events), 'E0', CATALOG['E0'], NOW)
        self.assertEqual(feeds['fixtures']['rows'],20)
        self.assertEqual(len(records),21)
        self.assertEqual(records[0]['club_ids'],['arsenal1','chelsea1'])
        self.assertEqual(records[0]['regulation'],[0,1])

    def test_wrong_competition_sport_season_or_unpublished_feed_is_rejected(self):
        raw=page()
        for bad in [raw.replace(b'dYlOSQOD',b'WRONG001'),raw.replace(b'/england/premier-league/',b'/england/premier-league-women/'),
            raw.replace(b'England',b'Scotland'),raw.replace(b'SA\xc3\xb71',b'SA\xc3\xb72'),raw.replace(b'2026/2027',b'2025/2026'),page([],[],total=5)]:
            with self.assertRaises(ValueError):sw.parse(bad,'E0',CATALOG['E0'],NOW)
        self.assertEqual(sw.parse(page([],[]),'E0',CATALOG['E0'],NOW)[0],[])

    def test_short_visible_payload_does_not_claim_uncovered_window(self):
        _,feeds=sw.parse(page(total=300),'E0',CATALOG['E0'],NOW)
        self.assertFalse(feeds['fixtures']['requested_window_covered'])
        self.assertFalse(feeds['results']['requested_window_covered'])

    def test_only_ordinary_ft_has_regulation_goals_no_inferred_stats(self):
        for state,stage in [('3','10'),('3','11'),('2','2'),('3','5')]:
            b=self.batch(page(results=[event(state=state,stage=stage)]))
            self.assertEqual(b['results'],[])
            self.assertEqual(b['records'][0]['match']['display_score'],[0,1])
        b=self.batch();r=b['results'][0]['row']
        self.assertEqual(r[7:13],[0,1,None,None,None,None])
        self.assertEqual(r[13]['SRC'],'Soccerway')

    def test_future_finals_unknown_clubs_and_unknown_clock_are_quarantined(self):
        for r,reason in [(event(clock='2026-10-30T17:00:00+00:00'),'unconfirmed_final_kickoff'),
            (event(home='Arsenall'),'unmatched_or_ambiguous_club'),(event(clock=None),'unconfirmed_kickoff')]:
            b=self.batch(page(results=[r],fixtures=[]))
            self.assertEqual(b['results'],[])
            self.assertEqual(b['quarantined'][0]['reason'],reason)

    def test_unix_kickoff_preserves_sofia_midnight_and_both_dst_folds(self):
        b=self.batch(page(fixtures=[event('future01','2026-10-30T23:30:00+00:00','1','1',('',''))]))
        self.assertEqual(b['rows'][0][3:5],['2026-10-31','01:30'])
        before=dt.datetime(2026,10,24,12,tzinfo=dt.timezone.utc)
        for hour in ('00:30','01:30'):
            instant='2026-10-25T'+hour+':00+00:00'
            b=self.batch(page(results=[],fixtures=[event('future01',instant,'1','1',('',''))]),before)
            self.assertEqual(b['rows'][0][4],'03:30')
            book=registry.empty();registry.observe(book,b['observations'],sync.iso(before))
            self.assertEqual(next(iter(book['matches'].values()))['kickoff_utc'],instant)

    def test_real_access_denial_stops_remaining_batch_without_retry(self):
        calls=[]
        def denied(url):
            calls.append(url);raise urllib.error.HTTPError(url,403,'Denied',{},None)
        b=sw.collect(self.root,NOW,download=denied)
        self.assertLessEqual(len(calls),2);self.assertEqual(len(b['errors']),27)
        self.assertEqual(b['records'],[])

    def test_archive_keeps_corrections_and_old_patches_cannot_regress_current(self):
        b=self.batch();records=b['records']
        provider_archive.persist(self.root,sw.ARCHIVE,records,STAMP)
        later=sync.iso(NOW+dt.timedelta(hours=1));corrected=copy.deepcopy(records)
        corrected[0]['match']['regulation']=[2,1]
        provider_archive.persist(self.root,sw.ARCHIVE,corrected,later)
        provider_archive.persist(self.root,sw.ARCHIVE,records,sync.iso(NOW-dt.timedelta(hours=1)))
        saved=self.read(sw.ARCHIVE+'/2026-10.json')['matches']['final001']
        self.assertEqual(saved['current']['regulation'],[2,1]);self.assertEqual(len(saved['observations']),2)
        self.assertEqual(provider_archive.check(self.root,sw.ARCHIVE)['matches'],2)
        (self.root/sw.ARCHIVE/'2026-10.json').unlink()
        with self.assertRaises(ValueError):provider_archive.persist(self.root,sw.ARCHIVE,records,later)

    def test_scores_keep_rich_rows_conflicts_and_unlisted_fixtures(self):
        old=row('2026-10-29',(2,1));rich=row('2026-10-28',(3,0))
        u.writejson(self.root/'docs/data/history.json',[old,rich])
        cached=row('2026-10-31',(None,None),clock='19:00');cached[11]=1.9
        unlisted=row('2026-11-04',(None,None),home='Chelsea',away='Arsenal')
        u.writejson(self.root/'docs/data/fixtures.json',[cached,unlisted])
        report=sync.apply(self.root,self.patch(self.batch()))
        self.assertEqual(report['conflicts_this_patch'],1)
        self.assertIn(old,self.read('docs/data/history.json'));self.assertIn(rich,self.read('docs/data/history.json'))
        fs=self.read('docs/data/fixtures.json');fresh=next(r for r in fs if r[3]=='2026-10-31')
        self.assertEqual(fresh[4],'22:00');self.assertEqual(fresh[11],1.9);self.assertIn(unlisted,fs)
        conflicts=self.read(sync.REGISTRY)['conflicts'].values()
        self.assertTrue(any(c['kind']=='soccerway_score_conflict' for c in conflicts))

    def test_own_clock_and_trigger_survive_publish_and_older_patch(self):
        b=self.patch(self.batch());sync.apply(self.root,b)
        s=self.read('docs/data/status.json');self.assertEqual(s['last_soccerway_data_success_utc'],STAMP)
        self.assertEqual(s['last_soccerway_data_success_trigger'],b['trigger'])
        old=self.patch(self.batch(),sync.iso(NOW-dt.timedelta(hours=1)));sync.apply(self.root,old)
        publish=self.patch(None,sync.iso(NOW+dt.timedelta(hours=1)));publish['plan']=sync.plan({},'publish',NOW)
        sync.apply(self.root,publish);s=self.read('docs/data/status.json')
        self.assertEqual(s['last_soccerway_data_success_utc'],STAMP)
        self.assertEqual(s['fixtures_updated_utc'],STAMP)
        self.assertEqual(s['calendar_provider'],'Soccerway')

    def test_planner_switches_both_calendar_and_results_without_secondary_requests(self):
        status={key:STAMP for key in ('last_full_history_success_utc','last_current_history_success_utc',
            'last_fixture_attempt_utc','last_history_attempt_utc','last_europe_attempt_utc','last_standings_attempt_utc','last_quote_attempt_utc')}
        status['quote_window']=sync.quote_window(NOW)
        work=sync.plan(status,'auto',NOW,CONFIG)
        self.assertTrue(work['soccerway']);self.assertFalse(work['results']);self.assertFalse(work.get('statarea',False))
        status['last_soccerway_attempt_utc']=STAMP
        self.assertFalse(sync.plan(status,'auto',NOW+dt.timedelta(minutes=20),CONFIG)['soccerway'])
        self.assertTrue(sync.plan(status,'auto',NOW+dt.timedelta(minutes=30),CONFIG)['soccerway'])
        with patch.object(sync.soccerway,'collect',side_effect=AssertionError('provider called')):
            self.assertIsNone(sync.collect(self.root,'publish',NOW)['soccerway'])
        with patch.object(sync.statarea,'collect',side_effect=AssertionError('old provider')),patch.object(sync,'calendars',side_effect=AssertionError('legacy calendar')):
            batch=sync.collect(self.root,'calendar',NOW,soccerway_download=lambda url:page())
        self.assertIsNotNone(batch['soccerway']);self.assertIsNone(batch['statarea'])

    def test_quote_csv_cannot_introduce_fixture_or_replace_primary_kickoff(self):
        b=self.patch(self.batch());csvrow=row('2026-10-31',(None,None),clock='16:00');csvrow[11]=1.85
        unrelated=row('2026-11-02',(None,None),home='Chelsea',away='Arsenal')
        b['quotes']={'rows':[csvrow,unrelated],'sha256':'b'*64};b['plan']['quote_window']='2026-10-30'
        sync.apply(self.root,b);fs=self.read('docs/data/fixtures.json')
        self.assertEqual(len(fs),1);self.assertEqual(fs[0][4],'22:00');self.assertEqual(fs[0][11],1.85)

    def test_cross_date_fixture_requires_explicit_reviewed_stable_id_bridge(self):
        old=row('2026-11-01',(None,None));old[13]='FixtureDownload / UTC→Europe-Sofia'
        u.writejson(self.root/'docs/data/fixtures.json',[old]);book=registry.empty()
        registry.observe(book,[{'row':old,'provider_id':'FixtureDownload:E0:2026:105','round':12}],STAMP)
        match=next(iter(book['matches'].values()));u.writejson(self.root/sync.REGISTRY,book)
        batch=self.batch();sync.apply(self.root,self.patch(batch))
        self.assertEqual(self.read('docs/data/status.json')['soccerway_quarantined'][0]['reason'],'unlinked_possible_reschedule')
        link={'division':'E0','season':'2026/27','soccerway_match_id':'future01','registry_id':match['id'],
            'existing_provider_id':'FixtureDownload:E0:2026:105','clubs':match['clubs'],'club_ids':['arsenal1','chelsea1'],
            'round':12,'old_key':registry.row_key(old),'source_url':sw.BASE+CATALOG['E0']['path']+'fixtures/',
            'source_sha256':'a'*64,'existing_source_sha256':'b'*64}
        u.writejson(self.root/sw.MATCH_LINKS,{'schema':1,'entries':[link]})
        sync.apply(self.root,self.patch(batch));book=self.read(sync.REGISTRY);joined=book['matches'][match['id']]
        self.assertIn('Soccerway:future01',joined['provider_ids'])
        self.assertEqual(joined['schedule'][3:5],['2026-10-31','22:00'])
        self.assertIn(registry.row_key(old),joined['legacy_keys'])
        self.assertEqual(self.read('docs/data/status.json')['soccerway_quarantined'],[])
        link['club_ids']=['changed1','chelsea1'];u.writejson(self.root/sw.MATCH_LINKS,{'schema':1,'entries':[link]})
        with self.assertRaises(ValueError):sync.apply(self.root,self.patch(batch))

    def test_uefa_scores_stay_in_evidence_and_out_of_domestic_history(self):
        known=row();known[:3]=['UCL','Europe','UEFA Champions League']
        u.writejson(self.root/'docs/data/europe_history.json',[known])
        raw=page(div='UCL');b=sw.collect(self.root,NOW,download=lambda url:raw,divisions=['UCL'])
        self.assertTrue(b['records']);self.assertEqual(b['results'],[])
        self.assertEqual(len(b['observations']),2);self.assertEqual(b['quarantined'],[])

    def test_reviewed_alias_needs_exact_archived_scores_and_same_scoped_club_id(self):
        rows=[row('2026-10-01'),row('2026-10-08',away='Liverpool'),row('2026-10-15')]
        u.writejson(self.root/'docs/data/history.json',rows)
        e={'division':'E0','source_name':'The Gunners','target':'Arsenal','club_id':'arsenal1',
            'evidence':[{'provider_match_id':'proof00'+str(i+1),'date':r[3],'home':r[5],'away':r[6],
                'regulation':r[7:9],'opponent_key':u.club_key(r[6]),'source_url':sw.BASE+'/england/premier-league/fixtures/',
                'source_sha256':'a'*64} for i,r in enumerate(rows)]}
        u.writejson(self.root/sw.CROSSWALK,{'schema':1,'entries':[e]})
        names=sw.Names(self.root,rows,[])
        self.assertEqual(names.club('E0','The Gunners','arsenal1'),'Arsenal')
        self.assertIsNone(names.club('E0','The Gunners','changed1'))
        self.assertIsNone(names.club('D1','The Gunners','arsenal1'))
        e['evidence'][0]['regulation']=[9,9];u.writejson(self.root/sw.CROSSWALK,{'schema':1,'entries':[e]})
        with self.assertRaises(ValueError):sw.Names(self.root,rows,[])

