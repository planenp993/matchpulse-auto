#!/usr/bin/env python3
"""Collect once, safely rebase a data patch, retain every observed fixture.

Code pushes are provider-free. Scheduling decides what is due from successful
receipts, rather than from an exact cron string. No training or model changes.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as u
import match_registry as registry
from fixtures_fallback import collect as calendars, CALENDAR_DIVISIONS, is_secondary

ROOT = u.ROOT
REGISTRY = "data/match_registry.json"
LINKS = "docs/data/match_links.json"
HEALTH = "docs/data/data_health.json"
MODES = ("auto", "full", "history", "calendar", "publish")


def utcnow():
    return dt.datetime.now(dt.timezone.utc)


def iso(value):
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def age(value, now):
    try:
        return (now-dt.datetime.fromisoformat(value.replace("Z", "+00:00"))).total_seconds()/3600
    except (ValueError, TypeError, AttributeError):
        return float("inf")


def targets(today, full):
    result = []
    for div in u.CSV_LEAGUES:
        for year in u.current_years(today, div)[0 if full else 1:]:
            suffix = f"{year%100:02d}{(year+1)%100:02d}"
            result.append((f"{div}-{suffix}", div, f"https://www.football-data.co.uk/mmz4281/{suffix}/{div}.csv"))
    result += [(div, div, f"https://www.football-data.co.uk/new/{div}.csv") for div in u.EXTRA]
    return result


def quote_window(now):
    uk = now.astimezone(ZoneInfo("Europe/London"))
    # FD publishes by Tuesday 13:00 / Friday 17:00 UK. A safety margin follows.
    for offset in range(8):
        day = uk.date()-dt.timedelta(days=offset)
        hour = {1: 13, 4: 17}.get(day.weekday())
        if hour is None:
            continue
        window = dt.datetime.combine(day, dt.time(hour, 10), ZoneInfo("Europe/London"))
        if window <= uk:
            return day.isoformat()
    raise ValueError("No quote publication window")


def plan(status, mode, now):
    if mode not in MODES:
        raise ValueError("Unknown refresh mode")
    if mode == "publish":
        return {"mode": mode, "history": False, "full": False, "calendar": False, "quotes": False}
    today = u.today_sofia(now)
    full_due = age(status.get("last_full_history_success_utc"), now) >= 96
    current_due = age(status.get("last_current_history_success_utc"), now) >= 20
    can_history = age(status.get("last_history_attempt_utc"), now) >= 2
    full = mode == "full" or mode == "auto" and full_due and can_history
    history = mode in ("full", "history") or mode == "auto" and (full or current_due and can_history)
    calendar = mode in ("full", "calendar") or mode == "auto" and age(status.get("last_fixture_attempt_utc"), now) >= 8
    window = quote_window(now)
    quotes = mode == "full" or mode == "auto" and status.get("quote_window") != window and age(status.get("last_quote_attempt_utc"), now) >= 2
    return {"mode": mode, "history": bool(history), "full": bool(full), "calendar": calendar,
            "quotes": quotes, "quote_window": window, "history_targets": len(targets(today, full)) if history else 0}


def requested_mode(root, event, mode, request_commit=None):
    """The one push exception is an explicit, data-only operational request."""
    if event != "push":
        return mode, None
    if not request_commit:
        return "publish", None
    message = subprocess.check_output(["git", "show", "-s", "--format=%s", request_commit], cwd=root, text=True).strip()
    paths = subprocess.check_output(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", request_commit], cwd=root, text=True).splitlines()
    if not message.startswith("[data-sync] ") or paths != ["ops/sync_request.json"]:
        return "publish", None
    raw = subprocess.check_output(["git", "show", request_commit+":ops/sync_request.json"], cwd=root)
    request = json.loads(raw)
    if request.get("mode") not in ("auto", "full", "history", "calendar") or not isinstance(request.get("id"), str) or not request["id"]:
        raise ValueError("Invalid explicit data request")
    return request["mode"], request["id"]


def collect(root, mode, now, download=u.fetch, request_id=None):
    status = u.readjson(root/"docs/data/status.json", {})
    if request_id and request_id in status.get("processed_sync_requests", []):
        mode = "publish"
    work = plan(status, mode, now)
    history = u.index_history(u.readjson(root/"docs/data/history.json", []))
    stamp, today = iso(now), u.today_sofia(now)
    patch = {"schema": 1, "observed_at_utc": stamp, "plan": work, "request_id": request_id,
             "history": [], "checks": {}, "errors": [], "observations": [],
             "calendar": None, "quotes": None}

    def one(target):
        label, div, url = target
        check = {"division": div, "url": url, "attempt_utc": stamp}
        try:
            raw = download(url)
            rows = u.parse_csv(raw)
            parsed = []
            for item in rows:
                row = u.make_row(item, div)
                if not row:
                    continue
                if row[0] != div or row[3] > today.isoformat():
                    raise ValueError("Wrong division or future final score")
                # Native extra files contain multiple seasons; core files must match.
                if div in u.CSV_LEAGUES:
                    year = int(url.split("/")[-2][:2])+2000
                    if not f"{year}-07-01" <= row[3] < f"{year+1}-07-01":
                        raise ValueError("Result outside the requested season")
                for i in (9, 10):
                    if row[i] is not None and (not math.isfinite(row[i]) or row[i] < 0 or row[i] > 30):
                        raise ValueError("Invalid xG")
                for i in (11, 12):
                    if row[i] is not None and (not math.isfinite(row[i]) or not 1 < row[i] < 1001):
                        row[i] = None
                parsed.append({"row": row, "base_sha256": registry.digest(history.get(u.key(row)))})
            if not parsed:
                raise ValueError("No valid completed matches")
            check.update(status="ok", rows=len(parsed), sha256=hashlib.sha256(raw).hexdigest(),
                         last_result_date=max(x["row"][3] for x in parsed))
            return label, check, parsed, None
        except Exception as error:
            check.update(status="error", error=f"{type(error).__name__}: {error}")
            return label, check, [], f"{label}: {check['error']}"

    if work["history"]:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for label, check, rows, error in pool.map(one, targets(today, work["full"])):
                patch["checks"][label] = check
                if error:
                    patch["errors"].append(error)
                else:
                    patch["history"].extend(rows)
    if work["calendar"]:
        observed = []
        rows, counts, errors = calendars(download, today, u.LEAGUES, observer=observed.append)
        patch["calendar"] = {"rows": rows, "counts": counts, "errors": errors}
        patch["observations"] = observed
    if work["quotes"]:
        try:
            raw = download("https://www.football-data.co.uk/fixtures.csv")
            rows = []
            for item in u.parse_csv(raw):
                row = u.make_row(item, fixture=True)
                if row and today.isoformat() <= row[3] <= (today+dt.timedelta(days=15)).isoformat():
                    rows.append([*row[:13], "Football-Data"])
            patch["quotes"] = {"rows": rows, "sha256": hashlib.sha256(raw).hexdigest()}
        except Exception as error:
            patch["quotes"] = {"error": f"{type(error).__name__}: {error}"}
    return patch


def conservative_merge(old, fresh, expected):
    if old is None or registry.digest(old) == expected:
        return u.merge_rows(old, fresh)
    # Another writer changed this record since collection. Preserve its values,
    # enrich only genuinely missing fields, and still reject a score conflict.
    return u.merge_rows(fresh, old)


def apply(root, patch):
    if patch.get("schema") != 1:
        raise ValueError("Unknown data patch schema")
    stamp, work = patch["observed_at_utc"], patch["plan"]
    now = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    old_history = u.readjson(root/"docs/data/history.json", [])
    history = u.index_history(old_history)
    old_fixtures = u.readjson(root/"docs/data/fixtures.json", [])
    status = u.readjson(root/"docs/data/status.json", {})
    view_stamp = max(stamp, status.get("last_build_utc", ""))
    view_now = dt.datetime.fromisoformat(view_stamp.replace("Z", "+00:00"))
    today = u.today_sofia(view_now)
    book = u.readjson(root/REGISTRY, registry.empty())
    # Bootstrap every previously published fixture before applying a rolling view.
    registry.observe(book, [{"row": row} for row in old_fixtures], stamp)
    changed, applied, conflicts = [], 0, 0
    for item in patch["history"]:
        row = item["row"]
        key = u.key(row)
        old = history.get(key)
        try:
            result = conservative_merge(old, row, item["base_sha256"])
            if old != result:
                changed.append(result)
                applied += 1
            history[key] = result
        except ValueError:
            conflicts += 1
            registry.record_conflict(book, "final_score_conflict", {"key": registry.row_key(row), "kept": old, "incoming": row})
    # Newly completed fixtures and any enrichment retain identity and provenance.
    registry.observe(book, patch["observations"], stamp)
    registry.observe(book, [{"row": row} for row in changed], stamp)
    newer = lambda field: not status.get(field) or status[field] <= stamp
    if work["history"] and newer("last_history_attempt_utc"):
        source_checks = status.setdefault("source_checks", {})
        for name, check in patch["checks"].items():
            previous = source_checks.get(name, {})
            if previous.get("attempt_utc", "") <= stamp:
                source_checks[name] = {**previous, **check}
                if check["status"] == "ok":
                    source_checks[name]["success_utc"] = stamp
                    source_checks[name].pop("error", None)
        good = sum(c["status"] == "ok" for c in patch["checks"].values())
        complete = good == work["history_targets"] and conflicts == 0
        status.update(last_history_attempt_utc=stamp, history_sources_total=work["history_targets"], history_sources_ok=good,
                      history_refresh_status="ok" if complete else "partial", errors=patch["errors"][:100],
                      by_source={k: c["rows"] for k, c in patch["checks"].items() if c["status"] == "ok"})
        if complete:
            status.update(last_history_success_utc=stamp, last_current_history_success_utc=stamp)
            if work["full"]:
                status["last_full_history_success_utc"] = stamp
    future = lambda row: today.isoformat() <= row[3] <= (today+dt.timedelta(days=30)).isoformat()
    fixtures = list(old_fixtures)
    calendar = patch["calendar"]
    if calendar and newer("last_fixture_attempt_utc"):
        stamps = status.setdefault("calendar_success_utc", {})
        eligible = {div for div in calendar["counts"] if stamps.get(div, "") <= stamp}
        incoming = [r for r in calendar["rows"] if r[0] in eligible]
        incoming_keys = {u.key(r) for r in incoming}
        retained = [r for r in fixtures if r[0] not in eligible or not is_secondary(r) and u.key(r) in incoming_keys]
        fixtures = u.confirmed_kickoffs(u.merge_fixtures([*incoming, *retained]), incoming)
        stamps.update({d: stamp for d in eligible})
        status.update(last_fixture_attempt_utc=stamp, fixtures_checked_utc=stamp,
                      secondary_fixture_counts=calendar["counts"], secondary_fixture_sources_ok=len(calendar["counts"]),
                      secondary_fixture_sources_total=len(CALENDAR_DIVISIONS), secondary_fixture_errors=calendar["errors"],
                      stale_secondary_leagues=sorted(set(CALENDAR_DIVISIONS)-set(calendar["counts"])),
                      fixtures_feed_status=("partial_secondary" if calendar["errors"] else "ok_secondary") if calendar["counts"] else "stale_secondary",
                      fixtures_source="Football-Data + FixtureDownload + ESPN (keyless)")
        if calendar["counts"]:
            status["fixtures_updated_utc"] = stamp
    quotes = patch["quotes"]
    if quotes and newer("last_quote_attempt_utc"):
        status["last_quote_attempt_utc"] = stamp
        if "error" in quotes:
            status["quote_error"] = quotes["error"]
        else:
            secondary = [r for r in fixtures if is_secondary(r) or len(r) > 13 and "Sofia" in str(r[13])]
            keys = {u.key(r) for r in fixtures}
            eligible = calendar["counts"] if calendar else {}
            primary = [r for r in quotes["rows"] if r[0] not in eligible or u.key(r) in keys]
            # Fresh quotes overwrite older primary snapshots; kickoff remains Sofia.
            fresh_keys = {u.key(r) for r in primary}
            fixtures = u.confirmed_kickoffs(u.merge_fixtures([*primary, *[r for r in fixtures if u.key(r) not in fresh_keys]]), secondary)
            status.update(last_quote_success_utc=stamp, quote_window=work["quote_window"], quote_sha256=quotes["sha256"], quote_error=None)
    # Exports are rolling views; the book above never drops old pending matches.
    fixtures = u.merge_fixtures([r for r in fixtures if future(r) and u.key(r) not in history])
    registry.observe(book, [{"row": row} for row in fixtures], stamp)
    historical = sorted(history.values(), key=lambda r: (r[3], r[0], r[5], r[6]))
    registry.reconcile(book, historical, fixtures, view_stamp)
    status.update(schema_version=3, history_count=len(historical), fixtures_count=len(fixtures),
                  calendar_only=not work["history"], last_build_utc=max(stamp, status.get("last_build_utc", "")))
    if patch.get("request_id"):
        status["processed_sync_requests"] = sorted(set(status.get("processed_sync_requests", [])+[patch["request_id"]]))
    latest = {}
    for row in historical:
        latest[row[0]] = max(latest.get(row[0], ""), row[3])
    states = {}
    pending = {}
    for match in book["matches"].values():
        states[match["state"]] = states.get(match["state"], 0)+1
        if match["state"] in ("awaiting_result", "provisional_result"):
            start = match.get("kickoff_utc") or match["schedule"][3]+"T21:59:59+00:00"
            if age(start, view_now) >= 24:
                pending.setdefault(match["division"], []).append(match["id"])
    health = {"schema": 1, "checked_utc": view_stamp, "latest_results": latest, "registry_states": states,
              "pending_over_24h": pending, "unresolved_conflicts": len(book["conflicts"]),
              "history_refresh_status": status.get("history_refresh_status", "not_checked"),
              "calendar_stale_leagues": status.get("stale_secondary_leagues", []),
              "sources": status.get("source_checks", {}),
              "note": "Source date alone does not prove missing games during a break. Pending fixtures are retained; unlisted is not cancelled. UEFA results and six missing domestic calendars are separate unfinished coverage stages."}
    for name, data in [("docs/data/history.json", historical), ("docs/data/fixtures.json", fixtures),
                       ("docs/data/status.json", status), (REGISTRY, book), (LINKS, registry.links(book)), (HEALTH, health)]:
        u.writejson(root/name, data)
    return {"history": len(historical), "fixtures": len(fixtures), "changed_results": applied,
            "conflicts_this_patch": conflicts, "registry_matches": len(book["matches"]), "plan": work}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("collect", "apply", "plan"))
    parser.add_argument("--mode", choices=MODES, default="auto")
    parser.add_argument("--patch", type=Path, default=Path("/tmp/matchpulse-patch.json"))
    parser.add_argument("--event", default="workflow_dispatch")
    parser.add_argument("--commit")
    args = parser.parse_args()
    if args.action == "apply":
        print(json.dumps(apply(ROOT, json.loads(args.patch.read_text())), ensure_ascii=False))
    else:
        mode, request_id = requested_mode(ROOT, args.event, args.mode, args.commit)
        if args.action == "plan":
            print(json.dumps(plan(u.readjson(u.STAT, {}), mode, utcnow())))
        else:
            patch = collect(ROOT, mode, utcnow(), request_id=request_id)
            u.writejson(args.patch, patch)
            print(json.dumps({"plan": patch["plan"], "checks": len(patch["checks"]), "errors": patch["errors"],
                              "calendar_errors": (patch["calendar"] or {}).get("errors", [])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
