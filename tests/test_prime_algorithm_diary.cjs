const assert = require('node:assert/strict');
const test = require('node:test');

const fixtureDay = '2026-11-23';
const captured = fixtureDay + 'T15:00:00.000Z';
const kickoff = fixtureDay + 'T19:45:00.000Z';
const empty = { schema: 1, days: [], results: [] };
const match = (id, probability, overrides = {}) => ({
  id, league: 'E0', model: 'similar_defence', home: 'Home', away: 'Away', kickoff, issued: captured,
  probabilities: { over_2_5: probability, under_2_5: 1 - probability, btts_yes: .39, btts_no: .61 },
  ...overrides
});

function context(now = captured) {
  return {
    raw: { links: {}, prices: { fixtures: {} }, history: [], europeHistory: [], europeCoverage: { checked_utc: now } },
    base: { fitted: {}, euroFitted: {} },
    live: { index: { competitions: [{ slug: 'epl', seasons: [{ fixtures: 1 }] }] }, csv: { epl: coreCsv(kickoff) } },
    version: 'a'.repeat(64), now: Date.parse(now)
  };
}

const headers = 'fixture_id,date,kickoff_utc,home,away,phase,source,status,awarded_winner,result_note,home_goals_90,away_goals_90,team_xg_source,home_xg,away_xg';
function coreCsv(time, h, a) {
  const status = h == null ? 'unplayed' : 'full_time';
  return headers + '\n' + [12, time.slice(0, 10), time, 'Home', 'Away', 'league', 'Sportmonks', status,
    '', '', h, a, '', '', ''].join(',') + '\n';
}

function snapshot(matches, observed = captured) {
  return { matches, xgTime: observed, calendarTime: observed };
}

