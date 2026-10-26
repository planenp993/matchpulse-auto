"""Keyless ESPN schedules, restricted to published league calendar dates.

Only explicitly scheduled, unplayed events become fixtures. Results, team
statistics and ratings are never imported by this module.
"""
import datetime as dt
import gzip
import json


FEEDS = {"D2":"ger.2", "I2":"ita.2", "B1":"bel.1", "SP2":"esp.2", "G1":"gre.1"}


def url_for(slug, day):
    return ("https://site.api.espn.com/apis/site/v2/sports/soccer/"
            f"{slug}/scoreboard?dates={day.replace('-', '')}")


def read_board(download, slug, day):
    raw = download(url_for(slug, day))
    if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
    data = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(data,dict) or not isinstance(data.get("events"),list):
        raise ValueError("Invalid ESPN scoreboard")
    leagues = data.get("leagues",[])
    if not any(isinstance(x,dict) and x.get("slug")==slug for x in leagues):
        raise ValueError("ESPN league identity does not match the requested league")
    return data


def collect_league(download, division, slug, metadata, now_sofia, end):
    today = now_sofia.date()
    board = read_board(download,slug,today.isoformat())
    league = next(x for x in board["leagues"] if x.get("slug")==slug)
    if (league.get("calendarType")!="day" or league.get("calendarIsWhitelist") is not True
            or not isinstance(league.get("calendar"),list)):
        raise ValueError("No authoritative day calendar; refusing speculative date requests")
    days = set()
    for value in league["calendar"]:
        day = dt.date.fromisoformat(str(value)[:10])
        if today<=day<=end: days.add(day.isoformat())
    events = list(board["events"])
    for day in sorted(days-{today.isoformat()}):
        # Any failed day rejects this league refresh, preserving its cached rows.
        events.extend(read_board(download,slug,day)["events"])
    country,name = metadata
    rows = {}
    for event in events:
        if not isinstance(event,dict): continue
        for game in event.get("competitions",[]):
            if not isinstance(game,dict): continue
            status = game.get("status",event.get("status",{})).get("type",{})
            if status.get("state")!="pre" or status.get("completed") is not False: continue
            if status.get("name") not in ("STATUS_SCHEDULED","STATUS_TIME_TBD"): continue
            if game.get("dateValid") is False: continue
            try:
                kickoff = dt.datetime.fromisoformat(str(game.get("date",event.get("date",""))).replace("Z","+00:00"))
                if kickoff.tzinfo is None: continue
                local = kickoff.astimezone(now_sofia.tzinfo)
            except (ValueError,TypeError,OverflowError): continue
            time_known = game.get("timeValid") is not False and status.get("name")!="STATUS_TIME_TBD"
            if not today<=local.date()<=end or (time_known and local<now_sofia): continue
            sides = {}
            for side in game.get("competitors",[]):
                team = side.get("team",{})
                label = str(team.get("displayName","")).strip()
                if side.get("homeAway") in ("home","away") and label:
                    sides[side["homeAway"]] = label
            if set(sides)!={"home","away"} or sides["home"]==sides["away"]: continue
            row = [division,country,name,local.date().isoformat(),local.strftime("%H:%M") if time_known else "",
                   sides["home"],sides["away"],None,None,None,None,None,None,
                   "ESPN / UTC→Europe-Sofia"+("; kickoff unconfirmed" if not time_known else "")]
            rows[str(game.get("id") or event.get("id") or (row[3],row[5],row[6]))] = row
    return sorted(rows.values(),key=lambda r:(r[3],r[4],r[5]))
