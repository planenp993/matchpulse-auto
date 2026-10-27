import copy
import tempfile
from pathlib import Path
import unittest
from scripts import selection_quotes as view, market_archive as markets, match_registry as registry, update as u

ROW = ['E0', 'England', 'Premier League', '2026-10-30', '18:00', 'Arsenal', 'Chelsea', None, None, None, None, None, None, 'ESPN / UTC→Europe-Sofia']
STAMP = '2026-10-27T12:00:00+00:00'


class SelectionQuoteTests(unittest.TestCase):
    def save(self, root, raw, kind='fixture_csv', stamp=STAMP):
        item, _ = markets.observation(raw, ROW, markets.market_columns(raw),
                                     'https://www.football-data.co.uk/fixtures.csv', 'a'*64, kind, registry.row_key(ROW))
        path = root/'data/markets/E0/2026-27.json'
        shard = markets.load(path) if path.exists() else markets.empty('E0', '2026-27')
        markets.merge(shard, [item], stamp)
        u.writejson(path, shard)

    def test_historical_closing_and_handicap_prices_are_never_upcoming_selections(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.save(root, {'B365H': '1.8'}, kind='historical_csv')
            self.save(root, {'B365CH': '1.7', 'B365CAHH': '1.9', 'AHCh': '-0.5'})
            self.assertEqual(view.build(root, [ROW], {})['fixtures'], {})

    def test_exact_identity_and_date_only_with_retained_book_column_and_clock(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.save(root, {'B365>2.5': '1.85', 'Avg>2.5': '1.9', 'AvgH': '1.8'})
            before = (root/'data/markets/E0/2026-27.json').read_bytes()
            actual = view.build(root, [ROW], {'last_quote_success_utc': STAMP})
            prices = actual['fixtures'][registry.row_key(ROW)]
            self.assertEqual(prices['o25']['odds'], 1.85)
            self.assertEqual(prices['o25']['column'], 'B365>2.5')
            self.assertEqual(prices['o25']['observed_at_utc'], STAMP)
            self.assertEqual(prices['1']['book'], 'Средна CSV цена')
            moved = copy.deepcopy(ROW); moved[3] = '2026-11-01'
            self.assertEqual(view.build(root, [moved], {})['fixtures'], {})
            self.assertEqual((root/'data/markets/E0/2026-27.json').read_bytes(), before)

    def test_latest_actual_observation_wins_and_empty_columns_stay_missing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.save(root, {'B365H': '1.8'})
            self.save(root, {'B365H': '1.9', 'B365D': ''}, stamp='2026-10-28T12:00:00+00:00')
            prices = view.build(root, [ROW], {})['fixtures'][registry.row_key(ROW)]
            self.assertEqual(prices['1']['odds'], 1.9)
            self.assertNotIn('X', prices)
            view.write(root, [ROW], {})
            first = (root/view.VIEW).read_bytes(); view.write(root, [ROW], {})
            self.assertEqual(first, (root/view.VIEW).read_bytes())

    def test_corrupt_shards_block_the_publication_view(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.save(root, {'B365H': '1.8'})
            path = root/'data/markets/E0/2026-27.json'
            path.write_text('{}')
            with self.assertRaises(ValueError):
                view.build(root, [ROW], {})
