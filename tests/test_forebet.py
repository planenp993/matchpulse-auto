import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

from scripts import data_sync as sync, forebet as fb, match_registry as registry, statarea as sta, update as u

NOW = dt.datetime(2026, 10, 30, 12, tzinfo=dt.timezone.utc)
STAMP = sync.iso(NOW)
CONFIG = {'schema':1,'provider':'Statarea','interval_minutes':30,
          'secondary':{'provider':'Forebet','interval_minutes':120,'daily_past_days':7,'future_days':7}}


def payload(day='2026-10-31', clock='18:30:00', status=None, score=(None,None), identity='123',
            home='Arsenal', away='Chelsea', league=('England','Premier League'), extra=None):
    row = {'id':identity,'host_id':'11','guest_id':'22','league_id':'1',
           'HOST_NAME':home,'GUEST_NAME':away,'DATE_BAH':day+' '+clock,'DATE':day,
           'Host_SC':score[0],'Guest_SC':score[1],'comment':status,'extra_time_score':extra,
           'penalty_score':None,'host_sc_pr':'9','guest_sc_pr':'8','Pred_1':99,'best_odd':1.01}
    return json.dumps([[row],{'1':[*league,'fixture-league']}]).encode()


def row(day='2026-10-01', goals=(0,0), clock='19:30'):
    return ['E0','England','Premier League',day,clock,'Arsenal','Chelsea',
            *goals,None,None,None,None,{'HS':12} if goals[0] is not None else 'Statarea / UTC→Europe-Sofia']


class ForebetTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        for path,value in [('docs/data/history.json',[row()]),('docs/data/fixtures.json',[]),
                           ('docs/data/status.json',{}),(sta.CONFIG,CONFIG)]:u.writejson(self.root/path,value)

    def batch(self, raw=None, now=NOW):
        raw=raw or payload();records,_=fb.parse(raw,'2026-10-31')
        result={'provider':'Forebet','wide':False,'initial':False,
            'days':{d:{'status':'ok'} for d in fb.dates(now)},'errors':[],
            'records':[{'match':r,'source':{'url':fb.listing_url('2026-10-31'),'sha256':hashlib.sha256(raw).hexdigest()}} for r in records]}
        return fb.project(result,fb.Names(self.root,[row()],[]),now)

    def operation(self,batch,stamp=STAMP,primary=None):
        return {'schema':1,'observed_at_utc':stamp,'plan':{'history':False,'full':False,'calendar':True,
            'quotes':False,'calendar_provider':'Statarea'},'history':[],'checks':{},'errors':[],
            'observations':[],'calendar':None,'quotes':None,'statarea':primary,'forebet':batch,
            'trigger':{'event':'workflow_dispatch','run_id':'test','run_attempt':'1'}}

    def read(self,path):return json.loads((self.root/path).read_text())

    def test_schema_exact_country_competition_and_real_scores_are_separate_from_predictions(self):
        records,n=fb.parse(payload(),'2026-10-31');self.assertEqual(n,1)
        self.assertIsNone(records[0]['regulation']);self.assertNotIn('Pred_1',records[0])
        self.assertNotIn('best_odd',records[0]);self.assertEqual(records[0]['score_display'],[None,None])
        for league in [('Scotland','Championship'),('England','Premier League Women'),('England','Premier League U21')]:
            self.assertFalse(fb.parse(payload(league=league),'2026-10-31')[0])
        for raw in [b'{}',b'[]',b'[[],{}]',b'<html>blocked</html>']:
            with self.assertRaises((ValueError,UnicodeError)):fb.parse(raw,'2026-10-31')
        j=json.loads(payload());j[0].append(j[0][0]);
        with self.assertRaises(ValueError):fb.parse(json.dumps(j).encode(),'2026-10-31')
        j=json.loads(payload());unknown={**j[0][0],'id':'999','league_id':'339'};j[0].append(unknown)
        self.assertEqual(len(fb.parse(json.dumps(j).encode(),'2026-10-31')[0]),1)

    def test_source_clock_selects_actual_utc_day_and_sofia_dst_is_not_a_fixed_offset(self):
        records,_=fb.parse(payload(day='2026-10-31',clock='00:30:00'),'2026-10-30')
        self.assertEqual(records[0]['kickoff_utc'],'2026-10-30T23:30:00+00:00')
        for day,clock,expected in [('2026-07-01','18:30:00','20:30'),('2026-10-31','18:30:00','19:30')]:
            records,_=fb.parse(payload(day=day,clock=clock),day)
            b=fb.project({'records':[{'match':records[0]}]},fb.Names(self.root,[row()],[]),NOW)
            self.assertEqual(b['observations'][0]['row'][4],expected)
        for clock,instant in [('01:30:00','2026-10-25T00:30:00+00:00'),('02:30:00','2026-10-25T01:30:00+00:00')]:
            records,_=fb.parse(payload(day='2026-10-25',clock=clock),'2026-10-25')
            self.assertEqual(records[0]['kickoff_utc'],instant)
            b=fb.project({'records':[{'match':records[0]}]},fb.Names(self.root,[row()],[]),NOW)
            self.assertEqual(b['observations'][0]['row'][4],'03:30')

    def test_only_explicit_regulation_finals_accept_observed_zero_and_extra_time_is_excluded(self):
        for status,extra,valid in [('FT',None,True),('AET',None,False),('Pen.',None,False),('FT','1-0',False),('Awarded',None,False),('90',None,False)]:
            records,_=fb.parse(payload(status=status,score=('0','0'),extra=extra),'2026-10-31')
            self.assertEqual(records[0]['regulation'],[0,0] if valid else None)
        raw=payload(status='FT',score=('1','0'));b=self.batch(raw)
        self.assertFalse(b['results']);self.assertEqual(b['quarantined'][0]['reason'],'unconfirmed_final_kickoff')

    def test_unreviewed_identity_is_retained_but_cannot_create_a_fixture_or_result(self):
        b=self.batch(payload(home='Arsenall'));self.assertFalse(b['rows']);self.assertEqual(len(b['records']),1)
        self.assertEqual(b['quarantined'][0]['reason'],'unmatched_or_ambiguous_club')
        with self.assertRaises(ValueError):fb.validate_name({'evidence':[]},self.root)

    def test_collector_is_bounded_and_stops_after_access_denial_without_a_fallback(self):
        calls=[]
        def blocked(url):
            calls.append(url);raise urllib.error.HTTPError(url,403,'denied',{},None)
        b=fb.collect(self.root,NOW,download=blocked)
        self.assertLessEqual(len(calls),2);self.assertFalse(b['records']);self.assertEqual(len(b['errors']),len(fb.dates(NOW)))
        self.assertTrue(all('Forebet'==b['provider'] for _ in [0]))

    def test_archive_deduplicates_retains_corrections_and_rejects_corrupt_shards(self):
        b=self.batch();fb.persist(self.root,b,STAMP);fb.persist(self.root,b,STAMP)
        self.assertEqual(fb.check(self.root)['forebet_matches'],1)
        changed=copy.deepcopy(b);changed['records'][0]['match']['status']='Postp.'
        later=sync.iso(NOW+dt.timedelta(hours=1));fb.persist(self.root,changed,later);fb.persist(self.root,b,STAMP)
        shard=self.read(fb.ARCHIVE+'/2026-10.json');saved=shard['matches']['123']
        self.assertEqual(saved['current']['status'],'Postp.');self.assertEqual(len(saved['observations']),2)
        (self.root/fb.ARCHIVE/'2026-10.json').write_text('{}')
        with self.assertRaises(ValueError):fb.persist(self.root,b,later)

    def test_secondary_fills_missing_calendar_even_when_primary_fails_and_old_rows_survive(self):
        b=self.batch();primary={'records':[],'observations':[],'rows':[],'results':[],
            'quarantined':[],'errors':['primary unavailable'],'wide':False,
            'days':{d:{'status':'error'} for d in fb.dates(NOW)}}
        sync.apply(self.root,self.operation(b,primary=primary))
        self.assertEqual(len(self.read('docs/data/fixtures.json')),1)
        s=self.read('docs/data/status.json');self.assertEqual(s['fixtures_feed_status'],'ok_secondary')
        self.assertEqual(s['statarea_refresh_status'],'error');self.assertEqual(s['forebet_refresh_status'],'ok')
        self.assertEqual(s['last_forebet_success_trigger']['run_id'],'test')
        failed=copy.deepcopy(b);failed.update(records=[],observations=[],rows=[],results=[],errors=['secondary unavailable'],days={d:{'status':'error'} for d in fb.dates(NOW)})
        sync.apply(self.root,self.operation(failed,sync.iso(NOW+dt.timedelta(hours=3)),primary))
        self.assertEqual(len(self.read('docs/data/fixtures.json')),1)
        self.assertEqual(self.read('docs/data/status.json')['last_forebet_success_utc'],STAMP)

    def test_same_fixture_is_confirmed_once_and_source_clock_disagreement_is_quarantined(self):
        primary=row('2026-10-31',(None,None));u.writejson(self.root/'docs/data/fixtures.json',[primary])
        book=registry.empty();registry.observe(book,[{'row':primary,'provider_id':'Statarea:555','kickoff_utc':'2026-10-31T17:30:00+00:00'}],STAMP)
        u.writejson(self.root/'data/match_registry.json',book)
        sync.apply(self.root,self.operation(self.batch()))
        fixtures=self.read('docs/data/fixtures.json');self.assertEqual(len(fixtures),1)
        self.assertIn('Statarea + Forebet',fixtures[0][13])
        book=self.read('data/match_registry.json');m=next(iter(book['matches'].values()))
        self.assertEqual(set(m['provider_ids']),{'Statarea:555','Forebet:123'})
        wrong=self.batch(payload(clock='19:30:00'))
        sync.apply(self.root,self.operation(wrong,sync.iso(NOW+dt.timedelta(minutes=30))))
        self.assertEqual(self.read('docs/data/fixtures.json')[0][4],'19:30')
        self.assertTrue(self.read('docs/data/status.json')['forebet_quarantined'])

    def test_different_score_never_replaces_published_result_or_richer_statistics(self):
        b=self.batch();o=b['observations'][0];finished=[*o['row'][:7],2,1,None,None,None,None,{'HS':12,'SRC':'Football-Data'}]
        history={u.key(finished):finished};book=registry.empty()
        b['results']=[{**o,'row':[*finished[:7],0,0,None,None,None,None,{'SRC':'Forebet'}]}]
        changed,conflicts=fb.apply_results(b,history,book)
        self.assertEqual(conflicts,1);self.assertFalse(changed);self.assertEqual(history[u.key(finished)],finished)
        self.assertEqual(next(iter(book['conflicts'].values()))['kind'],'forebet_score_conflict')

    def test_older_patch_cannot_renew_receipts_or_replace_newer_calendar(self):
        sync.apply(self.root,self.operation(self.batch()))
        later=sync.iso(NOW+dt.timedelta(hours=1));new=self.batch(payload(clock='20:30:00'))
        sync.apply(self.root,self.operation(new,later));sync.apply(self.root,self.operation(self.batch()))
        s=self.read('docs/data/status.json');self.assertEqual(s['last_forebet_attempt_utc'],later)
        self.assertEqual(self.read('docs/data/fixtures.json')[0][4],'21:30')

    def test_secondary_planner_has_independent_gate_and_publish_makes_no_requests(self):
        status={'last_forebet_attempt_utc':STAMP,'last_forebet_wide_attempt_utc':STAMP}
        self.assertFalse(sync.plan(status,'auto',NOW,CONFIG)['forebet'])
        self.assertTrue(sync.plan(status,'auto',NOW+dt.timedelta(hours=2),CONFIG)['forebet'])
        with patch.object(sync.forebet,'fetch',side_effect=AssertionError('provider called')):
            p=sync.collect(self.root,'publish',NOW)
            self.assertIsNone(p['forebet'])

    def test_missing_primary_fixture_requests_help_after_cooldown_even_when_pages_succeed(self):
        fixture=row('2026-10-31',(None,None));u.writejson(self.root/'docs/data/fixtures.json',[fixture])
        primary={'observations':[],'results':[],'quarantined':[],'errors':[]}
        self.assertTrue(fb.needs_help(self.root,primary,NOW))
        self.assertFalse(fb.needs_help(self.root,{**primary,'observations':[{'row':fixture}]},NOW))
        status={field:STAMP for field in ('last_full_history_success_utc','last_current_history_success_utc',
            'last_history_attempt_utc','last_results_attempt_utc','last_europe_attempt_utc',
            'last_standings_attempt_utc','last_statarea_wide_attempt_utc','last_forebet_wide_attempt_utc')}
        status.update(quote_window=sync.quote_window(NOW),statarea_wide_status='ok',
            last_fixture_attempt_utc=sync.iso(NOW-dt.timedelta(minutes=35)),
            last_statarea_attempt_utc=sync.iso(NOW-dt.timedelta(minutes=35)))
        for minutes,called in [(20,False),(30,True)]:
            status['last_forebet_attempt_utc']=sync.iso(NOW-dt.timedelta(minutes=minutes))
            u.writejson(self.root/'docs/data/status.json',status)
            with patch.object(sync.statarea,'collect',return_value=primary), patch.object(sync.forebet,'collect',return_value=self.batch()) as second:
                p=sync.collect(self.root,'auto',NOW)
                self.assertEqual(second.called,called)
                self.assertEqual(p['forebet'] is not None,called)

    def test_name_proof_rechecks_real_dates_scores_and_distinct_opponents(self):
        history={('E0',day,'arsenal',opponent):[2,1] for day,opponent in
                 [('2026-10-01','chelsea'),('2026-10-02','everton'),('2026-10-03','chelsea')]}
        evidence=[{'provider_match_id':str(i),'date':key[1],'home':'Arsenal','away':key[3],
            'regulation':[2,1],'opponent_key':key[3],'source_url':fb.BASE+'/en/football/matches/proof-9',
            'source_sha256':'a'*64,'match_url':fb.BASE+'/en/football/matches/proof-'+str(i)}
            for i,key in enumerate(history,1)]
        entry={'division':'E0','source_name':'Arsenal FC','target':'Arsenal','evidence':evidence}
        fb.validate_name(entry,self.root,history)
        bad=copy.deepcopy(entry);bad['evidence'][0]['regulation']=[1,2]
        with self.assertRaises(ValueError):fb.validate_name(bad,self.root,history)
        bad=copy.deepcopy(entry);bad['evidence'][1]=bad['evidence'][0]
        with self.assertRaises(ValueError):fb.validate_name(bad,self.root,history)
