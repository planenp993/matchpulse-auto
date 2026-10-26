import datetime as dt
import importlib
import pathlib
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"scripts"))
import backfill_openfootball_txt as txt

NOW=dt.date(2026,10,25)
EXAMPLE="""= English League One 2021/22

# Matches 552

▪ Matchday 1
Sat Aug 7
  15:00  Sunderland AFC           2-1 (1-1)  Wigan Athletic
         Bolton Wanderers         3-3 (1-1)  Milton Keynes Dons
  17:30  Charlton Athletic        0-0  Sheffield Wednesday
Sat Aug 14
  19:00  Plymouth Argyle          1-0 (0-0)  Gillingham FC
Jan 15
"""
class TxtBackfill(unittest.TestCase):
 def test_center_goals_and_halftime(self):
  rows=txt.parse(EXAMPLE,"E2",2021,NOW)
  self.assertEqual(len(rows),4)
  self.assertEqual(rows[0][3],"2021-08-07")
  self.assertEqual(rows[0][7:9],[2,1])
  self.assertEqual(rows[0][13]["HTHG"],1)
  self.assertEqual(rows[2][7:9],[0,0])
  self.assertNotIn("HTHG",rows[2][13])
  self.assertEqual(rows[-1][3],"2021-08-14")
 def test_explicit_year_and_alternate_teams_v_score(self):
  text="""= English League Two 2021/22
Sat Aug 7 2021
  19:00  Carlisle United          v Crawley Town             1-1 (0-1)
Sun Jan 2 2022
          Mansfield Town          v Bradford City            2-0 (1-0)
"""
  rows=txt.parse(text,"E3",2021,NOW)
  self.assertEqual(len(rows),2)
  self.assertEqual(rows[-1][3],"2022-01-02")
  self.assertEqual(rows[0][7:9],[1,1])
 def test_silent_misdated_source_is_rejected(self):
  with self.assertRaisesRegex(ValueError,"Season title"):
   txt.parse(EXAMPLE.replace("2021/22","2020/21"),"E2",2021,NOW)
 def test_awarded_annotation_is_metadata_not_a_team(self):
  text="""= Greek Super League 2023/24
Sun Feb 11 2024
  16:00  AE Kifisias             v Volos NFC              3-0  [awarded]
"""
  r=txt.parse(text,"G1",2023,NOW)[0]
  self.assertEqual(r[5:9],["AE Kifisias","Volos NFC",3,0])
  self.assertTrue(r[13]["AWARDED"])
 def test_centered_score_strips_awarded_note_from_away_club(self):
  text="""= Italian Serie B 2022/23
Thu Jun 1 2023
  20:30  Brescia Calcio           0-3  Cosenza Calcio [awarded]
"""
  r=txt.parse(text,"I2",2022,NOW)[0]
  self.assertEqual(r[5:9],["Brescia Calcio","Cosenza Calcio",0,3])
  self.assertTrue(r[13]["AWARDED"])
 def test_skips_future_and_ignores_invalid(self):
  future="= English League One 2026/27\nTue Oct 27\n  19:00  Team A         2-1  Team B\n"
  self.assertEqual(txt.parse(future,"E2",2026,NOW),[])
 def test_backfill_avoids_poor_quality_and_existing_seasons(self):
  # No network; must skip when source is substantially incomplete.
  calls=[]
  def downloader(url):
   calls.append(url)
   return EXAMPLE
  out,report=txt.fill([],today=NOW,downloader=downloader)
  self.assertEqual(len(out),0)
  self.assertTrue(report["issues"])
  self.assertEqual(report["added"],0)
 def test_source_url_and_licensing_note(self):
  url=txt.url_for(2021,"england","3-league1")
  self.assertIn("openfootball/england/master/2021-22/3-league1.txt",url)
if __name__=="__main__":unittest.main()
