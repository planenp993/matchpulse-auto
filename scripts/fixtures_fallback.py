"""Secondary, keyless FIXTURE feed. Football-Data remains the primary results source.

Fixture Download JSON is generally refreshed daily, not live. Each row retains
source provenance. This module does NOT import scores into match history.
"""
import datetime as dt
import json
from concurrent.futures import ThreadPoolExecutor
from fixtures_espn import FEEDS as ESPN_FEEDS, collect_league as collect_espn_league
from zoneinfo import ZoneInfo

FEEDS = {
    "E0": "epl",
    "E1": "championship",
    "E2": "efl-league-one",
    "E3": "efl-league-two",
    "D1": "bundesliga",
    "I1": "serie-a",
    "P1": "primeira-liga",
    "T1": "super-lig",
    "SC0": "scottish-premiership",
    "SP1": "la-liga",
    "F1": "ligue-1",
    "F2": "ligue-2",
    "N1": "eredivisie",
    "UCL": "champions-league",
    "UEL": "europa-league",
    "UECL": "conference-league",
}
CALENDAR_DIVISIONS = tuple([*FEEDS,*ESPN_FEEDS])


def is_secondary(row):
    return (len(row)>13 and isinstance(row[13],str)
            and row[13].startswith(("FixtureDownload","ESPN")))


CUP_META = {
    "UCL": ("Europe", "UEFA Champions League"),
    "UEL": ("Europe", "UEFA Europa League"),
    "UECL": ("Europe", "UEFA Conference League"),
}
ALIASES = {
    "E0": {"Spurs": "Tottenham", "Nott'm Forest": "Nott'm Forest"},
    "E1": {"Wolverhampton Wanderers": "Wolves",
           "Queens Park Rangers": "QPR", "West Bromwich Albion": "West Brom",
           "Cardiff City": "Cardiff", "Birmingham City": "Birmingham",
           "Blackburn Rovers": "Blackburn", "Bristol City": "Bristol City",
           "Derby County": "Derby", "Norwich City": "Norwich",
           "Sheffield United": "Sheffield United", "Swansea City": "Swansea",
           "Stoke City": "Stoke", "Preston North End": "Preston"},
    "SP1": {"Atlético Madrid": "Ath Madrid", "Atletico Madrid": "Ath Madrid",
            "Real Betis": "Betis", "Athletic Club": "Ath Bilbao",
            "RCD Espanyol": "Espanol"},
    "F1": {"Paris Saint-Germain": "Paris SG", "Olympique Lyonnais": "Lyon"},
    "N1": {"AZ Alkmaar": "AZ", "N.E.C. Nijmegen": "Nijmegen",
           "N.E.C.": "Nijmegen", "FC Twente": "Twente",
           "sc Heerenveen": "Heerenveen", "FC Groningen": "Groningen",
           "Sparta Rotterdam": "Sparta Rotterdam",
           "FC Utrecht": "Utrecht"},
}

def collect(download, today, leagues, horizon_days=30, observer=None):
    """Fetch each league independently; failures never masquerade as an empty feed."""
    season_start = today.year if today.month >= 7 else today.year - 1
    now_sofia = dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo("Europe/Sofia"))
    if today != now_sofia.date():
        now_sofia = dt.datetime.combine(today, dt.time.min, ZoneInfo("Europe/Sofia"))
    end = today + dt.timedelta(days=horizon_days)
    meta = {**leagues, **CUP_META}
    tasks = [(d,"FixtureDownload",slug) for d,slug in FEEDS.items() if d in meta]
    tasks += [(d,"ESPN",slug) for d,slug in ESPN_FEEDS.items() if d in meta]

    def one(task):
        div,provider,slug = task
        url = f"https://fixturedownload.com/feed/json/{slug}-{season_start}"
        try:
            observed = []
            if provider=="ESPN":
                rows = collect_espn_league(download,div,slug,meta[div],now_sofia,end,
                    observer=observed.append) if observer else collect_espn_league(download,div,slug,meta[div],now_sofia,end)
            else:
                items = json.loads(download(url).decode("utf-8-sig"))
                if not isinstance(items,list): raise ValueError("Not a list")
                rows = []
                for item in items:
                    if not isinstance(item,dict) or not item.get("DateUtc"): continue
                    try:
                        kickoff = dt.datetime.fromisoformat(item["DateUtc"].replace(" ","T").replace("Z","+00:00"))
                        if kickoff.tzinfo is None: continue
                        local = kickoff.astimezone(now_sofia.tzinfo)
                    except (ValueError,TypeError,OverflowError): continue
                    if not today-dt.timedelta(days=7)<=local.date()<=end: continue
                    home = ALIASES.get(div,{}).get(item.get("HomeTeam"),item.get("HomeTeam"))
                    away = ALIASES.get(div,{}).get(item.get("AwayTeam"),item.get("AwayTeam"))
                    if not home or not away or home==away: continue
                    if str(home).upper() in ("TBC","TBD") or str(away).upper() in ("TBC","TBD"): continue
                    country,league = meta[div]
                    row=[div,country,league,local.date().isoformat(),local.strftime("%H:%M"),
                                 str(home).strip(),str(away).strip(),None,None,None,None,None,None,
                                 "FixtureDownload / UTC→Europe-Sofia"]
                    scored=item.get("HomeTeamScore") is not None or item.get("AwayTeamScore") is not None
                    if observer:
                        observed.append({"row":row,"provider_id":f"FixtureDownload:{div}:{season_start}:{item['MatchNumber']}" if item.get("MatchNumber") is not None else None,
                            "round":item.get("RoundNumber"),"phase":item.get("Group"),
                            "status":"provisional_result" if scored else "scheduled"})
                    if not scored and now_sofia<=local and today<=local.date()<=end: rows.append(row)
            return div,rows,None,observed
        except Exception as exc:
            source = url if provider=="FixtureDownload" else "ESPN "+slug
            return div,[],f"{div} ({source}): {type(exc).__name__}: {exc}",[]

    counts,errors,rows = {},[],[]
    # Bound provider traffic and avoid one slow league blocking the other sources.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for div,fixtures,error,observed in pool.map(one,tasks):
            if error: errors.append(error)
            else:
                counts[div]=len(fixtures);rows.extend(fixtures)
                if observer:
                    for item in observed: observer(item)
    return sorted(rows,key=lambda r:(r[3],r[4],r[0],r[5])),counts,errors
