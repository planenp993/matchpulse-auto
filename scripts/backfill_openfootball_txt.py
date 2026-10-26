#!/usr/bin/env python3
"""Conservative CC0 backfill from OpenFootball Football.TXT country repositories.

Covers historical scores NOT supplied in generated football.json, without
requesting football-data.co.uk. No player, shot, corner or card data is invented.
"""
import argparse
import calendar
import datetime as dt
import json
import re
import urllib.request
from pathlib import Path
import update as u
from backfill_openfootball import season_key

# These historical source files have been inspected. Do not use guessed paths.
SOURCES={
    "E2":("england","3-league1",552),
    "E3":("england","4-league2",552),
    "SP2":("espana","2-liga2",462),
    "I2":("italy","2-serieb",380),
    "F2":("europe","france/{season}_fr2",380),
    "G1":("europe","greece/{season}_gr1",240),
    "SC0":("europe","scotland/{season}_sco1",228),
    "T1":("europe","turkey/{season}_tr1",380),
}
MONTH={v[:3].lower():k for k,v in enumerate(calendar.month_name) if k}
DATE_RE=re.compile(r"^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$")
# Format 1: "15:00  Home Club    2-1 (1-0)   Away Club"
CENTER=re.compile(r"^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s{2,}(\d{1,2})-(\d{1,2})(?:\s+\((\d{1,2})-(\d{1,2})\))?\s{2,}(.+?)\s*$")
# Format 2: "15:00  Home Club   v Away Club    2-1 (1-0)"
AT_END=re.compile(r"^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s{2,}v\s+(.+?)\s{2,}(\d{1,2})-(\d{1,2})(?:\s+\((\d{1,2})-(\d{1,2})\))?\s*$")
HEADER_RE=re.compile(r"^=\s+.*\b(20\d{2})/(\d{2})\s*$")
BAD_TEAM={"","tbc","tbd"}
MAX_ROWS={"E2":552,"E3":552,"SP2":462,"I2":410,"F2":400,"G1":270,"SC0":260,"T1":410}

