"""One explicit anonymous Soccerway feasibility probe; never imports live data.

Reads only embedded public fixture/result facts from one ordinary HTML page.
No JavaScript execution, private feed, login, proxy or access-denial retry.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

URL = 'https://www.soccerway.com/england/premier-league/fixtures/'
REQUEST = 'ops/soccerway_probe_request.json'
UA = 'Matchpulse-Source-Probe/1.0 (+https://github.com/planenp993/matchpulse-auto)'
FIELDS = {'AA', 'AD', 'AE', 'AF', 'AG', 'AH', 'AB', 'AC'}
FEEDS = ('summary-fixtures', 'summary-results')
LIMIT = 6_000_000


def parse_page(raw):
    if len(raw) > LIMIT:
        raise ValueError('Soccerway page exceeds bound')
    text = raw.decode('utf-8-sig', errors='strict')
    # Identify this exact competition, not a similarly named country/youth page.
    if not re.search(r'tournamentTemplateId:\s*"dYlOSQOD"', text):
        raise ValueError('Expected Premier League identity is absent')
    found = {}
    for name, data in re.findall(r'cjs\.initialFeeds\["([^"]+)"\]\s*=\s*\{\s*data:\s*`(.*?)`', text, re.S):
        if name not in FEEDS:
            continue
        if 'ZEE÷dYlOSQOD' not in data or 'ZA÷ENGLAND: Premier League' not in data:
            raise ValueError('Embedded feed has an unexpected competition')
        if name in found or '${' in data:
            raise ValueError('Ambiguous/nonliteral initial feed')
        rows, seen = [], set()
        for block in data.split('¬~'):
            fields = {}
            for value in block.split('¬'):
                key, sep, value = value.partition('÷')
                if sep and key in FIELDS:
                    if key in fields:
                        raise ValueError('Duplicate match field')
                    fields[key] = value
            if 'AA' not in fields:
                continue
            identity = fields['AA']
            if not re.fullmatch(r'[A-Za-z0-9]{8}', identity) or identity in seen:
                raise ValueError('Invalid/duplicate Soccerway match identity')
            seen.add(identity)
            if not all(fields.get(k) for k in ('AD', 'AE', 'AF', 'AB', 'AC')) or fields['AE'] == fields['AF']:
                raise ValueError('Incomplete Soccerway match fact')
            if not re.fullmatch(r'\d{10}', fields['AD']):
                raise ValueError('Unconfirmed Soccerway kickoff')
            instant = dt.datetime.fromtimestamp(int(fields['AD']), dt.timezone.utc)
            if not 2020 <= instant.year <= 2100:
                raise ValueError('Implausible Soccerway kickoff')
            goals = [int(fields[k]) if re.fullmatch(r'\d{1,2}', fields.get(k, '')) else None for k in ('AG', 'AH')]
            rows.append({'id': identity, 'kickoff_utc': instant.isoformat(timespec='seconds'),
                'home': fields['AE'], 'away': fields['AF'], 'display_score': goals,
                'state_code': fields['AB'], 'stage_code': fields['AC']})
        if not rows:
            raise ValueError('Empty embedded '+name+' is not usable match evidence')
        found[name] = rows
    if set(found) != set(FEEDS):
        raise ValueError('Public HTML lacks actual fixture/result data')
    return found


def fetch():
    request = urllib.request.Request(URL, headers={'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml'})
    with urllib.request.urlopen(request, timeout=25) as response:
        if response.status != 200 or response.url != URL:
            raise ValueError('Unexpected Soccerway response/redirect')
        raw = response.read(LIMIT+1)
    if len(raw) > LIMIT:
        raise ValueError('Soccerway response exceeds bound')
    return raw


def validate_request(root, event, commit):
    if event == 'push':
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
        paths = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).splitlines()
        if paths != [REQUEST] or not git('show', '-s', '--format=%s', commit).startswith('[source-probe] '):
            raise ValueError('Source probe needs an explicit single-file operational request')
        request = json.loads(git('show', commit+':'+REQUEST))
    else:
        request = json.loads((root/REQUEST).read_text())
    if request.get('schema') != 1 or request.get('provider') != 'Soccerway' or not request.get('id'):
        raise ValueError('Invalid Soccerway probe request')
    return request['id']


def probe(download=fetch):
    result = {'schema': 1, 'provider': 'Soccerway', 'url': URL,
              'observed_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
              'imported_matches': 0, 'production_enabled': False}
    try:
        raw = download()
        feeds = parse_page(raw)
        result.update(http_status=200, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                      usable_sample=True, feeds=feeds)
    except Exception as error:
        result.update(usable_sample=False, error=type(error).__name__+': '+str(error))
        if isinstance(error, urllib.error.HTTPError):
            result['http_status'] = error.code
    return result


def summary(report):
    return {**{k: v for k, v in report.items() if k != 'feeds'},
            'feeds': {name: {'matches': len(rows),
                'first_utc': min(r['kickoff_utc'] for r in rows),
                'last_utc': max(r['kickoff_utc'] for r in rows),
                'sample': rows[:2]} for name, rows in report.get('feeds', {}).items()}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--event', choices=('push', 'workflow_dispatch'), required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    request_id = validate_request(root, args.event, args.commit)
    report = probe()
    report.update(request_id=request_id, trigger={'event': args.event, 'run_id': args.run_id})
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(summary(report), ensure_ascii=False))
    raise SystemExit(0 if report['usable_sample'] else 2)


if __name__ == '__main__':
    main()
