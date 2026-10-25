#!/usr/bin/env python3
"""Refresh only secondary match calendars. No Football-Data URL is requested.

For personal research. Existing published results are never modified here.
"""
import datetime as dt
import json
from zoneinfo import ZoneInfo
import update as u
from fixtures_fallback import collect as collect_secondary_fixtures


def run(downloader=u.fetch, now=None):
    today = now or dt.datetime.now(ZoneInfo("Europe/Sofia")).date()
    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    status = u.readjson(u.STAT, {})
    old = u.readjson(u.FIX, [])
    secondary, counts, errors = collect_secondary_fixtures(
        downloader, today, u.LEAGUES, horizon_days=30)
    status.update(
        secondary_fixture_counts=counts,
        secondary_fixture_sources_ok=len(counts),
        secondary_fixture_sources_total=9,
        secondary_fixture_errors=errors[:12],
        fixtures_checked_utc=stamp,
        last_fixture_attempt_utc=stamp,
    )

    future=lambda r: (isinstance(r,list) and len(r)>=13 and
        today.isoformat() <= str(r[3]) <= (today+dt.timedelta(days=30)).isoformat())
    if secondary:
        # Keep recent primary CSV calendar snapshots without querying their source.
        # Drop stale secondary fixtures that the refreshed feed no longer contains.
        primaries = [r for r in old if future(r) and
            not (len(r)>13 and "FixtureDownload" in str(r[13])) and
            str(r[3]) <= (today+dt.timedelta(days=15)).isoformat()]
        merged = {u.key(r):r for r in secondary}
        for r in primaries: merged[u.key(r)] = r
        upcoming = sorted(merged.values(), key=lambda r:(r[3],r[4],r[0],r[5]))
        status.update(
            fixtures_feed_status="ok_secondary" if not errors else "partial_secondary",
            fixtures_source="Football-Data cached + FixtureDownload (keyless)",
            fixtures_updated_utc=stamp,
        )
    else:
        # If service unavailable, keep cached schedule but display its stale state.
        upcoming = [r for r in old if future(r)]
        status.update(
            fixtures_feed_status="stale_secondary",
            fixtures_source="Cached schedule; last secondary refresh failed",
        )
    u.writejson(u.FIX, upcoming)
    status.update(
        fixtures_count=len(upcoming),
        last_build_utc=stamp,
        history_count=status.get("history_count",len(u.readjson(u.HIST,[]))),
        calendar_only=True,
    )
    u.writejson(u.STAT, status)
    print(json.dumps({"fixtures":len(upcoming),"fresh_feeds":len(counts),
        "errors":errors[:5],"football_data_fetches":0},ensure_ascii=False))
    return status


if __name__=="__main__":
    run()
