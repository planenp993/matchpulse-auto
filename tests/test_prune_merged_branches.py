import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from scripts import prune_merged_branches as prune


class PruneTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        parent = Path(self.folder.name)
        self.remote, self.root = parent/'remote.git', parent/'work'
        subprocess.run(['git', 'init', '--bare', str(self.remote)], check=True, capture_output=True)
        self.root.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Test'); self.git('config', 'user.email', 'test@example.invalid')
        self.git('commit', '--allow-empty', '-m', 'base')
        self.base = self.git('rev-parse', 'HEAD').stdout.strip()
        self.git('remote', 'add', 'origin', str(self.remote))
        self.git('branch', 'merged', self.base)
        self.git('checkout', '-b', 'unmerged')
        self.git('commit', '--allow-empty', '-m', 'pending work')
        self.unmerged = self.git('rev-parse', 'HEAD').stdout.strip()
        self.git('checkout', 'main')
        self.git('commit', '--allow-empty', '-m', 'main advanced')
        self.current = self.git('rev-parse', 'HEAD').stdout.strip()
        self.git('push', 'origin', 'main', 'merged', 'unmerged')

    def git(self, *args):
        return prune.git(self.root, *args)

    def row(self, name, sha):
        return {'branch': name, 'head_sha': sha, 'merged_pr': 1, 'merged_at': '2026-10-28T07:00:00Z'}

    def test_only_the_reviewed_ancestor_head_is_deleted(self):
        manifest = {'branches': [self.row('merged', self.base), self.row('unmerged', self.unmerged), self.row('missing', self.base)]}
        planned = prune.prune(self.root, manifest)
        self.assertEqual(planned['eligible'], ['merged']); self.assertEqual(planned['removed'], [])
        result = prune.prune(self.root, manifest, apply=True)
        self.assertEqual(result['removed'], ['merged'])
        self.assertIn('not_in_main', [x['reason'] for x in result['skipped']])
        remote = self.git('ls-remote', '--heads', 'origin').stdout
        self.assertIn('refs/heads/main', remote); self.assertIn('refs/heads/unmerged', remote)
        self.assertNotIn('refs/heads/merged\n', remote)

    def test_changed_head_is_preserved_and_a_late_race_is_rejected_by_git(self):
        self.git('branch', '-f', 'merged', self.current); self.git('push', 'origin', 'merged')
        result = prune.prune(self.root, {'branches': [self.row('merged', self.base)]}, apply=True)
        self.assertEqual(result['removed'], []); self.assertEqual(result['skipped'][0]['reason'], 'head_changed')
        raced = prune.git(self.root, 'push', '--porcelain', '--force-with-lease=refs/heads/merged:'+self.base, 'origin', ':refs/heads/merged', check=False)
        self.assertNotEqual(raced.returncode, 0)
        self.assertIn(self.current+'\trefs/heads/merged', self.git('ls-remote', '--heads', 'origin').stdout)

    def test_main_and_unreviewed_records_are_rejected(self):
        with self.assertRaises(ValueError):
            prune.prune(self.root, {'branches': [self.row('main', self.current)]}, apply=True)
        with self.assertRaises(ValueError):
            prune.prune(self.root, {'branches': [{'branch': 'merged', 'head_sha': self.base}]}, apply=True)
