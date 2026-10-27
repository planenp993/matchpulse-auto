#!/usr/bin/env python3
"""Verify the registered research snapshot, independently of live data refreshes."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/data/research_snapshot.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def check(root=ROOT):
    manifest = json.loads((root / "docs/data/research_snapshot.json").read_text())
    raw = subprocess.check_output(["git", "show", manifest["commit"] + ":docs/data/history.json"], cwd=root)
    if sha(raw) != manifest["history_sha256"]:
        raise ValueError("Research history fingerprint mismatch")
    for name, expected in manifest["files"].items():
        if sha((root / name).read_bytes()) != expected:
            raise ValueError("Registered research changed: " + name)
    with tempfile.TemporaryDirectory(prefix="matchpulse-research-") as folder:
        target = Path(folder)
        for name in manifest["files"]:
            (target / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / name, target / name)
        (target / "docs/data/history.json").write_bytes(raw)
        for script in ("compare_goal_models", "compare_shot_models", "evaluate_scanner"):
            subprocess.run(["node", f"scripts/{script}.cjs", "--check"], cwd=target, check=True)
    print(json.dumps({"research_snapshot": "verified", "live_history_replay": False,
                      "pinned_commit": manifest["commit"]}))


if __name__ == "__main__":
    check()