test('first daily selection freezes even when the feed later changes', async () => {
  const { advanceDiary, validateDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const fixture = match('epl/12', .575);
  const future = match('epl/future', .583, { kickoff: '2026-11-24T19:45:00Z' });
  const tooLate = match('epl/started', .585, { kickoff: '2026-11-23T15:01:00Z' });
  const pilot = match('uel/pilot', .587, { league: 'UEL', model: 'europe' });
  const options = context();
  const first = advanceDiary(empty, snapshot([fixture, future, tooLate, pilot]), options);
  assert.equal(first.days.length, 1);
  assert.deepEqual(first.days[0].picks.map(x => [x.m.id, x.key, x.p]), [['epl/12', 'over_2_5', .575]]);
  assert.equal(first.days[0].picks[0].price, null);
  const retry = advanceDiary(first, snapshot([match('epl/12', .501), match('epl/34', .58)]), options);
  assert.deepEqual(retry, first);
  assert.throws(() => validateDiary(empty, first), /was altered/);
  const changed = structuredClone(first);
  changed.days[0].picks[0].m.home = 'Changed';
  assert.throws(() => validateDiary(changed), /Changed Prime Algorithm diary record/);
});

test('prematch price needs a recent exact-match pair from a bookmaker', async () => {
  const { advanceDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const options = context();
  const prices = options.raw.prices.fixtures;
  const quote = (odds, column, seen) => ({ odds, column, book: 'bet365', observed_at_utc: seen });
  const priced = seen => ({ o25: quote(1.98, 'B365>2.5', seen), u25: quote(1.86, 'B365<2.5', seen) });
  const toCapture = snapshot([match('epl/12', .575)]);
  prices['E0|2026-11-23|home|away'] = priced('2026-11-23T14:42:00Z');
  assert.deepEqual(advanceDiary(empty, toCapture, options).days[0].picks[0].price, {
    selected: 1.98, opposite: 1.86, seen: '2026-11-23T14:42:00.000Z', source: 'Bet365'
  });
  for (const seen of ['2026-11-23T13:59:00Z', '2026-11-23T15:01:00Z']) {
    prices['E0|2026-11-23|home|away'] = priced(seen);
    assert.equal(advanceDiary(empty, toCapture, options).days[0].picks[0].price, null);
  }
});

test('verified final scores append, and corrections leave the original forecast intact', async () => {
  const { advanceDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const { dailyEntries, dailySummary } = await import('../docs/algorithm/daily-diary.js');
  const first = advanceDiary(empty, snapshot([match('epl/12', .575)]), context());
  for (const [seen, expected] of [['2026-11-23T22:44:59Z', 0], ['2026-11-23T22:45:00Z', 1]]) {
    const opts = context(seen);
    opts.live.csv.epl = coreCsv(kickoff, 2, 1);
    const tracked = advanceDiary(first, snapshot([], seen), opts);
    assert.equal(tracked.results.length, expected);
  }
  const time = '2026-11-24T03:00:00Z';
  const options = context(time);
  options.live.csv.epl = coreCsv(kickoff, 2, 1);
  const settled = advanceDiary(first, snapshot([], time), options);
  assert.deepEqual(dailySummary(dailyEntries(settled)), {
    recorded: 1, settled: 1, hits: 1, waiting: 0, quoted: 0, expected: .575, rate: 1
  });
  assert.deepEqual(advanceDiary(settled, snapshot([], time), options), settled);
  const correction = '2026-11-24T03:30:00Z';
  options.now = Date.parse(correction);
  options.live.csv.epl = coreCsv(kickoff, 1, 1);
  const amended = advanceDiary(settled, snapshot([], correction), options);
  assert.deepEqual(amended.days, first.days);
  assert.deepEqual(amended.results.map(x => x.score), [[2, 1], [1, 1]]);
  assert.equal(dailyEntries(amended)[0].state, 'miss');
});

test('a moved domestic fixture keeps its selection and settles on the recorded new date', async () => {
  const { advanceDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const id = 'E2|2026-11-23|home|away';
  const opts = context();
  opts.base.fitted.E2 = { qualified: true, test: { overLoss: .5, bttsLoss: .6 }, reference: { overLoss: .6, bttsLoss: .6 } };
  const first = advanceDiary(empty, snapshot([match(id, .575, { league: 'E2', model: 'results' })]), opts);
  const observed = '2026-11-26T00:00:00Z';
  opts.now = Date.parse(observed);
  const changed = 'E2|2026-11-25|home|away';
  opts.raw.links[id] = { result_key: changed, kickoff_utc: '2026-11-25T19:45:00Z', state: 'final' };
  opts.raw.history.push(['E2', '', '', '2026-11-25', '', 'Home', 'Away', 0, 2]);
  const settled = advanceDiary(first, snapshot([], observed), opts);
  assert.deepEqual(settled.days, first.days);
  assert.deepEqual(settled.results[0].score, [0, 2]);
  assert.equal(settled.results[0].kickoff, '2026-11-25T19:45:00.000Z');
});

test('an eligible European pick uses the UEFA regulation result', async () => {
  const { advanceDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const opts = context();
  opts.base.euroFitted.UCL = { selected: true };
  opts.live.index.competitions.push({ slug: 'ucl', seasons: [{ fixtures: 1 }] });
  opts.live.csv.ucl = 'fixture_id,date,kickoff_utc,home,away,home_id,away_id,phase,source,status,stage\n' +
    `88,${fixtureDay},${kickoff},FC København,Away,12,32,main,Sportmonks,full_time,Final\n`;
  const quote = { selected: 1.95, opposite: 1.90, seen: '2026-11-23T14:42:00Z', source: 'Bookmaker' };
  const forecast = match('ucl/88', .575, { league: 'UCL', model: 'europe', home: 'FC København',
    facts: { domesticSample: [12, 18] }, marketPrices: { over_2_5: quote } });
  const first = advanceDiary(empty, snapshot([forecast]), opts);
  assert.deepEqual(first.days[0].picks[0].price, { ...quote, seen: '2026-11-23T14:42:00.000Z' });
  const settledOn = '2026-11-24T03:00:00Z';
  opts.now = Date.parse(settledOn);
  opts.raw.europeCoverage.checked_utc = settledOn;
  opts.raw.europeHistory.push(['UCL', 'Europe', '', fixtureDay, '', 'FC Copenhagen', 'Away', 1, 1, null, null,
    null, null, { SRC: 'UEFA/UEFA:123', AFTER_PLAY: [2, 1] }]);
  const settled = advanceDiary(first, snapshot([], settledOn), opts);
  assert.equal(settled.results[0].source, 'УЕФА');
  assert.deepEqual(settled.results[0].score, [1, 1]);
});

test('unconfirmed or inconsistent UEFA candidates appear for review and stay out of both diary rankings', async () => {
  const { advanceDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const { dailySelectionPool, europeanPricePairs } = await import('../docs/algorithm/catalog.js');
  const opts = context();
  opts.base.euroFitted.UECL = { selected: true };
  opts.live.index.competitions.push({ slug: 'uecl', seasons: [{ fixtures: 1 }] });
  opts.live.csv.uecl = 'fixture_id,date,kickoff_utc,home,away,home_id,away_id,phase,source,status,stage\n' +
    `88,${fixtureDay},${kickoff},Sporting Braga,KuPS,12,32,main,Sportmonks,unplayed,League phase\n`;
  const forecast = match('uecl/88', .433, { league: 'UECL', model: 'europe', home: 'Sporting Braga', away: 'KuPS',
    facts: { domesticSample: [181, 20] } });
  const quote = { selected: 1.44, opposite: 2.85, seen: '2026-11-23T14:42:00Z', source: 'Bookmaker' };
  const withPrice = (pair, time = kickoff) => ({ ...forecast,
    marketPrices: europeanPricePairs(forecast, { fixtures: { [forecast.id]: { kickoff: time, markets: { over_2_5: pair } } } },
      opts.raw.prices, opts.now) });
  const inconsistent = withPrice(quote);
  const missing = { ...inconsistent, facts: { domesticSample: [181, 0] } };
  const stale = withPrice({ ...quote, seen: '2026-11-23T13:59:00Z' });
  const moved = withPrice(quote, '2026-11-24T19:45:00Z');
  for (const [candidate, reason] of [[inconsistent, 'gap'], [missing, 'domestic'], [stale, 'price'], [moved, 'price'], [forecast, 'price']]) {
    const { eligible, review } = dailySelectionPool([candidate], opts.now);
    assert.equal(eligible.length, 0);
    assert.equal(review[0].check.reason, reason);
    assert.deepEqual(advanceDiary(empty, { ...snapshot([candidate]), selectionVersion: 'test' }, opts), empty);
  }
  const [review] = dailySelectionPool([inconsistent], opts.now).review;
  assert.equal(review.key, 'under_2_5');
  assert.equal(review.check.price.selected, 2.85);
  assert.ok(Math.abs(review.check.marketProbability - 0.3356643356643357) < 1e-9);

  const near = withPrice({ ...quote, selected: 2.10, opposite: 1.75 });
  const saved = advanceDiary(empty, { ...snapshot([near]), selectionVersion: 'test' }, opts);
  assert.equal(saved.days[0].picks[0].price.selected, 1.75);
  assert.equal(saved.days[0].comparison.picks[0].price.opposite, 2.10);
  assert.deepEqual(advanceDiary(saved, snapshot([inconsistent]), opts), saved);
});

test('UEFA BTTS selections record the actual market pair', async () => {
  const { dailySelectionPool, europeanPricePairs } = await import('../docs/algorithm/catalog.js');
  const opts = context();
  const forecast = match('uecl/33', .68, { league: 'UECL', model: 'europe', home: 'Home', away: 'Away',
    probabilities: { over_2_5: .68, under_2_5: .32, btts_yes: .42, btts_no: .58 },
    facts: { domesticSample: [12, 14] } });
  const pair = { selected: 2.16, opposite: 1.70, seen: '2026-11-23T14:42:00Z', source: 'Bookmaker' };
  const source = { fixtures: { [forecast.id]: { kickoff, markets: { btts_yes: pair } } } };
  const priced = { ...forecast, marketPrices: europeanPricePairs(forecast, source, opts.raw.prices, opts.now) };
  const { eligible, review } = dailySelectionPool([priced], opts.now);
  assert.equal(review.length, 0);
  assert.equal(eligible[0].key, 'btts_no');
  assert.equal(eligible[0].price.selected, 1.70);
});

test('both ranks freeze the same daily candidates and settle selections exclusive to the old rank', async () => {
  const { createHash } = require('node:crypto');
  const { advanceDiary, validateDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const { selectDaily } = await import('../docs/algorithm/catalog.js');
  const { dailyComparison, dailyEntries } = await import('../docs/algorithm/daily-diary.js');
  const fixtureList = [
    match('epl/12', .585, { chances: { over_2_5: .41 } }),
    match('epl/13', .581, { chances: { over_2_5: .603 } }),
    match('epl/14', .574),
    match('epl/15', .550, { chances: { over_2_5: .73 } }),
    match('epl/16', .635, { chances: { over_2_5: .99 } }),
  ];
  const next = { ...snapshot(fixtureList), selectionVersion: 'prime-chances-2026-v1' };
  const ledger = advanceDiary(empty, next, context());
  const record = ledger.days[0];
  const ids = picks => picks.map(pick => pick.m.id);
  assert.deepEqual(ids(selectDaily(fixtureList)), ['epl/15', 'epl/13', 'epl/14']);
  assert.deepEqual(ids(record.picks), ['epl/15', 'epl/13', 'epl/14']);
  assert.deepEqual(ids(record.comparison.picks), ['epl/12', 'epl/13', 'epl/14']);
  assert.equal(record.comparison.candidates.length, 4);
  assert.equal(record.picks[0].key, 'over_2_5');
  assert.equal(record.picks[0].fair, 1 / .550);
  assert.deepEqual(advanceDiary(ledger, { ...next, matches: fixtureList.slice(0, 2) }, context()), ledger);

  const changed = structuredClone(record);
  changed.comparison.picks.reverse();
  delete changed.sha256;
  changed.sha256 = createHash('sha256').update(JSON.stringify(changed)).digest('hex');
  assert.throws(() => validateDiary({ ...ledger, days: [changed] }), /rankings differ/);
  assert.equal(dailyComparison(dailyEntries(ledger), dailyEntries(ledger, true)).complete, 0);

  const seen = '2026-11-23T22:45:00.000Z';
  const settle = context(seen);
  settle.live.csv.epl = headers + '\n' + [12, 13, 14, 15].map(id =>
    [id, fixtureDay, kickoff, 'Home', 'Away', 'league', 'Sportmonks', 'full_time',
      '', '', id === 12 ? 0 : 2, 1, '', '', ''].join(',')).join('\n') + '\n';
  const final = advanceDiary(ledger, snapshot([], seen), settle);
  assert.equal(final.results.length, 4);
  const comparison = dailyComparison(dailyEntries(final), dailyEntries(final, true));
  assert.equal(comparison.complete, 1);
  assert.deepEqual([comparison.current.hits, comparison.previous.hits], [3, 2]);
});

test('the full 80/20 forecast is coherent and the daily quote follows the tested selector', async () => {
  const { markets, scoreGrid } = await import('../docs/algorithm/core.js');
  const { selectDaily } = await import('../docs/algorithm/catalog.js');
  const { applyForecastRelease, mixDistribution } = await import('../scripts/prime_full_forecast.mjs');
  const rates = [1.6, 1.3], first = [.78, .78], positiveGoalRates = [1.1, 1.1], dependence = .0434;
  const grid = scoreGrid(first, positiveGoalRates, dependence);
  const original = markets(grid);
  const chances = markets(mixDistribution(grid, rates, 1)).probabilities;
  const row = match('epl/13', .57, { ...original, chances, chanceRates: rates, facts:{first,positiveGoalRates} });
  const options = { release:{version:'new', domestic:['E0'], domesticChanceWeight:.2},
    scoring:{parameters:{dependence}}, fitted:{} };
  const output = applyForecastRelease({ matches:[row] }, options);
  const newMatch = output.matches[0];
  const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-12, `${a} != ${b}`);
  for (const key of ['over_2_5','btts_yes','home','draw','away']) {
    close(newMatch.probabilities[key], .8*original.probabilities[key]+.2*chances[key]);
  }
  close(newMatch.probabilities.home_or_draw + newMatch.probabilities.away,1);
  close(newMatch.probabilities.over_2_5 + newMatch.probabilities.under_2_5,1);
  close(newMatch.probabilities.btts_yes + newMatch.probabilities.btts_no,1);
  assert.equal(newMatch.forecastEdition,'Prime 80/20');
  assert.deepEqual(newMatch.selectionForecast.probabilities, original.probabilities);
  assert.ok(!Object.hasOwn(newMatch,'chanceRates'));
  assert.deepEqual(applyForecastRelease(output,options),output);
  const baseline = selectDaily([row])[0];
  const upgraded = selectDaily([newMatch])[0];
  assert.ok(baseline && upgraded);
  assert.deepEqual([upgraded.key,upgraded.p],[baseline.key,baseline.p]);
  assert.deepEqual(upgraded.m.matchForecast.probabilities,newMatch.probabilities);
});

test('a fresh market-specific reserve fills an empty day and freezes its own probabilities', async () => {
  const { advanceDiary, validateDiary } = await import('../scripts/prime_algorithm_diary.mjs');
  const { dailySelectionPool, eligibleForSelection } = await import('../docs/algorithm/catalog.js');
  const reserve = match('I2|2026-11-23|home|away', .57, {
    league: 'I2', model: 'results', reserveOnly: true,
    reserve: {
      market: 'btts_yes', label: 'Пробен резерв · xG',
      forecast: { probabilities: { over_2_5: .585, under_2_5: .415, btts_yes: .46, btts_no: .54 } }
    }
  });
  const now = Date.parse(captured);
  assert.equal(eligibleForSelection(reserve, {}, {}), true);
  assert.deepEqual(dailySelectionPool([reserve, match('epl/12', .52)], now).eligible.map(p => p.m.id), ['epl/12']);
  assert.equal(dailySelectionPool([reserve], now + 2 * 3600000 + 1).eligible.length, 0);
  const alternative = { ...reserve, id: 'I2|2026-11-23|other|away',
    reserve: { ...reserve.reserve, forecast: { probabilities: { btts_yes: .565, btts_no: .435 } } } };
  const opts = context();
  const evidence = snapshot([reserve, alternative]);
  evidence.selectionVersion = 'paired';
  const recorded = advanceDiary(empty, evidence, opts);
  assert.equal(recorded.days[0].picks.length, 1);
  const [pick] = recorded.days[0].picks;
  assert.deepEqual([pick.m.id, pick.key, pick.p, pick.m.trialMarket], [alternative.id, 'btts_yes', .565, 'btts_yes']);
  assert.equal(pick.method, reserve.reserve.label);
  const another = advanceDiary(empty, snapshot([reserve]), opts).days[0].picks[0];
  assert.deepEqual([another.key, another.p], ['btts_no', .54]);
  assert.equal(another.m.probabilities.over_2_5, .585);
  assert.doesNotThrow(() => validateDiary(recorded));
  assert.deepEqual(advanceDiary(recorded, snapshot([match('epl/12', .56)]), opts), recorded);
});

test('reserve forecasts require current league coverage and six prior xG games per club', async () => {
  const { resultsForecasts } = await import('../docs/algorithm/catalog.js');
  const now = Date.parse(captured);
  const past = Array.from({ length: 12 }, (_, i) => [
    'I2', 'Italy', 'Serie B', '2026-11-' + String(i + 1).padStart(2, '0'), '15:00', 'Home', 'Away',
    i % 3, 1, 1.4, .9, null, null
  ]);
  const audit = [{ id: 'I2', eligible: true }];
  const f = ['I2', 'Italy', 'Serie B', fixtureDay, '21:45', 'Home', 'Away'];
  const cfg = { I2: { preset: 'cautious', qualified: false, reserve: { market: 'btts_yes', method: 'xg' } } };
  const good = { last_soccerway_success_utc: captured, soccerway_checks: { I2: { status: 'ok', window_covered: true } } };
  const [forecast] = resultsForecasts(past, [f], audit, cfg, now, now, good);
  assert.equal(forecast.reserveOnly, true);
  assert.equal(forecast.reserve.market, 'btts_yes');
  const noXg = past.map((row, i) => i >= 5 ? [...row.slice(0, 9), null, null] : row);
  assert.equal(resultsForecasts(noXg, [f], audit, cfg, now, now, good).length, 0);
  assert.equal(resultsForecasts(past, [f], audit, cfg, now, now, {
    ...good, soccerway_checks: { I2: { status: 'ok', window_covered: false } }
  }).length, 0);
});
