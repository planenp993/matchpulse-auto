import './club-aliases.js?v=08c05a43670f';
import './model-core.js?v=08c05a43670f';
import { expected, markets, parseCSV, rating, updateMeans, updateRating } from './core.js?v=08c05a43670f';

export const EURO_CODES = { ucl: 'UCL', uel: 'UEL', uecl: 'UECL' };
export const EURO_LEAGUES = Object.keys(EURO_CODES);
const ids = new Set(Object.values(EURO_CODES));
const model = globalThis.MatchpulseModel;
const aliases = [
  ['Slovan Bratislava', 'S. Bratislava'], ['Shakhtar Donetsk', 'Shakhtar'],
  ['Lillestrøm', 'Lillestrom'], ['Jagiellonia Białystok', 'Jagiellonia'],
  ['Omonia Nicosia', 'Omonia'], ['Ferencvárosi', 'Ferencváros'], ['OFI', 'OFI Crete'],
  ["Hapoel Be'er Sheva", 'H. Beer-Sheva'], ['Hapoel Beer-Sheva', 'H. Beer-Sheva'],
  ['Dinamo Zagreb', 'GNK Dinamo'], ['Celta de Vigo', 'RC Celta de Vigo'],
  ['Olympiacos F.C.', 'Olympiakos'], ['Olympiacos', 'Olympiakos'],
  ['FC Iberia 1999', 'Iberia Tbilisi'], ['Universitatea Craiova', 'Univ. Craiova'],
  ['Kairat', 'Kairat Almaty'], ['KuPS', 'KuPS Kuopio'],
  ["Inter Club d'Escaldes", 'Inter Escaldes'], ['FC København', 'FC Copenhagen'],
  ['Copenhagen', 'FC Copenhagen'], ['Sint-Truiden', 'St Truiden'],
  ['Borac Banja Luka', 'Borac'], ['AGF', 'Aarhus'], ['Pafos FC', 'Pafos'],
  ['Egnatia Rrogozhinë', 'Egnatia'], ['Lincoln Red Imps', 'L. Red Imps'],
  ['Mjällby', 'Mjallby'], ['Crvena Zvezda', 'Red Star Belgrade']
];
const reviewed = new Map(aliases.map(([alias, club]) => [model.clubKey(alias), model.clubKey(club)]));
export const euroKey = name => {
  const key = model.clubKey(name);
  return reviewed.get(key) ?? key;
};

const matchInfo = (home, away) => [euroKey(home), euroKey(away)];
const time = value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value ?? '') ? Date.parse(value) : NaN;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '');
const regularResult = value => Number.isInteger(value) && value >= 0 && value <= 30;
const DAY = 86_400_000;
const PRIOR = [1.45, 1.15];

export function readEuropeanHistory(rows) {
  const found = new Set();
  return rows.flatMap(row => {
    const [code,,, day,, home, away, g1, g2] = row;
    if (!ids.has(code) || !date(day) || !home || !away || !regularResult(g1) || !regularResult(g2)) return [];
    const details = row[13] ?? {};
    const id = details.SRC;
    const teams = matchInfo(home, away);
    if (typeof id !== 'string' || !id.startsWith('UEFA/UEFA:') ||
        found.has(id) || teams[0] === teams[1]) throw new Error('Невалиден резултат от УЕФА');
    found.add(id);
    return [{ id, code, day, home, away, teams, goals: [g1, g2],
      phase: details.PHASE === 'QUALIFYING' ? 'qualifying' : 'main', round: details.ROUND }];
  }).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}

export function parseEuropeanFixtures(league, csv, fixtureCount) {
  const code = EURO_CODES[league];
  if (!code) throw new Error('Непознат евротурнир');
  const rows = parseCSV(csv);
  if (rows.length !== fixtureCount) throw new Error('Непълен календар за ' + code);
  const found = new Set();
  return rows.map(row => {
    const { fixture_id: id, home, away } = row;
    // Preserve known rows with an unresolved opponent until the draw gives it a real club ID.
    const named = Boolean(home && away && /^\d+$/.test(row.home_id) && /^\d+$/.test(row.away_id) &&
      row.home_id !== row.away_id && euroKey(home) !== euroKey(away));
    if (!id || found.has(id) || !date(row.date) || row.source !== 'Sportmonks')
      throw new Error('Невалиден календар за ' + code);
    found.add(id);
    return { id: league + '/' + id, providerId: id, code, day: row.date, home, away,
      teams: named ? matchInfo(home, away) : [],
      kickoff: time(row.kickoff_utc), status: row.status, phase: row.phase === 'qualifying' ? 'qualifying' : 'main',
      round: row.stage, named };
  });
}

