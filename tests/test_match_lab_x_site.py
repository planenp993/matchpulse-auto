"""Source integrity tests for the isolated public Football-Data downloader."""
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("site_builder",ROOT/"scripts/build_match_lab_x_site.py")
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class SiteBuilder(unittest.TestCase):
    def test_csv_filters_nonfinal_and_preserves_only_past(self):
        doc=("Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,HS,AS,HST,AST,HC,AC,HY,AY\n"
             "E0,12/11/2026,Arsenal,Chelsea,2,1,1,0,14,8,5,2,7,4,2,3\n"
             "E0,16/11/2026,Everton,Fulham,,,,,,,,,,,\n"
             "E0,28/11/2026,Arsenal,Newcastle,1,0,0,0,10,9,5,4,3,4,2,2\n")
        rows=builder.parse_csv(doc.encode(),"E0","2026-11-19")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0][:7],["2026-11-12","Arsenal","Chelsea",2,1,1,0])
        self.assertEqual(rows[0][9:11],[5,2])
    def test_nonnegative_and_missing_stat_handling(self):
        self.assertIsNone(builder.as_int(""))
        self.assertIsNone(builder.as_int("-2"))
        self.assertEqual(builder.as_int("4.0"),4)
        self.assertEqual(builder.date_value("17/11/2026"),"2026-11-17")
    def test_no_fabricated_rows_on_bad_csv(self):
        with self.assertRaises(ValueError):builder.parse_csv(b"<html>Denied</html>","E0")
    def test_required_five_and_second_tiers_present(self):
        ten={"E0","E1","D1","D2","I1","I2","SP1","SP2","F1","F2"}
        self.assertTrue(ten.issubset(set(builder.DIVISIONS)))
        self.assertGreaterEqual(len(builder.DIVISIONS),18)
if __name__=="__main__":unittest.main()
