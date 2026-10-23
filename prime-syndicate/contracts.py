"""PRIME SYNDICATE data contracts. Pure standard-library validation.

This validates *records*, not predictions. No network or publication.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
import json

VALID_STATES = {"scheduled", "postponed", "cancelled", "completed"}
REQUIRED_FIXTURE = (
    "fixture_id", "competition_id", "season", "kickoff_utc",
    "home_id", "away_id", "status", "source", "source_updated_utc",
)
REQUIRED_RESULT = REQUIRED_FIXTURE + ("home_goals", "away_goals")


def _utc(value: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError("required ISO-8601 UTC timestamp")
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid ISO-8601 timestamp") from exc
    if t.tzinfo is None or t.utcoffset().total_seconds() != 0:
        raise ValueError("timestamp must be explicitly UTC")
    return t.astimezone(timezone.utc)


def _token(obj: dict, field: str) -> str:
    v = obj.get(field)
    if not isinstance(v, str) or not v.strip():
        raise ValueError(f"{field}: non-empty string required")
    return v.strip()


def validate_fixture(obj: Any, *, now: datetime | None = None) -> dict:
    if not isinstance(obj, dict):
        raise ValueError("fixture must be a JSON object")
    for field in REQUIRED_FIXTURE:
        if field not in obj:
            raise ValueError(f"missing {field}")
    for field in ("fixture_id", "competition_id", "season", "home_id", "away_id", "source"):
        _token(obj, field)
    if obj["home_id"] == obj["away_id"]:
        raise ValueError("home_id and away_id must differ")
    state = obj["status"]
    if state not in VALID_STATES:
        raise ValueError("invalid status")
    kickoff = _utc(obj["kickoff_utc"])
    source_time = _utc(obj["source_updated_utc"])
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        raise ValueError("now must include timezone")
    if source_time > moment.astimezone(timezone.utc):
        raise ValueError("source update is in the future")
    if state in ("scheduled", "postponed") and ("home_goals" in obj or "away_goals" in obj):
        raise ValueError("future fixture cannot contain final goals")
    if state == "completed" and not ("home_goals" in obj and "away_goals" in obj):
        raise ValueError("completed match must include both scores")
    if state in ("cancelled", "postponed") and kickoff < source_time:
        # Postponements can retain an old kickoff, but it must not be passed as a live fixture.
        pass
    return obj


def validate_result(obj: Any, *, now: datetime | None = None) -> dict:
    validate_fixture(obj, now=now)
    if obj["status"] != "completed":
        raise ValueError("result must have completed status")
    for field in ("home_goals", "away_goals"):
        x = obj.get(field)
        if type(x) is not int or x < 0 or x > 30:
            raise ValueError(f"{field} must be integer 0..30")
    if _utc(obj["kickoff_utc"]) > (now or datetime.now(timezone.utc)).astimezone(timezone.utc):
        raise ValueError("no future result")
    for field in ("home_xg", "away_xg"):
        if field in obj and obj[field] is not None:
            x = obj[field]
            if not isinstance(x, (float, int)) or isinstance(x, bool) or not 0 <= x <= 12:
                raise ValueError(f"{field} must be null or plausible non-negative number")
    return obj


def validate_snapshot(payload: dict, *, now: datetime | None = None) -> dict:
    """Return deterministic diagnostics; raises when unique IDs or identities collide."""
    if not isinstance(payload, dict):
        raise ValueError("snapshot must be a JSON object")
    fixtures = payload.get("fixtures")
    results = payload.get("results")
    if not isinstance(fixtures, list) or not isinstance(results, list):
        raise ValueError("fixtures and results must be JSON arrays")
    ids: dict[str, tuple] = {}
    diagnostics = {"fixtures": 0, "results": 0, "sources": {}, "competitions": {}}
    for record, finished in [(r, False) for r in fixtures] + [(r, True) for r in results]:
        (validate_result if finished else validate_fixture)(record, now=now)
        fixture_id = record["fixture_id"]
        identity = (record["competition_id"], record["season"], record["home_id"], record["away_id"])
        if fixture_id in ids:
            raise ValueError(f"duplicate fixture_id {fixture_id}")
        ids[fixture_id] = identity
        stage = "results" if finished else "fixtures"
        diagnostics[stage] += 1
        source = record["source"]
        diagnostics["sources"][source] = diagnostics["sources"].get(source, 0) + 1
        league = record["competition_id"]
        diagnostics["competitions"][league] = diagnostics["competitions"].get(league, 0) + 1
        if not finished and record["status"] == "completed":
            raise ValueError("completed match must be in results, not fixtures")
    return diagnostics


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python contracts.py SNAPSHOT.json")
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.dumps(validate_snapshot(json.load(f)), ensure_ascii=False, indent=2))
