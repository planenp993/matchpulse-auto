import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import refresh_clock as clock
from scripts import data_sync as sync
from scripts import update as u
from tests import test_statarea as sta_tests


NOW = dt.datetime(2026, 10, 29, 13, 20, tzinfo=dt.timezone.utc)


class RefreshClockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        stamp = sync.iso(NOW)
        self.status = {key: stamp for key in ('last_full_history_success_utc',
            'last_current_history_success_utc', 'last_history_attempt_utc',
            'last_fixture_attempt_utc', 'last_statarea_success_utc',
            'last_statarea_wide_attempt_utc', 'last_europe_attempt_utc',
            'last_europe_backfill_success_utc', 'last_standings_attempt_utc', 'last_quote_attempt_utc')}
        self.status['quote_window'] = sync.quote_window(NOW)
        u.writejson(self.root/'ops/calendar_source.json', sta_tests.CONFIG)

    def decide(self, after=0):
        u.writejson(self.root/'docs/data/status.json', self.status)
        # Any accidental provider access while merely checking due work fails.
        with patch.object(clock.sync, 'collect', side_effect=AssertionError('Collection in clock')), \
             patch('urllib.request.urlopen', side_effect=AssertionError('Provider access in clock')):
            return clock.decision(self.root, NOW+dt.timedelta(minutes=after))

    def test_fresh_tick_does_not_repeat_download_or_publish(self):
        before = dict(self.status)
        self.assertEqual(self.decide(10)['due'], [])
        self.assertFalse(self.decide(20)['refresh'])
        self.assertEqual(json.loads((self.root/'docs/data/status.json').read_text()), before)

    def test_30_minute_tick_refreshes_statarea_without_slow_sources(self):
        result = self.decide(30)
        self.assertTrue(result['refresh'])
        self.assertEqual(set(result['due']), {'calendar', 'statarea'})
        self.assertFalse(result['plan']['statarea_wide'])

    def test_delayed_or_missed_tick_catches_up_from_receipts(self):
        self.assertEqual(set(self.decide(70)['due']), {'calendar', 'statarea'})
        self.status['last_current_history_success_utc'] = sync.iso(NOW-dt.timedelta(hours=21))
        self.assertNotIn('history', self.decide(70)['due'])  # Still in attempt cooldown.
        self.status['last_history_attempt_utc'] = sync.iso(NOW-dt.timedelta(hours=3))
        self.assertIn('history', self.decide(70)['due'])

    def test_daily_wide_pass_can_be_due_independently_of_csv_history(self):
        self.status['last_statarea_wide_attempt_utc'] = sync.iso(NOW-dt.timedelta(hours=24))
        result = self.decide(30)
        self.assertTrue(result['plan']['statarea_wide'])
        self.assertFalse(result['plan']['history'])


class SourceTriggerTests(unittest.TestCase):
    # Reuse only fixture helpers; keep the original source tests in their module.
    setUp = sta_tests.StatareaTests.setUp
    read = sta_tests.StatareaTests.read
    batch = sta_tests.StatareaTests.batch
    patch = sta_tests.StatareaTests.patch

    def test_scheduled_source_receipt_survives_a_later_code_publication(self):
        batch = self.patch(self.batch())
        trigger = {'event': 'schedule', 'run_id': '12345', 'run_attempt': '1'}
        batch['trigger'] = trigger
        sync.apply(self.root, batch)
        self.assertEqual(self.read('docs/data/status.json')['last_statarea_success_trigger'], trigger)
        publication = self.patch(None, sync.iso(NOW+dt.timedelta(hours=1)))
        publication['plan'] = sync.plan({}, 'publish', NOW)
        publication['trigger'] = {'event': 'push', 'run_id': '12346'}
        sync.apply(self.root, publication)
        self.assertEqual(self.read('docs/data/status.json')['last_statarea_success_trigger'], trigger)
