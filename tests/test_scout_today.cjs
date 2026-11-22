const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../docs/scout-core.js');
const Model = require('../docs/model-core.js');
const Today = require('../docs/scout-today-core.js');

const now = new Date('2026-11-22T11:00:00Z');
const row = (home, away, date = '2026-11-22', h = null, a = null) =>
  ['E0', 'England', 'Premier League', date, '19:00', home, away, h, a, null, null, null, null];
const evidence = {home: {hits: 7, n: 10}, away: {hits: 6, n: 10}};
const pick = (id, probability = .62, rank = .2, eligible = true) =>
  ({id, family: id.startsWith('btts') ? 'btts' : id.includes('25') || id === 'o15' ? 'total' : 'result', probability, rank, eligible, evidence});
const entry = (home, away, candidates) => ({fixture: row(home, away), candidates});
const priced = (item, odds = 1.85, book = 'Example', checkedAt = now.toISOString()) =>
  ({odds, book, checkedAt, kickoffs: Today.kickoffKey(item.legs)});
const collect = (entries, history = []) => Today.collect(entries, history, Core, Model);

test('Only eligible goals singles enter the board and a verified price changes the order before the cutoff', () => {
  const entries = [entry('Arsenal', 'Everton', [pick('1X', .83, .4), pick('o15', .83, .37), pick('o25', .62, .3)]),
    entry('Liverpool', 'Chelsea', [pick('u25', .59, .19), pick('btts', .54), pick('bttsNo', .6, .2, false)])];
  const {singles} = collect(entries);
  assert.deepEqual(singles.map(item => item.legs[0].markets[0]), ['o25', 'u25']);
  const [first, second] = singles;
  assert.equal(first.minimum, 1.70);
  assert.equal(Today.assess(first, priced(first, 1.20), now), 'below');
  assert.equal(Today.assess(first, priced(first, 1.70), now), 'ready');
  assert.equal(Today.assess(first, priced(first, 2, 'Example', '2026-11-22T09:59:59Z'), now), 'stale');
  const moved = {...first, legs: [{...first.legs[0], time: '21:00'}]};
  assert.equal(Today.assess(moved, priced(first), now), 'missing');
  assert.equal(Today.rank(singles, {[second.id]: priced(second)}, now)[0], second);
});

test('The builder uses the joint score matrix and rejects redundant matches of the same event', () => {
  const home = 'Arsenal', away = 'Chelsea';
  const build = entry(home, away, [pick('o25'), pick('btts', .52), pick('o15', .78)]);
  const all = (club, other) => Array.from({length: 10}, () => row(club, other, '2026-11-08', 2, 1));
  const homeForm = all(home, 'Everton'), awayForm = all(away, 'Brighton');
  build.profile = {home: {all: homeForm, venue: []}, away: {all: awayForm, venue: []}};
  build.model = {distribution: {matrix: [[.22, 0, 0, 0], [0, .16, 0, 0], [0, .36, 0, 0], [.26, 0, 0, 0]]}};
  const history = [...homeForm, ...awayForm, ...Array.from({length: 40}, () => row('Leeds', 'Burnley', '2026-11-08', 0, 0))];
  const {builders} = collect([build], history);
  assert.equal(builders.length, 1);
  assert.deepEqual(builders[0].legs[0].markets, ['btts', 'o25']);
  assert.equal(builders[0].probability, .36);
  assert.equal(builders[0].minimum, 2.92);
  const resultFor = () => row(home, away, '2026-11-22', 3, 0);
  assert.equal(Today.settlement(builders[0], resultFor, Core).won, false);
});

test('A column requires distinct teams and matching bookmakers, with a separately verified total', () => {
  const {singles} = collect([entry('Arsenal', 'Everton', [pick('o25', .62, .4)]),
    entry('Arsenal', 'Chelsea', [pick('u25', .64, .3)]), entry('Liverpool', 'Leeds', [pick('o25', .7, .2)]),
    entry('Brighton', 'Burnley', [pick('u25', .65, .1)])]);
  const quotes = Object.fromEntries(singles.map((item, i) => [item.id, priced(item, 2, i === 2 ? 'Other' : 'Example')]));
  const two = Today.column(singles, quotes, now, Core, 2, 'Example');
  assert.deepEqual(two.legs.map(leg => leg.home), ['Arsenal', 'Brighton']);
  assert.equal(two.probability, .62 * .65);
  assert.equal(Today.column(singles, quotes, now, Core, 3, 'Example'), null);
  assert.equal(Today.assess(two, undefined, now), 'missing');
  assert.equal(Today.assess(two, priced(two, 4), now), 'ready');
});

test('The publication retains the original quote and waits for an official result', () => {
  const {singles} = collect([entry('Arsenal', 'Everton', [pick('o25')]), entry('Liverpool', 'Chelsea', [pick('u25')])]);
  const first = singles[0], record = {...first, audience: 'FREE', quote: priced(first), publishedAt: now.toISOString()};
  assert.equal(Today.recordsFrom({schema: 1, records: [record]}, Core).length, 1);
  assert.equal(Today.recordsFrom({schema: 1, records: [{...record, quote: priced(first, 1.20)}]}, Core).length, 0);
  assert.equal(Today.canRecord(singles[1], 'FREE', [record]), false);
  assert.equal(Today.canRecord(singles[1], 'VIP', [record]), true);
  assert.equal(Today.settlement(record, () => null, Core).won, null);
  assert.equal(Today.settlement(record, () => row('Arsenal', 'Everton', '2026-11-22', 2, 1), Core).won, true);
  assert.equal(record.quote.odds, 1.85);
});
