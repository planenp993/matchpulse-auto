"""Secondary, keyless FIXTURE feed. Football-Data remains the primary results source.

Fixture Download JSON is generally refreshed daily, not live. Each row retains
source provenance. This module does NOT import scores into match history.
"""
import datetime as dt
import json
from zoneinfo import ZoneInfo

FEEDS = {
    "E0": "epl",
    "E1": "championship",
    "SP1": "la-liga",
    "F1": "ligue-1",
    "F2": "ligue-2",
    "N1": "eredivisie",
    "UCL": "champions-league",
    "UEL": "europa-league",
    "UECL": "conference-league",
}
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

def collect(download, today, leagues, horizon_days=30):
    """Returns (fixtures, feed_counts, errors). Empty or invalid feeds are not fabricated."""
    season_start = today.year if today.month >= 7 else today.year - 1
    now_sofia = dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo("Europe/Sofia"))
    if today != now_sofia.date():
        # Deterministic historical fixture tests can set a date explicitly.
        now_sofia = dt.datetime.combine(today, dt.time.min, ZoneInfo("Europe/Sofia"))
    end = today + dt.timedelta(days=horizon_days)
    fixture_map, counts, errors = {}, {}, []
    meta = {**leagues, **CUP_META}
    for div, slug in FEEDS.items():
        url = f"https://fixturedownload.com/feed/json/{slug}-{season_start}"
        try:
            raw = download(url)
            items = json.loads(raw.decode("utf-8-sig"))
            if not isinstance(items, list):
                raise ValueError("Not a list")
            accepted = 0
            for item in items:
                if not isinstance(item, dict) or not item.get("DateUtc"):
                    continue
                if item.get("HomeTeamScore") is not None or item.get("AwayTeamScore") is not None:
                    continue
                try:
                    kickoff = dt.datetime.fromisoformat(item["DateUtc"].replace(" ", "T").replace("Z", "+00:00"))
                    if kickoff.tzinfo is None:
                        continue
                    local = kickoff.astimezone(ZoneInfo("Europe/Sofia"))
                except (ValueError, TypeError, OverflowError):
                    continue
                if not (now_sofia <= local and today <= local.date() <= end):
                    continue
                home = ALIASES.get(div, {}).get(item.get("HomeTeam"), item.get("HomeTeam"))
                away = ALIASES.get(div, {}).get(item.get("AwayTeam"), item.get("AwayTeam"))
                if not home or not away or home == away or str(home).upper() in ("TBC", "TBD") or str(away).upper() in ("TBC", "TBD"):
                    continue
                country, league = meta[div]
                row = [div, country, league, local.date().isoformat(), local.strftime("%H:%M"),
                       str(home).strip(), str(away).strip(), None, None, None, None, None, None,
                       "FixtureDownload / UTC→Europe-Sofia"]
                key = (div, kickoff.isoformat(), home, away)
                fixture_map[key] = row
                accepted += 1
            counts[div] = accepted
        except Exception as exc:
            errors.append(f"{div} ({url}): {type(exc).__name__}: {exc}")
    return sorted(fixture_map.values(), key=lambda r: (r[3], r[4], r[0], r[5])), counts, errors
