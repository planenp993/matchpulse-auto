import './club-aliases.js?v=08c05a43670f';
import './model-core.js?v=d017cb640a6f';
import { europeanForecasts, readEuropeanHistory } from './europe.js?v=e2b2d2fe8657';
import { CORE_CODES, CORE_LEAGUES, MIN_LEAD, parseCoreFixtures, topForecasts, markets } from './core.js?v=d017cb640a6f';

import { DELAY_AFTER } from './refresh-state.js?v=ad7cbaff7250';

const model = globalThis.MatchpulseModel;
export const SOFIA = 'Europe/Sofia';
export const HORIZON = 9 * 86_400_000;
export const PRICE_BUFFER = .05;
export const PRICE_WINDOW = 60 * 60_000;
export const MARKET_REVIEW_GAP = .20;
export const SELECTION = { fairMin: 1.70, fairMax: 2.00, count: 3 };
export const PUBLISHED_HISTORY = 'https://planenp993.github.io/matchpulse-auto/data/';
const DOMESTIC_LEAGUES = [
  ['E0', 'Висша лига', 'Англия', 'ENG', 380, true],
  ['SP1', 'Ла Лига', 'Испания', 'ESP', 380, true],
  ['D1', 'Бундеслига', 'Германия', 'GER', 306, true],
  ['I1', 'Серия А', 'Италия', 'ITA', 380, true],
  ['F1', 'Лига 1', 'Франция', 'FRA', 306, true],
  ['E1', 'Чемпиъншип', 'Англия', 'ENG', 552],
  ['E2', 'Лига 1', 'Англия', 'ENG', 552],
  ['E3', 'Лига 2', 'Англия', 'ENG', 552],
  ['SP2', 'Сегунда дивисион', 'Испания', 'ESP', 462],
  ['D2', 'Втора Бундеслига', 'Германия', 'GER', 306],
  ['I2', 'Серия Б', 'Италия', 'ITA', 380],
  ['F2', 'Лига 2', 'Франция', 'FRA', 306],
  ['N1', 'Ередивизи', 'Нидерландия', 'NED', 306],
  ['B1', 'Про лига', 'Белгия', 'BEL', 240],
  ['P1', 'Примейра лига', 'Португалия', 'POR', 306],
  ['T1', 'Суперлига', 'Турция', 'TUR', 306],
  ['G1', 'Суперлига', 'Гърция', 'GRE', 182],
  ['SC0', 'Премиършип', 'Шотландия', 'SCO', 228],
  ['EC', 'Национална лига', 'Англия', 'ENG', 552],
  ['SC1', 'Чемпиъншип', 'Шотландия', 'SCO', 180],
  ['SC2', 'Лига 1', 'Шотландия', 'SCO', 180],
  ['SC3', 'Лига 2', 'Шотландия', 'SCO', 180],
  ['AUT', 'Бундеслига', 'Австрия', 'AUT', 192],
  ['DNK', 'Суперлига', 'Дания', 'DEN', 192],
  ['SWZ', 'Суперлига', 'Швейцария', 'SUI', 228],
  ['POL', 'Екстракласа', 'Полша', 'POL', 306],
  ['NOR', 'Елитсериен', 'Норвегия', 'NOR', 240],
  ['SWE', 'Алсвенскан', 'Швеция', 'SWE', 240]
].map(([id, name, country, countryCode, minPrevious, core]) =>
  ({ id, name, country, countryCode, minPrevious, core: Boolean(core) }));
