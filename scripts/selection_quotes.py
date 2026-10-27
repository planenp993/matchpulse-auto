"""Small upcoming-price view from saved fixture CSVs; no provider requests."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import market_archive as markets
import match_registry as registry
import update as u

VIEW = 'docs/data/selection_quotes.json'
SUFFIXES = {'1': 'H', 'X': 'D', '2': 'A', 'o25': '>2.5', 'u25': '<2.5'}
BOOKS = [('B365', 'bet365'), ('PS', 'Pinnacle'), ('Avg', 'Средна CSV цена')]


def build(root, fixtures, status):
    expected = {registry.row_key(row) for row in fixtures}
    result = {}
    for path in sorted((root/'data/markets').glob('*/*.json')):
        shard = markets.load(path)  # Corruption remains an error, never an empty reset.
        for key, observations in shard['matches'].items():
            if key not in expected:
                continue
            valid = []
            for identity, snap in observations.items():
                if snap['kind'] != 'fixture_csv':
                    continue
                try:
                    stamp = dt.datetime.fromisoformat(snap['observed_at_utc'].replace('Z', '+00:00'))
                    if stamp.tzinfo is None:
                        continue
                except (ValueError, TypeError, KeyError):
                    continue
                valid.append((stamp, identity, snap))
            quotes = {}
            for _, _, snap in sorted(valid, key=lambda v: (v[0], v[1]), reverse=True):
                values = dict(zip(shard['formats'][snap['format']], snap['values']))
                for market, suffix in SUFFIXES.items():
                    if market in quotes:
                        continue
                    for prefix, label in BOOKS:
                        column = prefix+suffix
                        value = values.get(column)
                        if value is not None:
                            quotes[market] = {'odds': value, 'kind': 'fixture_csv', 'book': label,
                                              'column': column, 'source_url': snap['source_url'],
                                              'observed_at_utc': snap['observed_at_utc']}
                            break
            if quotes:
                result[key] = quotes
    return {'schema': 1, 'checked_at_utc': status.get('last_quote_success_utc'),
            'fixtures': dict(sorted(result.items())),
            'timestamp_note': 'CSV retrieval time, not a bookmaker quote timestamp.'}


def write(root, fixtures, status):
    view = build(root, fixtures, status)
    u.writejson(root/VIEW, view)
    return view


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    fixtures = json.loads((u.ROOT/'docs/data/fixtures.json').read_text())
    status = json.loads((u.ROOT/'docs/data/status.json').read_text())
    expected = build(u.ROOT, fixtures, status)
    if args.check:
        actual = json.loads((u.ROOT/VIEW).read_text())
        if actual != expected:
            raise SystemExit('Upcoming selection quotes do not match saved fixture observations')
    else:
        u.writejson(u.ROOT/VIEW, expected)
    print(f"Selection quotes: {len(expected['fixtures'])} exact fixture keys; no provider requests")


if __name__ == '__main__':
    main()
