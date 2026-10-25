#!/usr/bin/env python3
"""Small weekly CC0 results update for leagues not served by existing Football-Data feeds.

Never requests Football-Data. Never replaces richer existing match stats.
"""
import datetime as dt
import json
from pathlib import Path
import update as u
import backfill_openfootball as of

# Verified available 2026/27 OpenFootball JSON files; absent competitions aren't spammed.
CURRENT_SUPPORTED=("D1","I1")
def run(today=None, downloader=of.fetch):
    today=today or dt.date.today()
    season=today.year if today.month>=7 else today.year-1
    old=u.readjson(u.HIST,[])
    bykey={u.key(r):r for r in old if isinstance(r,list) and len(r)>=13}
    added=0;issues=[];by_league={}
    for div in CURRENT_SUPPORTED:
        try:
            payload=downloader(of.url_for(season,of.SOURCES[div]))
            found=[r for r in of.parse(payload,div,today) if of.season_key(r[3])==season]
            for r in found:
                key=u.key(r)
                if key in bykey:
                    prev=bykey[key]
                    if prev[7:9]!=r[7:9]:
                        issues.append(f"Score conflict; retained original {div}/{r[3]}/{r[5]}")
                    continue
                bykey[key]=r;added+=1;by_league[div]=by_league.get(div,0)+1
        except Exception as exc:
            issues.append(f"{div}: {type(exc).__name__}: {str(exc)[:100]}")
    if added:
        u.writejson(u.HIST,sorted(bykey.values(),key=lambda r:(r[3],r[0],r[5],r[6])))
    status=u.readjson(u.STAT,{})
    status["history_count"]=len(bykey)
    status["openfootball_weekly"]={
      "checked_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
      "added":added,"by_league":by_league,"issues":issues}
    u.writejson(u.STAT,status)
    print(json.dumps({"added":added,"leagues":by_league,"issues":issues},ensure_ascii=False))
    return status
if __name__=="__main__":
    run()
