#!/usr/bin/env python3
"""Scout data coverage and integrity audit; writes machine-readable evidence.

No data source downloads. Highlight missing data and structural risks.
"""
import collections
import datetime as dt
import json
import math
from pathlib import Path
import update as u

FIELDS={
 "shots":("HS","AS"),"on_target":("HST","AST"),
 "corners":("HC","AC"),"yellow_cards":("HY","AY"),
 "red_cards":("HR","AR"),"fouls":("HF","AF"),
 "halftime":("HTHG","HTAG"),"odds_1x2":("ODDH","ODDD","ODDA"),
}
def season(date, div):
    year=int(date[:4])
    return year if div in ("NOR","SWE") or int(date[5:7])>=7 else year-1

def audit(history,fixtures,today=None,source_expectations=None):
    today=today or u.today_sofia()
    league=collections.defaultdict(lambda:{"matches":0,"first":None,"last":None,"seasons":{},
        "goals":0,"xg":0,"sources":collections.Counter(),
        "stats":collections.Counter(),"season_stats":collections.defaultdict(collections.Counter),
        "excluded_from_model":0})
    problems=[];duplicate={};team_date=collections.defaultdict(int)
    for n,row in enumerate(history):
        if not isinstance(row,list) or len(row)<13:
            problems.append(f"history[{n}]: invalid row length");continue
        div,date,home,away=row[0],row[3],row[5],row[6]
        try: game_day=dt.date.fromisoformat(str(date))
        except (TypeError,ValueError):
            problems.append(f"history[{n}]: invalid date");continue
        valid_goals=all(type(value) is int and 0<=value<=30 for value in row[7:9])
        valid_clubs=(isinstance(home,str) and isinstance(away,str) and home.strip() and away.strip()
                     and u.club_key(home)!=u.club_key(away)
                     and not any("[" in club or "]" in club or " v " in club for club in (home,away)))
        if not valid_clubs or not valid_goals:
            problems.append(f"history[{n}]: invalid team or FT");continue
        if game_day>today:problems.append(f"history[{n}]: match score in the future")
        key=u.key(row)
        if key in duplicate:problems.append(f"duplicate: {key}")
        duplicate[key]=row[7:9]
        # Each club should not play two league fixtures on same day.
        for club in (home,away):
            team_date[(div,date,u.club_key(club))]+=1
        item=league[div];item["matches"]+=1
        item["first"]=min(item["first"] or date,date)
        item["last"]=max(item["last"] or date,date)
        y=season(date,div)
        item["seasons"][str(y)]=item["seasons"].get(str(y),0)+1
        item["goals"]+=1
        if all(type(value) in (int,float) and math.isfinite(value) and value>=0 for value in row[9:11]):
            item["xg"]+=1;item["season_stats"][str(y)]["xg"]+=1
        meta=row[13] if len(row)>13 and isinstance(row[13],dict) else {}
        if meta.get("AWARDED") is True:item["excluded_from_model"]+=1
        origin=meta.get("SRC") or "existing-archive"
        item["sources"][origin]+=1
        for label,fields in FIELDS.items():
            def present(field):
                value=meta.get(field)
                if label=="odds_1x2":return type(value) in (int,float) and math.isfinite(value) and 1<value<=1000
                return type(value) is int and u.count_stat(value,u.MATCH_STATS[field])==value
            if all(present(v) for v in fields):
                item["stats"][label]+=1;item["season_stats"][str(y)][label]+=1
    double_teams=[f"{k} {n}" for k,n in team_date.items() if n>1]
    problems.extend("team twice on same date: "+s for s in double_teams[:50])
    fixtures_by_league=collections.Counter();stale=0;future=0
    seen=set()
    for idx,f in enumerate(fixtures):
        if not isinstance(f,list) or len(f)<13:
            problems.append(f"fixture[{idx}] invalid");continue
        try:date=dt.date.fromisoformat(str(f[3]))
        except (TypeError,ValueError):
            problems.append(f"fixture[{idx}]: invalid date");continue
        key=u.key(f)
        if key in seen:problems.append(f"duplicate fixture: {key}")
        seen.add(key)
        if date<today:stale+=1
        else:future+=1;fixtures_by_league[f[0]]+=1
        if f[7] is not None or f[8] is not None:problems.append(f"fixture[{idx}] has final goals")
    all_leagues=sorted(set(league)|set(fixtures_by_league))
    # Observed finished seasons 2021–2025; flag absent and thin snapshots.
    # Thresholds are coarse quality gates, NOT guarantees of complete fixture coverage.
    EXPECTED={"E0":380,"E1":552,"E2":552,"E3":552,
              "D1":306,"D2":306,"I1":380,"I2":380,
              "SP1":380,"SP2":462,"F1":306,"F2":306,
              "N1":306,"P1":306,"B1":240,"T1":306,
              "G1":200,"SC0":228,"AUT":180}
    season_gaps=[]
    summary={}
    for code in all_leagues:
        obj=league[code];n=obj["matches"]
        coverage={field:{"available":obj["stats"].get(field,0),"percentage":round(obj["stats"].get(field,0)/n*100,1) if n else 0}
                  for field in FIELDS}
        coverage["xg"]={"available":obj["xg"],"percentage":round(obj["xg"]/n*100,1) if n else 0}
        if code in EXPECTED:
            for y in range(2021,2026):
                observed=obj["seasons"].get(str(y),0)
                if observed<EXPECTED[code]*.80:
                    season_gaps.append({"division":code,"season":f"{y}/{(y+1)%100:02d}",
                                        "matches":observed,"typical_size":EXPECTED[code],
                                        "note":"thin or missing; source snapshots may be incomplete"})
        summary[code]={"matches":n,"first":obj["first"],"last":obj["last"],
            "seasons":dict(sorted(obj["seasons"].items())),"source_mix":dict(obj["sources"]),
            "coverage":coverage,"future_fixtures":fixtures_by_league[code],
            "excluded_from_model":obj["excluded_from_model"],
            "coverage_by_season":{year:{"matches":count,"coverage":{
                field:{"available":obj["season_stats"][year].get(field,0),
                       "percentage":round(obj["season_stats"][year].get(field,0)/count*100,1)}
                for field in (*FIELDS,"xg")}}
                for year,count in sorted(obj["seasons"].items())}}
    # Coverage is not uniform across markets. A zero here means unavailable,
    # never a 0% prediction or a lost game.
    stat_totals={field:sum(v["coverage"][field]["available"] for v in summary.values())
                 for field in (*FIELDS,"xg")}
    completed_season_gaps=collections.Counter(r["division"] for r in season_gaps)
    confidence={
        "historical_scores":"pass" if len(problems)==0 and sum(g["matches"] for g in summary.values())>=10000 else "review",
        "six_seasons":"incomplete" if season_gaps else "no_flagged_gaps",
        "match_stats":"missing" if not any(stat_totals[x] for x in ("shots","corners","yellow_cards")) else "partial",
        "upcoming_fixtures":"incomplete" if len(fixtures_by_league)<20 else "partial",
    }
    # Coverage alert is deliberately non-fatal; integrity violations are fatal.
    warnings=[]
    if season_gaps:warnings.append(f"{len(season_gaps)} historical league-seasons appear incomplete or missing")
    if not stat_totals["shots"]:warnings.append("Shots are unavailable in the published history")
    if not stat_totals["corners"]:warnings.append("Corners are unavailable in the published history")
    if not stat_totals["yellow_cards"]:warnings.append("Yellow cards are unavailable in the published history")
    if stale:warnings.append(f"{stale} stale calendar rows")
    if source_expectations is None:
        source_expectations=u.readjson(u.OUT/"archive_import_report.json",{}).get("sources",[])
    source_checks=[]
    for entry in source_expectations:
        div,year,expected=entry["division"],str(entry["season_start"]),entry["rows"]
        observed=summary.get(div,{}).get("seasons",{}).get(year,0)
        source_checks.append({"division":div,"season_start":int(year),"expected_source_rows":expected,
                              "observed_season_rows":observed,"covered_count":observed>=expected})
    return {"checked_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
        "as_of_date":today.isoformat(),"date_zone":"Europe/Sofia",
        "historical_matches":sum(g["matches"] for g in summary.values()),
        "historical_leagues":sum(g["matches"]>0 for g in summary.values()),
        "calendar_leagues":len(fixtures_by_league),
        "future_fixtures":future,"stale_fixture_rows":stale,
        "issues_total":len(problems),"issues":problems[:65],
        "readiness":confidence,"warnings":warnings,
        "observations_by_market":stat_totals,
        "excluded_from_model":sum(obj["excluded_from_model"] for obj in league.values()),
        "source_snapshot_checks":source_checks,
        "incomplete_leagues":dict(completed_season_gaps),
        "season_target":"2021/22–2026/27, season-only leagues. Calendar-year leagues differ.",
        "thin_or_missing_finished_seasons":season_gaps,
        "leagues":summary,
        "notes":[
            "A historic goal result does NOT imply shots/corners/cards coverage.",
            "OpenFootball CC0 archives supply scores and sometimes HT, not shots/corners/cards.",
            "Source country/date/team aliases may prevent joining to the calendar.",
            "The personal-use Football-Data archive is not a freely licensed commercial feed."
        ]}

def main():
    h=u.readjson(u.HIST,[])
    f=u.readjson(u.FIX,[])
    result=audit(h,f)
    u.writejson(u.OUT/"coverage_audit.json",result)
    compact={k:result[k] for k in ("historical_matches","historical_leagues","calendar_leagues","future_fixtures","stale_fixture_rows","issues_total")}
    compact["readiness"]=result["readiness"]
    compact["observations_by_market"]=result["observations_by_market"]
    worst=sorted(result["leagues"].items(),key=lambda p:p[1]["matches"])
    print(json.dumps({**compact,"small_leagues":[[n,v["matches"]] for n,v in worst[:9]],
                      "issues":result["issues"][:7],"thin_seasons":len(result["thin_or_missing_finished_seasons"])},ensure_ascii=False))
    if result["historical_matches"]<10000:raise SystemExit("Refuse empty/truncated archive")
    if result["issues_total"]:
        raise SystemExit("Fail audit: data-integrity issues need investigation")
if __name__=="__main__":main()
