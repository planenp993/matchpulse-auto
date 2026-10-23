#!/usr/bin/env python3
"""Build a dated research snapshot. No predictions, publication, or AI calls.

Usage: python build_snapshot.py --cache PATH [--refresh] [--date YYYY-MM-DD]
OpenLigaDB data: ODbL, https://www.openligadb.de/lizenz
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

SOFIA = ZoneInfo("Europe/Sofia")
ROOT = Path(__file__).resolve().parent

BG = {
 16: "Щутгарт", 87: "Мьонхенгладбах", 118: "Дармщат", 98: "Санкт Паули",
 129: "Бохум", 131: "Волфсбург", 1635: "РБ Лайпциг", 198: "Елверсберг",
 95: "Аугсбург", 80: "Унион Берлин", 81: "Майнц", 134: "Вердер Бремен",
 65: "Кьолн", 9: "Шалке 04", 31: "Падерборн", 100: "Хамбургер",
 7: "Дортмунд", 91: "Айнтрахт", 175: "Хофенхайм", 6: "Леверкузен",
 112: "Фрайбург", 40: "Байерн", 199: "Хайденхайм", 93: "Енерги Котбус",
 54: "Херта", 83: "Арминия", 78: "Магдебург", 105: "Карлсруе",
 79: "Нюрнберг", 76: "Кайзерслаутерн", 104: "Холщайн Кил", 177: "Динамо Дрезден",
 74: "Брауншвайг", 55: "Хановер", 36: "Оснабрюк", 115: "Гройтер Фюрт",
}
MONOGRAMS = {16:"VfB",87:"BMG",118:"D98",98:"STP",129:"BOC",131:"WOB",
 7:"BVB",91:"SGE",40:"FCB",6:"B04",1635:"RBL",112:"SCF",81:"M05"}
COLORS = {16:"#b33d38",87:"#294e42",118:"#22589d",98:"#684630",129:"#24559c",
 131:"#598d38",7:"#8b7813",91:"#ae3535",40:"#b62e46",6:"#b54035",1635:"#be394c"}

def utc(value):
    result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("UTC kickoff must have an offset")
    return result.astimezone(dt.timezone.utc)

def normalize(raw, league, season):
    kickoff = utc(raw["matchDateTimeUTC"])
    final = next((r for r in raw.get("matchResults", []) if r.get("resultTypeID") == 2), None)
    finished = raw.get("matchIsFinished") is True
    if finished and final is None:
        raise ValueError(f"Completed match {raw['matchID']} without full-time result")
    def team(t):
        tid=t["teamId"]
        return {"id": f"oldb:{tid}", "name": BG.get(tid,t.get("shortName") or t["teamName"]),
                "source_name":t["teamName"],"short":MONOGRAMS.get(tid,(t.get("shortName") or t["teamName"])[:3].upper()),
                "color":COLORS.get(tid,"#53675f")}
    return {"id":f"oldb:{raw['matchID']}","league_id":league,
            "league":"Бундеслига" if league=="bl1" else "Бундеслига 2",
            "season":season, "kickoff_utc":kickoff.isoformat().replace("+00:00","Z"),
            "date":kickoff.astimezone(SOFIA).date().isoformat(),
            "time":kickoff.astimezone(SOFIA).strftime("%H:%M"),
            "home":team(raw["team1"]),"away":team(raw["team2"]),
            "finished":finished,"score":[final["pointsTeam1"],final["pointsTeam2"]] if finished else None,
            "source_url":f"https://api.openligadb.de/getmatchdata/{league}/{season}",
            "round":raw.get("group",{}).get("groupOrderID"),
            "source_updated":raw.get("lastUpdateDateTime")}

def profile(history, team_id, kickoff, venue=None):
    # Strict timestamp cutoff. An unfinished or later game is never evidence.
    rows=sorted((r for r in history if r["finished"] and r["kickoff_utc"]<kickoff and
                 (r["home"]["id"]==team_id or r["away"]["id"]==team_id) and
                 (venue is None or (r["home"]["id"]==team_id)==venue)),
                 key=lambda r:r["kickoff_utc"],reverse=True)[:10]
    gf=[];ga=[];btts=0;over=0
    for r in rows:
        h,a=r["score"];home=r["home"]["id"]==team_id
        gf.append(h if home else a);ga.append(a if home else h)
        btts+=int(h>0 and a>0);over+=int(h+a>2.5)
    return {"n":len(rows),"gf":round(sum(gf)/len(gf),2) if rows else None,
            "ga":round(sum(ga)/len(ga),2) if rows else None,"btts":btts,"over25":over,
            "matches":[{"id":r["id"],"date":r["date"],"home":r["home"]["name"],
                        "away":r["away"]["name"],"score":r["score"]} for r in rows]}

def build(cache, today, refresh=False):
    season=today.year if today.month>=7 else today.year-1
    all_rows=[];checks=[];retrieved=[]
    for league in ("bl1","bl2"):
        for year in range(season-2,season+1):
            file=cache/f"{league}-{year}.json"
            if refresh or not file.exists():
                req=urllib.request.Request(f"https://api.openligadb.de/getmatchdata/{league}/{year}",
                    headers={"User-Agent":"PRIME-Research-Snapshot/0.1"})
                with urllib.request.urlopen(req,timeout=20) as response: data=json.load(response)
                if not isinstance(data,list) or not data:raise ValueError("Empty source snapshot")
                cache.mkdir(parents=True,exist_ok=True)
                file.write_text(json.dumps(data,ensure_ascii=False),encoding="utf-8")
            raw=json.loads(file.read_text(encoding="utf-8"))
            retrieved.append(file.stat().st_mtime)
            rows=[normalize(r,league,year) for r in raw]
            all_rows.extend(rows)
            checks.append({"source":"OpenLigaDB","league":league,"season":year,"n":len(rows),
                "completed":sum(r["finished"] for r in rows),
                "latest_completed":max((r["date"] for r in rows if r["finished"]),default=None)})
    ids=[r["id"] for r in all_rows]
    if len(ids)!=len(set(ids)):raise ValueError("Duplicate match IDs")
    history=[r for r in all_rows if r["finished"] and r["date"]<today.isoformat()]
    stop=today+dt.timedelta(days=30)
    fixtures=sorted([r for r in all_rows if not r["finished"] and today.isoformat()<=r["date"]<=stop.isoformat()],key=lambda r:r["kickoff_utc"])
    for f in fixtures:
        # Domestic comparisons only. Promoted clubs keep their sample labelled by competition.
        league_history=[r for r in history if r["league_id"]==f["league_id"]]
        f["home_stats"]=profile(league_history,f["home"]["id"],f["kickoff_utc"])
        f["away_stats"]=profile(league_history,f["away"]["id"],f["kickoff_utc"])
        f["home_venue"]=profile(league_history,f["home"]["id"],f["kickoff_utc"],True)
        f["away_venue"]=profile(league_history,f["away"]["id"],f["kickoff_utc"],False)
    return {"kind":"research_snapshot","date":today.isoformat(),
            "fetched_utc":dt.datetime.fromtimestamp(min(retrieved),dt.timezone.utc).isoformat(timespec="seconds"),
            "built_utc":dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "publication_allowed":False,"time_zone":"Europe/Sofia","fixtures":fixtures,
            "history_count":len(history),"checks":checks,
            "attribution":"Данни: OpenLigaDB, ODbL. Авторските текстове и примерните селекции са отделни от базата.",
            "license_url":"https://www.openligadb.de/lizenz"}

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--cache",type=Path,required=True)
    p.add_argument("--refresh",action="store_true");p.add_argument("--date",default=dt.datetime.now(SOFIA).date().isoformat())
    args=p.parse_args();payload=build(args.cache,dt.date.fromisoformat(args.date),args.refresh)
    (ROOT/"dist"/"data.js").write_text("window.PRIME_DATA = "+json.dumps(payload,ensure_ascii=False,separators=(",",":"))+";\n",encoding="utf-8")
    print(json.dumps({"fixtures":len(payload["fixtures"]),"history":payload["history_count"],"checks":payload["checks"]},ensure_ascii=False))