export const LEAGUES = [
  { id: 'UCL', name: 'Шампионска лига', country: 'Европа', countryCode: 'UCL', europe: true },
  { id: 'UEL', name: 'Лига Европа', country: 'Европа', countryCode: 'UEL', europe: true },
  { id: 'UECL', name: 'Лига на конференциите', country: 'Европа', countryCode: 'UECL', europe: true },
  ...DOMESTIC_LEAGUES
];
export const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map(x => [x.id, x]));
export const MARKETS = ['over_2_5', 'under_2_5', 'btts_yes', 'btts_no'];
const prices = new Intl.DateTimeFormat('sv-SE', { timeZone: SOFIA, year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function sofiaDate(time) {
  return prices.format(new Date(time)).slice(0, 10);
}

export function sofiaKickoff(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time || '')) return NaN;
  const local = day + ' ' + time + ':00';
  const wanted = Date.parse(local.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(wanted)) return NaN;
  let result = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const instant = prices.format(new Date(result)).replace(' ', 'T') + 'Z';
    result += wanted - Date.parse(instant);
  }
  return prices.format(new Date(result)) === local ? result : NaN;
}

export function fairPrice(p) {
  return p > 0 && p <= 1 ? 1 / p : null;
}
export function priceFrom(p, buffer = PRICE_BUFFER) {
  return p > 0 && p <= 1 ? Math.ceil(100 * (1 + buffer) / p - 1e-10) / 100 : null;
}
export const matchKey = x => [x[0], x[3], model.clubKey(x[5]), model.clubKey(x[6])].join('|');
const isDomestic = m => Array.isArray(m) && LEAGUE_BY_ID[m[0]] && !LEAGUE_BY_ID[m[0]].europe;
const timeOf = m => sofiaKickoff(m[3], m[4]);

function completeShots(m) {
  const fields = m[13];
  return ['HS', 'AS', 'HST', 'AST'].every(k => Number.isInteger(fields?.[k]) && fields[k] >= 0) &&
    fields.HST <= fields.HS && fields.AST <= fields.AS;
}

function uniqueDomestic(rows) {
  const checked = new Map();
  for (const m of rows) {
    if (!isDomestic(m) || !model.isPlayed(m) || !m[5] || !m[6]) continue;
    const key = matchKey(m);
    const prior = checked.get(key);
    if (prior && (m[7] !== prior[7] || m[8] !== prior[8])) throw new Error('Конфликт в архива на ' + m[0]);
    if (!prior || completeShots(m)) checked.set(key, m);
  }
  return [...checked.values()];
}

export function extraCoverage(history, fixtures, now) {
  const start = (Number(sofiaDate(now).slice(0, 4)) - Number(sofiaDate(now).slice(5, 7) < '07')) + '-07-01';
  const previous = (Number(start.slice(0, 4)) - 1) + '-07-01';
  const day = sofiaDate(now);
  const covered = Object.fromEntries(DOMESTIC_LEAGUES.map(l => [l.id, { previousN: 0, previousShots: 0,
    currentN: 0, currentShots: 0, forecastCount: 0, upcoming: 0, latest: '' }]));
  const clean = uniqueDomestic(history);
  for (const m of clean) {
    const row = covered[m[0]];
    if (m[3] > row.latest && m[3] < day) row.latest = m[3];
    if (m[3] >= previous && m[3] < start) {
      row.previousN++; row.previousShots += Number(completeShots(m));
    } else if (m[3] >= start && m[3] < day) {
      row.currentN++; row.currentShots += Number(completeShots(m));
    }
  }
  const seen = new Set();
  for (const m of fixtures) {
    if (!isDomestic(m) || !m[5] || !m[6]) continue;
    const kickoff = timeOf(m);
    if (!(kickoff > now && kickoff < now + HORIZON)) continue;
    const key = matchKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    covered[m[0]].upcoming++;
  }
  const audit = DOMESTIC_LEAGUES.map(l => {
    const c = covered[l.id];
    const denom = Math.max(l.minPrevious, c.previousN);
    const previousRatio = c.previousShots / denom;
    const currentRatio = c.currentN ? c.currentShots / c.currentN : 0;
    const eligible = previousRatio > .8 && currentRatio > .8;
    return { id: l.id, ...c, denominatorPrevious: denom, previousRatio, currentRatio, eligible,
      mode: l.core ? 'similar_defence' : 'results' };
  });
  return { rows: clean, audit };
}

