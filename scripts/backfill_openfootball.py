#!/usr/bin/env python3
"""Safely supplement a personal research history from CC0 OpenFootball JSON.

Six rolling Aug/May seasons. No Football-Data downloads. No live-fixture import.
Protect covered seasons; do NOT blend two publishers for the same partial season.
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as u

SOURCE = "https://raw.githubusercontent.com/openfootball/football.json/master"
SOURCES = {
    "E0":"en.1", "E1":"en.2", "E2":"en.3", "E3":"en.4",
    "D1":"de.1", "D2":"de.2",
    "I1":"it.1", "I2":"it.2",
    "SP1":"es.1","SP2":"es.2",
    "F1":"fr.1","F2":"fr.2",
    "N1":"nl.1","P1":"pt.1",
    "B1":"be.1","T1":"tr.1","G1":"gr.1",
    "AUT":"at.1","SC0":"sco.1",
}
# Aliases explicitly confirmed in public source or historical Football-Data naming.
# Never guess from a fuzzy similarity threshold: "United" is not a unique club.
ALIASES = {
    "E0": {"Manchester United":"Man United", "Manchester City":"Man City",
           "Tottenham Hotspur":"Tottenham", "Nottingham Forest":"Nott'm Forest"},
    "D1": {"FC Bayern München":"Bayern Munich", "Borussia Dortmund":"Dortmund",
           "Bayer 04 Leverkusen":"Leverkusen", "VfB Stuttgart":"Stuttgart"},
    "N1": {"PSV Eindhoven":"PSV","Ajax Amsterdam":"Ajax"},
}
# Missing optional stats aren't converted into zeros and never copied between sources.
def season_key(date):
    d=dt.date.fromisoformat(str(date))
    return d.year if d.month>=7 else d.year-1

def url_for(year, name):
    return f"{SOURCE}/{year}-{(year+1)%100:02d}/{name}.json"

def parse(data, division, today):
    if not isinstance(data, dict) or not isinstance(data.get("matches"), list):
        raise ValueError("OpenFootball JSON must contain a matches array")
    country, league = u.LEAGUES[division]
    out=[]
    for m in data["matches"]:
        if not isinstance(m,dict):continue
        date=u.dayparse(str(m.get("date") or ""))
        home=str(m.get("team1") or "").strip()
        away=str(m.get("team2") or "").strip()
        ft=m.get("score") or {}
        ft=ft.get("ft") if isinstance(ft,dict) else None
        if not date or date>today or not home or not away or home==away:
            continue
        if not isinstance(ft,list) or len(ft)!=2:
            continue
        hg,ag=(u.goals(str(n)) for n in ft)
        if hg is None or ag is None:continue
        home=ALIASES.get(division,{}).get(home,home)
        away=ALIASES.get(division,{}).get(away,away)
        extra={"SRC":"openfootball-cc0"}
        score=m.get("score") or {}
        ht=score.get("ht") if isinstance(score,dict) else None
        if isinstance(ht,list) and len(ht)==2:
            a,b=(u.goals(str(n)) for n in ht)
            if a is not None and b is not None:
                extra["HTHG"],extra["HTAG"]=a,b
        out.append([division,country,league,date.isoformat(),m.get("time") or "",
                    home,away,hg,ag,None,None,None,None,extra])
    return out

def fetch(url):
    req=urllib.request.Request(url,headers={"User-Agent":"MATCHPULSE-SCOUT-CC0-PersonalResearch/1.0",
                                           "Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=22) as r:
        return json.loads(r.read(1_800_000).decode("utf-8-sig"))

def run(history, *, today=None, downloader=fetch, seasons=6):
    today=today or dt.date.today()
    start=today.year if today.month>=7 else today.year-1
    first=start-seasons+1
    results={u.key(r):r for r in history if isinstance(r,list) and len(r)>=13 and
             isinstance(r[7],int) and isinstance(r[8],int)}
    # Pre-existing matches determine whether a season is already covered.
    coverage=defaultdict(int)
    for r in results.values():
        try:coverage[(r[0],season_key(r[3]))]+=1
        except ValueError:pass
    status={"source":"openfootball/football.json","license":"CC0",
            "period":[first,start],"added":0,"skipped_covered":[],"skipped_partial":[],
            "fetched":[],"errors":[],"by_league":{}}
    for division,name in SOURCES.items():
        for year in range(first,start+1):
            existing=coverage.get((division,year),0)
            # Guard against alias collisions when overlapping with Football-Data results.
            # No merges into partially populated same-season feeds.
            if existing>=120:
                status["skipped_covered"].append(f"{division}/{year}: {existing}")
                continue
            if 0<existing<120:
                status["skipped_partial"].append(f"{division}/{year}: {existing}")
                continue
            url=url_for(year,name)
            try:
                payload=downloader(url)
                rows=[r for r in parse(payload,division,today) if season_key(r[3])==year]
                if not rows:raise ValueError("No completed matches")
                # Repeated club+date with distinct FT is suspicious. Block the feed.
                keys={};error=None
                for r in rows:
                    k=u.key(r)
                    if k in keys and keys[k][7:9]!=r[7:9]:
                        error="conflicting same-date final scores";break
                    keys[k]=r
                if error:raise ValueError(error)
                added=0
                for k,r in keys.items():
                    if k not in results:
                        results[k]=r;added+=1
                status["added"]+=added
                status["fetched"].append(f"{division}/{year}: {len(keys)} rows, +{added}")
                status["by_league"][division]=status["by_league"].get(division,0)+added
            except (OSError,ValueError,TypeError,KeyError,json.JSONDecodeError) as e:
                status["errors"].append(f"{division}/{year}: {type(e).__name__}: {str(e)[:110]}")
            except Exception as e:
                status["errors"].append(f"{division}/{year}: network/format {type(e).__name__}: {str(e)[:90]}")
            # Avoid a request storm on free shared infrastructure.
            time.sleep(.14)
    merged=sorted(results.values(),key=lambda r:(r[3],r[0],r[5],r[6]))
    return merged,status

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--seasons",type=int,default=6,choices=range(1,9))
    args=p.parse_args()
    before=u.readjson(u.HIST,[])
    output,log=run(before,seasons=args.seasons)
    if len(output)<len(before):raise SystemExit("Refusing a shrinking historical archive")
    if log["added"]:
        u.writejson(u.HIST,output)
    state=u.readjson(u.STAT,{})
    state["history_count"]=len(output)
    state["openfootball_backfill"]={
      "source":log["source"],"license":log["license"],"seasons":log["period"],
      "added":log["added"],"by_league":log["by_league"],"checked_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
      "issues":len(log["errors"]),"partial_seasons":len(log["skipped_partial"])}
    u.writejson(u.STAT,state)
    u.writejson(u.OUT/"backfill_report.json",log)
    print(json.dumps({"before":len(before),"after":len(output),"added":log["added"],
                      "successful_feeds":len(log["fetched"]),"skipped_covered":len(log["skipped_covered"]),
                      "partial_seasons":len(log["skipped_partial"]),"errors":log["errors"][:9],
                      "by_league":log["by_league"]},ensure_ascii=False))

if __name__=="__main__":
    main()
