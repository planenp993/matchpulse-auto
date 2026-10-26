import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import backfill_csv_archive as archive
import update as u

TODAY=dt.date(2026,10,25)

def row(home="Bolton Wanderers",away="Reading FC",score=(2,1),meta=None):
    return ["E2","England","League One","2026-08-01","15:00",home,away,
            *score,1.4,1.1,None,None,meta or {"SRC":"openfootball-cc0"}]

class CSVArchiveTests(unittest.TestCase):
    def test_verified_alias_enriches_one_match_and_preserves_xg(self):
        old=row()
        fresh=row("Bolton","Reading",meta={"HS":12,"AS":8,"HC":5,"AC":2})
        fresh[9:11]=[None,None]
        result,report=archive.merge_archive([old],[{"matches":[fresh]}])
        self.assertEqual(len(result),1)
        self.assertEqual(result[0][5:7],old[5:7])
        self.assertEqual(result[0][9:11],[1.4,1.1])
        self.assertEqual(result[0][13]["HC"],5)
        self.assertEqual(report["enriched"],1)
        self.assertEqual(report["unresolved_conflicts"],0)
        self.assertNotIn("HC",old[13])

    def test_unreviewed_score_conflict_never_overwrites_prior_result(self):
        old=row()
        fresh=row("Bolton","Reading",score=(0,1),meta={"HS":8,"AS":10})
        result,report=archive.merge_archive([old],[{"matches":[fresh]}])
        self.assertEqual(result[0][7:9],[2,1])
        self.assertEqual(report["unresolved_conflicts"],1)
        self.assertNotIn("HS",result[0][13])

    def test_same_club_twice_on_a_date_is_not_appended(self):
        result,report=archive.merge_archive([row()],[{"matches":[row("Bolton","Wigan")]}])
        self.assertEqual(len(result),1)
        self.assertEqual(len(report["schedule_conflicts"]),1)

    def test_source_wrong_season_or_future_scores_are_rejected(self):
        header="Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\n"
        for date,reason in [("01/08/2025","wrong season"),("26/10/2026","future")]:
            with self.subTest(date=date),self.assertRaisesRegex(ValueError,reason):
                archive.parse_archive((header+f"E2,{date},Bolton,Reading,2,1\n").encode(),"E2",2026,TODAY)

    def test_unplayed_rows_are_reported_without_synthetic_scores(self):
        blob=b"Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE2,01/08/2026,Bolton,Reading,2,1\nE2,02/08/2026,Wigan,Barnsley,,\n"
        diagnostics={}
        rows=archive.parse_archive(blob,"E2",2026,TODAY,diagnostics)
        self.assertEqual(len(rows),1)
        self.assertEqual(len(diagnostics["unplayed"]),1)

    def test_inconsistent_shots_are_quarantined_not_replaced_with_zeros(self):
        stats=u.match_stats({"HS":"2","AS":"9","HST":"7","AST":"4","HC":"6","AC":"2"})
        self.assertTrue(stats["STAT_ISSUES"])
        self.assertNotIn("HS",stats)
        self.assertNotIn("HST",stats)
        self.assertEqual(stats["HC"],6)

    def test_alias_aware_integrity_rejects_same_team_under_two_names(self):
        first=row()
        second=row("Bolton","Reading")
        import audit_scout
        report=audit_scout.audit([first,second],[],TODAY)
        self.assertTrue(any("duplicate:" in x for x in report["issues"]))
        self.assertNotEqual(u.club_key("Red Star"),u.club_key("Red Star Belgrade"))

    def test_fixture_alias_merge_prefers_primary_without_losing_the_match(self):
        secondary=row("Bolton Wanderers","Reading FC")
        secondary[7:9]=[None,None];secondary[13]="FixtureDownload / UTC→Europe-Sofia"
        primary=row("Bolton","Reading")[:13]
        primary[7:9]=[None,None]
        result=u.merge_fixtures([secondary,primary])
        self.assertEqual(result,[primary])

    def test_reimport_is_idempotent_and_preserves_score_verification(self):
        old=["E2","England","League One","2025-11-06","19:00","Reading FC","Stevenage FC",2,0,None,None,None,None,{"SRC":"openfootball-cc0"}]
        fresh=["E2","England","League One","2025-11-06","19:00","Reading","Stevenage",1,0,None,None,None,None,{"HS":12,"AS":7}]
        first,one=archive.merge_archive([old],[{"matches":[fresh]}])
        second,two=archive.merge_archive(first,[{"matches":[fresh]}])
        self.assertEqual(first,second)
        self.assertEqual(len(one["verified_score_corrections"]),1)
        self.assertEqual(len(two["verified_score_corrections"]),0)
        self.assertTrue(second[0][13]["SCORE_VERIFIED"])
        self.assertEqual(two["added"],0)

    def test_reapplying_cli_keeps_the_original_correction_ledger(self):
        import contextlib,io,tempfile
        from unittest import mock
        corrected=["E2","England","League One","2025-11-06","19:00","Reading FC","Stevenage FC",1,0,None,None,None,None,{"SRC":"football-data","SCORE_VERIFIED":"fixture-verification"}]
        fresh=list(corrected[:13])+[{"HS":12,"AS":7}]
        evidence={"key":list(u.key(corrected)),"existing":[2,0],"csv":[1,0],"evidence":"fixture-verification"}
        source={"division":"E2","season_start":2025,"rows":1,"matches":[fresh],"unplayed":[]}
        with tempfile.TemporaryDirectory() as name:
            root=Path(name)
            with mock.patch.multiple(archive.u,OUT=root,HIST=root/"history.json",FIX=root/"fixtures.json",STAT=root/"status.json"),mock.patch.object(archive,"load_cache",return_value=[source]),mock.patch.object(sys,"argv",["backfill_csv_archive.py","--cache-dir",name,"--apply"]):
                u.writejson(u.HIST,[corrected]);u.writejson(u.FIX,[]);u.writejson(u.STAT,{})
                u.writejson(root/"archive_import_report.json",{"before":50889,"added":3790,"verified_score_corrections":[evidence]})
                with contextlib.redirect_stdout(io.StringIO()):
                    archive.main()
                    first=u.HIST.read_bytes()
                    archive.main()
                self.assertEqual(u.HIST.read_bytes(),first)
                report=u.readjson(root/"archive_import_report.json",{})
                self.assertEqual(report["verified_score_corrections"],[evidence])
                self.assertEqual(report["verified_score_correction_count"],1)
                self.assertEqual(report["verified_score_corrections_this_run"],[])
                self.assertEqual(report["cumulative_added"],3790)

if __name__=="__main__":
    unittest.main()