function compactForm(matches, club) {
  return matches.slice(0, 10).map(m => {
    const home = model.clubKey(m[5]) === model.clubKey(club);
    return { opponent: home ? m[6] : m[5], gf: home ? m[7] : m[8], ga: home ? m[8] : m[7], day: m[3], venue: home ? 'home' : 'away', competition: m[0] };
  }).reverse();
}

const RESERVE_MARKETS = { over_2_5: ['over_2_5', 'under_2_5'], btts_yes: ['btts_yes', 'btts_no'] };
const RESERVE_LABELS = {
  shots: 'точни удари', xg: 'xG', league: 'лигова честота'
};

function approvedReserveLeagues(rows, audit, fitted, now, status) {
  const observed = Date.parse(status?.last_soccerway_success_utc);
  if (!(observed <= now && now - observed <= DELAY_AFTER)) return new Map();
  const previousYear = String(Number(sofiaDate(now).slice(0, 4)) - 1);
  return new Map(audit.flatMap(coverage => {
    const league = LEAGUE_BY_ID[coverage.id], fit = fitted[coverage.id], rule = fit?.reserve;
    const feed = status.soccerway_checks?.[coverage.id];
    if (league.core || !rule || !Object.hasOwn(RESERVE_MARKETS, rule.market) || !Object.hasOwn(RESERVE_LABELS, rule.method) ||
        feed?.status !== 'ok' || feed.window_covered !== true ||
        status.stale_secondary_leagues?.includes(coverage.id)) return [];
    const fullCalendarYear = rule.method === 'league' &&
      rows.filter(row => row[0] === coverage.id && row[3].startsWith(previousYear + '-')).length >= league.minPrevious;
    return coverage.eligible || fullCalendarYear ? [[coverage.id, rule]] : [];
  }));
}

// Use the same publication lag and historical windows as the paired test.
function reserveContext(candidates, day) {
  const previous = new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
  const threeYears = (Number(day.slice(0, 4)) - 3) + day.slice(4);
  const history = candidates.filter(r => r[3] < previous);
  const rates = new Map();
  for (const row of history) {
    if (row[3] < threeYears) continue;
    const stats = rates.get(row[0]) ?? { count: 0, over: 0, shots: 0, goals: [0, 0], target: [0, 0] };
    stats.count++;
    stats.over += Number(row[7] + row[8] >= 3);
    if (completeShots(row)) {
      stats.shots++;
      stats.goals[0] += row[7];
      stats.goals[1] += row[8];
      stats.target[0] += row[13].HST;
      stats.target[1] += row[13].AST;
    }
    rates.set(row[0], stats);
  }
  return { history, rates, bases: model.leagueBases(history, day) };
}

function reservePrediction(fixture, rule, context, preset, day) {
  const [code, , , , , home, away] = fixture;
  const country = LEAGUE_BY_ID[code].countryCode;
  const games = context.history.filter(row => LEAGUE_BY_ID[row[0]].countryCode === country);
  const profiles = [home, away].map(club => model.teamMatches(games, club, day));
  let homeMatches = profiles[0], awayMatches = profiles[1], xg = 0;
  const hasPair = row => Number.isFinite(row[9]) && Number.isFinite(row[10]);
  if (rule.method === 'xg') {
    const seasonStart = (Number(day.slice(0, 4)) - Number(day.slice(5, 7) < '07')) + '-07-01';
    if (profiles.some(rows => rows.slice(0, 30).filter(row => row[0] === code && row[3] >= seasonStart && hasPair(row)).length < 6))
      return null;
    xg = preset.xg;
  }
  if (rule.method === 'shots') {
    const total = profiles.map(rows => rows.slice(0, 30).map(row => {
      const stats = context.rates.get(row[0]);
      // These are temporary shot-based contributions to the team strength, never stored xG.
      const signal = stats?.shots >= 100 && stats.target.every(n => n > 0) && completeShots(row)
        ? [stats.goals[0] * row[13].HST / stats.target[0], stats.goals[1] * row[13].AST / stats.target[1]]
        : [null, null];
      return [...row.slice(0, 9), ...signal, ...row.slice(11)];
    }));
    if (total.some(rows => rows.filter(hasPair).length < 6)) return null;
    [homeMatches, awayMatches] = total;
    xg = preset.xg;
  }
  const modelForecast = model.evaluateContext(fixture, { bases: context.bases, homeMatches, awayMatches }, { ...preset, xg });
  if (modelForecast.error || !modelForecast.bases.count) return null;
  let grid = modelForecast.distribution.matrix;
  if (rule.method === 'league') {
    const stats = context.rates.get(code);
    const current = modelForecast.distribution.probs.over25;
    if (!stats || stats.count < 12 || !(current > 0 && current < 1)) return null;
    const adjusted = .75 * current + .25 * (stats.over + 1) / (stats.count + 2);
    const over = adjusted / current, under = (1 - adjusted) / (1 - current);
    grid = grid.map((row, h) => row.map((p, a) => p * (h + a >= 3 ? over : under)));
  }
  const output = markets(grid);
  return { market: rule.market, label: 'Пробен резерв · ' + RESERVE_LABELS[rule.method], forecast: {
    ...output, facts: { goals: output.expectedGoals, league: [modelForecast.bases.home, modelForecast.bases.away],
      baseCount: modelForecast.bases.count, form: [compactForm(profiles[0], home), compactForm(profiles[1], away)] }
  } };
}

