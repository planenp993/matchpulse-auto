import datetime as dt
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import update as u
import audit_scout


class SofiaDateTests(unittest.TestCase):
    def test_winter_midnight_uses_sofia_not_istanbul(self):
        instant=dt.datetime(2026,10,25,21,30,tzinfo=dt.timezone.utc)
        self.assertEqual(u.today_sofia(instant),dt.date(2026,10,25))
        self.assertEqual(u.today_sofia(instant+dt.timedelta(hours=1)),dt.date(2026,10,26))

    def test_summer_offset_is_not_hardcoded_to_two_hours(self):
        instant=dt.datetime(2026,3,29,21,30,tzinfo=dt.timezone.utc)
        self.assertEqual(u.today_sofia(instant),dt.date(2026,3,30))

    def test_audit_uses_the_product_date_for_future_scores(self):
        row=["E0","England","Premier League","2026-10-26","15:00","Arsenal","Chelsea",2,1,None,None,None,None]
        with mock.patch.object(audit_scout.u,"today_sofia",return_value=dt.date(2026,10,25)) as clock:
            result=audit_scout.audit([row],[])
        clock.assert_called_once_with()
        self.assertEqual(result["as_of_date"],"2026-10-25")
        self.assertTrue(any("in the future" in issue for issue in result["issues"]))
