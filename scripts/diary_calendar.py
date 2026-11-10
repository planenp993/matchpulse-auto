"""Project independent supplemental receipts into the registered diary input."""
import datetime as dt


def project(status, now):
    supplemental = status.get("supplemental_leagues")
    if not supplemental:
        return
    checks = supplemental.get("checks", {})
    fixtures = supplemental.get("fixture_counts", {})
    divisions = checks.keys() | fixtures.keys()
    counts = {div: n for div, n in status.get("secondary_fixture_counts", {}).items() if div not in divisions}
    for div, check in checks.items():
        if (check.get("status") != "ok" or check.get("window_covered") is not True
                or not check.get("feeds", {}).get("fixtures", {}).get("rows") or not fixtures.get(div)):
            continue
        try:
            age = now - dt.datetime.fromisoformat(check["attempt_utc"])
        except (KeyError, TypeError, ValueError):
            continue
        if -dt.timedelta(minutes=1) <= age <= dt.timedelta(hours=6):
            counts[div] = fixtures[div]
    status["secondary_fixture_counts"] = counts