export function resultsForecasts(clean, fixtures, audit, fitted, now, dataTime, status) {
  const reserveLeagues = approvedReserveLeagues(clean, audit, fitted, now, status);
  const passed = new Set(audit.filter(l => l.eligible && !LEAGUE_BY_ID[l.id].core && fitted[l.id]?.qualified).map(l => l.id));
  const day = sofiaDate(now);
  const old = (Number(day.slice(0, 4)) - 4) + day.slice(4);
  const candidates = clean.filter(m => m[3] < day && m[3] >= old);
  const existing = new Set(clean.map(matchKey));
  const bases = model.leagueBases(candidates, day);
  const reserve = reserveLeagues.size ? reserveContext(candidates, day) : null;
  const seen = new Set();
  return fixtures.flatMap(f => {
    const rule = reserveLeagues.get(f[0]);
    if ((!passed.has(f[0]) && !rule) || !f[5] || !f[6]) return [];
    const stamp = timeOf(f);
    if (!(stamp >= now + MIN_LEAD && stamp < now + HORIZON)) return [];
    const id = matchKey(f);
    if (existing.has(id) || seen.has(id)) return [];
    seen.add(id);
    const country = LEAGUE_BY_ID[f[0]].countryCode;
    const domestic = candidates.filter(m => LEAGUE_BY_ID[m[0]].countryCode === country);
    const home = model.teamMatches(domestic, f[5], day);
    const away = model.teamMatches(domestic, f[6], day);
    const fit = fitted[f[0]];
    const preset = model.params[fit.preset];
    const forecast = model.evaluateContext(f, { bases, homeMatches: home, awayMatches: away }, { ...preset, xg: 0 });
    if (forecast.error || !forecast.bases.count) return [];
    const trial = rule && reservePrediction(f, rule, reserve, preset, day);
    if (!passed.has(f[0]) && !trial) return [];
    return [{ id, league: f[0], home: f[5], away: f[6], kickoff: new Date(stamp).toISOString(),
      issued: new Date(now).toISOString(), dataAsOf: new Date(dataTime).toISOString(),
      source: String(f[13] || 'Prime Syndicate · календар').split(' / ')[0],
      model: 'results', ...markets(forecast.distribution.matrix),
      ...(trial && { reserve: trial, reserveOnly: !legacyResultsEligible(fit) }),
      facts: { goals: [forecast.lambdaHome, forecast.lambdaAway], league: [forecast.bases.home, forecast.bases.away],
        baseCount: forecast.bases.count, form: [compactForm(home, f[5]), compactForm(away, f[6])] } }];
  });
}

