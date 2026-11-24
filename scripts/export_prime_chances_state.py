"""Export aggregate ratings and fixed coefficients from the private five-model archive study."""

import argparse
from collections import defaultdict
from datetime import date
import gzip
from itertools import groupby
import json
from pathlib import Path
import sys
import unicodedata


def normalize(name):
    text = "".join(
        char for char in unicodedata.normalize("NFKD", name) if not unicodedata.combining(char)
    ).replace("&", " and ").lower()
    return " ".join("".join(char if char.isalnum() else " " for char in text).split())


def export_state(baseline, archive_file, through, output):
    sys.path.insert(0, str(baseline.resolve()))
    from archive import ALIASES, DIVISION_ALIASES, join_verified, read_archive, team_key
    from features import Club, League, rates, update_signal

    fits = json.loads((baseline / "frozen-fits.json").read_text(encoding="utf-8"))
    fit = fits["fits"][-1]
    if fit["last_training_day"] > through.toordinal():
        raise ValueError("The checkpoint predates model training")

    fixtures, index, audit = read_archive(archive_file)
    xg_audit = join_verified(index, baseline / "xg-reference.json.gz", "xg")
    if through.toordinal() > fixtures[-1].day:
        raise ValueError("The checkpoint date is beyond the archive")

    teams = defaultdict(dict)
    leagues = defaultdict(League)
    for day, batch in groupby(fixtures, key=lambda row: row.day):
        if day > through.toordinal():
            break
        pending = []
        for match in batch:
            league = leagues[match.division]
            home, away = [
                teams[match.division].setdefault(key, Club(name))
                for key, name in zip(match.clubs, match.names)
            ]
            expected = rates(league, home, away, "goals", day, require_history=False)
            pending.append((match, league, home, away, expected))
        for match, league, home, away, expected in pending:
            residual = [actual - estimate for actual, estimate in zip(match.goals, expected)]
            home.venue[0].update(residual[0], residual[1], day)
            away.venue[1].update(residual[1], residual[0], day)
            for signal, observed in (("goals", match.goals), ("shots", match.shots),
                                     ("target", match.on_target), ("corners", match.corners),
                                     (match.xg_source, match.xg)):
                if observed is not None:
                    update_signal(league, home, away, signal, observed, day)

    def packed(strength):
        return [strength.attack, strength.weakness, strength.games, strength.day]

    # These alternate provider names were verified against opponents and scores in the archive study.
    extra = {
        "SP1": {"celta de vigo": "celta vigo", "deportivo a coruna": "la coruna"},
        "E0": {"hull city": "hull", "coventry city": "coventry"},
        "F1": {"paris": "paris fc"},
        "D1": {"fsv mainz 05": "mainz 05", "fc union berlin": "union berlin"},
    }
    divisions = {}
    for code, league in sorted(leagues.items()):
        clubs = teams[code]
        aliases = {}
        for name in ALIASES.keys() | DIVISION_ALIASES.get(code, {}).keys():
            key = team_key(code, name)
            if key in clubs and name != key and name not in clubs:
                aliases[normalize(name)] = key
        for name, key in extra.get(code, {}).items():
            if key in clubs and name not in clubs:
                aliases[name] = key
        divisions[code] = {
            "means": {key: value for key, value in league.means.items() if key not in ("half", "cards")},
            "clubs": {key: {"venue": [packed(strength) for strength in club.venue],
                            "signals": {name: packed(s) for name, s in club.signals.items()}}
                      for key, club in sorted(clubs.items())},
            "aliases": aliases,
        }
    state = {
        "schema": 1, "through": through.isoformat(),
        "fitSeason": fit["season"], "fitThrough": date.fromordinal(fit["last_training_day"]).isoformat(),
        "coefficients": fit["chance_coefficients"],
        "archiveSha256": audit["sha256"], "referenceSha256": xg_audit["sha256"],
        "divisions": divisions,
    }
    content = json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    output.write_bytes(gzip.compress(content, compresslevel=9, mtime=0))
    print(f"Prime chances checkpoint through {through}: {len(divisions)} divisions, "
          f"{sum(map(len, teams.values()))} club profiles, {output.stat().st_size} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True, help="baseline/ in the selection study ZIP")
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--through", type=date.fromisoformat, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    export_state(arguments.baseline, arguments.archive, arguments.through, arguments.output)
