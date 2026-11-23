/* Browser adapter for the frozen scoring_frequency.py model.
   scripts/core.test.mjs compares it against all 51 sealed forecasts. */
export const CORE_LEAGUES = ['epl', 'bundesliga', 'la-liga', 'serie-a', 'ligue-1'];
export const CORE_CODES = { epl: 'E0', bundesliga: 'D1', 'la-liga': 'SP1', 'serie-a': 'I1', 'ligue-1': 'F1' };
export const MIN_LEAD = 90 * 60_000;
const HOLD_RESULT = 3 * 3_600_000;
const DAY = 86_400_000;
const logistic = n => 1 / (1 + Math.exp(-n));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const csv = text.replace(/^\ufeff/, '');
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      rows.push([...row, field]); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('Незатворено поле в CSV');
  if (row.length || field) rows.push([...row, field]);
  const headers = rows.shift() ?? [];
  if (new Set(headers).size !== headers.length) throw new Error('Повторени колони в CSV');
  return rows.filter(item => item.some(Boolean)).map(item => {
    if (item.length !== headers.length) throw new Error('Невалиден ред в CSV');
    return Object.fromEntries(headers.map((key, i) => [key, item[i]]));
  });
}

const score = s => /^\d{1,2}$/.test(s) ? Number(s) : null;
const realXg = s => s?.trim() && Number.isFinite(+s) && +s >= 0 && +s <= 20 ? +s : null;
const numberPair = (a, b) => (a === null || b === null ? null : [a, b]);

export function parseCoreFixtures(csv, fixtureCount) {
  const source = parseCSV(csv).filter(row => row.phase === 'league');
  if (fixtureCount && source.length < .8 * fixtureCount) throw new Error('Непълен календар за лигата');
  const ids = new Set();
  return source.map(row => {
    const id = row.fixture_id;
    if (!id || ids.has(id) || !row.home?.trim() || !row.away?.trim() || row.home === row.away ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.source !== 'Sportmonks') {
      throw new Error('Невалидна самоличност на мач');
    }
    ids.add(id);
    const final = row.status === 'full_time' && !row.awarded_winner && !row.result_note;
    const goals = final ? numberPair(score(row.home_goals_90), score(row.away_goals_90)) : null;
    const xg = goals && row.team_xg_source === 'Sportmonks'
      ? numberPair(realXg(row.home_xg), realXg(row.away_xg)) : null;
    const kickoff = /(?:Z|[+-]\d{2}:\d{2})$/.test(row.kickoff_utc) ? Date.parse(row.kickoff_utc) : NaN;
    return { id, day: row.date, home: row.home.trim(), away: row.away.trim(),
      kickoff, status: row.status, goals, xg };
  });
}