export function priceReference(match, quotes, now) {
  if (!quotes?.fixtures) return null;
  const date = sofiaDate(match.kickoff);
  const key = matchKey([match.league, null, null, date, null, match.home, match.away]);
  const line = quotes.fixtures[key];
  if (!line) return null;
  const o = line.o25, u = line.u25;
  const stamp = Date.parse(o?.last_confirmed_at_utc ?? o?.observed_at_utc ?? '');
  const other = Date.parse(u?.last_confirmed_at_utc ?? u?.observed_at_utc ?? '');
  if (!/^((Avg)|(B365)|(P))>2\.5$/.test(o?.column) || !/^((Avg)|(B365)|(P))<2\.5$/.test(u?.column) ||
      !Number.isFinite(o.odds) || !Number.isFinite(u.odds) || Math.min(o.odds, u.odds) <= 1 ||
      o.book !== u.book || stamp !== other || stamp > now || stamp >= Date.parse(match.kickoff) ||
      now - stamp > 7 * 86_400_000) return null;
  return { over: o.odds, under: u.odds, seen: new Date(stamp).toISOString(),
    source: o.column.startsWith('Avg') ? 'Пазарна средна' : { bet365: 'Bet365', pinnacle: 'Pinnacle' }[o.book] ?? 'Букмейкърска засечка' };
}

export function forecastVersion(f) {
  if (f.forecastEdition) return f.forecastEdition;
  if (f.model === 'europe') return 'Европейски модел';
  if (f.model === 'results') return 'Лигов модел';
  if (f.model === 'retrospective') return 'V3 / ' + f.bttsVersion;
  return 'Сходни защити';
}

function legacyResultsEligible(profile) {
  return profile?.qualified && profile.test.overLoss + profile.test.bttsLoss <
    profile.reference.overLoss + profile.reference.bttsLoss;
}

export function eligibleForSelection(match, fitted, europeFitted) {
  if (match.model === 'europe') return europeFitted[match.league]?.selected === true;
  if (match.model !== 'results') return true;
  return Boolean(match.reserve) || legacyResultsEligible(fitted[match.league]);
}

export function eligiblePrice(p, rule = SELECTION) {
  const price = Number.isFinite(p) ? fairPrice(p) : null;
  return price != null && price >= rule.fairMin - 1e-9 && price <= rule.fairMax + 1e-9;
}

export function selectionMatch(match) {
  if (!match.selectionForecast) return match;
  const { selectionForecast, forecastEdition, ...fixture } = match;
  return { ...fixture, ...selectionForecast,
    matchForecast: { probabilities: fixture.probabilities, edition: forecastEdition } };
}

export function dailyCandidates(matches, rule = SELECTION) {
  return matches.flatMap(match => {
    const m = selectionMatch(match);
    const marketsToCheck = m.trialMarket
      ? (Object.hasOwn(RESERVE_MARKETS, m.trialMarket) ? RESERVE_MARKETS[m.trialMarket] : [])
      : MARKETS;
    const best = marketsToCheck.map(key => ({ key, p: m.probabilities[key] }))
      .filter(({ p }) => eligiblePrice(p, rule)).sort((a, b) => b.p - a.p)[0];
    if (!best) return [];
    const second = m.chances?.[best.key];
    return [{ m, ...best, second: Number.isFinite(second) && second > 0 && second < 1 ? second : null }];
  });
}

function verifiedPrice(entry, match, now) {
  if (!entry || typeof entry.seen !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(entry.seen) ||
      typeof entry.source !== 'string' || !entry.source.trim() || entry.source.trim() === 'Пазарна средна' ||
      ![entry.selected, entry.opposite].every(odds => Number.isFinite(odds) && odds > 1)) return null;
  const seen = Date.parse(entry.seen);
  if (!(seen <= now && now - seen <= PRICE_WINDOW && seen < Date.parse(match.kickoff))) return null;
  return { selected: entry.selected, opposite: entry.opposite, seen: new Date(seen).toISOString(), source: entry.source.trim() };
}

