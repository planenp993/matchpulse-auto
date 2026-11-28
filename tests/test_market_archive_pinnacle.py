"""Regression checks for Pinnacle's exact source column names."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from scripts import market_archive as markets
from scripts import match_registry as registry

ROW=['E0','England','Premier League','2025-08-15','20:00','Liverpool','Bournemouth',4,2,None,None,None,None]
RAW={'P>2.5':'1.61','P<2.5':'2.42','PC>2.5':'1.66','PC<2.5':'2.30',
     'PAHH':'1.95','PAHA':'1.91','PCAHH':'1.93','PCAHA':'1.93','PSH':'1.40',
     'B365>2.5':'1.62','B365<2.5':'2.35','PUnrelated':'7','HS':'10'}
URL='https://www.football-data.co.uk/mmz4281/2526/E0.csv'
SHA='a'*64
STAMP='2026-10-27T12:00:00+00:00'
LATER='2026-11-28T09:00:00+00:00'

class PinnacleArchiveRegression(unittest.TestCase):
    def test_p_and_pc_are_lossless_and_distinct_from_ps(self):
        cols=markets.market_columns(RAW)
        expected={k:float(v) for k,v in RAW.items() if k not in ('PUnrelated','HS')}
        key=registry.row_key(ROW)
        obs,rejected=markets.observation(RAW,ROW,cols,URL,SHA,'historical_csv',key)
        self.assertFalse(rejected)
        self.assertEqual(dict(zip(obs['columns'],obs['values'])),expected)
        self.assertEqual(obs['source_sha256'],SHA)
        self.assertEqual(obs['source_url'],URL)

    def test_backfill_appends_without_rewriting_prior_history(self):
        key=registry.row_key(ROW)
        previous=markets.observation(RAW,ROW,['B365<2.5','B365>2.5','PSH'],
                                     URL,SHA,'historical_csv',key)[0]
        improved=markets.observation(RAW,ROW,markets.market_columns(RAW),
                                     URL,SHA,'historical_csv',key)[0]
        shard=markets.empty('E0','2025-26')
        self.assertEqual(markets.merge(shard,[previous],STAMP),1)
        first=copy.deepcopy(shard['matches'][key])
        self.assertEqual(markets.merge(shard,[improved],LATER),1)
        for k,v in first.items():
            self.assertEqual(shard['matches'][key][k],v)
        self.assertEqual(markets.merge(shard,[improved],LATER),0)
        self.assertEqual(markets.summary([shard],[ROW],registry.row_key,LATER)['future_matches_with_saved_quotes'],0)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'shard.json'
            p.write_text(json.dumps(shard))
            self.assertEqual(markets.load(p),shard)

if __name__=='__main__': unittest.main()