def fetch(url):
    req=urllib.request.Request(url,headers={"User-Agent":"MATCHPULSE-SCOUT-CC0-PersonalResearch/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(2_000_000).decode("utf-8-sig")

def url_for(year,repo,file):
    season=f"{year}-{(year+1)%100:02d}"
    if repo=="europe":
        return f"https://raw.githubusercontent.com/openfootball/europe/master/{file.format(season=season)}.txt"
    return f"https://raw.githubusercontent.com/openfootball/{repo}/master/{season}/{file}.txt"

def parse(text, division, year, today):
    """Return score-only rows, with source provenance and optional halftime data."""
    if not isinstance(text,str):raise ValueError("Expected text")
    titles=[line.strip() for line in text.splitlines() if line.strip().startswith("=")]
    if not titles:raise ValueError("Missing file title")
    m=HEADER_RE.match(titles[0])
    if not m or int(m[1])!=year or int(m[2])!=(year+1)%100:
        raise ValueError("Season title does not match requested season")
    if division not in u.LEAGUES:raise ValueError("Unknown division")
    country,league=u.LEAGUES[division]
    rows=[];day=None
    for line in text.splitlines():
        found=DATE_RE.match(line)
        if found:
            mo=MONTH.get(found[1].lower())
            if mo:
                actual_year=int(found[3]) if found[3] else year if mo>=7 else year+1
                try:day=dt.date(actual_year,mo,int(found[2]))
                except ValueError:day=None
            continue
        if not day or day>today or season_key(day.isoformat())!=year:continue
        awarded=bool(re.search(r"\s+\[awarded\]\s*$",line,re.I))
        clean=re.sub(r"\s+\[awarded\]\s*$","",line,flags=re.I)
        # Try the explicit home-v-away format first. Otherwise a trailing note
        # can be mistaken for the away club by the centered-score expression.
        final=AT_END.match(clean)
        regular=CENTER.match(clean)
        if final:
            time,home,away,hg,ag,ht_h,ht_a=final.groups()
        elif regular:
            time,home,hg,ag,ht_h,ht_a,away=regular.groups()
        else:continue
        home,away=" ".join(home.split())," ".join(away.split())
        if home.casefold() in BAD_TEAM or away.casefold() in BAD_TEAM or home.casefold()==away.casefold():continue
        if any(" v " in club or "[" in club or "]" in club for club in (home,away)):
            raise ValueError("Unparsed team annotation")
        hg,ag=int(hg),int(ag)
        if max(hg,ag)>30:continue
        extra={"SRC":"openfootball-txt-cc0"}
        if awarded:extra["AWARDED"]=True
        if ht_h is not None and ht_a is not None:
            extra.update(HTHG=int(ht_h),HTAG=int(ht_a))
        rows.append([division,country,league,day.isoformat(),time or "",
                     home,away,hg,ag,None,None,None,None,extra])
    keys={}
    for r in rows:
        k=u.key(r)
        if k in keys and keys[k][7:9]!=r[7:9]:
            raise ValueError("Conflicting duplicate in source")
        keys[k]=r
    if len(keys)>MAX_ROWS[division]:raise ValueError("Too many matches: possible cup/playoff contamination")
    return list(keys.values())

def fill(history,*,today=None,downloader=fetch):
    """Fill absent seasons only, or leave them unresolved. No fuzzy joins of identities."""
    today=today or dt.date.today()
    years=list(range(2021,2026))
    existing={u.key(r):r for r in history if isinstance(r,list) and len(r)>=13}
    counts={}
    for r in existing.values():
        try:k=(r[0],season_key(r[3]));counts[k]=counts.get(k,0)+1
        except (ValueError,TypeError):continue
    report={"source":"openfootball Football.TXT CC0","added":0,"by_league":{},
            "sources":[],"skipped_partial":[],"skipped_existing":[],"issues":[]}
    for div,(owner,filename,expected) in SOURCES.items():
        for year in years:
            # Europe archive coverage for these divisions starts in 2023/24.
            if div in ("G1","SC0","T1") and year<2023:
                continue
            n=counts.get((div,year),0)
            if n:
                report["skipped_existing" if n>=.8*expected else "skipped_partial"].append(f"{div}/{year}: {n}")
                continue
            url=url_for(year,owner,filename)
            try:
                rows=parse(downloader(url),div,year,today)
                if len(rows)<.65*expected:
                    raise ValueError(f"Incomplete source {len(rows)}/{expected}: no import")
                for row in rows:
                    k=u.key(row)
                    if k not in existing:
                        existing[k]=row
                        report["added"]+=1
                        report["by_league"][div]=report["by_league"].get(div,0)+1
                report["sources"].append({"division":div,"season":year,"rows":len(rows),"url":url})
            except Exception as exc:
                report["issues"].append(f"{div}/{year}: {type(exc).__name__}: {str(exc)[:100]}")
    return sorted(existing.values(),key=lambda r:(r[3],r[0],r[5],r[6])),report

def main():
    history=u.readjson(u.HIST,[])
    out,report=fill(history)
    if len(out)<len(history):raise SystemExit("Refused shrinking archive")
    if report["added"]:u.writejson(u.HIST,out)
    state=u.readjson(u.STAT,{})
    state["history_count"]=len(out)
    state["openfootball_txt_backfill"]={"checked_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
        "added":report["added"],"by_league":report["by_league"],
        "sources":len(report["sources"]),"issues":len(report["issues"])}
    u.writejson(u.STAT,state)
    u.writejson(u.OUT/"txt_backfill_report.json",report)
    print(json.dumps({"before":len(history),"after":len(out),"sources":len(report["sources"]),
        "added":report["added"],"issues":report["issues"][:6]},ensure_ascii=False))
if __name__=="__main__":main()