export function europeanPricePairs(match, submissions, prices, now) {
  const submitted = submissions?.fixtures?.[match.id];
  const markets = Date.parse(submitted?.kickoff) === Date.parse(match.kickoff) ? submitted.markets : null;
  const reference = priceReference(match, prices, now);
  const over = verifiedPrice(markets?.over_2_5, match, now) ?? (reference &&
    verifiedPrice({ selected: reference.over, opposite: reference.under, seen: reference.seen, source: reference.source }, match, now));
  const btts = verifiedPrice(markets?.btts_yes, match, now);
  return { ...(over && { over_2_5: over }), ...(btts && { btts_yes: btts }) };
}

export function europeanSelectionReview({ m, key, p }, now) {
  if (m.model !== 'europe') return null;
  const market = key === 'btts_yes' || key === 'btts_no' ? 'btts_yes' : 'over_2_5';
  const pair = verifiedPrice(m.marketPrices?.[market], m, now);
  const price = pair && (key === market ? pair : { ...pair, selected: pair.opposite, opposite: pair.selected });
  const marketProbability = price ? (1 / price.selected) / (1 / price.selected + 1 / price.opposite) : null;
  const missing = [m.home, m.away].filter((_, i) => !Number.isInteger(m.facts?.domesticSample?.[i]) ||
    m.facts.domesticSample[i] < 1);
  let reason = null;
  if (missing.length) reason = 'domestic';
  else if (!price) reason = 'price';
  else if (Math.abs(p - marketProbability) >= MARKET_REVIEW_GAP - 1e-9) reason = 'gap';
  return { reason, missing, price, marketProbability };
}

export function dailySelectionPool(matches, now) {
  const eligible = [], review = [];
  const regular = matches.filter(m => !m.reserveOnly).map(({ reserve, reserveOnly, ...match }) => match);
  for (const candidate of dailyCandidates(regular)) {
    const check = europeanSelectionReview(candidate, now);
    if (check?.reason) review.push({ ...candidate, check });
    else eligible.push({ ...candidate, price: check?.price ?? null });
  }
  if (eligible.length) return { eligible, review };
  const fallback = matches.flatMap(({ reserve, reserveOnly, ...match }) => {
    if (!reserve?.forecast || match.model !== 'results' || !Object.hasOwn(RESERVE_MARKETS, reserve.market)) return [];
    const time = Date.parse(match.issued);
    if (!(time <= now && now - time <= DELAY_AFTER)) return [];
    const { selectionForecast, chances, ...ordinary } = match;
    return dailyCandidates([{ ...ordinary, ...reserve.forecast, trialMarket: reserve.market,
      forecastEdition: reserve.label,
      matchForecast: { probabilities: match.probabilities, edition: forecastVersion(match) } }]);
  });
  return { eligible: orderDaily(fallback, false, 1), review };
}

export function orderDaily(candidates, useChances, limit = SELECTION.count) {
  const rank = candidate => useChances && candidate.second != null
    ? (candidate.p + candidate.second) / 2 : candidate.p;
  return [...candidates].sort((a, b) => rank(b) - rank(a) || a.m.kickoff.localeCompare(b.m.kickoff) ||
    a.m.id.localeCompare(b.m.id)).slice(0, limit);
}

export function selectDaily(matches, now = Date.now()) {
  return orderDaily(dailySelectionPool(matches, now).eligible, true);
}

