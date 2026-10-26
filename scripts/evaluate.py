#!/usr/bin/env python3
"""Publish diagnostics from the actual browser engine; no duplicate equations."""
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ENGINE=ROOT/"scripts/evaluate_model.cjs"
OUT=ROOT/"docs/data/model_report.json"

def report(history,since="2026-08-20"):
    process=subprocess.run(["node",str(ENGINE),"--stdin","--since",since],
                           input=json.dumps(history),text=True,capture_output=True,check=True,cwd=ROOT)
    return json.loads(process.stdout)

def main():
    process=subprocess.run(["node",str(ENGINE)],text=True,capture_output=True,check=True,cwd=ROOT)
    result=json.loads(process.stdout)
    OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(json.dumps({"walk_forward_n":result["n"],"brier":result.get("brier"),
                      "league_baseline":result.get("baseline_brier"),"model":result["model"]}))

if __name__=="__main__":main()
