"""Check cached reimports twice without rewriting history or its correction log."""
import argparse
import hashlib
import json
import datetime as dt
from pathlib import Path

import update as u
import audit_scout
import backfill_csv_archive as archive


def run(cache_dir,seeds=(),report_path=None):
    today=u.today_sofia()
    original=u.HIST.read_bytes()
    ledger=u.OUT/"archive_import_report.json"
    ledger_before=ledger.read_bytes()
    history=json.loads(original)
    sources=archive.load_cache(cache_dir,today)
    seed_rows=[]
    for path in seeds:
        for raw in u.parse_csv(path.read_bytes()):
            row=u.make_row(raw)
            if row and row[3]<=today.isoformat():seed_rows.append(row)
    first,one=archive.merge_archive(history,sources,seeds=seed_rows)
    second,two=archive.merge_archive(first,sources,seeds=seed_rows)
    if history!=first or first!=second:
        raise SystemExit("Refuse acceptance: cached reimport changes the current snapshot")
    if any(r["unresolved_conflicts"] or r["added"] for r in (one,two)):
        raise SystemExit("Refuse acceptance: reimport adds records or unresolved conflicts")
    if u.HIST.read_bytes()!=original or ledger.read_bytes()!=ledger_before:
        raise SystemExit("Refuse acceptance: validation changed the history or correction ledger")
    audit=audit_scout.audit(history,u.readjson(u.FIX,[]),today,source_expectations=sources)
    if audit["issues_total"] or any(not r["covered_count"] for r in audit["source_snapshot_checks"]):
        raise SystemExit("Refuse acceptance: integrity or source coverage checks failed")
    result={
        "checked_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
        "as_of_date":today.isoformat(),"date_zone":"Europe/Sofia",
        "scope":"Acceptance of the cached six-season snapshot, not a live completeness guarantee",
        "history_count":len(history),"source_files":len(sources),
        "history_sha256":hashlib.sha256(original).hexdigest(),
        "ledger_sha256":hashlib.sha256(ledger_before).hexdigest(),
        "reimport_passes":2,"semantic_idempotence":True,
        "history_bytes_preserved":True,"correction_ledger_preserved":True,
        "added_per_pass":[one["added"],two["added"]],
        "unresolved_conflicts_per_pass":[one["unresolved_conflicts"],two["unresolved_conflicts"]],
        "source_snapshot_checks_passed":len(audit["source_snapshot_checks"]),
        "integrity_issues":audit["issues_total"],
    }
    u.writejson(report_path or u.OUT/"base_acceptance.json",result)
    print(json.dumps(result,ensure_ascii=False))
    return result


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--cache-dir",type=Path,required=True)
    p.add_argument("--local-seed",type=Path,action="append",default=[])
    p.add_argument("--report",type=Path)
    args=p.parse_args()
    run(args.cache_dir,args.local_seed,args.report)
