"""Merge an explicitly supplied six-season CSV cache; never downloads providers.

Reviewed identities join exact division/date/clubs only. Score conflicts stop the
write, except documented awarded results, which remain excluded from models.
Raw personal seed files and the cache stay outside the public repository.
"""
import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path

import update as u
import audit_scout
from backfill_openfootball import season_key

RESOLUTIONS=json.loads((u.OUT/"match_resolutions.json").read_text(encoding="utf-8"))

def flag_administrative(row):
    for entry in RESOLUTIONS["administrative_matches"]:
        if tuple(entry["key"])==u.key(row):
            if len(row)==13:row.append({})
            row[13].update(AWARDED=True,DECISION_SRC=entry["source_url"])
    for entry in RESOLUTIONS["withdrawals"]:
        if row[0]!=entry["division"] or not entry["from"]<=row[3]<=entry["until"]:
            continue
        withdrawn=set(entry["clubs"])
        h,a=u.club_key(row[5]),u.club_key(row[6])
        awarded=(h in withdrawn and row[7:9]==[0,3]) or (a in withdrawn and row[7:9]==[3,0])
        if awarded:
            if len(row)==13:row.append({})
            row[13].update(AWARDED=True,DECISION_SRC=entry["source_url"])


def parse_archive(blob, division, year, today, diagnostics=None):
    result = {}
    for number, raw in enumerate(u.parse_csv(blob), 2):
        if u.val(raw, "Div") != division:
            raise ValueError(f"Row {number}: wrong division in archive")
        date = u.dayparse(u.val(raw, "Date"))
        if not date or season_key(date.isoformat()) != year:
            raise ValueError(f"Row {number}: wrong season in archive")
        row = u.make_row(raw, division)
        if row is None:
            if u.val(raw,"FTHG")=="" and u.val(raw,"FTAG")=="":
                if diagnostics is not None:
                    diagnostics.setdefault("unplayed",[]).append({"date":date.isoformat(),"home":u.val(raw,"HomeTeam"),"away":u.val(raw,"AwayTeam")})
                continue  # Abandoned/unplayed fixture; never manufacture a score.
            raise ValueError(f"{division}/{year}, row {number}: invalid completed match")
        if date > today:
            raise ValueError(f"Row {number}: future final score")
        flag_administrative(row)
        key = u.key(row)
        if key in result:
            raise ValueError(f"Row {number}: duplicate match in source")
        result[key] = row
    if not result or len(result) > 650:
        raise ValueError("Unexpected source size")
    current = today.year if today.month >= 7 else today.year - 1
    if year < current and len(result) < 120:
        raise ValueError("Completed-season source is substantially incomplete")
    return list(result.values())


def repair_known_annotations(history):
    out = copy.deepcopy(history)
    repairs = []
    for row in out:
        if (row[0], row[3], row[5], row[6], row[7], row[8]) == (
            "G1", "2024-02-11", "AE Kifisias v Volos NFC", "[awarded]", 3, 0
        ):
            row[5:7] = ["AE Kifisias", "Volos NFC"]
            row[13]["AWARDED"] = True
            repairs.append({"division": "G1", "date": row[3], "kind": "awarded annotation parsed as club"})
        if (row[0], row[3], row[5], row[6], row[7], row[8]) == (
            "I2", "2023-06-01", "Brescia Calcio", "Cosenza Calcio [awarded]", 0, 3
        ):
            row[6] = "Cosenza Calcio"
            row[13]["AWARDED"] = True
            repairs.append({"division": "I2", "date": row[3], "kind": "awarded annotation appended to club"})
        for entry in RESOLUTIONS["venue_corrections"]:
            if u.key(row)==tuple(entry["old_key"]):
                previous=copy.deepcopy(row)
                row[5],row[6]=row[6],row[5]
                row[7],row[8]=row[8],row[7]
                row[9],row[10]=row[10],row[9]
                if len(row)==13:row.append({})
                for left,right in (("HS","AS"),("HST","AST"),("HC","AC"),("HY","AY"),("HR","AR"),("HTHG","HTAG"),("HF","AF")):
                    x,y=row[13].pop(left,None),row[13].pop(right,None)
                    if y is not None:row[13][left]=y
                    if x is not None:row[13][right]=x
                row[13]["VENUE_CORRECTION_SRC"]=entry["source_url"]
                repairs.append({"division":row[0],"date":row[3],"kind":"verified venue reversal","replaced_row":previous,"evidence":entry["source_url"]})
        flag_administrative(row)
    return out, repairs


