#!/usr/bin/env python3
"""Walk-forward evaluation of the *same* simple goal equations as browser engine.

No odds / ROI. Historical replay, never use a match on or after forecast date.
This is a diagnostic, not evidence of prospective commercial profitability.
"""
import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
HISTORY=ROOT/"docs/data/history.json"
OUT=ROOT/"docs/data/model_report.json"

def mean(rows, i, fallback):
    return sum(row[i] for row in rows)/len(rows) if rows else fallback

def stats(rows, team):
    if not rows:return None
    return {"n":len(rows),
            "gf":sum(r[7] if r[5]==team else r[8] for r in rows)/len(rows),
            "ga":sum(r[8] if r[5]==team else r[7] for r in rows)/len(rows)}

def shrunk(x,n,prior,prior_games=4):
    return (x*n+prior*prior_games)/(n+prior_games)

def over_two_five(lam):
    return 1-math.exp(-lam)*(1+lam+lam*lam/2)

def forecast(pre, game):
    """Match browser formula: 35% base, 40% recent10, 25% venue10."""
    div,date,home,away=game[0],game[3],game[5],game[6]
    league=[r for r in pre if r[0]==div and r[3]<date and r[3]>=str(int(date[:4])-3)+date[4:]]
    h=sorted([r for r in pre if r[0]==div and r[3]<date and (r[5]==home or r[6]==home)], key=lambda r:r[3],reverse=True)
    a=sorted([r for r in pre if r[0]==div and r[3]<date and (r[5]==away or r[6]==away)], key=lambda r:r[3],reverse=True)
    if min(len(h),len(a))<5 or not league: return None
    bh=mean(league,7,1.45);ba=mean(league,8,1.23)
    hs=stats(h[:10],home);aws=stats(a[:10],away)
    hs_venue=stats([r for r in h if r[5]==home][:10],home)
    as_venue=stats([r for r in a if r[6]==away][:10],away)
    recenth=(hs["gf"]+aws["ga"])/2
    recenta=(aws["gf"]+hs["ga"])/2
    venueh=((hs_venue["gf"] if hs_venue else hs["gf"])+(as_venue["ga"] if as_venue else aws["ga"]))/2
    venuea=((as_venue["gf"] if as_venue else aws["gf"])+(hs_venue["ga"] if hs_venue else hs["ga"]))/2
    n=min(hs_venue["n"] if hs_venue else 0,as_venue["n"] if as_venue else 0)
    eh=max(.15,min(3.6,.35*bh+.40*recenth+.25*shrunk(venueh,n,bh)))
    ea=max(.15,min(3.6,.35*ba+.40*recenta+.25*shrunk(venuea,n,ba)))
    return {"our":over_two_five(eh+ea),
            "league":over_two_five(bh+ba),
            "eh":eh,"ea":ea, "sample":min(len(h),len(a))}

def report(history, since="2026-08-20"):
    history=sorted([r for r in history if isinstance(r,list) and len(r)>=13 and
        isinstance(r[7],int) and isinstance(r[8],int)],key=lambda r:r[3])
    by_league=defaultdict(list)
    for r in history: by_league[r[0]].append(r)
    obs=[]
    for div, games in by_league.items():
        for i,game in enumerate(games):
            if not (since<=game[3] and game[3]<=dt.date.today().isoformat()):
                continue
            z=forecast(games[:i],game)
            if z is None:continue
            actual=int(game[7]+game[8]>=3)
            obs.append({"div":div,"date":game[3],"actual":actual,**z})
    if not obs:
        return {"n":0,"note":"Няма достатъчно мачове за теста", "since":since}
    def score(a,b):return sum((r[a]-r["actual"])**2 for r in b)/len(b)
    bins=[]
    for low in range(0,100,20):
        subset=[r for r in obs if low<=r["our"]*100<(low+20 if low<80 else 101)]
        if subset:
            bins.append({"range":f"{low}-{min(low+20,100)}%","n":len(subset),
                         "forecast":round(mean(subset,"our",0),3),
                         "actual":round(mean(subset,"actual",0),3)})
    league_scores=[]
    for div in sorted({r["div"] for r in obs}):
        rows=[r for r in obs if r["div"]==div]
        league_scores.append({"league":div,"n":len(rows),
                            "brier":round(score("our",rows),4),
                            "baseline_brier":round(score("league",rows),4)})
    return {"n":len(obs),"since":since,"until":max(x["date"] for x in obs),
            "market":"Over 2.5 goals","model":"browser weighted Poisson 35/40/25",
            "brier":round(score("our",obs),4),
            "baseline_brier":round(score("league",obs),4),
            "bins":bins,"leagues":league_scores,
            "method":"walk-forward historical replay; cutoff date strictly before fixture; sample >=5 per team; fixed weights",
            "limitations":"retrospective diagnostic; weights not cross-validated; no bookmaker prices; no yield/ROI claim"}

def main():
    rows=json.loads(HISTORY.read_text(encoding="utf-8"))
    result=report(rows)
    OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(json.dumps({"walk_forward_n":result["n"],"brier":result.get("brier"),"league_baseline":result.get("baseline_brier")}))
if __name__=="__main__":main()
