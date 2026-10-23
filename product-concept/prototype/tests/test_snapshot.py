import datetime as dt
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from build_snapshot import normalize, profile

class SnapshotTests(unittest.TestCase):
    def row(self, kickoff='2026-10-23T18:30:00Z',finished=False):
        return {'matchID':1,'matchDateTimeUTC':kickoff,'matchIsFinished':finished,
                'team1':{'teamId':16,'teamName':'Stuttgart'},'team2':{'teamId':87,'teamName':'Gladbach'},
                'matchResults':[{'resultTypeID':2,'pointsTeam1':2,'pointsTeam2':1}] if finished else []}
    def test_sofia_daylight_saving_boundary(self):
        a=normalize(self.row(), 'bl1',2026)
        b=normalize(self.row('2026-10-25T18:30:00Z'), 'bl1',2026)
        self.assertEqual(a['time'],'21:30');self.assertEqual(b['time'],'20:30')
    def test_stable_id_survives_rescheduling(self):
        a=normalize(self.row(), 'bl1',2026)
        b=normalize(self.row('2026-10-25T18:30:00Z'), 'bl1',2026)
        self.assertEqual(a['id'],b['id'])
    def test_no_future_or_unfinished_match_in_form(self):
        prior=normalize(self.row('2026-10-20T18:30:00Z',True),'bl1',2026)
        later=normalize(self.row('2026-10-25T18:30:00Z',True),'bl1',2026)
        pending=normalize(self.row('2026-10-19T18:30:00Z',False),'bl1',2026)
        got=profile([prior,later,pending],'oldb:16','2026-10-23T18:30:00Z')
        self.assertEqual(got['n'],1);self.assertEqual(got['gf'],2);self.assertEqual(got['ga'],1)
    def test_unknown_history_stays_null(self):
        x=profile([],'x','2026-10-23T18:30:00Z')
        self.assertIsNone(x['gf']);self.assertIsNone(x['ga'])
    def test_finished_game_requires_actual_final_score(self):
        raw=self.row(finished=True);raw['matchResults']=[]
        with self.assertRaises(ValueError):normalize(raw,'bl1',2026)

if __name__=='__main__':unittest.main()
