import datetime as dt
import unittest
from scripts import update

class CSVImportTests(unittest.TestCase):
    def test_original_football_data(self):
        b=b"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,Time\nE0,21/10/2026,Arsenal,Chelsea,2,1,20:00\n"
        row=update.make_row(update.parse_csv(b)[0])
        self.assertEqual(row[:9],["E0","England","Premier League","2026-10-21","20:00","Arsenal","Chelsea",2,1])

    def test_master_csv_format(self):
        b=b"DIV,DATE,HOME,AWAY,HG,AG,HXG,AXG\nN1,2026-10-18,Ajax,PSV,2,2,2.15,1.5\n"
        row=update.make_row(update.parse_csv(b)[0])
        self.assertEqual((row[7],row[8],row[9]),(2,2,2.15))

    def test_fixture_row(self):
        b=b"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,24/10/2026,Everton,Brentford,,\n"
        row=update.make_row(update.parse_csv(b)[0],fixture=True)
        self.assertIsNone(row[7])
        self.assertIsNone(row[8])
        self.assertIsNone(update.make_row(update.parse_csv(b)[0]))

    def test_scored_game_never_fixture(self):
        b=b"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,24/10/2026,Everton,Brentford,0,0\n"
        self.assertIsNone(update.make_row(update.parse_csv(b)[0],fixture=True))

    def test_empty_html_rejected(self):
        with self.assertRaises(ValueError):
            update.parse_csv(b"<!doctype html><html></html>")

    def test_incorrect_csv_schema_rejected(self):
        with self.assertRaises(ValueError):
            update.parse_csv(b"Date,Something\n21/10/2026,Test\n")

    def test_date_parsing(self):
        self.assertEqual(update.dayparse("21/10/26"),dt.date(2026,10,21))
        self.assertEqual(update.dayparse("2026-10-21"),dt.date(2026,10,21))

    def test_current_seasons(self):
        years=update.current_years(dt.date(2026,10,22),"E0")
        self.assertEqual(years,[2025,2026])
        self.assertEqual(update.current_years(dt.date(2026,10,22),"N1")[0],2021)

    def test_dedup_key(self):
        a=["E0","England","Premier League","2026-10-20","17:00","Arsenal","Chelsea",1,1,None,None,None,None]
        b=["E0","England","Premier League","2026-10-20","17:00","ARSENAL","CHELSEA",1,1,None,None,None,None]
        self.assertEqual(update.key(a),update.key(b))

    def test_reject_invalid_teams(self):
        b=b"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,21/10/2026,Arsenal,Arsenal,2,1\n"
        self.assertIsNone(update.make_row(update.parse_csv(b)[0]))

if __name__=="__main__":
    unittest.main()
