"""Build isolated, strictly Football-Data.co.uk CSV snapshots for MATCH LAB X.

The Soccerway schedule is already maintained in docs/data/fixtures.json by the
existing calendar pipeline; this process never contacts Soccerway directly.
Does not alter Prime Syndicate pages or the match-research private repository.
"""
from __future__ import annotations
import csv,datetime as dt,hashlib,io,json,sys,time,urllib.request,urllib.error
from pathlib import Path

BASE=Path(__file__).resolve().parents[1]
OUT=BASE/"docs"/"match-lab-x"/"data"
DIVISIONS={
 "E0":"Premier League","E1":"Championship","D1":"Bundesliga",
 "D2":"2. Bundesliga","I1":"Serie A","I2":"Serie B",
 "SP1":"La Liga","SP2":"Segunda División",
 "F1":"Ligue 1","F2":"Ligue 2","E2":"League One",
 "E3":"League Two","SC0":"Scottish Premiership",
 "N1":"Eredivisie","B1":"Belgian Pro League",
 "P1":"Primeira Liga","T1":"Süper Lig","G1":"Super League Greece"
}
YEARS=(2023,2024,2025,2026)
REQ_HEADERS={"User-Agent":"MatchLabX/1.0 (+independent research; public CSV download)"}
MIN_HISTORY=500

def as_int(value):
 try:
  if value is None or str(value).strip()=="":return None
  z=int(float(str(value).strip()))
  return z if z>=0 else None
 except (ValueError,TypeError):return None

def date_value(raw):
 value=str(raw or "").strip().split(" ")[0]
 for pattern in ("%d/%m/%Y","%d/%m/%y","%Y-%m-%d","%d-%m-%Y"):
  try:return dt.datetime.strptime(value,pattern).date().isoformat()
  except ValueError:pass
 return None

def parse_csv(raw,league,limit_date=None):
 if not raw or len(raw)<30:raise ValueError("Empty CSV")
 source=raw.decode("utf-8-sig",errors="replace")
 lines=source.splitlines()
 if not lines or not any("FTHG" in line and "FTAG" in line for line in lines[:5]):
  raise ValueError("CSV missing final score headers")
 rows=[]
 for item in csv.DictReader(io.StringIO(source)):
  if not item or str(item.get("Div",league)).strip() not in (league,""):continue
  date=date_value(item.get("Date"))
  if not date or limit_date and date>limit_date:continue
  home=str(item.get("HomeTeam") or "").strip()
  away=str(item.get("AwayTeam") or "").strip()
  hg=as_int(item.get("FTHG"));ag=as_int(item.get("FTAG"))
  if not home or not away or home==away or hg is None or ag is None:continue
  ht_h=as_int(item.get("HTHG"));ht_a=as_int(item.get("HTAG"))
  if ht_h is not None and ht_h>hg:ht_h=None
  if ht_a is not None and ht_a>ag:ht_a=None
  rows.append([date,home,away,hg,ag,ht_h,ht_a,
               as_int(item.get("HS")),as_int(item.get("AS")),
               as_int(item.get("HST")),as_int(item.get("AST")),
               as_int(item.get("HC")),as_int(item.get("AC")),
               as_int(item.get("HY")),as_int(item.get("AY"))])
 return rows

def download(year,division):
 season=f"{year%100:02d}{(year+1)%100:02d}"
 url=f"https://www.football-data.co.uk/mmz4281/{season}/{division}.csv"
 with urllib.request.urlopen(urllib.request.Request(url,headers=REQ_HEADERS),timeout=35) as response:
  data=response.read(4_000_000+1)
 if len(data)>4_000_000:raise ValueError("CSV exceeds safe per-file size")
 return url,data

def run():
 today=dt.datetime.now(dt.timezone.utc).date().isoformat()
 OUT.mkdir(parents=True,exist_ok=True)
 (OUT/"history").mkdir(exist_ok=True)
 catalog={"schema":1,"generated_utc":dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
          "history_provider":"Football-Data.co.uk / public historical CSV",
          "fixtures_provider":"Soccerway / curated existing public calendar",
          "years":list(YEARS),"leagues":{},"total_matches":0,
          "min_history_for_extra":MIN_HISTORY}
 for division,label in DIVISIONS.items():
  matches={};sources=[];problems=[]
  for year in YEARS:
   try:
    url,raw=download(year,division)
    rows=parse_csv(raw,division,today)
    if not rows:raise ValueError("No completed games in file")
    for row in rows:
     key=(row[0],row[1],row[2])
     old=matches.get(key)
     if old is None or sum(x is not None for x in row[5:])>sum(x is not None for x in old[5:]):
      matches[key]=row
    sources.append({"season":year,"url":url,"sha256":hashlib.sha256(raw).hexdigest(),"rows":len(rows)})
   except (TimeoutError,urllib.error.URLError,ValueError,OSError) as exc:
    problems.append({"season":year,"message":str(exc)[:180]})
  series=sorted(matches.values(),key=lambda x:x[0])
  shot_rows=sum(r[7] is not None and r[8] is not None for r in series)
  on_target=sum(r[9] is not None and r[10] is not None for r in series)
  hts=sum(r[5] is not None and r[6] is not None for r in series)
  file={"schema":1,"division":division,"league":label,
        "source":"Football-Data.co.uk","rows":series,
        "columns":["date","home","away","fth","fta","hth","hta","hs","as","hst","ast","hc","ac","hy","ay"],
        "seasons":sources}
  (OUT/"history"/f"{division}.json").write_text(
   json.dumps(file,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
  stats={"name":label,"matches":len(series),"first_date":series[0][0] if series else None,
         "last_date":series[-1][0] if series else None,
         "shots_matches":shot_rows,"on_target_matches":on_target,
         "halftime_matches":hts,"source_files":len(sources),
         "problems":problems,"ready":len(series)>=MIN_HISTORY}
  catalog["leagues"][division]=stats
  catalog["total_matches"]+=len(series)
  print(division,len(series),"shots",shot_rows,"files",len(sources),"errors",len(problems),flush=True)
  # Acknowledge source limits, avoid hammering a CSV origin.
  time.sleep(.22)
 (OUT/"coverage.json").write_text(
  json.dumps(catalog,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 if sum(catalog["leagues"][d]["matches"]>=500 for d in
        ("E0","E1","D1","D2","I1","I2","SP1","SP2","F1","F2"))<8:
  raise RuntimeError("Too few top-two tier leagues have valid historical coverage")
 return catalog

if __name__=="__main__":
 try:run()
 except Exception as error:
  print("MATCH LAB X public history build FAILED:",error,file=sys.stderr)
  raise
