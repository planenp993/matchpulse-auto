"""Offline contract tests. No external football provider requests."""
import datetime as dt
import importlib.util
import unittest
from pathlib import Path

p=Path(__file__).resolve().parents[1]/"contracts.py"
s=importlib.util.spec_from_file_location("prime_contracts",p)
m=importlib.util.module_from_spec(s)
s.loader.exec_module(m)
NOW=dt.datetime(2026,10,23,8,0,tzinfo=dt.timezone.utc)

def fixture(**override):
    item={
       "fixture_id":"epl-2026-27-arsenal-chelsea-r09",
       "competition_id":"EPL","season":"2026-27",
       "kickoff_utc":"2026-10-24T16:30:00Z",
       "home_id":"arsenal","away_id":"chelsea",
       "status":"scheduled","source":"openfootball",
       "source_updated_utc":"2026-10-22T07:00:00Z",
    }
    item.update(override)
    return item

class ContractTests(unittest.TestCase):
    def test_valid_future_schedule(self):
        self.assertEqual(m.validate_snapshot({"fixtures":[fixture()],"results":[]},now=NOW)["fixtures"],1)
    def test_missing_team_fails(self):
        with self.assertRaisesRegex(ValueError,"away_id"):
            m.validate_fixture(fixture(away_id=""),now=NOW)
    def test_same_team_fails(self):
        with self.assertRaisesRegex(ValueError,"differ"):
            m.validate_fixture(fixture(away_id="arsenal"),now=NOW)
    def test_no_scores_on_future_fixture(self):
        with self.assertRaisesRegex(ValueError,"future fixture"):
            m.validate_fixture(fixture(home_goals=4,away_goals=2),now=NOW)
    def test_future_source_timestamp_is_invalid(self):
        with self.assertRaisesRegex(ValueError,"future"):
            m.validate_fixture(fixture(source_updated_utc="2026-11-01T08:00:00Z"),now=NOW)
    def test_timezone_required(self):
        with self.assertRaisesRegex(ValueError,"UTC"):
            m.validate_fixture(fixture(kickoff_utc="2026-10-24T16:30:00"),now=NOW)
    def test_future_result_rejected(self):
        with self.assertRaisesRegex(ValueError,"future result"):
            m.validate_result(fixture(status="completed",home_goals=1,away_goals=1),now=NOW)
    def test_result_and_unknown_xg(self):
        v=fixture(status="completed",kickoff_utc="2026-10-21T16:30:00Z",home_goals=2,away_goals=1,
                  home_xg=None,away_xg=None)
        self.assertIsNone(m.validate_result(v,now=NOW)["home_xg"])
    def test_boolean_and_negative_goals_invalid(self):
        for goals in (True,-1,1.2):
            with self.assertRaisesRegex(ValueError,"home_goals"):
                m.validate_result(fixture(status="completed",kickoff_utc="2026-10-21T16:30:00Z",
                    home_goals=goals,away_goals=1),now=NOW)
    def test_duplicate_id_fails(self):
        with self.assertRaisesRegex(ValueError,"duplicate fixture_id"):
            m.validate_snapshot({"fixtures":[fixture(),fixture()],"results":[]},now=NOW)
    def test_completed_fixture_must_be_in_results(self):
        v=fixture(status="completed",kickoff_utc="2026-10-21T16:30:00Z",home_goals=2,away_goals=0)
        with self.assertRaisesRegex(ValueError,"results"):
            m.validate_snapshot({"fixtures":[v],"results":[]},now=NOW)
    def test_no_arrays_is_invalid(self):
        with self.assertRaisesRegex(ValueError,"arrays"):
            m.validate_snapshot({"fixtures":{},"results":{}},now=NOW)

if __name__=="__main__":unittest.main()