def merge_archive(history, sources, *, seeds=()):
    repaired, repairs = repair_known_annotations(history)
    result = u.index_history(repaired)
    report = {
        "before": len(history), "added": 0, "enriched": 0,
        "aliases_deduplicated": len(history) - len(result),
        "annotation_repairs": repairs, "by_division": {},
        "score_conflicts": [], "schedule_conflicts": [],
        "awarded_score_variants": [], "seed_score_conflicts": [],
        "seed_fields_added": 0,"verified_score_corrections":[],
    }
    by_division = collections.defaultdict(lambda: {"added": 0, "enriched": 0})
    occupied = {}
    approved={tuple(x["key"]):x for x in RESOLUTIONS["score_corrections"]}
    for key, row in result.items():
        for club in key[2:]:
            slot = (key[0], key[1], club)
            if slot in occupied and occupied[slot] != key:
                report["schedule_conflicts"].append({"key": list(key), "existing_key": list(occupied[slot])})
            occupied[slot] = key
    for source in sources:
        for fresh in source["matches"]:
            key = u.key(fresh)
            old = result.get(key)
            if old is not None:
                if old[7:9] != fresh[7:9]:
                    meta = old[13] if len(old) > 13 and isinstance(old[13], dict) else {}
                    conflict = {"key": list(key), "existing": old[7:9], "csv": fresh[7:9]}
                    verified=approved.get(key)
                    if verified and verified["previous_score"]==old[7:9] and verified["accepted_score"]==fresh[7:9]:
                        corrected=copy.deepcopy(fresh)
                        corrected[5:7]=old[5:7]
                        if len(corrected)==13:corrected.append({})
                        corrected[13].update(SRC="football-data",STATS_SRC="football-data",SCORE_VERIFIED=verified["verification_url"])
                        result[key]=corrected
                        report["verified_score_corrections"].append({**conflict,"replaced_row":old,"evidence":verified["verification_url"]})
                        report["enriched"]+=1;by_division[key[0]]["enriched"]+=1
                    elif meta.get("AWARDED"):
                        meta["SCORE_VARIANTS"] = {"existing_archive": old[7:9], "football-data": fresh[7:9]}
                        report["awarded_score_variants"].append(conflict)
                    else:
                        report["score_conflicts"].append(conflict)
                    continue
                merged = u.merge_rows(old, fresh)
                # Preserve existing display names and measured xG. Shared club
                # keys make all source aliases usable by the importer and UI.
                merged[5:7] = old[5:7]
                for i in (9, 10, 11, 12):
                    if old[i] is not None:
                        merged[i] = old[i]
                previous = old[13] if len(old) > 13 and isinstance(old[13], dict) else {}
                if len(merged) == 13:
                    merged.append({})
                if merged[13] != previous:
                    report["enriched"] += 1
                    by_division[key[0]]["enriched"] += 1
                merged[13].setdefault("SRC", "football-data")
                merged[13]["STATS_SRC"] = "football-data"
                result[key] = merged
            else:
                collision = next((occupied[(key[0], key[1], club)] for club in key[2:]
                                  if (key[0], key[1], club) in occupied), None)
                if collision is not None:
                    report["schedule_conflicts"].append({"key": list(key), "existing_key": list(collision)})
                    continue
                row = copy.deepcopy(fresh)
                if len(row) == 13:
                    row.append({})
                row[13].update(SRC="football-data", STATS_SRC="football-data")
                result[key] = row
                for club in key[2:]:
                    occupied[(key[0], key[1], club)] = key
                report["added"] += 1
                by_division[key[0]]["added"] += 1
    # Local seed data can fill missing values only; it cannot override a
    # verified CSV score or fresher reported match statistics.
    for seed in seeds:
        key = u.key(seed)
        old = result.get(key)
        if old is None:
            continue
        if old[7:9] != seed[7:9]:
            report["seed_score_conflicts"].append({"key": list(key), "existing": old[7:9], "seed": seed[7:9]})
            continue
        for i in (9, 10, 11, 12):
            if old[i] is None and seed[i] is not None:
                old[i] = seed[i]
                report["seed_fields_added"] += 1
        incoming = seed[13] if len(seed) > 13 and isinstance(seed[13], dict) else {}
        if incoming and len(old) == 13:
            old.append({})
        for name, value in incoming.items():
            if name not in old[13]:
                old[13][name] = value
                report["seed_fields_added"] += 1
    report["after"] = len(result)
    report["by_division"] = dict(by_division)
    report["unresolved_conflicts"] = len(report["score_conflicts"]) + len(report["schedule_conflicts"])
    return sorted(result.values(), key=lambda r: (r[3], r[0], r[5], r[6])), report