export function makeData({ raw, base, live, now, keep = [], quotes = null, previousEuropeanAudit = [] }) {
  const xgTime = Date.parse(live.index.data_updated_at ?? live.index.generated_at);
  const baseTime = Date.parse(base.status.last_build_utc);
  const calendarTime = Date.parse(base.status.fixtures_updated_utc ?? base.status.last_build_utc);
  if (!Number.isFinite(xgTime) || !Number.isFinite(baseTime) || !Number.isFinite(calendarTime) || Math.max(xgTime, baseTime, calendarTime) > now + 60_000)
    throw new Error('Невалиден час на данните');
  const { rows, audit } = extraCoverage(raw.history, raw.fixtures, now);
  const coreById = new Map();
  const core = [];
  const settlements = {};
  for (const league of CORE_LEAGUES) {
    const season = live.index.competitions.find(c => c.slug === league)?.seasons[0];
    if (!season || typeof live.csv[league] !== 'string') throw new Error('Липсва сезон за ' + league);
    const fixtures = parseCoreFixtures(live.csv[league], season.fixtures);
    for (const f of fixtures) coreById.set(league + '/' + f.id, f);
    const finals = fixtures.filter(f => f.goals && f.day < new Date(now).toISOString().slice(0, 10));
    const row = audit.find(x => x.id === CORE_CODES[league]);
    row.currentN = finals.length;
    row.currentShots = finals.filter(f => f.xg).length;
    row.currentRatio = row.currentN ? row.currentShots / row.currentN : 0;
    row.upcoming = fixtures.filter(f => f.status === 'unplayed' && f.kickoff > now && f.kickoff < now + HORIZON).length;
    row.eligible = row.currentRatio > .8 && row.previousRatio > .8;
    row.latest = finals.map(f => f.day).sort().at(-1) ?? '';
    if (row.eligible) core.push(...topForecasts(fixtures, league, season.year, now,
      Math.min(xgTime, now), base.config, now + HORIZON));
  }
  const present = new Set(core.map(f => f.id));
  for (const f of keep) {
    const lookup = coreById.get(f.id);
    const stamp = Date.parse(f.kickoff);
    const league = audit.find(row => row.id === f.league);
    if (lookup?.goals && lookup.kickoff === stamp && stamp + 3 * 3_600_000 <= xgTime && f.seal) {
      settlements[f.id] = lookup.goals;
    }
    if (league?.eligible && lookup?.status === 'unplayed' && lookup.kickoff === stamp &&
        stamp > now && stamp < now + HORIZON && !present.has(f.id)) {
      core.push(f);
      present.add(f.id);
    }
  }
  const extras = resultsForecasts(rows, raw.fixtures, audit, base.fitted, now, baseTime, base.status);
  const namedExtras = new Set(extras.map(m => m.id));
  const finalKeys = new Set(rows.map(matchKey));
  const activeExtra = new Map(raw.fixtures.filter(isDomestic).map(f => [matchKey(f), timeOf(f)]));
  for (const f of keep) {
    const stamp = Date.parse(f.kickoff);
    if (f.model === 'results' && audit.some(x => x.id === f.league && x.eligible) &&
        stamp > now && stamp < now + MIN_LEAD && activeExtra.get(f.id) === stamp &&
        !namedExtras.has(f.id) && !finalKeys.has(f.id)) {
      extras.push(f);
      namedExtras.add(f.id);
    }
  }
  let europe = { matches: keep.filter(m => m.model === 'europe' && Date.parse(m.kickoff) > now),
    audit: previousEuropeanAudit };
  if (raw.europeHistory && raw.europeCoverage) {
    try {
      europe = europeanForecasts({ records: readEuropeanHistory(raw.europeHistory), domestic: rows, allDomestic: raw.history, index: live.index,
        csv: live.csv, coverage: raw.europeCoverage, fitted: base.euroFitted, releaseWeights: base.release?.europe, now, day: sofiaDate(now),
        observed: Math.min(now, Math.min(xgTime, Date.parse(raw.europeCoverage.checked_utc))) });
    } catch (error) {
      if (!previousEuropeanAudit.length) throw error;
      europe.cached = true;
    }
  } else if (previousEuropeanAudit.length) europe.cached = true;
  const matches = [...core, ...extras, ...europe.matches].map(m => ({ ...m, quote: priceReference(m, quotes, now) }))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
  for (const row of audit) {
    row.forecastCount = matches.filter(m => m.league === row.id).length;
    row.latest = row.latest || null;
  }
  return { version: 1, asOf: new Date(now).toISOString(), xgTime: new Date(xgTime).toISOString(),
    calendarTime: new Date(calendarTime).toISOString(), archiveTime: new Date(baseTime).toISOString(),
    europeTime: raw.europeCoverage?.checked_utc ?? null, matches, audit, euroAudit: europe.audit, euroCached: Boolean(europe.cached), settlements, state: base.status.fixtures_feed_status };
}
