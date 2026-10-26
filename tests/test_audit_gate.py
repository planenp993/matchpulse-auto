"""Regression checks for the release gate, using isolated synthetic snapshots."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import audit_scout


class AuditGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.paths = mock.patch.multiple(
            audit_scout.u,
            OUT=self.out,
            HIST=self.out / "history.json",
            FIX=self.out / "fixtures.json",
        )
        self.paths.start()
        self.addCleanup(self.paths.stop)
        # Enough valid rows to pass the independent archive-size guard. Clubs
        # are unique so the only integrity violation is the one a test adds.
        self.history = [
            ["E0", "England", "Premier League", "2024-01-01", "",
             f"Home {n}", f"Away {n}", 1, 0, None, None, None, None]
            for n in range(10000)
        ]
        audit_scout.u.writejson(audit_scout.u.FIX, [])

    def run_gate(self):
        audit_scout.u.writejson(audit_scout.u.HIST, self.history)
        with contextlib.redirect_stdout(io.StringIO()):
            audit_scout.main()

    def test_one_duplicate_blocks_release_and_keeps_evidence(self):
        self.history.append(list(self.history[0]))
        with self.assertRaisesRegex(SystemExit, "data-integrity"):
            self.run_gate()
        report = json.loads((self.out / "coverage_audit.json").read_text())
        self.assertGreater(report["issues_total"], 0)
        self.assertLess(report["issues_total"], 50)
        self.assertTrue(any("duplicate:" in issue for issue in report["issues"]))

    def test_missing_optional_stats_remain_nonfatal_coverage_warnings(self):
        self.run_gate()
        report = json.loads((self.out / "coverage_audit.json").read_text())
        self.assertEqual(report["issues_total"], 0)
        self.assertEqual(report["observations_by_market"]["shots"], 0)
        self.assertEqual(report["readiness"]["match_stats"], "missing")
        self.assertTrue(report["warnings"])


if __name__ == "__main__":
    unittest.main()