def load_cache(directory, today):
    current = today.year if today.month >= 7 else today.year - 1
    sources = []
    for division in sorted(u.CSV_LEAGUES):
        for year in range(current - 5, current + 1):
            season = f"{year % 100:02d}{(year + 1) % 100:02d}"
            path = directory / f"{division}-{season}.csv"
            blob = path.read_bytes()
            diagnostics={}
            rows = parse_archive(blob, division, year, today, diagnostics)
            sources.append({
                "division": division, "season_start": year,
                "url": f"https://www.football-data.co.uk/mmz4281/{season}/{division}.csv",
                "sha256": hashlib.sha256(blob).hexdigest(),
                "bytes": len(blob), "rows": len(rows), "matches": rows,
                "unplayed":diagnostics.get("unplayed",[]),
            })
    return sources


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cache-dir", type=Path, required=True)
    p.add_argument("--local-seed", type=Path, action="append", default=[])
    p.add_argument("--apply", action="store_true")
    p.add_argument("--report", type=Path)
    args = p.parse_args()
    today = dt.date.today()
    sources = load_cache(args.cache_dir, today)
    seeds = []
    for path in args.local_seed:
        for raw in u.parse_csv(path.read_bytes()):
            row = u.make_row(raw)
            if row and row[3] <= today.isoformat():
                seeds.append(row)
    history = u.readjson(u.HIST, [])
    original_fixtures = u.readjson(u.FIX, [])
    fixtures=u.merge_fixtures(original_fixtures)
    output, report = merge_archive(history, sources, seeds=seeds)
    audit = audit_scout.audit(output, fixtures, today,source_expectations=sources)
    report.update(
        checked_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
        source_files=len(sources), source_matches=sum(s["rows"] for s in sources),
        local_seed_rows=len(seeds), integrity_issues=audit["issues_total"],
        integrity_details=audit["issues"],
        fixture_alias_duplicates=len(original_fixtures)-len(fixtures),
        unplayed_source_rows=sum(len(s["unplayed"]) for s in sources),
        stat_quarantines=sum(len(r)>13 and bool(r[13].get("STAT_ISSUES")) for r in output),
        verified_score_correction_count=len(report["verified_score_corrections"]),
        observations_by_market=audit["observations_by_market"],
        sources=[{k: v for k, v in s.items() if k != "matches"} for s in sources],
    )
    if args.report:
        u.writejson(args.report, report)
    print(json.dumps({k: v for k, v in report.items() if k not in (
        "sources", "score_conflicts", "schedule_conflicts", "seed_score_conflicts","verified_score_corrections"
    )}, ensure_ascii=False))
    if report["unresolved_conflicts"] or audit["issues_total"]:
        raise SystemExit("Refuse archive write: unresolved data-integrity conflicts")
    if not args.apply:
        return
    if len(output) < len(history) - report["aliases_deduplicated"]:
        raise SystemExit("Refuse shrinking archive")
    u.writejson(u.HIST, output)
    u.writejson(u.FIX, fixtures)
    u.writejson(u.OUT / "archive_import_report.json", report)
    u.writejson(u.OUT / "coverage_audit.json", audit)
    state = u.readjson(u.STAT, {})
    state.update(history_count=len(output),fixtures_count=len(fixtures))
    state["csv_archive_backfill"] = {
        k: report[k] for k in ("checked_utc", "source_files", "added", "enriched", "unresolved_conflicts")
    }
    u.writejson(u.STAT, state)


if __name__ == "__main__":
    main()
