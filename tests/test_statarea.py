import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
from scripts import data_sync as sync
from scripts import match_registry as registry
from scripts import statarea as sta
from scripts import update as u

NOW = dt.datetime(2026, 10, 29, 12, tzinfo=dt.timezone.utc)
STAMP = sync.iso(NOW)
CONFIG = {'schema': 1, 'provider': 'Statarea', 'interval_minutes': 30,
          'initial_past_days': 30, 'daily_past_days': 7, 'future_days': 7}


def html(day='2026-10-28', clock='17:30', status='fin', system='1', extra='',
         score=('2', '1'), league='England - Premier League', home='Arsenal', away='Chelsea', gmt='GMT 0'):
    return (f"<div class='date navigator'><div class='value' id='cdate'>{day}</div></div>"
            f"<div class='gmt'>{gmt}</div><div class='competition'><div class='header'><div class='name'>{league}</div></div>"
            f"<div class='match' id='{day.replace('-', '')}1'><div class='systemstatus'>{system}</div>"
            f"<div class='time'>{clock}</div><div class='status'>{status}</div><div class='hostteam'>"
            f"<div class='name'>{home}</div><div class='goals'>{score[0]}</div></div><div class='guestteam'>"
            f"<div class='name'>{away}</div><div class='goals'>{score[1]}</div><div class='extra'>{extra}</div>"
            "</div></div></div>").encode()


def row(day='2026-10-28', goals=None, clock='19:30', home='Arsenal', away='Chelsea'):
    return ['E0', 'England', 'Premier League', day, clock, home, away,
            *(goals if goals is not None else [None, None]), None, None, None, None,
            {'HS': 12} if goals else 'Statarea / UTC→Europe-Sofia']


class StatareaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for path, value in [('docs/data/history.json', [row('2026-10-01', [0, 0])]),
                            ('docs/data/fixtures.json', []), ('docs/data/status.json', {}),
                            (sta.CONFIG, CONFIG)]:
            u.writejson(self.root/path, value)

    def read(self, path):
        return json.loads((self.root/path).read_text())

    def batch(self, **kwargs):
        raw, _ = sta.parse(html(**kwargs), kwargs.get('day', '2026-10-28'))
        record = raw[0]
        names = sta.Names(self.root, [row(goals=[0, 0])], [])
        future = sta.row_for(record, names)
        observation = {'row': future, 'provider_id': 'Statarea:'+record['id'],
                       'kickoff_utc': record['kickoff_utc'], 'status': None}
        final = {**observation, 'row': [*future[:7], *(record['regulation'] or [None, None]),
                                      None, None, None, None, {'SRC': 'Statarea'}]}
        return {'records': [{'match': record, 'source': {'url': 'https://www.statarea.com/livescore/date/'+record['source_date_utc'], 'sha256': 'a'*64}}],
                'observations': [observation], 'results': [final] if record['regulation'] else [],
                'rows': [] if record['regulation'] else [future],
                'wide': False, 'days': {record['source_date_utc']: {'status': 'ok'}},
                'errors': [], 'quarantined': []}

    def patch(self, batch, stamp=STAMP):
        return {'schema': 1, 'observed_at_utc': stamp, 'plan': {'history': False, 'full': False,
                'calendar': True, 'quotes': False, 'calendar_provider': 'Statarea'},
                'history': [], 'observations': [], 'checks': {}, 'errors': [],
                'calendar': None, 'quotes': None, 'statarea': batch}

    def test_parser_requires_requested_day_confirmed_utc_and_nonempty_global_page(self):
        for raw, day in [(html(gmt='GMT -5'), '2026-10-28'), (html(), '2026-10-27'),
                         (b"<div class='gmt'>GMT 0</div>", '2026-10-28')]:
            with self.assertRaises(ValueError): sta.parse(raw, day)
        self.assertEqual(sta.parse(html(), '2026-10-28')[0][0]['regulation'], [2, 1])

    def test_only_exact_competitions_and_explicit_regulation_finals_are_accepted(self):
        for kwargs in [dict(extra='P'), dict(extra='ET'), dict(status='awrd'),
                       dict(status="90'", system='10'), dict(system='2'), dict(score=('-', '-'))]:
            self.assertIsNone(sta.parse(html(**kwargs), '2026-10-28')[0][0]['regulation'])
        for label in ['England - Premier League Women', 'England - Efl Cup', 'England - Premier League U21']:
            self.assertEqual(sta.parse(html(league=label), '2026-10-28')[0], [])

    def test_explicit_split_and_uefa_phase_labels_preserve_competition_scope(self):
        labels = {
            'Scotland - Premiership - Championship Group': 'SC0',
            'Belgium - Jupiler Pro League - Conference League Group': 'B1',
            'Austria - Bundesliga - Relegation Group': 'AUT',
            'Denmark - Superliga - Championship Group': 'DNK',
            'Greece - Super League - Conference League Group': 'G1',
            'Switzerland - Super League - Relegation Group': 'SWZ',
            'Europe - Champions League - Play Offs': 'UCL',
            'Europe - Europa League - Qualification': 'UEL',
            'Europe - Conference League - Play Offs': 'UECL',
        }
        for label, div in labels.items():
            self.assertEqual(sta.parse(html(league=label), '2026-10-28')[0][0]['division'], div)
        for label in ['Austria - Bundesliga Women - Relegation Group',
                      'Europe - Champions League Women - Play Offs',
                      'Switzerland - Super League Women - Placement Play Offs']:
            self.assertFalse(sta.parse(html(league=label), '2026-10-28')[0])
        records, _ = sta.parse(html(league='Belgium - Jupiler Pro League - Relegation'), '2026-10-28')
        self.assertTrue(records[0]['calendar_only'])
        home = row(goals=[0, 0]); home[0:3] = ['B1', 'Belgium', 'Pro League']
        batch = {'records': [{'match': records[0]}]}
        projected = sta.project(batch, sta.Names(self.root, [home], []), NOW)
        self.assertFalse(projected['results'])
        self.assertEqual(len(projected['records']), 1)

    def test_utc_day_converts_to_next_sofia_day_and_dst_fold_is_explicit(self):
        names = sta.Names(self.root, [row(goals=[0, 0])], [])
        record = sta.parse(html(clock='23:30'), '2026-10-28')[0][0]
        result = sta.row_for(record, names)
        self.assertEqual(result[3:5], ['2026-10-29', '01:30'])
        book = registry.empty()
        for i, hour in enumerate(['00:30', '01:30']):
            rec = sta.parse(html(day='2026-10-25', clock=hour, status='sched', system='0'), '2026-10-25')[0][0]
            future = sta.row_for(rec, names)
            self.assertEqual(future[4], '03:30')
            self.assertIsNone(registry.kickoff(future))
            registry.observe(book, [{'row': future, 'provider_id': 'Statarea:fold', 'kickoff_utc': rec['kickoff_utc']}], f'2026-10-24T0{i}:00:00+00:00')
            registry.observe(book, [{'row': future}], f'2026-10-24T0{i}:00:00+00:00')
            self.assertEqual(next(iter(book['matches'].values()))['kickoff_utc'], rec['kickoff_utc'])
        with self.assertRaises(ValueError):
            registry.observe(registry.empty(), [{'row': future, 'kickoff_utc': '2026-10-25T02:30:00+00:00'}], STAMP)

    def test_unknown_clock_remains_unknown_and_no_fuzzy_or_cross_league_identity(self):
        names = sta.Names(self.root, [row(goals=[0, 0])], [])
        rec = sta.parse(html(clock='TBD'), '2026-10-28')[0][0]
        result = sta.row_for(rec, names)
        self.assertEqual(result[4], '')
        self.assertNotIn('Sofia', result[13])
        self.assertIsNone(registry.kickoff(result))
        self.assertIsNone(names.resolve('D1', 'Arsenal'))
        self.assertIsNone(names.resolve('E0', 'Arsenall'))
        names.add('E0', 'Arsenal', 'Chelsea')
        self.assertIsNone(names.resolve('E0', 'Arsenal'))

    def test_collector_keeps_other_days_when_one_fails_and_quarantines_unsafe_final(self):
        def get(url):
            day = url.rsplit('/', 1)[1]
            if day == '2026-10-28': raise OSError('temporarily unavailable')
            return html(day=day, clock='TBD' if day == '2026-10-27' else '17:30',
                        status='fin' if day <= '2026-10-29' else 'sched',
                        system='1' if day <= '2026-10-29' else '0')
        batch = sta.collect(self.root, NOW, download=get)
        self.assertEqual(batch['days']['2026-10-28']['status'], 'error')
        self.assertGreater(len(batch['rows']), 0)
        self.assertTrue(any(x['reason'] == 'unconfirmed_final_kickoff' for x in batch['quarantined']))
        self.assertFalse(any(r['row'][3] == '2026-10-27' for r in batch['results']))

    def test_rate_limited_source_stops_the_batch_without_retrying_every_day(self):
        calls = []
        def limited(url):
            calls.append(url)
            raise urllib.error.HTTPError(url, 429, 'Too many requests', {}, None)
        batch = sta.collect(self.root, NOW, wide=True, initial=True, download=limited)
        self.assertLessEqual(len(calls), 2)
        self.assertEqual(len(batch['errors']), len(batch['days']))
        self.assertFalse(batch['records'])

    def test_archive_deduplicates_observations_appends_corrections_and_replays_older_evidence(self):
        first, second = self.batch(), self.batch(score=('3', '1'))
        sta.persist(self.root, first, STAMP)
        later = sync.iso(NOW+dt.timedelta(minutes=30))
        sta.persist(self.root, first, later)
        sta.persist(self.root, second, sync.iso(NOW+dt.timedelta(hours=1)))
        sta.persist(self.root, first, sync.iso(NOW-dt.timedelta(hours=1)))
        saved = next(iter(self.read('data/statarea/2026-10.json')['matches'].values()))
        self.assertEqual(len(saved['observations']), 2)
        self.assertEqual(saved['current']['regulation'], [3, 1])
        self.assertEqual(sta.check(self.root)['statarea_matches'], 1)
        self.assertEqual(saved['first_observed_utc'], sync.iso(NOW-dt.timedelta(hours=1)))

    def test_corrupt_or_missing_indexed_shard_blocks_without_reset(self):
        sta.persist(self.root, self.batch(), STAMP)
        path = self.root/'data/statarea/2026-10.json'
        path.write_text('{')
        with self.assertRaises(ValueError): sta.persist(self.root, self.batch(), STAMP)
        self.assertEqual(path.read_text(), '{')
        path.unlink()
        with self.assertRaises(ValueError): sta.persist(self.root, self.batch(), STAMP)

    def test_score_conflicts_do_not_overwrite_published_result_or_richer_stats(self):
        existing = row(goals=[2, 1]); original = copy.deepcopy(existing)
        history = u.index_history([existing]); book = registry.empty()
        changed, conflicts = sta.apply_results(self.batch(), history, book)
        self.assertEqual((changed, conflicts), ([], 0))
        self.assertEqual(next(iter(history.values())), original)
        changed, conflicts = sta.apply_results(self.batch(score=('3', '1')), history, book)
        self.assertEqual((changed, conflicts), ([], 1))
        self.assertEqual(next(iter(history.values())), original)
        self.assertEqual(len(book['conflicts']), 1)

    def test_apply_adds_goal_only_result_preserves_it_through_outage_and_rejects_old_view(self):
        summary = sync.apply(self.root, self.patch(self.batch()))
        self.assertEqual(summary['changed_results'], 1)
        result = next(r for r in self.read('docs/data/history.json') if r[3] == '2026-10-28')
        self.assertEqual(result[7:13], [2, 1, None, None, None, None])
        outage = {**self.batch(), 'records': [], 'observations': [], 'results': [],
                  'days': {'2026-10-28': {'status': 'error'}}, 'errors': ['unavailable']}
        sync.apply(self.root, self.patch(outage, sync.iso(NOW+dt.timedelta(hours=1))))
        sync.apply(self.root, self.patch(self.batch(score=('5', '0')), sync.iso(NOW-dt.timedelta(hours=1))))
        self.assertEqual(self.read('docs/data/history.json')[-1][7:9], [2, 1])
        self.assertEqual(self.read('docs/data/status.json')['statarea_refresh_status'], 'error')
        self.assertEqual(sta.check(self.root)['statarea_matches'], 1)

    def test_provider_id_reschedule_replaces_only_that_fixture_and_failure_retains_other_dates(self):
        first = self.batch(day='2026-10-30', status='sched', system='0', score=('-', '-'))
        sync.apply(self.root, self.patch(first))
        newer = self.batch(day='2026-11-01', status='sched', system='0', score=('-', '-'))
        identity = first['records'][0]['match']['id']
        newer['records'][0]['match']['id'] = identity
        newer['observations'][0]['provider_id'] = 'Statarea:'+identity
        sync.apply(self.root, self.patch(newer, sync.iso(NOW+dt.timedelta(minutes=30))))
        self.assertEqual([r[3] for r in self.read('docs/data/fixtures.json')], ['2026-11-01'])
        outage = {**newer, 'rows': [], 'records': [], 'observations': [],
                  'days': {'2026-11-01': {'status': 'error'}}, 'errors': ['unavailable']}
        sync.apply(self.root, self.patch(outage, sync.iso(NOW+dt.timedelta(hours=1))))
        self.assertEqual([r[3] for r in self.read('docs/data/fixtures.json')], ['2026-11-01'])
        self.assertEqual(len(self.read('data/statarea/2026-10.json')['matches']), 1)
        self.assertFalse((self.root/'data/statarea/2026-11.json').exists())

    def test_production_fast_tick_and_daily_wide_scan_leave_slower_sources_gated(self):
        fresh = {k: STAMP for k in ['last_full_history_success_utc', 'last_current_history_success_utc',
                 'last_history_attempt_utc', 'last_fixture_attempt_utc', 'last_europe_attempt_utc',
                 'last_standings_attempt_utc', 'last_statarea_wide_attempt_utc']}
        fresh.update(quote_window=sync.quote_window(NOW), last_europe_backfill_success_utc=STAMP)
        work = sync.plan(fresh, 'auto', NOW+dt.timedelta(minutes=30), CONFIG)
        self.assertTrue(work['statarea'])
        self.assertFalse(work['statarea_wide'])
        self.assertFalse(any(work[k] for k in ['history', 'quotes', 'results', 'europe', 'standings']))
        work = sync.plan(fresh, 'auto', NOW+dt.timedelta(hours=23), CONFIG)
        self.assertTrue(work['statarea_wide'])
        self.assertFalse(any(sync.plan(fresh, 'publish', NOW, CONFIG)[k] for k in ['history', 'calendar', 'results']))

    def test_calendar_mode_uses_only_statarea_no_football_data_or_legacy_calendar(self):
        calls = []
        def source(url):
            calls.append(url)
            return html(day=url.rsplit('/', 1)[1], status='sched', system='0', score=('-', '-'))
        def forbidden(*args, **kwargs): raise AssertionError('Unexpected non-Statarea provider request')
        with patch.object(sync, 'calendars', side_effect=forbidden), patch.object(sync.bridge, 'collect', side_effect=forbidden):
            result = sync.collect(self.root, 'calendar', NOW, download=forbidden, statarea_download=source)
        self.assertTrue(result['statarea']['records'])
        self.assertIsNone(result['calendar'])
        self.assertEqual(len(calls), 39)
        self.assertFalse(result['markets'])

    def test_csv_quote_enrichment_cannot_add_fixture_or_replace_primary_kickoff(self):
        batch = self.batch(day='2026-10-30', status='sched', system='0', score=('-', '-'))
        patch = self.patch(batch)
        patch['plan'].update(quotes=True, quote_window='2026-10-27')
        priced = row('2026-10-30', clock='23:00'); priced[11:13] = [1.8, 2.1]
        patch['quotes'] = {'rows': [priced, row('2026-10-31', home='New team')], 'sha256': 'b'*64}
        sync.apply(self.root, patch)
        rows = self.read('docs/data/fixtures.json')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][4], '19:30')
        self.assertEqual(rows[0][11:13], [1.8, 2.1])
        self.assertTrue(rows[0][13].startswith('Statarea'))


    def test_verified_uefa_registry_alias_keeps_the_original_match_without_false_identity_conflict(self):
        clubs = {'10': {'name': 'Paris SG', 'source_names': ['Paris', 'Paris SG']},
                 '20': {'name': 'Barcelona', 'source_names': ['Barcelona']}}
        u.writejson(self.root/'data/europe_clubs.json', clubs)
        original = ['UCL', 'Europe', 'Champions League', '2026-10-30', '21:00', 'Paris', 'Barcelona',
                    None, None, None, None, None, None, 'Saved calendar / Europe-Sofia']
        book = registry.empty(); registry.observe(book, [{'row': original}], STAMP)
        changed = list(original); changed[5] = 'Paris SG'
        batch = self.batch(); batch.update(observations=[{'row': changed, 'provider_id': 'Statarea:123'}], rows=[changed], results=[])
        aligned = sta.align_registry(self.root, batch, book)
        self.assertEqual(aligned['rows'][0][5], 'Paris')
        registry.observe(book, aligned['observations'], STAMP)
        self.assertEqual(len(book['matches']), 1)
        self.assertFalse(book['conflicts'])
        self.assertFalse(aligned['quarantined'])
        self.assertEqual(batch['rows'][0][5], 'Paris SG')
        wrong = copy.deepcopy(batch); wrong['observations'][0]['row'][0] = 'E0'
        wrong['observations'][0]['provider_id'] = 'Statarea:123'
        rejected = sta.align_registry(self.root, wrong, book)
        self.assertFalse(rejected['observations'])
        self.assertEqual(rejected['quarantined'][0]['reason'], 'provider_identity_changed')

    def test_published_final_date_correction_is_archived_for_review_not_imported_twice(self):
        book = registry.empty(); batch = self.batch()
        registry.observe(book, batch['observations'], STAMP)
        registry.reconcile(book, [batch['results'][0]['row']], [], STAMP)
        newer = self.batch(day='2026-10-27')
        newer['observations'][0]['provider_id'] = batch['observations'][0]['provider_id']
        newer['results'][0]['provider_id'] = batch['observations'][0]['provider_id']
        aligned = sta.align_registry(self.root, newer, book)
        self.assertFalse(aligned['results'])
        self.assertEqual(aligned['quarantined'][0]['reason'], 'published_result_date_changed')
        self.assertEqual(len(aligned['records']), 1)

    def test_checked_in_name_proofs_match_archived_scores_and_two_match_tables(self):
        root = Path(__file__).resolve().parents[1]
        entries = json.loads((root/sta.CROSSWALK).read_text())['entries']
        history = json.loads((root/'docs/data/history.json').read_text())+json.loads((root/'docs/data/europe_history.json').read_text())
        lookup = {registry.row_key(r): r for r in history}
        for entry in entries:
            sta.validate_name(entry, root)
            for evidence in entry['evidence']:
                self.assertEqual(lookup[evidence['archive_key']][7:9], evidence['regulation'])
            if entry.get('two_match_uefa_proof'):
                broken = copy.deepcopy(entry)
                broken['two_match_uefa_proof']['standing_totals']['gf'] += 1
                with self.assertRaises(ValueError): sta.validate_name(broken, root)


if __name__ == '__main__': unittest.main()
