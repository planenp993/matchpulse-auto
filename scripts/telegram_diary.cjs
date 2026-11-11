/* Prospective comparison of four rankings on the same daily Telegram pool. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const J = require('./forecast_diary.cjs');
const Pair = require('./paired_model_diary.cjs');
const Fit = require('./fit_goal_model.cjs');
const Evaluation = require('./evaluate_model.cjs');
const Daily = require('../docs/scout-daily.js');
const Curated = require('../docs/scout-curated.js');
const Core = require('../docs/scout-core.js');
const Model = require('../docs/model-core.js');
const Archive = require('../docs/scout-archive.js');
require('../docs/scout-presentation.js');
const View = globalThis.MatchpulsePresentation;

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'docs/data');
const ID = 'telegram-daily-v1';
const RELATIVE = 'docs/data/diary/experiments/' + ID;
const DIR = path.join(ROOT, RELATIVE);
const REPORT = path.join(DATA, 'telegram_diary_report.json');
const CONFIG = path.join(DIR, 'config.json');
const VARIANTS = {league_form: 'rank', probability: 'probability', calibrated: 'calibrated', opponent: 'opponent'};
const VARIANT_IDS = Object.keys(VARIANTS);
const MODELS = ['probability', 'calibrated', 'opponent'];
const PROBABILITY_IDS = {
  o15: 'over15', o25: 'over25', o35: 'over35', u25: 'under25', u35: 'under35',
  btts: 'btts', bttsNo: 'noBtts'
};
const MARKETS = new Map(Curated.MARKETS.filter(market => market.id in PROBABILITY_IDS).map(market => [market.id, market]));
const INDEX = Object.fromEntries(Evaluation.MARKETS.map((market, index) => [market.id, index]));
const FILES = [
  'scripts/telegram_diary.cjs', 'scripts/forecast_diary.cjs', 'scripts/evaluate_model.cjs', 'scripts/fit_goal_model.cjs',
  'docs/model-core.js', 'docs/club-aliases.js', 'docs/scout-core.js', 'docs/scout-archive.js',
  'docs/scout-selections.js', 'docs/scout-combinations.js', 'docs/scout-curated.js', 'docs/scout-daily.js', 'docs/scout-presentation.js'
];
const versions = () => Object.fromEntries(FILES.map(file => [file, J.sha(fs.readFileSync(path.join(ROOT, file)))]));
const vector = probabilities => Evaluation.MARKETS.map(market => probabilities[market.id]);
const validProbability = p => Number.isFinite(p) && p >= 0 && p <= 1;
const isHash = value => /^[a-f0-9]{64}$/.test(value || '');
const round = value => Number(value.toFixed(6));

function makeConfig(comparison, opponent, now = new Date(), files = versions(), comparisonSha = J.sha(J.canonical(comparison))) {
  Pair.validateConfig(opponent);
  const current = comparison.blends.current;
  if (current.fitted_on !== 'calibration_fit' || J.canonical(comparison.periods.calibration_fit) !== J.canonical(opponent.calibration_period) ||
      comparison.blends.opponent_days.weight !== opponent.blend_weight) throw Error('Historical calibration does not match the paired model');
  return J.seal({
    schema: 1, id: ID, created_at_utc: now.toISOString(), files,
    calibration: {
      method: 'coherent_league_goal_distribution_blend', period: opponent.calibration_period,
      current_weight: current.weight, opponent_weight: opponent.blend_weight,
      historical_report_sha256: comparisonSha, opponent_config_sha256: opponent.sha256
    },
    opponent_fit: opponent.fit_settings,
    policy: {maximum_per_day: Daily.LIMIT, minimum_probability: Daily.MIN_PROBABILITY, minimum_minutes_before_kickoff: J.MARGIN_MINUTES}
  });
}

function validateConfig(config) {
  const {sha256, ...payload} = config;
  const calibration = config.calibration;
  if (sha256 !== J.seal(payload).sha256 || config.id !== ID || config.schema !== 1 ||
      !Number.isFinite(Date.parse(config.created_at_utc)) || !FILES.every(file => isHash(config.files?.[file])) ||
      calibration?.method !== 'coherent_league_goal_distribution_blend' ||
      !validProbability(calibration.current_weight) || !validProbability(calibration.opponent_weight) ||
      !isHash(calibration.historical_report_sha256) || !isHash(calibration.opponent_config_sha256) ||
      !Array.isArray(calibration.period) || calibration.period.length !== 2 ||
      calibration.period[0] >= calibration.period[1] || calibration.period[1] >= J.sofiaDate(new Date(config.created_at_utc))) {
    throw Error('Invalid Telegram comparison registration');
  }
}

function validate(forecasts, events, config) {
  validateConfig(config);
  const {latest} = J.validate(forecasts, events);
  const days = new Map();
  for (const entry of forecasts) {
    const {fixture, telegram} = entry;
    const captured = new Date(entry.captured_at_utc);
    const date = fixture.date;
    if (telegram?.config_sha256 !== config.sha256 || +captured < Date.parse(config.created_at_utc) ||
        J.sofiaDate(captured) !== date || !telegram.markets.length ||
        typeof telegram.opponent_available !== 'boolean' || telegram.training_cutoff !== Fit.weekStart(date)) {
      throw Error('Invalid Telegram capture');
    }
    const markets = new Map(telegram.markets.map(pick => [pick.id, pick]));
    if (markets.size !== telegram.markets.length) throw Error('Duplicate Telegram market');
    for (const pick of markets.values()) {
      if (!MARKETS.has(pick.id) || !MODELS.every(key => validProbability(pick[key])) ||
          pick.probability < config.policy.minimum_probability || !Number.isFinite(pick.rank) || pick.rank <= 0 ||
          (!telegram.opponent_available && pick.opponent !== pick.calibrated)) {
        throw Error('Invalid frozen Telegram probability');
      }
    }
    if (!days.has(date)) days.set(date, {
      captured: entry.captured_at_utc, fixtures: [], choices: Object.fromEntries(VARIANT_IDS.map(id => [id, []]))
    });
    const day = days.get(date);
    if (day.captured !== entry.captured_at_utc) throw Error('Multiple Telegram captures on the same day');
    const state = latest.get(entry.id)?.state || {status: 'pending'};
    day.fixtures.push({entry, state});
    for (const [id, choice] of Object.entries(telegram.choices)) {
      const pick = markets.get(choice.market);
      if (!day.choices[id] || !pick || !Number.isInteger(choice.position) || choice.position < 1) {
        throw Error('Invalid frozen Telegram selection');
      }
      day.choices[id].push({entry, state, pick, position: choice.position});
    }
  }
  for (const day of days.values()) {
    const size = Math.min(config.policy.maximum_per_day, day.fixtures.length);
    for (const picks of Object.values(day.choices)) {
      picks.sort((a, b) => a.position - b.position);
      if (picks.length !== size || picks.some((pick, index) => pick.position !== index + 1)) {
        throw Error('Telegram variants must have equal daily counts and unique positions');
      }
    }
  }
  return days;
}

function capture({history, fixtures, forecasts, config, now, matchLinks, europe, europeNames, sources}) {
  const today = J.sofiaDate(now);
  const pool = Core.getUpcoming(fixtures.filter(f => f[3] === today && Daily.isFixture(f, View)), Daily.cutoff(now));
  if (!pool.length) return [];

  const archive = Archive.build(Core, history, europe, {matches: matchLinks}, europeNames);
  const engine = Curated.createEngine(history, Model, Core);
  const evaluated = new Map();
  for (const fixture of pool) {
    const profile = archive.profile(fixture, {windowSize: 10});
    const recent = archive.recentProfile(fixture, {windowSize: 10, now});
    const pending = !!(recent.home.pendingLatest || recent.away.pendingLatest);
    const entry = engine.evaluate(fixture, {profile, now, pending});
    if (Daily.candidates(entry).length) evaluated.set(Core.keyFixture(fixture), entry);
  }
  if (!evaluated.size) return [];

  // The shared recorder also guards duplicate/rescheduled identities and kickoff times.
  const base = J.advance({
    history, fixtures: [...evaluated.values()].map(entry => entry.fixture), forecasts, now, matchLinks, sources
  }).newForecasts;
  const cutoff = Fit.weekStart(today);
  const fits = new Map();
  const candidates = base.map(entry => {
    const division = entry.fixture.div;
    const evaluation = evaluated.get(entry.fixture_key);
    if (!fits.has(division)) fits.set(division, Fit.fit(history, division, cutoff, config.opponent_fit));
    const predicted = Fit.predict(fits.get(division), evaluation.fixture);
    const available = !predicted.error;
    const reference = vector(entry.model.baselines.league_goal_means);
    const calibrated = Fit.blendVector(Evaluation.probabilityVector(entry.model.probabilities), reference, config.calibration.current_weight);
    const opponent = available
      ? Fit.blendVector(Evaluation.probabilityVector(predicted.distribution.probs), reference, config.calibration.opponent_weight)
      : calibrated;
    return {
      fixture: evaluation.fixture, entry, available, choices: {},
      candidates: Daily.candidates(evaluation).map(pick => {
        const index = INDEX[PROBABILITY_IDS[pick.id]];
        return {...pick, calibrated: calibrated[index], opponent: opponent[index]};
      })
    };
  });
  for (const [id, field] of Object.entries(VARIANTS)) {
    Daily.shortlist(candidates, Core, View, pick => pick[field]).forEach(({entry, pick}, index) => {
      entry.choices[id] = {market: pick.id, position: index + 1};
    });
  }
  return candidates.map(({entry, available, choices, candidates: picks}) => {
    const {sha256, ...payload} = entry;
    return J.seal({...payload, scanner: null, telegram: {
      config_sha256: config.sha256, training_cutoff: cutoff, opponent_available: available, choices,
      markets: picks.map(({id, rank, probability, calibrated, opponent}) => ({id, rank, probability, calibrated, opponent}))
    }});
  });
}

const tally = () => ({recorded: 0, settled: 0, hits: 0, pending: 0, excluded: 0, hit_rate: null});
function count(total, state, won) {
  total.recorded++;
  if (state === 'settled') {
    total.settled++;
    total.hits += Number(won);
  } else if (state === 'pending') total.pending++;
  else total.excluded++;
  total.hit_rate = total.settled ? round(total.hits / total.settled) : null;
}

function addCalibration(summary, probability, outcome) {
  const index = Math.min(9, Math.floor(probability * 10));
  const bin = summary.bins[index] ||= {n: 0, sum: 0, hits: 0};
  bin.n++;
  bin.sum += probability;
  bin.hits += Number(outcome);
  summary.n++;
  summary.loss += (probability - Number(outcome)) ** 2;
}

function report(forecasts, events, config, now = new Date(), lastRun = {}) {
  const days = validate(forecasts, events, config);
  const variants = Object.fromEntries(VARIANT_IDS.map(id => [id, {overall: tally(), comparable: tally(), markets: {}}]));
  const calibration = Object.fromEntries(MODELS.map(id => [id, Object.fromEntries(
    [...MARKETS.keys()].map(market => [market, {n: 0, loss: 0, bins: {}}])
  )]));
  const coverage = {fixtures: forecasts.length, opponent_fitted: 0, opponent_selected_fallback: 0};
  let comparableDays = 0;
  const recent = [];
  for (const [date, day] of [...days].sort(([a], [b]) => b.localeCompare(a))) {
    const comparable = Object.values(day.choices).flat().every(choice => choice.state.status === 'settled');
    if (comparable) comparableDays++;
    const counts = {};
    for (const [id, choices] of Object.entries(day.choices)) {
      counts[id] = tally();
      for (const {entry, state, pick} of choices) {
        const won = state.status === 'settled' && MARKETS.get(pick.id).test(...state.result.score);
        const summary = variants[id];
        const market = summary.markets[pick.id] ||= tally();
        for (const total of [counts[id], summary.overall, market]) count(total, state.status, won);
        if (comparable) count(summary.comparable, state.status, won);
        if (id === 'opponent' && !entry.telegram.opponent_available) coverage.opponent_selected_fallback++;
      }
    }
    for (const {entry, state} of day.fixtures) {
      if (entry.telegram.opponent_available) coverage.opponent_fitted++;
      if (state.status !== 'settled') continue;
      for (const pick of entry.telegram.markets) {
        const won = MARKETS.get(pick.id).test(...state.result.score);
        for (const model of MODELS) addCalibration(calibration[model][pick.id], pick[model], won);
      }
    }
    if (recent.length < 21) recent.push({date, captured_at_utc: day.captured, comparable, variants: counts});
  }
  for (const markets of Object.values(calibration)) {
    for (const [id, {n, loss, bins}] of Object.entries(markets)) {
      markets[id] = {n, brier: n ? round(loss / n) : null, bins: Object.entries(bins).map(([index, bin]) => ({
        range: [Number(index) * 10, (Number(index) + 1) * 10], n: bin.n, forecast: round(bin.sum / bin.n), actual: round(bin.hits / bin.n)
      }))};
    }
  }
  return {
    schema: 1, version: ID, checked_at_utc: now.toISOString(), config_sha256: config.sha256,
    fitted_on: config.calibration.period, days: days.size, comparable_days: comparableDays,
    variants, calibration, coverage, recent, last_run: lastRun,
    market_labels: Object.fromEntries([...MARKETS].map(([id, market]) => [id, market.label])),
    integrity: {ledger_sha256: J.ledgerHash(forecasts, events)}
  };
}

function advance({
  history, fixtures, forecasts = [], events = [], config, now = new Date(), matchLinks = {}, europe = [], europeNames = {},
  sources = {}, files = versions()
}) {
  const days = validate(forecasts, events, config);
  const active = J.canonical(files) === J.canonical(config.files);
  if (+now < Date.parse(config.created_at_utc)) throw Error('Telegram capture predates registration');
  const newForecasts = active && !days.has(J.sofiaDate(now))
    ? capture({history, fixtures, forecasts, config, now, matchLinks, europe, europeNames, sources})
    : [];
  const allForecasts = [...forecasts, ...newForecasts];
  const newEvents = allForecasts.length
    ? J.advance({history, fixtures, forecasts: allForecasts, events, now, matchLinks, sources, capture: false}).newEvents
    : [];
  return {newForecasts, newEvents, report: report(allForecasts, [...events, ...newEvents], config, now, {
    capture_paused: !active, new_fixtures: newForecasts.length, new_events: newEvents.length
  })};
}

function checkPrefixes(baseRef) {
  J.checkPrefixes(baseRef, ROOT, [RELATIVE]);
  const file = RELATIVE + '/config.json';
  const exists = execFileSync('git', ['ls-tree', '--name-only', baseRef, '--', file], {cwd: ROOT, encoding: 'utf8'}).trim();
  if (exists && !execFileSync('git', ['show', baseRef + ':' + file], {cwd: ROOT}).equals(fs.readFileSync(CONFIG))) {
    throw Error('Published Telegram configuration changed');
  }
}

function main() {
  const args = process.argv.slice(2);
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  if (args.includes('--init')) {
    if (fs.existsSync(CONFIG)) throw Error('Telegram comparison already registered');
    const raw = fs.readFileSync(path.join(DATA, 'model_comparison.json'));
    const paired = read(path.join(ROOT, Pair.RELATIVE, 'config.json'));
    const config = makeConfig(JSON.parse(raw), paired, new Date(), versions(), J.sha(raw));
    fs.mkdirSync(DIR, {recursive: true});
    fs.writeFileSync(CONFIG, JSON.stringify(config));
    fs.writeFileSync(REPORT, JSON.stringify(report([], [], config)));
    console.log('Registered ' + ID);
    return;
  }
  const config = read(CONFIG);
  const ledger = J.readLedger(DIR);
  const base = args.indexOf('--base-ref');
  if (base >= 0) checkPrefixes(args[base + 1]);
  if (args.includes('--check')) {
    const saved = read(REPORT);
    const expected = report(ledger.forecasts, ledger.events, config, new Date(saved.checked_at_utc), saved.last_run);
    if (J.canonical(saved) !== J.canonical(expected)) throw Error('Telegram report differs from the frozen records');
    console.log(JSON.stringify({telegram_days: saved.days, comparable_days: saved.comparable_days, append_only_check: 'pass'}));
    return;
  }
  if (!args.includes('--write')) throw Error('Use --init, --check or --write');
  const raw = Object.fromEntries(['history', 'fixtures', 'status'].map(name => [name, fs.readFileSync(path.join(DATA, name + '.json'))]));
  const now = new Date();
  const calendar = J.calendarSnapshot(JSON.parse(raw.status), JSON.parse(raw.fixtures), now);
  const result = advance({
    ...ledger, config, now, history: JSON.parse(raw.history), fixtures: calendar.fixtures,
    matchLinks: J.readMatchLinks(), europe: read(path.join(DATA, 'europe_history.json')),
    europeNames: read(path.join(DATA, 'europe_fixture_names.json')),
    sources: {history_sha256: J.sha(raw.history), fixtures_sha256: J.sha(raw.fixtures), status_sha256: J.sha(raw.status), calendar_stamp_utc: calendar.stamp}
  });
  result.report.last_run.calendar_fresh = calendar.fresh;
  J.appendRecords(DIR, 'forecasts', result.newForecasts);
  J.appendRecords(DIR, 'events', result.newEvents, new Map([...ledger.forecasts, ...result.newForecasts].map(entry => [entry.id, entry])));
  fs.writeFileSync(REPORT, JSON.stringify(result.report));
  console.log(JSON.stringify({...result.report.last_run, days: result.report.days, comparable_days: result.report.comparable_days}));
}

if (require.main === module) main();
module.exports = {VARIANTS, makeConfig, advance, report};