export function rating() {
  return { attack: 0, weakness: 0, games: 0 };
}
function club() {
  return { goals: rating(), chance: rating(), lastXg: '', points: 0, scored: 0, allowed: 0,
    homeHistory: [], awayHistory: [], form: [] };
}
export function updateRating(state, attackError, defenceError) {
  state.attack = .96 * state.attack + .045 * attackError;
  state.weakness = .96 * state.weakness + .045 * defenceError;
  state.games++;
}
export function expected(lg, home, away) {
  return [lg[0] * Math.exp(home.attack + away.weakness), lg[1] * Math.exp(away.attack + home.weakness)];
}
export function updateMeans(previous, results) {
  if (!results.length) return previous;
  const decay = 0.5 ** (results.length / 120);
  return previous.map((s, i) => decay * s + (1 - decay) * mean(results.map(game => game[i])));
}
function remember(series, item, limit = 6) {
  series.push(item);
  if (series.length > limit) series.shift();
}
function frequency(series, def, day) {
  let weight = 0, similar = 0, residual = 0, adjusted = 0;
  for (const item of series) {
    const w = .5 ** ((Date.parse(day) - Date.parse(item.day)) / (100 * DAY));
    const wSimilar = w * Math.exp(-.5 * ((item.def - def) / .20) ** 2);
    weight += w; similar += wSimilar;
    residual += w * item.residual; adjusted += wSimilar * item.residual;
  }
  const venue = residual / (4 + weight);
  return { features: [venue, adjusted / (4 + similar) - venue], n: series.length, similar };
}
function rank(clubs, team) {
  let position = 1;
  const gd = team.scored - team.allowed;
  for (const c of clubs.values()) {
    if (!c.goals.games) continue;
    const d = c.scored - c.allowed;
    if (c.points > team.points || (c.points === team.points && (d > gd || (d === gd && c.scored > team.scored)))) position++;
  }
  return position;
}
function settle(item) {
  const { match, home, away, pg, px, hd, ad } = item;
  const [h, a] = match.goals;
  updateRating(home.goals, h - pg[0], a - pg[1]);
  updateRating(away.goals, a - pg[1], h - pg[0]);
  home.scored += h; away.scored += a; home.allowed += a; away.allowed += h;
  home.points += h === a ? 1 : h > a ? 3 : 0;
  away.points += h === a ? 1 : a > h ? 3 : 0;
  remember(home.form, { opponent: match.away, gf: h, ga: a, day: match.day, venue: "home" }, 10);
  remember(away.form, { opponent: match.home, gf: a, ga: h, day: match.day, venue: "away" }, 10);
  if (!match.xg) return;
  updateRating(home.chance, match.xg[0] - px[0], match.xg[1] - px[1]);
  updateRating(away.chance, match.xg[1] - px[1], match.xg[0] - px[0]);
  home.lastXg = away.lastXg = match.day;
  remember(home.homeHistory, { day: match.day, def: ad, residual: Number(h === 0) - Math.exp(-px[0]) });
  remember(away.awayHistory, { day: match.day, def: hd, residual: Number(a === 0) - Math.exp(-px[1]) });
}

export function markets(grid) {
  let over = 0, btts = 0, home = 0, draw = 0, away = 0, total = 0;
  const scorelines = [];
  const expectedGoals = [0, 0], scoring = [0, 0];
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      const p = grid[h][a];
      if (!Number.isFinite(p) || p < 0) throw new Error('Невалидно разпределение на голове');
      total += p;
      expectedGoals[0] += h * p; expectedGoals[1] += a * p;
      if (h) scoring[0] += p;
      if (a) scoring[1] += p;
      if (h + a >= 3) over += p;
      if (h && a) btts += p;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      scorelines.push({ h, a, p });
    }
  }
  if (Math.abs(total - 1) > 1e-9) throw new Error('Вероятностите трябва да дават сбор 100%');
  return { probabilities: { over_2_5: over, under_2_5: 1 - over, btts_yes: btts, btts_no: 1 - btts,
    home, draw, away, home_or_draw: home + draw, draw_or_away: draw + away, home_or_away: home + away },
    expectedGoals, scoring, scorelines: scorelines.sort((a, b) => b.p - a.p).slice(0, 3) };
}

function scoreGrid(p, rate, dependence) {
  let both = p[0] * p[1];
  both += dependence * (dependence >= 0
    ? Math.min(...p) - both : both - Math.max(0, p[0] + p[1] - 1));
  const [home, away] = rate.map(r => {
    const weights = [0, r / Math.expm1(r)];
    for (let i = 2; i <= 30; i++) weights.push(weights[i - 1] * r / i);
    return weights;
  });
  const grid = home.map(h => away.map(a => both * h * a));
  grid[0][0] = Math.max(0, 1 - p[0] - p[1] + both);
  for (let i = 1; i <= 30; i++) {
    grid[i][0] = (p[0] - both) * home[i];
    grid[0][i] = (p[1] - both) * away[i];
  }
  return grid;
}

