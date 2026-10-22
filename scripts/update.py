#!/usr/bin/env python3
"""Matchpulse Auto: refresh Football-Data CSV results and fixture snapshots.

All data remains public JSON for GitHub Pages; no paid sports API.
"""
import csv
import datetime as dt
import io
import json
import os
import time
import urllib.request
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "data"
HIST = OUT / "history.json"
FIX = OUT / "fixtures.json"
STAT = OUT / "status.json"
MAIN = {
    "E0": ("England","Premier League"), "E1": ("England","Championship"),
    "B1": ("Belgium","Pro League"), "D2": ("Germany","2. Bundesliga"),
    "P1": ("Portugal","Primeira Liga"), "F2": ("France","Ligue 2"),
    "SP2": ("Spain","LaLiga 2"), "T1": ("Turkey","Super Lig"),
    "SP1": ("Spain","LaLiga"), "F1": ("France","Ligue 1"),
    "I2": ("Italy","Serie B"), "G1": ("Greece","Super League"),
    "N1": ("Netherlands","Eredivisie")
}
EXTRA = {
    "NOR": ("Norway","Eliteserien"), "SWE": ("Sweden","Allsvenskan"),
    "DNK": ("Denmark","Superliga"), "SWZ": ("Switzerland","Super League"),
    "AUT": ("Austria","Bundesliga"), "POL": ("Poland","Ekstraklasa")
}
LEAGUES = {**MAIN, **EXTRA}
from fixtures_fallback import collect as collect_secondary_fixtures

def val(row, *names):
    normalized = {str(k).lstrip("\ufeff").strip().lower(): v for k,v in row.items() if k}
    for n in names:
        x = normalized.get(n.lower())
        if x is not None and str(x).strip():
            return str(x).strip()
    return ""

def dayparse(value):
    for pattern in ("%Y-%m-%d","%d/%m/%Y","%d/%m/%y","%d-%m-%Y","%d-%m-%y","%Y/%m/%d"):
        try: return dt.datetime.strptime(value,pattern).date()
        except ValueError: pass
    return None

def number(value):
    try: return float(value) if str(value).strip() else None
    except (TypeError,ValueError): return None

def goals(value):
    n=number(value)
    return int(n) if n is not None and n>=0 and n<=30 and int(n)==n else None

def parse_csv(blob):
    for encoding in ("utf-8-sig","cp1252","latin1"):
        try:
            raw=blob.decode(encoding)
            break
        except UnicodeError: continue
    if not raw.strip() or raw.lstrip().lower().startswith(("<!doctype","<html")):
        raise ValueError("Empty or HTML response instead of CSV")
    try: dialect=csv.Sniffer().sniff(raw[:2500],delimiters=",;\t")
    except csv.Error: dialect=csv.excel
    rows=list(csv.DictReader(io.StringIO(raw),dialect=dialect))
    if not rows: raise ValueError("No rows")
    cols={str(k).strip().lower().lstrip("\ufeff") for k in rows[0] if k}
    if "date" not in cols or not ({"hometeam","awayteam"}<=cols or {"home","away"}<=cols):
        raise ValueError("Unexpected CSV columns")
    return rows

def make_row(row, fallback=None, fixture=False):
    div=(val(row,"DIV","division") or fallback or "").upper().strip()
    if div not in LEAGUES: return None
    d=dayparse(val(row,"Date"))
    home=" ".join(val(row,"HOME","HomeTeam").split())
    away=" ".join(val(row,"AWAY","AwayTeam").split())
    if not d or not home or not away or home.casefold()==away.casefold(): return None
    hg=goals(val(row,"HG","FTHG","home_goals"))
    ag=goals(val(row,"AG","FTAG","away_goals"))
    if fixture:
        if hg is not None or ag is not None: return None
    else:
        if hg is None or ag is None: return None
    country,league=LEAGUES[div]
    return [div,val(row,"Country") or country,val(row,"League") or league,
            d.isoformat(),val(row,"Time"),home,away,hg,ag,
            number(val(row,"HXG","HxG")),number(val(row,"AXG","AxG")),
            number(val(row,"B365>2.5","B365O2.5","B365O25","Avg>2.5","B365_OPEN_O25")),
            number(val(row,"B365<2.5","B365U2.5","B365U25","Avg<2.5","B365_OPEN_U25"))]

def readjson(path, default):
    try:
        obj=json.loads(path.read_text(encoding="utf8"))
        return obj if isinstance(obj,type(default)) else default
    except (OSError,ValueError): return default

