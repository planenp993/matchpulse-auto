// Fixed, experimental, market-anchored rule. This is NOT the official Prime
// selector. Never substitute a missing model or synthesize an opposing price.
import { LEAGUE_BY_ID, eligibleForSelection, selectionMatch, sofiaDate } from './catalog.js?v=9880ec988a17';
import { MIN_LEAD } from './core.js?v=d017cb640a6f';
import { DELAY_AFTER } from './refresh-state.js?v=ad7cbaff7250';
import { calendarKey, marketOutcome } from './calendar-view.js?v=269732adda9d';
import { parseOdds } from './value-check.js?v=0eece3b97e02';

export const RULE = Object.freeze({
  version: 'prime-value-v1', release: 'prime-forecast-2026-11-v1',
  minimum: 1.70, maximum: 2.00, leadMs: MIN_LEAD, quoteAgeMs: 3_600_000,
  forecastAgeMs: DELAY_AFTER, cap: 3, modelGap: .10, marketGap: .15,
  maxOverround: 1.12, minEdge: .02,
  weights: Object.freeze({ market: .50, prime: .25, chances: .25 })
});
export const FAMILIES = Object.freeze({
  over_2_5: ['over_2_5', 'under_2_5'], btts_yes: ['btts_yes', 'btts_no']
});
const ms = value => Date.parse(value);
const prob = p => Number.isFinite(p) && p > 0 && p < 1;
const eps = 1e-9;
const coherent = (p, keys) => keys.every(k => prob(p?.[k])) && Math.abs(p[keys[0]] + p[keys[1]] - 1) < 1e-6;
const iso = t => new Date(t).toISOString();
const goodClock = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(ms(value));

export function valueFixtures(snapshot, fitted, euroFitted, now, rule = RULE) {
  const day = sofiaDate(now);
  const current = (snapshot?.matches ?? []).filter(m => Number.isFinite(ms(m.kickoff)) &&
    sofiaDate(ms(m.kickoff)) === day && ms(m.kickoff) - now >= rule.leadMs);
  const status = snapshot?.forecastRelease !== rule.release ? 'release' :
    !(ms(snapshot.asOf) <= now && now - ms(snapshot.asOf) <= rule.forecastAgeMs) ? 'stale' : 'ready';
  const base = { day, status, scheduled: current.length, eligible: 0, fixtures: [] };
  if (status !== 'ready') return base;
  const eligible = current.filter(m => LEAGUE_BY_ID[m.league] && m.id && m.home && m.away &&
    !m.reserveOnly && !m.trialMarket && m.model !== 'retrospective' && eligibleForSelection(m, fitted, euroFitted) &&
    ms(m.issued) <= ms(snapshot.asOf) && now - ms(m.issued) <= rule.forecastAgeMs);
  base.eligible = eligible.length;
  const ids = new Set(), duplicates = new Set();
  for (const m of eligible) { if (ids.has(m.id)) duplicates.add(m.id); ids.add(m.id); }
  base.fixtures = eligible.flatMap(m => {
    if (duplicates.has(m.id)) return [];
    const prime = selectionMatch(m).probabilities, chances = m.chances;
    const families = Object.keys(FAMILIES).filter(f => coherent(prime, FAMILIES[f]) && coherent(chances, FAMILIES[f]));
    if (!families.length) return [];
    const project = p => Object.fromEntries(families.flatMap(f => FAMILIES[f].map(k => [k, p[k]])));
    return [{ id: m.id, calendarKey: calendarKey(m.league, day, m.home, m.away), league: m.league, home: m.home, away: m.away,
      kickoff: iso(ms(m.kickoff)), issued: iso(ms(m.issued)), prime: project(prime), chances: project(chances), families }];
  });
  return base;
}

// The pair is oriented to the first key of its family, never to the choice.
export function normalizePair(fixture, family, pair, now, rule = RULE) {
  if (!Object.hasOwn(FAMILIES, family) || !fixture.families.includes(family) ||
      pair?.matchId !== fixture.id || !goodClock(pair.kickoff) || ms(pair.kickoff) !== ms(fixture.kickoff) ||
      pair.family !== family || !goodClock(pair.seen) || typeof pair.source !== 'string' ||
      !pair.source.trim() || pair.source.trim().length > 100 || pair.source.trim() === 'Пазарна средна' ||
      !['csv', 'published', 'owner', 'manual'].includes(pair.kind)) return null;
  const price = parseOdds(pair.selected), opposite = parseOdds(pair.opposite), seen = ms(pair.seen);
  if (price === null || opposite === null || !(seen <= now && now - seen <= rule.quoteAgeMs && seen < ms(fixture.kickoff)) ||
      ms(fixture.kickoff) - now < rule.leadMs || !(ms(fixture.issued) <= now && now - ms(fixture.issued) <= rule.forecastAgeMs) ||
      sofiaDate(ms(fixture.kickoff)) !== sofiaDate(now)) return null;
  return { matchId: fixture.id, kickoff: fixture.kickoff, family, selected: price, opposite,
    seen: iso(seen), source: pair.source.trim(), kind: pair.kind };
}