function strength(profile, day) {
  if (!profile) return rating();
  const gap = (Date.parse(day) - Date.parse(profile.last)) / DAY;
  const decay = .5 ** (Math.max(0, gap) / 365);
  return { attack: profile.attack * decay, weakness: profile.weakness * decay };
}
function scaled(s, weight) {
  return { attack: weight * s.attack, weakness: weight * s.weakness };
}

export function europeRatings() {
  const clubs = new Map(), means = new Map();
  const group = m => m.code + '/' + m.phase;
  const report = m => String(m.round ?? '').trim().toLowerCase() === 'final';

  function basis(m) {
    const linear = means.get(group(m)) ?? PRIOR;
    if (!report(m)) return linear;
    const neutral = (linear[0] + linear[1]) / 2;
    return [neutral, neutral];
  }

  function profile(key, day) {
    const p = clubs.get(key);
    return { ...strength(p, day), games: p?.games ?? 0 };
  }

  function estimate(m, weights = 1, domestic = null) {
    const weightsBySource = typeof weights === 'number' ? { europe: weights, domestic: 0 } : weights;
    const profiles = m.teams.map(key => profile(key, m.day));
    const local = m.teams.map(key => domestic?.profile(key, m.day) ?? rating());
    const combined = profiles.map((p, i) => {
      const intl = scaled(p, weightsBySource.europe);
      const homeLeague = scaled(local[i], weightsBySource.domestic);
      return { attack: intl.attack + homeLeague.attack, weakness: intl.weakness + homeLeague.weakness };
    });
    const league = basis(m);
    const lambdas = expected(league, ...combined).map(g => Math.max(.15, Math.min(4.5, g)));
    return { league, lambdas, counts: profiles.map(p => p.games), domesticCounts: local.map(p => p.games) };
  }

  function update(batch) {
    const work = batch.map(m => ({ m, old: m.teams.map(key => clubs.get(key)),
      rates: estimate(m).lambdas }));
    const results = new Map();
    for (const { m, old, rates } of work) {
      const err = m.goals.map((v, i) => v - rates[i]);
      for (const [i, key] of m.teams.entries()) {
        const profile = { ...strength(old[i], m.day), games: old[i]?.games ?? 0, last: m.day };
        updateRating(profile, err[i], err[1 - i]);
        clubs.set(key, profile);
      }
      if (report(m)) continue;
      const key = group(m);
      if (!results.has(key)) results.set(key, []);
      results.get(key).push(m.goals);
    }
    for (const [league, goals] of results) means.set(league, updateMeans(means.get(league) ?? PRIOR, goals));
  }

  return { estimate, update, profile };
}

export function historyByDay(records) {
  const days = new Map();
  for (const row of records) {
    if (!days.has(row.day)) days.set(row.day, []);
    days.get(row.day).push(row);
  }
  return days;
}

// Country-qualified club keys prevent data for two homonyms being mixed together.
export function domesticHistory(rows) {
  return rows.flatMap(row => {
    const [code, country,, day,, home, away, g1, g2] = row;
    if (ids.has(code) || !country || !date(day) || !home || !away ||
        !regularResult(g1) || !regularResult(g2) || row[13]?.AWARDED === true) return [];
    const clubs = matchInfo(home, away);
    const keys = clubs.map(name => country + '/' + name);
    if (keys[0] === keys[1]) return [];
    return [{ code, country, day, clubs, teams: keys, goals: [g1, g2], phase: 'main' }];
  }).sort((a, b) => a.day.localeCompare(b.day));
}

export function domesticRatings() {
  const ratings = europeRatings(), keysByClub = new Map();
  return {
    update(batch) {
      for (const m of batch) for (const [i, club] of m.clubs.entries()) {
        if (!keysByClub.has(club)) keysByClub.set(club, new Set());
        keysByClub.get(club).add(m.teams[i]);
      }
      ratings.update(batch);
    },
    profile(club, day) {
      const keys = keysByClub.get(club);
      return keys?.size === 1 ? ratings.profile(keys.values().next().value, day) : rating();
    }
  };
}

