import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from scripts import data_sync as sync
from scripts import market_archive as markets
from scripts import match_registry as registry
from scripts import update as u

STAMP='2026-10-27T12:00:00+00:00'
ROW=['E0','England','Premier League','2026-10-30','18:00','Arsenal','Chelsea',None,None,None,None,None,None,'ESPN / UTC→Europe-Sofia']


class MarketArchiveTests(unittest.TestCase):
    def sample(self, values=None, kind='historical_csv'):
        raw=values or {'B365H':'1.8','AvgD':'3.5','B365CH':'1.75','B365>2.5':'1.9','B365C>2.5':'1.85',
                      'AHh':'-0.25','B365AHH':'1.95','AHCh':'-0.5','B365CAHH':'2.05'}
        return markets.observation(raw,ROW,markets.market_columns(raw),'https://www.football-data.co.uk/fixtures.csv','a'*64,kind,registry.row_key(ROW))[0]

    def test_opening_closing_and_handicap_lines_keep_distinct_source_names(self):
        observation=self.sample();values=dict(zip(observation['columns'],observation['values']))
        self.assertEqual(values['B365H'],1.8);self.assertEqual(values['B365CH'],1.75)
        self.assertEqual(values['AHh'],-0.25);self.assertEqual(values['AHCh'],-0.5)
        self.assertEqual(values['B365C>2.5'],1.85)
        self.assertEqual(markets.market_columns(['HS','FTHG','Referee','Bb1X2','BB','BFECH','SKBCA','BFDH']),['BFDH','BFECH','SKBCA'])

    def test_missing_invalid_and_non_quarter_lines_never_become_zero(self):
        columns=['AHh','AvgH','B365H','B365CH','MaxH']
        values,invalid=markets.extract({'AHh':'0.1','AvgH':'','B365H':'NaN','B365CH':'Infinity','MaxH':'2.1'},columns)
        self.assertEqual(values,[None,None,None,None,2.1]);self.assertEqual(invalid,['AHh','B365H','B365CH'])
        self.assertEqual(markets.extract({'AHh':'0'},['AHh']),(None,[]))
        self.assertIsNone(markets.extract({'B365H':'0'},['B365H'])[0])

    def test_repeated_prices_deduplicate_and_a_change_appends_an_observation(self):
        shard=markets.empty('E0','2026-27');one=self.sample();copy_before=copy.deepcopy(one)
        self.assertEqual(markets.merge(shard,[one],STAMP),1)
        self.assertEqual(markets.merge(shard,[one],'2026-10-28T12:00:00+00:00'),0)
        two=self.sample({'B365H':'1.7'});self.assertEqual(markets.merge(shard,[two],STAMP),1)
        entries=shard['matches'][registry.row_key(ROW)];self.assertEqual(len(entries),2)
        self.assertEqual(one,copy_before);self.assertEqual(next(iter(entries.values()))['observed_at_utc'],STAMP)
        self.assertEqual(markets.merge(shard,[self.sample(kind='fixture_csv')],STAMP),1)

    def test_historical_prices_never_count_as_prospective_future_quotes(self):
        shard=markets.empty('E0','2026-27');markets.merge(shard,[self.sample()],STAMP)
        self.assertEqual(markets.summary([shard],[ROW],registry.row_key,STAMP)['future_matches_with_saved_quotes'],0)
        markets.merge(shard,[self.sample(kind='fixture_csv')],STAMP)
        self.assertEqual(markets.summary([shard],[ROW],registry.row_key,STAMP)['future_matches_with_saved_quotes'],1)
        moved=list(ROW);moved[3]='2026-11-03'
        self.assertEqual(markets.summary([shard],[moved],registry.row_key,STAMP)['future_matches_with_saved_quotes'],0)

    def test_shards_validate_and_reject_traversal_or_corrupt_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);sample=self.sample()
            markets.apply(root,[sample],[ROW],registry.row_key,STAMP,u.readjson,u.writejson)
            self.assertTrue((root/'data/markets/E0/2026-27.json').exists())
            bad=copy.deepcopy(sample);bad['division']='../E0'
            with self.assertRaises(ValueError):markets.apply(root,[bad],[],registry.row_key,STAMP,u.readjson,u.writejson)
            bad=copy.deepcopy(sample);bad['values'][bad['columns'].index('B365H')]=0
            with self.assertRaises(ValueError):markets.merge(markets.empty('E0','2026-27'),[bad],STAMP)

    def test_annual_leagues_have_calendar_seasons(self):
        row=list(ROW);row[0]='NOR';item,_=markets.observation({'AvgH':'2'},row,['AvgH'],'source','b'*64,'historical_csv',registry.row_key(row))
        self.assertEqual(item['season'],'2026')

    def test_successful_but_empty_quote_csv_is_retried_after_the_window(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);u.writejson(root/'docs/data/history.json',[]);u.writejson(root/'docs/data/fixtures.json',[ROW])
            previous='2026-10-23';u.writejson(root/'docs/data/status.json',{'quote_window':previous})
            patch={'schema':1,'observed_at_utc':'2026-10-27T14:00:00+00:00',
                   'plan':{'history':False,'quotes':True,'calendar':False,'quote_window':'2026-10-27'},
                   'history':[],'checks':{},'errors':[],'observations':[],'calendar':None,
                   'quotes':{'rows':[],'sha256':'a'*64,'market_rows':0}}
            sync.apply(root,patch);status=u.readjson(root/'docs/data/status.json',{})
            self.assertEqual(status['quote_window'],previous);self.assertEqual(status['quote_check_status'],'empty_for_upcoming')
            self.assertTrue(sync.plan(status,'auto',dt.datetime.fromisoformat('2026-10-27T17:00:00+00:00'))['quotes'])
            self.assertFalse(sync.plan(status,'auto',dt.datetime.fromisoformat('2026-10-27T15:00:00+00:00'))['quotes'])
            patch['observed_at_utc']='2026-10-27T17:00:00+00:00';priced=list(ROW);priced[11]=1.9
            patch['quotes']['rows']=[priced];sync.apply(root,patch);status=u.readjson(root/'docs/data/status.json',{})
            self.assertEqual(status['quote_window'],'2026-10-27');self.assertEqual(status['quote_check_status'],'ok')

    def test_corrupt_archive_blocks_apply_and_keeps_its_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);sample=self.sample();path=root/'data/markets/E0/2026-27.json'
            path.parent.mkdir(parents=True);path.write_text('{broken')
            with self.assertRaises(ValueError):markets.apply(root,[sample],[],registry.row_key,STAMP,u.readjson,u.writejson)
            self.assertEqual(path.read_text(),'{broken')

    def test_fixtures_mode_updates_calendars_and_quotes_without_historical_downloads(self):
        plan=sync.plan({},'fixtures',dt.datetime.fromisoformat(STAMP))
        self.assertFalse(plan['history']);self.assertFalse(plan['full'])
        self.assertTrue(plan['calendar']);self.assertTrue(plan['quotes']);self.assertEqual(plan['history_targets'],0)

    def test_rebased_patch_keeps_original_observation_time_and_current_report_time(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);later='2026-10-28T12:00:00+00:00'
            markets.apply(root,[self.sample()],[],registry.row_key,STAMP,u.readjson,u.writejson,checked_stamp=later)
            shard=json.loads((root/'data/markets/E0/2026-27.json').read_text())
            saved=next(iter(next(iter(shard['matches'].values())).values()))
            self.assertEqual(saved['observed_at_utc'],STAMP)
            self.assertEqual(json.loads((root/markets.SUMMARY).read_text())['checked_utc'],later)
