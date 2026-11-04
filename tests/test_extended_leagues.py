import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import extended_leagues as e
from scripts import update as u
from scripts import match_registry as registry

ROOT=Path(__file__).resolve().parents[1]
NOW=dt.datetime(2026,11,4,9,0,tzinfo=dt.timezone.utc)


def event(identity='Game0001',home='Club0001',away='Club0002',stamp=None,state='3',stage='3',score=(2,1)):
    stamp=stamp or int(dt.datetime(2026,11,2,23,0,tzinfo=dt.timezone.utc).timestamp())
    return {'AA':identity,'PX':home,'PY':away,'AE':'Alpha','AF':'Beta','AD':str(stamp),'AB':state,'AC':stage,'AG':str(score[0]),'AH':str(score[1]),'ER':'Round 20'}


def page(c,events,fixtures=(),season='2026',phase=None):
    def payload(rows):
        context={'SA':'1','ZEE':c['template'],'ZL':c['path'],'ZAF':c['country'],'ZA':phase or c['phase_labels'][0]}
        return '¬'.join(k+'÷'+v for k,v in context.items())+'¬~'+'¬~'.join('¬'.join(k+'÷'+v for k,v in r.items()) for r in rows)
    return ('tournamentTemplateId: "'+c['template']+'"<div class="heading__info">'+season+'</div>'+''.join('cjs.initialFeeds["'+kind+'"] = { data: `'+payload(rows)+'`, allEventsCount: '+str(len(rows))+'};' for kind,rows in [('results',events),('fixtures',fixtures)])).encode()


class SupplementalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.cfg=json.loads((ROOT/e.CATALOG).read_text());self.c=self.cfg['leagues']['BRA'];self.source={'url':e.primary.BASE+self.c['path']+'fixtures/','sha256':'a'*64}
        u.writejson(self.root/e.CATALOG,self.cfg)
        self.clubs=[{'division':'BRA','club_id':identity,'target':name,'source_names':[name],'evidence':[{'provider_match_id':'Game0001','opponent_id':opponent,'source_url':self.source['url'],'source_sha256':'a'*64}]} for identity,name,opponent in [('Club0001','Alpha','Club0002'),('Club0002','Beta','Club0001')]]
        u.writejson(self.root/e.CLUBS,{'schema':1,'entries':self.clubs});u.writejson(self.root/e.CSV_CLUBS,{'schema':1,'entries':[]})
        self.primary_history=['E0','England','Premier League','2026-10-31','15:00','Primary A','Primary B',1,0,None,None,None,None]
        self.primary_fixture=['E0','England','Premier League','2026-11-05','15:00','Primary A','Primary B',None,None,None,None,None,None,'Soccerway / UTC→Europe-Sofia']
        u.writejson(self.root/'docs/data/history.json',[self.primary_history]);u.writejson(self.root/'docs/data/fixtures.json',[self.primary_fixture])
        self.status={'fixtures_updated_utc':'2026-11-04T08:44:07+00:00','last_fixture_attempt_utc':'2026-11-04T08:44:07+00:00','last_soccerway_success_utc':'2026-11-04T08:44:07+00:00','soccerway_sources_total':27,'secondary_fixture_counts':{'E0':1},'stale_secondary_leagues':[],'fixtures_feed_status':'ok'}
        u.writejson(self.root/'docs/data/status.json',self.status)

    def batch(self,rows=None,fixtures=()):
        records,feeds=e.parse(page(self.c,rows or [event()],fixtures), 'BRA',self.c,NOW)
        return {'schema':1,'observed_at_utc':e.iso(NOW),'records':[{'match':r,'source':self.source} for r in records], 'csv_rows':{},'errors':[], 'checks':{'BRA':{'status':'ok','window_covered':True,'feeds':feeds}}}

    def test_public_epochs_define_sofia_date_and_only_ordinary_regulation_enters_history(self):
        rows=[event(),event('Game0002',state='3',stage='37',score=(3,3))]
        projected=e.project(self.root,self.batch(rows),NOW)
        self.assertEqual(len(projected['history']),1);self.assertEqual(projected['history'][0][3:5],['2026-11-03','01:00'])
        self.assertEqual(projected['history'][0][7:9],[2,1]);self.assertEqual(projected['history'][0][9:13],[None]*4)
        self.assertNotIn('HS',projected['history'][0][13])

    def test_wrong_template_season_country_duplicate_id_and_nonliteral_feed_are_rejected(self):
        raw=page(self.c,[event()])
        for changed in [raw.replace(self.c['template'].encode(),b'Wrong000'),raw.replace(b'heading__info">2026',b'heading__info">2025'),raw.replace(b'ZAF\xc3\xb7Brazil',b'ZAF\xc3\xb7Wrong'),page(self.c,[event(),event()]),raw.replace(b'SA\xc3\xb71',b'${payload}')]:
            with self.subTest(prefix=changed[:30]), self.assertRaises(ValueError):e.parse(changed,'BRA',self.c,NOW)

    def test_unapproved_phase_and_changed_club_label_never_enter_training(self):
        batch=self.batch();batch['records'][0]['match']['phase']='BRAZIL: Cup Final'
        self.assertEqual(e.project(self.root,batch,NOW)['history'],[])
        batch=self.batch();batch['records'][0]['match']['home']='Another club'
        self.assertEqual(e.project(self.root,batch,NOW)['history'],[])

    def test_recent_or_future_final_is_not_a_completed_model_input(self):
        batch=self.batch([event(stamp=int((NOW-dt.timedelta(minutes=45)).timestamp()))])
        self.assertEqual(e.project(self.root,batch,NOW)['history'],[])
        batch=self.batch([event(stamp=int((NOW+dt.timedelta(days=1)).timestamp()))])
        self.assertEqual(e.project(self.root,batch,NOW)['history'],[])

    def test_missing_csv_statistics_remain_missing_and_other_argentine_competition_is_excluded(self):
        raw=b'Country,League,Date,Home,Away,HG,AG\nBrazil,Serie A,02/11/2026,Alpha,Beta,2,1\n'
        rows=e.parse_csv(raw,'BRA',self.c,NOW);self.assertEqual(rows[0]['stats'],{})
        c=self.cfg['leagues']['ARG']
        raw=b'Country,League,Date,Home,Away,HG,AG\nArgentina,Copa De La Liga Profesional,02/11/2026,Alpha,Beta,2,1\nArgentina,Liga Profesional,01/11/2026,Alpha,Beta,0,0\n'
        self.assertEqual(len(e.parse_csv(raw,'ARG',c,NOW)),1)

    def test_csv_enrichment_requires_two_exact_approved_clubs_and_matching_regulation_score(self):
        batch=self.batch();batch['csv_rows']['BRA']=[{'date':'2026-11-02','home':'Alpha CSV','away':'Beta CSV','score':[2,1],'stats':{'HS':14,'AS':9}}]
        batch['checks']['BRA']['csv']={'url':'https://www.football-data.co.uk/new/BRA.csv','sha256':'b'*64}
        names,_=e.crosswalk(self.root,self.cfg['leagues'])
        with patch.object(e,'crosswalk',return_value=(names,{('BRA','Club0001'):'Alpha CSV',('BRA','Club0002'):'Beta CSV'})):
            final=e.project(self.root,batch,NOW)['history'][0]
            self.assertEqual(final[13]['HS'],14);self.assertEqual(final[13]['CSV_DATE'],'2026-11-02')
            batch['csv_rows']['BRA'][0]['score']=[3,3]
            projected=e.project(self.root,batch,NOW);self.assertEqual(projected['history'],[]);self.assertEqual(projected['quarantined'][0]['reason'],'ambiguous_or_conflicting_csv_score')
        self.assertNotIn('HS',e.project(self.root,batch,NOW)['history'][0][13],'Unapproved CSV labels must not attach statistics')

    def test_apply_is_idempotent_and_preserves_primary_rows_and_all_primary_clocks(self):
        future=event('Game0002',stamp=int((NOW+dt.timedelta(days=1)).timestamp()),state='1',stage='1')
        batch=self.batch(fixtures=[future]);report=e.apply(self.root,batch,NOW)
        self.assertEqual(report['history_added'],1)
        history=read_json(self.root,'docs/data/history.json');fixtures=read_json(self.root,'docs/data/fixtures.json');status=read_json(self.root,'docs/data/status.json')
        self.assertIn(self.primary_history,history);self.assertIn(self.primary_fixture,fixtures)
        for key in ('fixtures_updated_utc','last_fixture_attempt_utc','last_soccerway_success_utc','soccerway_sources_total','fixtures_feed_status'):self.assertEqual(status[key],self.status[key])
        self.assertIn('BRA',status['secondary_fixture_counts']);self.assertEqual(e.apply(self.root,batch,NOW)['history_added'],0)
        self.assertEqual(read_json(self.root,'docs/data/history.json'),history)
        bra=[m for m in read_json(self.root,'data/match_registry.json')['matches'].values() if m['division']=='BRA'];self.assertTrue(all(m['season']=='2026' for m in bra))

    def test_score_conflicts_keep_the_published_score(self):
        batch=self.batch();e.apply(self.root,batch,NOW);batch['records'][0]['match']['regulation']=[0,0]
        result=e.apply(self.root,batch,NOW);self.assertEqual(len(result['conflicts']),1)
        self.assertEqual([r[7:9] for r in read_json(self.root,'docs/data/history.json') if r[0]=='BRA'],[[2,1]])

    def test_cross_country_keys_and_two_source_ids_for_one_club_are_rejected(self):
        old=copy.deepcopy(self.primary_history);old[5]='Alpha';u.writejson(self.root/'docs/data/history.json',[old])
        with self.assertRaisesRegex(ValueError,'Cross-country'):e.crosswalk(self.root,self.cfg['leagues'])
        u.writejson(self.root/'docs/data/history.json',[]);self.clubs[1]['target']='Alpha';u.writejson(self.root/e.CLUBS,{'entries':self.clubs})
        with self.assertRaisesRegex(ValueError,'Ambiguous'):e.crosswalk(self.root,self.cfg['leagues'])

    def test_receipt_gate_does_no_network_work_and_ordinary_push_is_not_a_request(self):
        with patch('urllib.request.urlopen',side_effect=AssertionError('Provider called by planner')):
            self.assertTrue(e.due(self.root,NOW));status={**self.status,'supplemental_leagues':{'last_attempt_utc':e.iso(NOW)}};u.writejson(self.root/'docs/data/status.json',status)
            self.assertFalse(e.due(self.root,NOW+dt.timedelta(minutes=30)));self.assertTrue(e.due(self.root,NOW+dt.timedelta(hours=2)))
            self.assertFalse(e.requested(self.root,'pull_request'));self.assertFalse(e.requested(self.root,'push'))

    def test_blocked_source_stops_bounded_collection_without_retry_or_fallback(self):
        attempts=[]
        def blocked(url):
            attempts.append(url)
            raise e.urllib.error.HTTPError(url,403,'Forbidden',{},None)
        batch=e.collect(self.root,NOW,download_html=blocked,download_csv=lambda url:self.fail('CSV request after source circuit stop'))
        self.assertLessEqual(len(attempts),2)
        self.assertEqual(batch['records'],[])
        self.assertTrue(all(check['status']=='error' for check in batch['checks'].values()))

    def test_processed_operational_request_cannot_be_applied_twice(self):
        batch=self.batch();batch['trigger']={'event':'push','request_id':'unique-test'}
        self.assertEqual(e.apply(self.root,batch,NOW)['history_added'],1)
        self.assertEqual(e.apply(self.root,batch,NOW)['skipped'],'supplemental request already processed')

    def test_supplemental_workflow_reuses_publication_lock_and_introduces_no_timer(self):
        workflow=(ROOT/'.github/workflows/supplemental-leagues.yml').read_text()
        self.assertNotIn('schedule:',workflow);self.assertNotIn('cron:',workflow);self.assertIn('group: matchpulse-pages',workflow)
        self.assertIn('workflow_run:',workflow);self.assertIn("workflow_run.event == 'schedule'",workflow)
        self.assertIn('--base-ref origin/main',workflow);self.assertIn('git reset --hard origin/main',workflow)
        self.assertTrue(e.check(ROOT)['primary_catalog']==27)


def read_json(root,name):return json.loads((root/name).read_text())

if __name__=='__main__':unittest.main()
