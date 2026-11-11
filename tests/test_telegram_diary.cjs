'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Diary = require('../scripts/telegram_diary.cjs');
const J = require('../scripts/forecast_diary.cjs');
const Evaluation = require('../scripts/evaluate_model.cjs');
const Core = require('../docs/scout-core.js');
const Daily = require('../docs/scout-daily.js');
const Curated = require('../docs/scout-curated.js');
const Model = require('../docs/model-core.js');
const Archive = require('../docs/scout-archive.js');

const comparison = require('../docs/data/model_comparison.json');
const paired = require('../docs/data/diary/experiments/opponent-days-v1/config.json');
const date = '2026-10-28';
const now = new Date(date + 'T07:00:00Z');
const history = require('../docs/data/history.json').filter(row => row[3] < date);
const fixtures = require('./fixtures/selection-calendar-2026-10-28.json').filter(row => row[3] === date);
const config = Diary.makeConfig(comparison, paired, new Date(date + 'T06:00:00Z'));
const args = {history, fixtures, config, now};
const capture = Diary.advance(args);
const records = capture.newForecasts;

test('Telegram captures the browser ranking and three equally sized alternatives before kickoff', () => {
  assert.ok(records.length > Daily.LIMIT);
  const view = globalThis.MatchpulsePresentation;
  const engine = Curated.createEngine(history, Model, Core);
  const archive = Archive.build(Core, history, []);
  const pool = Core.getUpcoming(fixtures.filter(row => Daily.isFixture(row, view)), Daily.cutoff(now));
  const evaluations = pool.map(row => engine.evaluate(row, {profile: archive.profile(row, {windowSize: 10}), now}));
  const live = Daily.shortlist(evaluations, Core, view).map(({key, pick}) => [key, pick.id]);
  const saved = records.filter(entry => entry.telegram.choices.league_form)
    .sort((a, b) => a.telegram.choices.league_form.position - b.telegram.choices.league_form.position)
    .map(entry => [entry.fixture_key, entry.telegram.choices.league_form.market]);
  assert.deepEqual(saved, live);
  for (const totals of Object.values(capture.report.variants)) assert.equal(totals.overall.recorded, Daily.LIMIT);
  assert.equal(capture.report.comparable_days, 0);
  assert.ok(capture.report.coverage.opponent_fitted > 0);
  for (const entry of records) {
    assert.equal(entry.captured_at_utc, now.toISOString());
    assert.ok(Date.parse(entry.kickoff_utc) - +now >= 30 * 60000);
    assert.ok(entry.telegram.training_cutoff < entry.fixture.date);
    for (const choice of Object.values(entry.telegram.choices)) assert.ok(entry.telegram.markets.some(p => p.id === choice.market));
  }
});

test('Frozen calibration uses the registered early fit and the same outcome per market', () => {
  const markets = {o15: 'over15', o25: 'over25', o35: 'over35', u25: 'under25', u35: 'under35', btts: 'btts', bttsNo: 'noBtts'};
  const weight = config.calibration.current_weight;
  assert.equal(weight, comparison.blends.current.weight);
  assert.deepEqual(config.calibration.period, comparison.periods.calibration_fit);
  for (const entry of records) {
    for (const pick of entry.telegram.markets) {
      const id = markets[pick.id];
      const definition = Evaluation.MARKETS.find(m => m.id === id);
      const original = definition.probability(entry.model.probabilities);
      const expected = original * (1 - weight) + entry.model.baselines.league_goal_means[id] * weight;
      assert.ok(Math.abs(pick.probability - original) < 1e-12);
      assert.ok(Math.abs(pick.calibrated - expected) < 1e-12);
    }
  }
});

test('A second refresh preserves the slate and corrected outcomes update all comparisons', () => {
  const forecasts = records;
  const frozen = J.canonical(forecasts);
  const again = Diary.advance({...args, forecasts, now: new Date(date + 'T07:40:00Z')});
  assert.equal(again.newForecasts.length, 0);
  const results = records.map(entry => {
    const row = [...fixtures.find(f => Core.keyFixture(f) === entry.fixture_key)];
    row[7] = 2;
    row[8] = 1;
    row[13] = {};
    return row;
  });
  const later = {...args, history: [...history, ...results], fixtures: [], forecasts, now: new Date('2026-10-29T10:00:00Z')};
  const settled = Diary.advance(later);
  assert.equal(settled.report.comparable_days, 1);
  for (const counts of Object.values(settled.report.variants)) {
    assert.equal(counts.overall.settled, Daily.LIMIT);
    assert.deepEqual(counts.overall, counts.comparable);
  }
  for (const [market, baseline] of Object.entries(settled.report.calibration.probability)) {
    assert.equal(settled.report.calibration.calibrated[market].n, baseline.n);
    assert.equal(settled.report.calibration.opponent[market].n, baseline.n);
    assert.equal(baseline.bins.reduce((n, bin) => n + bin.n, 0), baseline.n);
  }
  const revised = Diary.advance({
    ...later, history: [...history, ...results.map((row, index) => index ? row : row.map((v, i) => i === 7 || i === 8 ? 0 : v))],
    events: settled.newEvents, now: new Date('2026-10-29T11:00:00Z')
  });
  assert.equal(revised.newEvents.length, 1);
  assert.equal(revised.newEvents[0].revision, 2);
  assert.deepEqual(revised.newEvents[0].state.result.score, [0, 0]);
  assert.equal(J.canonical(forecasts), frozen);
});

test('Missing candidate results stay pending and changed capture code pauses new slates', () => {
  const paused = Diary.advance({...args, files: {...config.files, 'docs/scout-daily.js': '0'.repeat(64)}});
  assert.equal(paused.newForecasts.length, 0);
  assert.equal(paused.report.last_run.capture_paused, true);
  const days = Diary.report(records, [], config, now);
  for (const counts of Object.values(days.variants)) {
    assert.equal(counts.overall.pending, Daily.LIMIT);
    assert.equal(counts.comparable.settled, 0);
  }
});