def writejson(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    p=path.with_suffix(path.suffix+".tmp")
    p.write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")),encoding="utf8")
    os.replace(p,path)

def key(row):
    return (row[0],row[3],row[5].casefold(),row[6].casefold())

def fetch(url):
    req=urllib.request.Request(url,headers={
        "User-Agent":"Mozilla/5.0 MatchpulseOpenCSVResearch/1.0",
        "Accept":"text/csv,text/plain,*/*"
    })
    with urllib.request.urlopen(req,timeout=25) as response:
        return response.read(15_000_000)

def current_years(today,div):
    season_start=today.year if today.month>=7 else today.year-1
    years=[season_start-1,season_start]
    if div=="N1":
        years=list(range(2021,season_start+1))
    return years

def run(online=True, downloader=fetch, now=None, sleeper=time.sleep):
    today=now or dt.date.today()
    saved=readjson(HIST,[])
    history={key(r):r for r in saved
             if isinstance(r,list) and len(r)>=13 and isinstance(r[7],int) and isinstance(r[8],int)}
    for seed in sorted((ROOT/"data"/"extra_seed").glob("*.csv")):
        try:
            for r in parse_csv(seed.read_bytes()):
                parsed=make_row(r)
                if parsed: history[key(parsed)]=parsed
        except (OSError,ValueError): pass
    seed_master=ROOT/"data"/"seed_master.csv"
    if seed_master.exists():
        try:
            for r in parse_csv(seed_master.read_bytes()):
                parsed=make_row(r)
                if parsed: history[key(parsed)]=parsed
        except (OSError,ValueError): pass
    status=readjson(STAT,{})
    errors=[];checks={};success=0
    stamp=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    if online:
        targets=[]
        for div in MAIN:
            for yr in current_years(today,div):
                suffix=f"{yr%100:02d}{(yr+1)%100:02d}"
                targets.append((f"{div}-{suffix}",div,f"https://www.football-data.co.uk/mmz4281/{suffix}/{div}.csv"))
        for div in EXTRA:
            targets.append((div,div,f"https://www.football-data.co.uk/new/{div}.csv"))
        for label,div,url in targets:
            try:
                rows=parse_csv(downloader(url))
                valid=0
                for row in rows:
                    parsed=make_row(row,div)
                    if parsed and parsed[3]<=today.isoformat():
                        history[key(parsed)]=parsed;valid+=1
                if not valid: raise ValueError("No valid completed matches")
                success+=1;checks[label]=valid
            except Exception as exc:
                errors.append(f"{label}: {type(exc).__name__}: {exc}")
            sleeper(0.2)
        status.update(last_history_attempt_utc=stamp,
                      history_sources_total=len(targets),history_sources_ok=success)
        if success: status["last_history_success_utc"]=stamp
    upcoming=readjson(FIX,[])
    if online:
        try:
            rows=parse_csv(downloader("https://www.football-data.co.uk/fixtures.csv"))
            start=today.isoformat()
            end=(today+dt.timedelta(days=15)).isoformat()
            seen={}
            for row in rows:
                parsed=make_row(row,fixture=True)
                if parsed and start<=parsed[3]<=end:
                    seen[key(parsed)]=parsed
            upcoming=sorted(seen.values(),key=lambda r:(r[3],r[4],r[0],r[5]))
            status["fixtures_feed_status"]="ok" if upcoming else "no_future_matches"
            status["fixtures_checked_utc"]=stamp
            status["fixtures_source"]="football-data.co.uk/fixtures.csv"
            if upcoming: status["fixtures_updated_utc"]=stamp
        except Exception as exc:
            errors.append(f"fixtures: {type(exc).__name__}: {exc}")
            status["fixtures_feed_status"]="error"
            upcoming=[r for r in upcoming if isinstance(r,list) and len(r)>=13 and
                      today.isoformat()<=r[3]<=(today+dt.timedelta(days=15)).isoformat()]
        status["last_fixture_attempt_utc"]=stamp
    # Secondary source supplies schedules only. Never treat its scores as history.
    if online:
        secondary, source_counts, secondary_errors = collect_secondary_fixtures(
            downloader, today, LEAGUES, horizon_days=30
        )
        status["secondary_fixture_counts"] = source_counts
        status["secondary_fixture_sources_ok"] = len(source_counts)
        status["secondary_fixture_sources_total"] = 9
        status["secondary_fixture_errors"] = secondary_errors[:12]
        if secondary:
            # Prefer Football-Data fixtures when both feeds report the same match.
            # Avoid false clashes: a different kickoff time can reflect rescheduling,
            # therefore keep the primary only when the same teams and date match.
            merged = {(r[0], r[3], r[5].casefold(), r[6].casefold()):r for r in secondary}
            for r in upcoming:
                merged[(r[0], r[3], r[5].casefold(), r[6].casefold())] = r
            upcoming = sorted(merged.values(), key=lambda r:(r[3],r[4],r[0]))
            status["fixtures_feed_status"] = "ok_secondary"
            status["fixtures_source"] = "Football-Data + FixtureDownload (keyless)"
            status["fixtures_updated_utc"] = stamp
        elif status.get("fixtures_feed_status") == "no_future_matches":
            status["fixtures_source"] = "Football-Data; secondary calendar unavailable"
    if not history:
        raise RuntimeError("No completed matches available: keeping cached files untouched")
    historical=sorted(history.values(),key=lambda r:(r[3],r[0],r[5],r[6]))
    writejson(HIST,historical)
    writejson(FIX,upcoming)
    status.update(history_count=len(historical),fixtures_count=len(upcoming),
                  last_build_utc=stamp,errors=errors[:100],by_source=checks,
                  schema_version=2,
                  data_time_zone_note="Kickoff times are from the source, not automatically Europe/Sofia")
    writejson(STAT,status)
    print(json.dumps({"history_count":len(historical),"fixtures_count":len(upcoming),
                      "sources_ok":success,"errors":errors[:8]},ensure_ascii=False))
    return status

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--online",action="store_true")
    ap.add_argument("--seed",action="store_true")
    args=ap.parse_args()
    run(online=args.online)
