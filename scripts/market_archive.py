"""Lossless typed Football-Data market snapshots, separate from model inputs.

CSV retrieval time is not a bookmaker quote timestamp. Historical starting and
closing columns are retained for research, never passed to prospective models.
"""
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = 'data/markets'
SUMMARY = 'docs/data/market_coverage.json'
# Current and legacy Football-Data bookmakers and aggregates. Counts such as
# Bb1X2/BbOU/BbAH are not prices. Unknown columns are reported, not guessed.
BOOKS = ('B365', 'BFD', 'BF', 'BFE', 'BV', 'BW', 'IW', 'LB', 'PS', 'PP', 'SJ', 'SKB',
         'SO', 'SB', 'SY', 'VC', 'WH', 'GB', 'BS', 'Max', 'Avg', 'BbMx', 'BbAv')
PRICE = re.compile(r'^(?:'+'|'.join(BOOKS)+r')(?:C)?(?:H|D|A|>2\.5|<2\.5|AHH|AHA)$')
LINES = {'AHh', 'AHCh', 'BbAHh'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False)


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def market_columns(columns):
    return sorted(k for k in columns if k and (k in LINES or PRICE.fullmatch(k)))


def extract(raw, columns):
    values, invalid = [], []
    for name in columns:
        value = raw.get(name)
        if value is None or not str(value).strip():
            values.append(None)
            continue
        try:
            number = float(value)
            valid = math.isfinite(number) and (-10 <= number <= 10 and abs(number*4-round(number*4)) < 1e-9
                                            if name in LINES else 1 < number < 1001)
        except (ValueError, TypeError):
            valid = False
        if valid:
            values.append(number)
        else:
            values.append(None)
            invalid.append(name)
    # A handicap line by itself is not a quoted price.
    return values if any(v is not None and k not in LINES for k, v in zip(columns, values)) else None, invalid


def observation(raw, row, columns, source, source_sha256, kind, key):
    values, invalid = extract(raw, columns)
    if values is None:
        return None, invalid
    year, month = int(row[3][:4]), int(row[3][5:7])
    start = year if month >= 7 else year-1
    season = str(year) if row[0] in ('NOR', 'SWE') else f'{start}-{str(start+1)[2:]}'
    return {'key': key, 'division': row[0], 'season': season, 'columns': columns,
            'values': values, 'kind': kind, 'source_url': source, 'source_sha256': source_sha256}, invalid


def empty(division, season):
    return {'schema': 1, 'division': division, 'season': season, 'formats': {}, 'matches': {}}


def merge(shard, observations, stamp):
    added = 0
    for item in observations:
        columns, values = item['columns'], item['values']
        if len(columns) != len(set(columns)) or len(columns) != len(values) or columns != market_columns(columns):
            raise ValueError('Invalid market column format')
        if item['kind'] not in ('historical_csv', 'fixture_csv'):
            raise ValueError('Invalid market observation kind')
        # Typed values must pass the same bounds on apply, including cached patches.
        checked, invalid = extract(dict(zip(columns, values)), columns)
        if invalid or checked != values or checked is None:
            raise ValueError('Invalid market values in patch')
        format_id = sha(columns)[:20]
        if format_id in shard['formats'] and shard['formats'][format_id] != columns:
            raise ValueError('Market format hash collision')
        shard['formats'][format_id] = columns
        identity = sha({'key': item['key'], 'kind': item['kind'], 'columns': columns, 'values': values})
        entries = shard['matches'].setdefault(item['key'], {})
        if identity not in entries:
            entries[identity] = {'format': format_id, 'values': values, 'observed_at_utc': stamp,
                                 'kind': item['kind'], 'source_url': item['source_url'],
                                 'source_sha256': item['source_sha256']}
            added += 1
    return added


def load(path):
    # A malformed archive is an integrity failure, never an empty replacement.
    shard = json.loads(path.read_text())
    if shard.get('schema') != 1 or not isinstance(shard.get('formats'), dict) or not isinstance(shard.get('matches'), dict):
        raise ValueError('Invalid saved market shard')
    for key, entries in shard['matches'].items():
        for identity, snap in entries.items():
            columns = shard['formats'][snap['format']]
            expected = sha({'key': key, 'kind': snap['kind'], 'columns': columns, 'values': snap['values']})
            if identity != expected: raise ValueError('Saved market observation fingerprint mismatch')
    return shard


def family(name):
    if name in LINES or name.endswith(('AHH', 'AHA')):
        return 'asian_handicap'
    return 'total_2_5' if '2.5' in name else 'one_x_two'


def summary(shards, fixtures, key_for, stamp, quote_status=None):
    future = {key_for(row) for row in fixtures}
    totals, by_division = {}, {}
    for shard in shards:
        division = by_division.setdefault(shard['division'], {'matches': 0, 'observations': 0})
        division['matches'] += len(shard['matches'])
        for key, snapshots in shard['matches'].items():
            division['observations'] += len(snapshots)
            for snap in snapshots.values():
                for name, value in zip(shard['formats'][snap['format']], snap['values']):
                    if value is not None:
                        group = family(name)
                        totals[group] = totals.get(group, 0)+1
    quoted = {key for shard in shards for key, observations in shard['matches'].items()
              if key in future and any(x['kind'] == 'fixture_csv' for x in observations.values())}
    return {'schema': 1, 'checked_utc': stamp, 'divisions': by_division, 'field_observations': totals,
            'future_matches_with_saved_quotes': len(quoted), 'quote_check': quote_status,
            'notes': ['Starting and closing columns retain their exact source names.',
                      'observed_at_utc is CSV retrieval time; bookmaker quote time is unknown.',
                      'Historical prices are retrospective observations, never pre-match trial evidence.',
                      'Snapshots are stored outside the web app in data/markets; unchanged values are deduplicated.',
                      'Absence of future quotes is distinct from a failed download. No odds are invented.']}


def apply(root, observations, fixtures, key_for, stamp, readjson, writejson, quote_status=None):
    grouped = {}
    for item in observations:
        division, season = item['division'], item['season']
        if not re.fullmatch(r'[A-Z0-9]{1,5}', division) or not re.fullmatch(r'\d{4}(?:-\d{2})?', season):
            raise ValueError('Invalid market shard identity')
        if not item['key'].startswith(division+'|'):
            raise ValueError('Market key division mismatch')
        grouped.setdefault((division, season), []).append(item)
    added = 0
    for (division, season), items in sorted(grouped.items()):
        path = root/DIRECTORY/division/(season+'.json')
        shard = load(path) if path.exists() else empty(division, season)
        if shard.get('division') != division or shard.get('season') != season:
            raise ValueError('Market shard identity mismatch')
        added += merge(shard, items, stamp)
        writejson(path, shard)
    shards = [load(p) for p in sorted((root/DIRECTORY).glob('*/*.json'))]
    report = summary(shards, fixtures, key_for, stamp, quote_status)
    writejson(root/SUMMARY, report)
    return added, report