export function topForecasts(fixtures, league, season, now, observed, cfg, until) {
  const clubs = new Map();
  const get = name => {
    if (!clubs.has(name)) clubs.set(name, club());
    return clubs.get(name);
  };
  let gc = [1.45, 1.15], xc = [1.45, 1.15];
  const edge = new Date(now).toISOString().slice(0, 10);
  const finals = fixtures.filter(m => m.goals && m.day < edge && m.kickoff + HOLD_RESULT <= observed);
  const groups = new Map();
  for (const m of finals.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))) {
    if (!groups.has(m.day)) groups.set(m.day, []);
    groups.get(m.day).push(m);
  }
  for (const batch of groups.values()) {
    const active = new Set();
    const pending = batch.map(match => {
      if (active.has(match.home) || active.has(match.away)) throw new Error('Повторен отбор в един ден');
      active.add(match.home); active.add(match.away);
      const home = get(match.home), away = get(match.away);
      return { match, home, away, pg: expected(gc, home.goals, away.goals),
        px: expected(xc, home.chance, away.chance), hd: home.chance.weakness, ad: away.chance.weakness };
    });
    for (const x of pending) settle(x);
    gc = updateMeans(gc, batch.map(m => m.goals));
    xc = updateMeans(xc, batch.flatMap(m => m.xg ? [m.xg] : []));
  }
  const p = cfg.parameters;
  const indicators = CORE_LEAGUES.slice(1).map(name => Number(league === name));
  const maxGames = league === 'bundesliga' || (league === 'ligue-1' && season >= 2023) ? 34 : 38;
  const history = { matches: finals.length, xg: finals.filter(m => m.xg).length };
  if (!history.matches || history.xg / history.matches <= .8) return [];
  return fixtures.flatMap(match => {
    if (match.status !== 'unplayed' || !(match.kickoff >= now + MIN_LEAD && match.kickoff < until)) return [];
    const home = get(match.home), away = get(match.away), both = [home, away];
    if (both.some(c => c.chance.games < 6 || Date.parse(match.day) - Date.parse(c.lastXg) > 45 * DAY)) return [];
    const xg = expected(xc, home.chance, away.chance), g = expected(gc, home.goals, away.goals);
    const ranks = both.map(team => rank(clubs, team));
    const ppg = both.map(c => c.points / c.goals.games);
    const stage = Math.min(home.goals.games, away.goals.games) / maxGames;
    const f = [frequency(home.homeHistory, away.chance.weakness, match.day),
      frequency(away.awayHistory, home.chance.weakness, match.day)];
    const first = [], base = [], rates = [];
    for (const side of [0, 1]) {
      const other = 1 - side;
      const terms = [1, .5 - side, ...indicators, Math.log(g[side]), Math.log(xg[side]), Math.log(xg[other]),
        (ppg[side] - 1.35) / 1.5, (ppg[other] - 1.35) / 1.5,
        (ranks[side] - 10) / 10, (ranks[other] - 10) / 10, stage - .5];
      const correction = f[side].features.map((v, i) => (v - p.signal_mean[i + 1]) / p.signal_scale[i + 1]);
      first.push(logistic(dot([...terms, ...correction], p.scoring.similar_defence)));
      base.push(logistic(dot(terms, p.scoring.base)));
      rates.push(Math.exp(dot(terms, p.positive_counts)));
    }
    const model = markets(scoreGrid(first, rates, p.dependence));
    const control = markets(scoreGrid(base, rates, p.dependence)).probabilities;
    return [{ id: league + '/' + match.id, providerId: match.id, league: CORE_CODES[league],
      home: match.home, away: match.away, kickoff: new Date(match.kickoff).toISOString(),
      issued: new Date(now).toISOString(), dataAsOf: new Date(observed).toISOString(),
      source: 'xGTables · Sportmonks', model: 'similar_defence', ...model,
      facts: { xg, ranks, ppg, first, form: both.map(c => c.form), oppositionCases: f.map(v => v.n),
        league: xc, xgCounts: both.map(c => c.chance.games),
        adjustments: [model.probabilities.over_2_5 - control.over_2_5,
          model.probabilities.btts_yes - control.btts_yes] } }];
  });
}
