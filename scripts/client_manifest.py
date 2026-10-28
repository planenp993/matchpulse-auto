"""Hash the published JSON snapshot after all writers, without provider requests."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ('history.json', 'fixtures.json', 'status.json', 'europe_history.json', 'match_links.json',
         'europe_fixture_names.json', 'standings.json', 'coverage_audit.json', 'diary_report.json',
         'selection_diary_report.json', 'selection_quotes.json')
MANIFEST = 'docs/data/client_manifest.json'


def invalid_constant(value):
    raise ValueError('Non-JSON numeric constant: '+value)


def build(root):
    files = {}
    for name in FILES:
        raw = (root/'docs/data'/name).read_bytes()
        value = json.loads(raw, parse_constant=invalid_constant)
        item = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
        if name in ('history.json', 'europe_history.json', 'fixtures.json'):
            if not isinstance(value, list):
                raise ValueError('Invalid match array: '+name)
            divisions = {}
            for row in value:
                divisions[row[0]] = divisions.get(row[0], 0)+1
            item.update(rows=len(value), divisions=dict(sorted(divisions.items())))
        files[name] = item
    canonical = json.dumps(files, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return {'schema': 1, 'version': hashlib.sha256(canonical).hexdigest(), 'files': files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    expected, path = build(ROOT), ROOT/MANIFEST
    if args.check:
        if json.loads(path.read_text()) != expected:
            raise SystemExit('Client data versions do not match the published JSON files')
    else:
        path.write_text(json.dumps(expected, ensure_ascii=False, separators=(',', ':'))+'\n')
    print(json.dumps({'client_snapshot': expected['version'], 'files': len(expected['files'])}))


if __name__ == '__main__':
    main()
