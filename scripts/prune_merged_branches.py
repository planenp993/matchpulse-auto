"""One-time cleanup of reviewed merged heads, with ancestry and lease guards."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def git(root, *args, check=True):
    return subprocess.run(['git', *args], cwd=root, text=True, capture_output=True, check=check)


def prune(root, manifest, apply=False):
    rows = manifest.get('branches', [])
    if not isinstance(rows, list) or len(rows) > 100:
        raise ValueError('Invalid reviewed branch list')
    seen = set()
    for row in rows:
        name = row.get('branch', '')
        if name in seen or name in ('main', 'master', 'work/audit-polish') or name.startswith(('-', 'refs/')):
            raise ValueError('Protected, duplicate or invalid branch')
        if not re.fullmatch(r'[a-f0-9]{40}', row.get('head_sha', '')) or not isinstance(row.get('merged_pr'), int) or not row.get('merged_at'):
            raise ValueError('Missing reviewed merge evidence')
        git(root, 'check-ref-format', '--branch', name)
        seen.add(name)
    git(root, 'fetch', '--no-tags', 'origin', 'main')
    remote = {ref.removeprefix('refs/heads/'): sha for sha, ref in
              (line.split() for line in git(root, 'ls-remote', '--heads', 'origin').stdout.splitlines())}
    result = {'removed': [], 'eligible': [], 'skipped': [], 'failed': []}
    for row in rows:
        name, expected = row['branch'], row['head_sha']
        reason = 'already_absent' if name not in remote else 'head_changed' if remote[name] != expected else None
        if reason is None and git(root, 'merge-base', '--is-ancestor', expected, 'origin/main', check=False).returncode:
            reason = 'not_in_main'
        if reason:
            result['skipped'].append({'branch': name, 'reason': reason})
            continue
        result['eligible'].append(name)
        if apply:
            # The deletion is rejected if this exact head changes after ls-remote.
            pushed = git(root, 'push', '--porcelain', '--force-with-lease=refs/heads/'+name+':'+expected,
                         'origin', ':refs/heads/'+name, check=False)
            result['removed' if pushed.returncode == 0 else 'failed'].append(name)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root/'ops/merged-branch-recovery.json').read_text())
    repository = os.environ.get('GITHUB_REPOSITORY')
    if repository != manifest.get('repository'):
        raise SystemExit('Cleanup only runs in the reviewed GitHub repository')
    origin = git(root, 'remote', 'get-url', 'origin').stdout.strip().removesuffix('.git')
    if origin != 'https://github.com/'+repository:
        raise SystemExit('Unexpected repository remote')
    result = prune(root, manifest, args.apply)
    print(json.dumps(result))
    if result['failed']:
        raise SystemExit('Some branch deletions were rejected; inspect their current heads')


if __name__ == '__main__':
    main()
