/** Replay the trained "Създадени положения" model on published, completed matches. */
import { sofiaDate, sofiaKickoff } from '../docs/algorithm/catalog.js';
import { CORE_CODES, CORE_LEAGUES, parseCoreFixtures } from '../docs/algorithm/core.js';

export const CHANCES_VERSION = 'prime-chances-2026-v1';
const DAY = 86_400_000;
const RESULT_WAIT = 3 * 3_600_000;
const LEAGUE_DECAY = 0.5 ** (1 / 150);
const XG_SOURCES = ['archive_xg', 'xgtables_recent', 'xgtables_history'];
const SIGNALS = ['shots', 'target', 'xg', 'corners'];
const SCALES = [12, 4, 1.3, 5];
const EMPTY = [0, 0, 0, 0];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const ordinal = day => Date.parse(day + 'T00:00:00Z') / DAY + 719163;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fade = (state, day) => 0.5 ** (Math.max(0, day - state[3] - 75) / 365);
const ready = (state, day) => state[2] >= 3 && day - state[3] <= 150;

function normalized(name) {
  return String(name ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/&/g, ' and ')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function identity(league, name) {
  const raw = normalized(name);
  if (Object.hasOwn(league.aliases, raw)) return league.aliases[raw];
  if (Object.hasOwn(league.clubs, raw)) return raw;
  const common = globalThis.MatchpulseModel.clubKey(name);
  if (Object.hasOwn(league.aliases, common)) return league.aliases[common];
  return Object.hasOwn(league.clubs, common) ? common : raw;
}

function pair(a, b, valid = value => Number.isInteger(value) && value >= 0) {
  return valid(a) && valid(b) ? [a, b] : null;
}
const xgPair = (a, b) => pair(a, b, value => Number.isFinite(value) && value >= 0 && value < 15);
const matchKey = (league, day, teams) => [league, day, ...teams].join('|');
const sameGoals = (one, two) => one?.[0] === two?.[0] && one?.[1] === two?.[1];

function historyAfter(state, raw, live, now, xgTime, calendarTime) {
  const today = sofiaDate(now);
  const rows = new Map();
  const blocked = new Set();
  const inWindow = day => day > state.through && day < today;
  for (const match of raw.history) {
    const [code, , , day, time, home, away, h, a, hxg, axg] = match;
    if (!Object.hasOwn(state.divisions, code) || !inWindow(day) ||
        !globalThis.MatchpulseModel.isPlayed(match)) continue;
    const kickoff = sofiaKickoff(day, time);
    if (Number.isFinite(kickoff) ? kickoff + RESULT_WAIT > calendarTime : day >= sofiaDate(calendarTime)) continue;

    const league = state.divisions[code];
    const teams = [identity(league, home), identity(league, away)];
    if (teams.some(team => !team) || teams[0] === teams[1]) continue;
    const key = matchKey(code, day, teams);
    const data = match[13];
    const shots = pair(data?.HS, data?.AS);
    let target = pair(data?.HST, data?.AST);
    if (shots && target?.some((n, i) => n > shots[i])) target = null;
    const goals = [h, a];
    if (rows.has(key) && !sameGoals(rows.get(key).goals, goals)) {
      blocked.add(key);
      continue;
    }
    const previous = rows.get(key);
    rows.set(key, { code, day, teams, goals, signals: {
      goals, shots: shots ?? previous?.signals.shots, target: target ?? previous?.signals.target,
      corners: pair(data?.HC, data?.AC) ?? previous?.signals.corners,
      archive_xg: xgPair(hxg, axg) ?? previous?.signals.archive_xg,
    } });
  }

  for (const slug of CORE_LEAGUES) {
    const code = CORE_CODES[slug], league = state.divisions[code];
    if (!league || typeof live.csv[slug] !== 'string') continue;
    const season = live.index.competitions.find(c => c.slug === slug)?.seasons[0];
    if (!season) continue;
    for (const match of parseCoreFixtures(live.csv[slug], season.fixtures)) {
      const day = match.day;
      if (!inWindow(day) || !match.goals || !(match.kickoff + RESULT_WAIT <= xgTime)) continue;
      const teams = [identity(league, match.home), identity(league, match.away)];
      if (teams.some(team => !Object.hasOwn(league.clubs, team)) || teams[0] === teams[1]) continue;
      const key = matchKey(code, day, teams);
      const row = rows.get(key);
      const xg = xgPair(...(match.xg ?? []));
      if (row) {
        if (xg && !row.signals.archive_xg && sameGoals(row.goals, match.goals)) row.signals.xgtables_recent = xg;
      } else {
        rows.set(key, { code, day, teams, goals: match.goals,
          signals: { goals: match.goals, xgtables_recent: xg } });
      }
    }
  }
  return [...rows].filter(([key]) => !blocked.has(key)).map(([, row]) => row).sort((one, two) =>
    compare(one.day, two.day) || compare(one.code, two.code) ||
    compare(one.teams[0], two.teams[0]) || compare(one.teams[1], two.teams[1]));
}

function newClub() {
  return { venue: [EMPTY.slice(), EMPTY.slice()], signals: Object.create(null) };
}

function goalRate(base, attack, defence, day) {
  return base * Math.exp(clamp(attack[0] * fade(attack, day) + defence[1] * fade(defence, day), -1.45, 1.45));
}

function rates(league, signal, home, away, day, requireHistory = true) {
  const h = home.signals[signal] ?? EMPTY;
  const a = away.signals[signal] ?? EMPTY;
  if (requireHistory && !(ready(h, day) && ready(a, day))) return null;
  return [goalRate(league.means[signal][0], h, a, day), goalRate(league.means[signal][1], a, h, day)];
}

function update(state, attackError, defenceError, day) {
  const decay = state[2] ? .955 * fade(state, day) : 0;
  state[0] = clamp(decay * state[0] + .065 * clamp(attackError, -2, 2), -.9, .9);
  state[1] = clamp(decay * state[1] + .065 * clamp(defenceError, -2, 2), -.9, .9);
  state[2]++;
  state[3] = day;
}

function updateSignal(league, signal, home, away, value, day) {
  const expected = rates(league, signal, home, away, day, false);
  const means = league.means[signal];
  const error = value.map((n, i) => (n - expected[i]) / Math.max(means[i], .5));
  update(home.signals[signal] ??= EMPTY.slice(), error[0], error[1], day);
  update(away.signals[signal] ??= EMPTY.slice(), error[1], error[0], day);
  league.means[signal] = means.map((n, i) => LEAGUE_DECAY * n + (1 - LEAGUE_DECAY) * value[i]);
}

function replay(state, rows) {
  let i = 0;
  while (i < rows.length) {
    const batchDay = rows[i].day;
    const day = ordinal(batchDay);
    const batch = [];
    while (rows[i]?.day === batchDay) {
      const observation = rows[i++];
      const league = state.divisions[observation.code];
      const [home, away] = observation.teams.map(key => {
        if (!Object.hasOwn(league.clubs, key))
          Object.defineProperty(league.clubs, key, { value: newClub(), enumerable: true, writable: true });
        return league.clubs[key];
      });
      const expected = rates(league, 'goals', home, away, day, false);
      batch.push({ observation, league, home, away, expected });
    }
    for (const { observation, league, home, away, expected } of batch) {
      const [homeError, awayError] = observation.goals.map((n, side) => n - expected[side]);
      update(home.venue[0], homeError, awayError, day);
      update(away.venue[1], awayError, homeError, day);
      for (const [name, value] of Object.entries(observation.signals)) {
        if (value) updateSignal(league, name, home, away, value, day);
      }
    }
  }
}

function opinion(state, match) {
  if (!Object.hasOwn(state.divisions, match.league)) return null;
  const league = state.divisions[match.league];
  const clubs = [match.home, match.away].map(name => identity(league, name));
  if (clubs.some(club => !Object.hasOwn(league.clubs, club)) || clubs[0] === clubs[1]) return null;
  const [home, away] = clubs.map(club => league.clubs[club]);
  const day = ordinal(sofiaDate(match.kickoff));
  const bases = league.means.goals;
  const goals = rates(league, 'goals', home, away, day, false);
  const venues = [goalRate(bases[0], home.venue[0], away.venue[1], day), goalRate(bases[1], away.venue[1], home.venue[0], day)];
  let xg = null;
  for (const source of XG_SOURCES) {
    const values = rates(league, source, home, away, day);
    if (!values) continue;
    xg = values.map((n, side) => n * bases[side] / league.means[source][side]);
    break;
  }
  const signals = SIGNALS.map(name => name === 'xg' ? xg : rates(league, name, home, away, day));
  if (signals.every(value => value === null)) return null;
  const means = bases.map((base, i) => {
    const log = n => Math.log(Math.max(n, .05));
    const features = [1, i === 0 ? 1 : 0, log(base), log(goals[i]), log(venues[i])];
    for (const [j, signal] of signals.entries()) {
      features.push(signal ? log(signal[i]) - Math.log(SCALES[j]) : 0, signal ? 1 : 0);
    }
    const linear = features.reduce((sum, value, j) => sum + value * state.coefficients[j], 0);
    return clamp(Math.exp(linear), .12, 6);
  });
  const total = means[0] + means[1];
  const p = value => clamp(value, .000001, .999999);
  const over = p(1 - Math.exp(-total) * (1 + total + total * total / 2));
  const btts = p(Math.expm1(-means[0]) * Math.expm1(-means[1]));
  return { chances: { over_2_5: over, under_2_5: 1 - over, btts_yes: btts, btts_no: 1 - btts }, chanceRates: means };
}

export function addChances(snapshot, { raw, live, now, checkpoint }) {
  if (checkpoint.schema !== 1 || checkpoint.fitThrough > checkpoint.through ||
      checkpoint.through >= sofiaDate(now) || checkpoint.coefficients.length !== 13 ||
      !checkpoint.coefficients.every(Number.isFinite)) {
    throw new Error('Invalid Prime chances checkpoint');
  }
  const state = structuredClone(checkpoint);
  const observations = historyAfter(state, raw, live, now, Math.min(now, Date.parse(snapshot.xgTime)),
                                    Math.min(now, Date.parse(snapshot.archiveTime ?? snapshot.calendarTime)));
  replay(state, observations);
  const matches = snapshot.matches.map(({ chances: previous, ...match }) => {
    const opinionForMatch = opinion(state, match);
    return opinionForMatch ? { ...match, ...opinionForMatch } : match;
  });
  return { ...snapshot, matches, selectionVersion: CHANCES_VERSION };
}