export function assessPair(fixture, family, supplied, now, rule = RULE) {
  const pair = normalizePair(fixture, family, supplied, now, rule);
  if (!pair) return [];
  const margin = 1 / pair.selected + 1 / pair.opposite;
  return FAMILIES[family].map((key, i) => {
    const price = i ? pair.opposite : pair.selected, opposite = i ? pair.selected : pair.opposite;
    const market = (1 / price) / margin, prime = fixture.prime[key], chances = fixture.chances[key];
    const p = rule.weights.market * market + rule.weights.prime * prime + rule.weights.chances * chances;
    const edge = p * price - 1;
    let reason = 'pass';
    if (!(margin >= 1 - eps && margin <= rule.maxOverround + eps)) reason = 'margin';
    else if (!(price >= rule.minimum - eps && price <= rule.maximum + eps)) reason = 'price';
    else if (!prob(prime) || !prob(chances)) reason = 'models';
    else if (Math.abs(prime - chances) > rule.modelGap + eps) reason = 'agreement';
    else if (Math.max(Math.abs(prime - market), Math.abs(chances - market)) > rule.marketGap + eps) reason = 'market_gap';
    else if (prime <= market || chances <= market || prime < .5 || chances < .5) reason = 'direction';
    else if (edge < rule.minEdge - eps) reason = 'edge';
    return { fixture, family, key, pair, price, opposite, market, prime, chances, p, edge, margin, reason };
  });
}

export function rankValue(rows, existing = [], day, rule = RULE) {
  const used = new Set(existing.map(p => p.fixture.id)); // Never repeat a sealed match, including a moved match ID.
  const keys = new Set(existing.map(p => p.fixture.calendarKey));
  const slots = Math.max(0, rule.cap - existing.filter(p => p.day === day).length);
  if (!slots) return [];
  const out = [];
  const sorted = rows.filter(r => r.reason === 'pass').sort((a, b) => b.edge - a.edge ||
    Math.min(b.prime, b.chances) - Math.min(a.prime, a.chances) ||
    a.fixture.kickoff.localeCompare(b.fixture.kickoff) || a.fixture.id.localeCompare(b.fixture.id) || a.key.localeCompare(b.key));
  for (const row of sorted) {
    if (used.has(row.fixture.id) || keys.has(row.fixture.calendarKey)) continue;
    used.add(row.fixture.id); keys.add(row.fixture.calendarKey);
    out.push(row);
    if (out.length === slots) break;
  }
  return out;
}
export function sealValuePick(row, at, snapshotAt, mode) {
  const day = sofiaDate(ms(at));
  const { fixture, family, key, pair, price, opposite, market, prime, chances, p, edge, margin } = row;
  return { id: day + '/' + fixture.id, day, at, snapshotAt, mode, fixture, family, key, pair,
    price, opposite, market, prime, chances, p, edge, margin };
}

// An exact schedule correction or conflicting final is not a win or a loss.
export function valueSettlement(pick, bucket, now) {
  const actual = bucket?.results?.find(r => r.key === pick.fixture.calendarKey);
  if (!actual || !goodClock(actual.observed) || ms(actual.observed) > now || !actual.source ||
      !(ms(actual.observed) - ms(pick.fixture.kickoff) >= 3 * 3_600_000) ||
      !Array.isArray(actual.score) || actual.score.length !== 2 || !actual.score.every(g => Number.isInteger(g) && g >= 0 && g <= 30)) return null;
  if (actual.conflict || actual.exactKickoff && ms(actual.kickoff) !== ms(pick.fixture.kickoff))
    return { state: 'review', score: actual.score, observed: actual.observed, source: actual.source,
      actualKickoff: actual.kickoff ?? null, reason: actual.conflict ? 'conflict' : 'schedule' };
  const hit = marketOutcome(pick.key, actual.score);
  if (hit === null) return null;
  return { state: hit ? 'hit' : 'miss', score: actual.score, observed: actual.observed, source: actual.source,
    actualKickoff: actual.kickoff ?? null, reason: null };
}
export function valueStats(entries) {
  const settled = entries.filter(p => ['hit', 'miss'].includes(p.result?.state));
  const hits = settled.filter(p => p.result.state === 'hit').length;
  const n = settled.length;
  const sum = fn => settled.reduce((total, row) => total + fn(row, Number(row.result.state === 'hit')), 0);
  const profit = sum((r, y) => r.price * y - 1);
  return { recorded: entries.length, settled: n, hits, pending: entries.filter(p => !p.result).length,
    review: entries.filter(p => p.result?.state === 'review').length,
    hitRate: n ? hits / n : null, roi: n ? profit / n : null, profit: n ? profit : null,
    averageOdds: n ? sum(r => r.price) / n : null,
    brier: n ? Object.fromEntries(['p', 'prime', 'chances', 'market'].map(k => [k, sum((r,y) => (r[k]-y)**2)/n])) : null };
}
