"""Offline integrity/backfill tests, no requests to third-party data providers."""
import sys
import unittest
import datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import update as u
import backfill_openfootball as backfill
import audit_scout as audit

TODAY=dt.date(2026,10,25)

def row(date="2022-08-06",division="D1",home="Bayern Munich",away="Dortmund"):
 return [division,"Germany","Bundesliga",date,"16:00",home,away,2,1,None,None,None,None,
         {"HC":7,"AC":5,"HY":2,"AY":1,"SRC":"existing"}]

def source_json():
 return {"name":"Bundesliga 2022/23","matches":[
  {"round":"Matchday 1","date":"2022-08-06","time":"18:00",
   "team1":"FC Bayern München","team2":"Borussia Dortmund","score":{"ft":[2,1],"ht":[1,1]}},
  {"date":"2022-08-08","team1":"Leverkusen","team2":"Schalke","score":{}},
  {"date":"2027-11-02","team1":"Leverkusen","team2":"Dortmund","score":{"ft":[3,0]}}
 ]}

class BackfillTests(unittest.TestCase):
 def test_openfootball_parser_only_completed_and_canonical_names(self):
  x=backfill.parse(source_json(),"D1",TODAY)
  self.assertEqual(len(x),1)
  self.assertEqual(x[0][5],"Bayern Munich")
  self.assertEqual(x[0][6],"Dortmund")
  self.assertEqual(x[0][13]["HTHG"],1)
  self.assertEqual(x[0][13]["SRC"],"openfootball-cc0")

 def test_existing_season_protected_and_untouched(self):
  old=[row("2022-08-06","D1","Bayern Munich","Dortmund")]
  calls=[]
  def fake(url):
   calls.append(url)
   return source_json()
  original=backfill.SOURCES
  backfill.SOURCES={"D1":"de.1"}
  try:
   merged,status=backfill.run(old,today=dt.date(2022,10,25),downloader=fake,seasons=1)
  finally:
   backfill.SOURCES=original
  self.assertEqual(len(merged),len(old))
  self.assertFalse(calls)
  self.assertEqual(merged[0][13]["HC"],7)
  self.assertEqual(len(status["skipped_partial"]),1)

 def test_new_division_backfilled_without_fabricating_shots_or_corners(self):
  old=[]
  original=backfill.SOURCES
  backfill.SOURCES={"D1":"de.1"}
  try:
   merged,status=backfill.run(old,today=dt.date(2022,10,25),downloader=lambda url:source_json(),seasons=1)
  finally:
   backfill.SOURCES=original
  self.assertEqual(len(merged),1)
  self.assertEqual(status["added"],1)
  self.assertNotIn("HC",merged[0][13])
  self.assertNotIn("HS",merged[0][13])

 def test_data_audit_exposes_unavailable_fields_and_duplicates(self):
  clean=[row()]
  r=audit.audit(clean,[],TODAY)
  self.assertEqual(r["historical_matches"],1)
  self.assertEqual(r["leagues"]["D1"]["coverage"]["corners"]["available"],1)
  self.assertEqual(r["leagues"]["D1"]["coverage"]["shots"]["available"],0)
  self.assertEqual(r["issues_total"],0)
  duplicate=audit.audit(clean+clean,[],TODAY)
  self.assertGreater(duplicate["issues_total"],0)
  future=audit.audit([row("2027-01-02")],[],TODAY)
  self.assertTrue(any("future" in text for text in future["issues"]))

 def test_full_csv_reseed_preserves_optional_fields(self):
  old=row()
  new=list(old[:13])
  merged=u.merge_rows(old,new)
  self.assertEqual(merged[13]["HC"],7)
  self.assertEqual(merged[13]["SRC"],"existing")

if __name__=="__main__":unittest.main()