function teamForm(records, domestic) {
  const byTeam = new Map();
  const selected = new Set(records.flatMap(m => m.teams));
  function add(key, entry) {
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(entry);
  }
  for (const m of records) {
    for (let side = 0; side < 2; side++) add(m.teams[side], { day: m.day, opponent: side ? m.home : m.away,
      gf: m.goals[side], ga: m.goals[1 - side], venue: side ? 'away' : 'home', competition: m.code });
  }
  // Merge domestic form only for an unambiguous cross-competition club name.
  const countries = new Map();
  for (const m of domestic) for (const name of m.slice(5, 7)) {
    const key = euroKey(name);
    if (!selected.has(key)) continue;
    if (!countries.has(key)) countries.set(key, new Set());
    countries.get(key).add(m[1]);
  }
  for (const m of domestic) {
    for (const [side, name] of m.slice(5, 7).entries()) {
      const key = euroKey(name);
      if (countries.get(key)?.size !== 1) continue;
      add(key, { day: m[3], opponent: m[6 - side], gf: m[7 + side], ga: m[8 - side],
        venue: side ? 'away' : 'home', competition: m[0] });
    }
  }
  for (const [key, rows] of byTeam) {
    const identified = new Map();
    for (const m of rows) identified.set([m.day, euroKey(m.opponent), m.venue].join('/'), m);
    byTeam.set(key, [...identified.values()].sort((a,b) => a.day.localeCompare(b.day)).slice(-10));
  }
  return byTeam;
}

export function europeanForecasts({ records, domestic, allDomestic = domestic, index, csv, coverage, fitted, releaseWeights = {}, now, day, observed }) {
  const history = records.filter(r => r.day < day);
  const ratings = europeRatings();
  for (const batch of historyByDay(history).values()) ratings.update(batch);
  const local = domesticRatings();
  for (const batch of historyByDay(domesticHistory(allDomestic.filter(r => r[3] >= '2021-07-01' && r[3] < day))).values()) local.update(batch);
  const forms = teamForm(history, domestic.filter(r => r[3] < day));
  const matches = [], audit = [];
  for (const slug of EURO_LEAGUES) {
    const code = EURO_CODES[slug];
    const season = index.competitions.find(c => c.slug === slug)?.seasons[0];
    if (!season || typeof csv[slug] !== 'string') throw new Error('Липсва календар за ' + code);
    const rows = parseEuropeanFixtures(slug, csv[slug], season.fixtures);
    const upcoming = rows.filter(m => m.status === 'unplayed' && m.named && m.kickoff > now);
    const current = coverage.seasons.find(e => e.division === code && e.season_year === season.year + 1);
    const past = coverage.seasons.find(e => e.division === code && e.season_year === season.year);
    const clocks = rows.filter(m => m.kickoff > now && m.status === 'unplayed' && !m.named);
    audit.push({ id: code, upcoming: upcoming.length, pending: clocks.length, fixtures: rows.length,
      previousN: past?.records, previousResults: past?.regulation_results,
      currentN: current?.records, currentResults: current?.regulation_results,
      xgN: season.stages.reduce((n, x) => n + (x.with_xg ?? 0), 0), xgDenom: season.results });
    for (const m of upcoming) {
      const config = fitted[code];
      const original = config?.matchWeights?.[m.phase] ?? { europe: config?.weight ?? .6, domestic: 0 };
      const upgrade = releaseWeights[code];
      const forWeights = weights => {
        const { league, lambdas, counts, domesticCounts } = ratings.estimate(m, weights, local);
        const distribution = model.distribution(...lambdas, model.params.standard.rho);
        return { ...markets(distribution.matrix), facts: { goals: lambdas, league,
          euroSample: counts, domesticSample: domesticCounts, euroWeight: weights.europe,
          domesticWeight: weights.domestic, form: m.teams.map(k => forms.get(k) ?? []) } };
      };
      const result = forWeights(upgrade ?? original);
      matches.push({ id: m.id, providerId: m.providerId, league: code, home: m.home, away: m.away,
        kickoff: new Date(m.kickoff).toISOString(), issued: new Date(now).toISOString(),
        dataAsOf: new Date(observed).toISOString(), source: 'Календар xGTables · резултати УЕФА',
        model: 'europe', round: m.round, ...result,
        ...(upgrade ? { forecastEdition: 'УЕФА · европейска и домашна форма', selectionForecast: forWeights(original) } : {}) });
    }
  }
  return { matches, audit };
}
