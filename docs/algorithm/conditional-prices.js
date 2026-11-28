// Read-only conditional price guide. No current bookmaker price is an input;
// this never writes or replaces a sealed Prime/Prime Value selection.
import { LEAGUE_BY_ID, SELECTION, dailyCandidates, eligibleForSelection,
  orderDaily, priceFrom, selectionMatch, sofiaDate } from './catalog.js?v=9880ec988a17';
import { MIN_LEAD } from './core.js?v=d017cb640a6f';
import { DELAY_AFTER } from './refresh-state.js?v=ad7cbaff7250';
import { REAL_MIN } from './value-check.js?v=0eece3b97e02';

export const CONDITIONAL = Object.freeze({ minimum: REAL_MIN, maximum: 2.00, count: SELECTION.count });
const zoned = s => typeof s === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
const eps = 1e-9;

export function conditionalPriceSelection({ snapshot, fitted = {}, day, now }) {
  const empty = status => ({ status, checked: 0, qualified: 0, scope: 'none', rows: [] });
  if (!Number.isFinite(now) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < sofiaDate(now)) return empty('past');
  if (!zoned(snapshot?.asOf)) return empty('stale');
  const asOf = Date.parse(snapshot.asOf);
  if (asOf > now || now - asOf > DELAY_AFTER || !Array.isArray(snapshot.matches)) return empty('stale');
  const fixtures = snapshot.matches.filter(m => {
    const league = LEAGUE_BY_ID[m?.league];
    if (!league || league.europe || !m.id || !m.home || !m.away ||
        m.model === 'retrospective' || m.model === 'europe' || m.reserveOnly || m.trialMarket ||
        !zoned(m.kickoff) || !zoned(m.issued) || sofiaDate(m.kickoff) !== day ||
        Date.parse(m.kickoff) - now < MIN_LEAD || Date.parse(m.issued) > asOf ||
        now - Date.parse(m.issued) > DELAY_AFTER) return false;
    return eligibleForSelection({ ...m, reserve: undefined }, fitted, {}) && Boolean(selectionMatch(m).probabilities);
  });
  // An ambiguous identity should not become a candidate even if just one copy
  // happens to have a stronger forecast.
  const counts = new Map();
  for (const m of snapshot.matches) if (m?.id) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  const regular = fixtures.filter(m => counts.get(m.id) === 1);
  const viable = dailyCandidates(regular).flatMap(candidate => {
    const floor = Math.max(CONDITIONAL.minimum, priceFrom(candidate.p) ?? Infinity);
    return floor <= CONDITIONAL.maximum + eps ? [{ ...candidate, floor }] : [];
  });
  const top = viable.filter(c => LEAGUE_BY_ID[c.m.league].core);
  const pool = top.length ? top : viable;
  return { status: 'ready', checked: regular.length, qualified: viable.length,
    scope: top.length ? 'top5' : viable.length ? 'other' : 'none',
    rows: orderDaily(pool, true, CONDITIONAL.count) };
}
