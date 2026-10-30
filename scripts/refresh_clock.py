"""Lightweight scheduler decision; importing/planning never contacts providers."""
import argparse
import datetime as dt
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import data_sync as sync
import match_registry as registry
import statarea

SOURCES = ('history', 'calendar', 'quotes', 'results', 'europe', 'standings', 'statarea', 'forebet')


def decision(root, now):
    status = registry.read_strict(root/'docs/data/status.json', {})
    plan = sync.plan(status, 'auto', now, statarea.configuration(root))
    due = [key for key in SOURCES if plan.get(key)]
    return {'refresh': bool(due), 'due': due, 'plan': plan,
            'last_statarea_success_utc': status.get('last_statarea_success_utc')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--event', choices=('schedule', 'workflow_dispatch'), required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = decision(sync.ROOT, dt.datetime.now(dt.timezone.utc))
    result.update(event=args.event, run_id=args.run_id)
    with args.output.open('a') as output:
        output.write('refresh='+str(result['refresh']).lower()+'\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
