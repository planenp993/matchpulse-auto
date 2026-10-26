#!/usr/bin/env python3
"""Refresh only secondary match calendars. No Football-Data URL is requested.

For personal research. Existing published results are never modified here.
"""
import datetime as dt
import json
import update as u
from fixtures_fallback import FEEDS, collect as collect_secondary_fixtures


def run(downloader=u.fetch, now=None):
    today = now or u.today_sofia()
    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    status = u.readjson(u.STAT, {})
    old = u.readjson(u.FIX, [])
    secondary, counts, errors = collect_secondary_fixtures(
        downloader, today, u.LEAGUES, horizon_days=30)
    status.update(
        secondary_fixture_counts=counts,
        secondary_fixture_sources_ok=len(counts),
        secondary_fixture_sources_total=len(FEEDS),
        secondary_fixture_errors=errors[:12],
        fixtures_checked_utc=stamp,
        last_fixture_attempt_utc=stamp,
    )

    future=lambda r: (isinstance(r,list) and len(r)>=13 and
        today.isoformat() <= str(r[3]) <= (today+dt.timedelta(days=30)).isoformat())
    is_secondary=lambda r:len(r)>13 and isinstance(r[13],str) and "FixtureDownload" in r[13]
    cached_secondary=[r for r in old if future(r) and is_secondary(r)]
    if counts:
        # Keep recent primary CSV calendar snapshots without querying their source.
        # Drop stale secondary fixtures that the refreshed feed no longer contains.
        primaries = [r for r in old if future(r) and
            not is_secondary(r) and
            str(r[3]) <= (today+dt.timedelta(days=15)).isoformat()]
        # A successful empty feed clears its old rows. Failed feeds retain
        # their usable cached rows while the status names their stale leagues.
        retained=[r for r in cached_secondary if r[0] not in counts]
        upcoming=u.merge_fixtures([*retained,*secondary,*primaries])
        status.update(
            fixtures_feed_status="partial_secondary" if errors else "ok_secondary" if upcoming else "no_future_matches",
            fixtures_source="Football-Data cached + FixtureDownload (keyless)",
            fixtures_updated_utc=stamp,
            stale_secondary_leagues=sorted({r[0] for r in retained}),
        )
    else:
        # If service unavailable, keep cached schedule but display its stale state.
        upcoming = u.merge_fixtures([r for r in old if future(r)])
        status.update(
            fixtures_feed_status="stale_secondary",
            fixtures_source="Cached schedule; last secondary refresh failed",
            stale_secondary_leagues=sorted({r[0] for r in cached_secondary}),
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
