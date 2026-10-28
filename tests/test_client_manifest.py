import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from scripts import client_manifest as manifest


class ClientManifestTests(unittest.TestCase):
    def root(self, folder):
        root = Path(folder)
        (root/'docs/data').mkdir(parents=True)
        for name in manifest.FILES:
            (root/'docs/data'/name).write_text('[]' if name in ('history.json', 'europe_history.json', 'fixtures.json') else '{}')
        return root

    def test_versions_cover_exact_bytes_and_build_is_read_only_and_repeatable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.root(folder)
            path = root/'docs/data/history.json'
            raw = json.dumps([['E0'], ['E0'], ['D1']], ensure_ascii=False).encode()
            path.write_bytes(raw)
            first = manifest.build(root)
            self.assertEqual(first, manifest.build(root))
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(first['files']['history.json']['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(first['files']['history.json']['divisions'], {'D1': 1, 'E0': 2})
            path.write_bytes(raw+b'\n')
            self.assertNotEqual(first['version'], manifest.build(root)['version'])

    def test_broken_json_and_missing_resources_block_manifest_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = self.root(folder)
            path = root/'docs/data/match_links.json'
            path.write_text('{broken')
            with self.assertRaises(ValueError):
                manifest.build(root)
            path.write_text('{"invalid":NaN}')
            with self.assertRaises(ValueError):
                manifest.build(root)
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                manifest.build(root)
