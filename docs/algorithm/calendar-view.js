import { LEAGUE_BY_ID, MARKETS, matchKey, sofiaDate } from './catalog.js?v=9880ec988a17';
import { euroKey } from './europe.js?v=e2b2d2fe8657';

export const FIRST_DAY = '2026-11-23';
export function shiftDay(day, offset) {
  return new Date(Date.parse(day + 'T12:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
}
export function calendarKey(league, day, home, away) {
  if (LEAGUE_BY_ID[league]?.europe) return [league, day, euroKey(home), euroKey(away)].join('|');
  // Calendar-only alias confirmed by matching both the venue and all ten
  // previous scores of the two archives. Paris FC and PSG remain distinct.
  const club = name => league === 'F1' && name === 'Paris' ? 'Paris FC' : name;
  return matchKey([league, null, null, day, null, club(home), club(away)]);
}
export function validCalendarIndex(index) {
  return index?.schema === 1 && index.start === FIRST_DAY && index.days && typeof index.days === 'object';
}
export function validCalendarDay(bucket, day, meta) {
  return bucket?.schema === 1 && bucket.day === day &&
    Array.isArray(bucket.forecasts) && Array.isArray(bucket.results) &&
    bucket.forecasts.length === meta.forecasts && bucket.results.length === meta.results;
}
export function marketOutcome(key, score) {
  if (!Array.isArray(score) || score.length !== 2 || !score.every(Number.isInteger)) return null;
  const [h, a] = score;
  return ({ over_2_5: h + a >= 3, under_2_5: h + a < 3, btts_yes: h > 0 && a > 0, btts_no: h === 0 || a === 0 })[key] ?? null;
}
export function forecastMarkets(p) {
  return [p.over_2_5 >= p.under_2_5 ? 'over_2_5' : 'under_2_5',
    p.btts_yes >= p.btts_no ? 'btts_yes' : 'btts_no'];
}

export function calendarRows(bucket, snapshot, day, now) {
  const today = sofiaDate(now);
  const rows = new Map();
  // All archived matches, independent of the daily selection and league filter.
  if (day <= today) {
    for (const record of bucket?.forecasts ?? []) {
      const m = record.m;
      const start = Date.parse(m.kickoff);
      if (!(Date.parse(record.published) < start && Date.parse(m.issued) <= Date.parse(record.published))) continue;
      // Do not treat an old, no-longer-published future fixture as current.
      if (start > now && day === today) continue;
      rows.set(record.key, { ...m, calendarKey: record.key, calendarSaved: record.published,
        calendarCommit: record.commit, calendarState: 'pending', date: day });
    }
    for (const actual of bucket?.results ?? []) {
      const old = rows.get(actual.key);
      const kickoff = Date.parse(actual.kickoff);
      const compatible = old && (!actual.exactKickoff || !Number.isFinite(kickoff) || Date.parse(old.calendarSaved) < kickoff);
      const base = compatible ? old : { id: 'result/' + actual.key, league: actual.league, home: actual.home, away: actual.away,
        kickoff: actual.kickoff, date: day, calendarKey: actual.key };
      rows.set(actual.key, { ...base, result: actual.score, resultSource: actual.source,
        resultConflict: Boolean(actual.conflict), calendarState: 'final' });
    }
  }
  const observed = Date.parse(snapshot.asOf);
  for (const m of snapshot.matches) {
    const start = Date.parse(m.kickoff);
    if (!Number.isFinite(start) || sofiaDate(start) !== day) continue;
    const key = calendarKey(m.league, day, m.home, m.away);
    if (rows.get(key)?.calendarState === 'final') continue;
    if (start > now) rows.set(key, { ...m, calendarKey: key, calendarState: 'upcoming', date: day });
    else if (day <= today && observed < start && Date.parse(m.issued) <= observed &&
        MARKETS.every(k => Number.isFinite(m.probabilities?.[k])) && !rows.has(key)) {
      rows.set(key, { ...m, calendarKey: key, calendarSaved: snapshot.asOf, calendarState: 'pending', date: day });
    }
  }
  return [...rows.values()].sort((a, b) => (a.kickoff ?? '').localeCompare(b.kickoff ?? '') ||
    a.calendarKey.localeCompare(b.calendarKey));
}
