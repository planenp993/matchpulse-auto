"""Persistent identities alongside the compatible match arrays. No model formulas."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
from zoneinfo import ZoneInfo
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as u


def read_strict(path, default):
    if not path.exists(): return default
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, type(default)): raise ValueError("Invalid archive type: "+str(path))
    return value


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def row_key(row):
    return "|".join(u.key(row))


def kickoff(row):
    if len(row) <= 13 or not isinstance(row[13], str) or "Sofia" not in row[13] or not row[4]:
        return None
    try:
        local = dt.datetime.fromisoformat(row[3] + "T" + row[4])
        zone = ZoneInfo("Europe/Sofia")
        possible = {local.replace(tzinfo=zone, fold=fold).astimezone(dt.timezone.utc) for fold in (0, 1)
                    if local.replace(tzinfo=zone, fold=fold).astimezone(dt.timezone.utc).astimezone(zone).replace(tzinfo=None) == local}
        return next(iter(possible)).isoformat(timespec="seconds") if len(possible) == 1 else None
    except ValueError:
        return None


def empty():
    return {"schema": 1, "matches": {}, "conflicts": {}}


def record_conflict(registry, kind, payload):
    record = {"kind": kind, **payload}
    registry["conflicts"][digest(record)] = record


def observe(registry, observations, stamp):
    """Only provider IDs or exact reviewed keys link identities. Never guess pairs."""
    matches = registry["matches"]
    keys, providers = {}, {}
    for identity, match in matches.items():
        for key in match["legacy_keys"]:
            keys.setdefault(key, set()).add(identity)
        for source in match["provider_ids"]:
            providers.setdefault(source, set()).add(identity)
    for observation in observations:
        row = observation["row"]
        key = row_key(row)
        provider = observation.get("provider_id")
        candidates = keys.get(key, set()) | (providers.get(provider, set()) if provider else set())
        if len(candidates) > 1:
            record_conflict(registry, "ambiguous_identity", {"key": key, "provider_id": provider, "identities": sorted(candidates)})
            continue
        identity = next(iter(candidates), "m-" + hashlib.sha256(key.encode()).hexdigest()[:24])
        match = matches.get(identity)
        clubs = [u.club_key(row[5]), u.club_key(row[6])]
        if match and (match["division"] != row[0] or match["clubs"] != clubs):
            record_conflict(registry, "provider_identity_changed", {"id": identity, "key": key, "provider_id": provider})
            continue
        if not match:
            year = int(row[3][:4])
            start = year if int(row[3][5:7]) >= 7 else year-1
            match = matches[identity] = {"id": identity, "division": row[0], "clubs": clubs,
                "season": str(year) if row[0] in ("NOR", "SWE") else f"{start}/{str(start+1)[2:]}",
                "legacy_keys": [], "provider_ids": [], "first_seen_utc": stamp,
                "schedule": row[:7], "kickoff_utc": kickoff(row), "last_seen_utc": stamp,
                "state": "scheduled", "result_key": None, "result": None}
        if key not in match["legacy_keys"]:
            match["legacy_keys"].append(key)
        keys.setdefault(key, set()).add(identity)
        if provider and provider not in match["provider_ids"]:
            match["provider_ids"].append(provider)
        if provider:
            providers.setdefault(provider, set()).add(identity)
        if stamp >= match["last_seen_utc"]:
            match["last_seen_utc"] = stamp
            if match["result"] is None and not (type(row[7]) is int and type(row[8]) is int):
                match["schedule"] = row[:7]
                match["kickoff_utc"] = kickoff(row)
                for field in ("phase", "round"):
                    if observation.get(field) is not None:
                        match[field] = observation[field]
                if observation.get("status") in ("postponed", "cancelled", "provisional_result"):
                    match["state"] = observation["status"]
                else:
                    match["state"] = "scheduled"
    return registry


def reconcile(registry, history, fixtures, stamp, aliases=None):
    now = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    lookup = {row_key(r): r for r in history}
    for alias, actual in (aliases or {}).items():
        if actual not in lookup: raise ValueError("Missing verified result alias target")
        if alias in lookup and lookup[alias][7:9] != lookup[actual][7:9]:
            raise ValueError("Conflicting verified result alias")
        lookup[alias] = lookup[actual]
    visible = {row_key(r) for r in fixtures}
    for match in registry["matches"].values():
        results = [lookup[k] for k in match["legacy_keys"] if k in lookup]
        variants = {tuple(r[7:9]) for r in results}
        if len(variants) > 1:
            match["state"] = "conflict"
            record_conflict(registry, "registry_score_conflict", {"id": match["id"], "scores": sorted(variants)})
            continue
        if results:
            result = results[-1]
            stats = result[13] if len(result) > 13 and isinstance(result[13], dict) else {}
            match["result_key"] = row_key(result)
            match["result"] = result[7:9]
            # Results dates never replace the immutable captured forecast date.
            match["actual_date"] = result[3]
            match["state"] = ("awarded" if stats.get("AWARDED") else "final" if result[0] in (*u.EXTRA, "UCL", "UEL", "UECL") or
                all(k in stats for k in ("HS", "AS", "HST", "AST", "HC", "AC", "HY", "AY", "HR", "AR")) else "final_awaiting_stats")
        elif match["state"] not in ("cancelled", "postponed", "provisional_result"):
            start = match.get("kickoff_utc")
            date = match["schedule"][3]
            past = dt.datetime.fromisoformat(start) < now if start else date < u.today_sofia(now).isoformat()
            match["state"] = "awaiting_result" if past else "scheduled" if any(k in visible for k in match["legacy_keys"]) else "unlisted"
    return registry


def links(registry):
    """Small public sidecar, keyed exactly like the browser/diary canonical key."""
    out = {}
    for match in registry["matches"].values():
        if match["state"] == "conflict":
            continue
        link = {"id": match["id"], "current_key": row_key([*match["schedule"], None, None]),
                "result_key": match["result_key"], "kickoff_utc": match.get("kickoff_utc"), "state": match["state"]}
        for key in match["legacy_keys"]:
            if key in out and out[key]["id"] != match["id"]:
                raise ValueError("Ambiguous public registry key")
            out[key] = link
    return {"schema": 1, "matches": out}
