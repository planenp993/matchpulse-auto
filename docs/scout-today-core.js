/* Editorial goals board. The registered forecast and diary engines supply its inputs. */
(function(root, factory) {
  const selections = typeof module === 'object' && module.exports ? require('./scout-selections.js') : root.MatchpulseSelections;
  const api = factory(selections);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MatchpulseTodayCore = api;
})(globalThis, function(Selections) {
  'use strict';

  const SINGLE_MARKETS = new Set(['o25', 'u25', 'btts', 'bttsNo']);
  const BUILDER_MARKETS = new Set([...SINGLE_MARKETS, 'o15', 'o35', 'u35']);
  const MARKETS = new Map(Selections.MARKETS.map(market => [market.id, market]));
  const LABELS = {single: 'Единична', builder: 'Бет билдър', column: 'Права колонка'};
  const LIMIT = 5;
  const PRICE_MINUTES = 60;
  const minimum = probability => Math.ceil((1 + Selections.RULES.priceBuffer) / probability * 100 - 1e-9) / 100;
  const kickoffKey = legs => legs.map(leg => `${leg.date} ${leg.time}`).join('|');
  const idFor = (type, legs) => `${type}:${legs.map(leg => `${leg.fixtureKey}::${leg.markets.join('+')}`).join('~')}`;
  const label = id => MARKETS.get(id)?.label || id;
  const reasonFor = evidence => `В последните мачове събитието се среща ${evidence.home.hits}/${evidence.home.n} при домакина и ${evidence.away.hits}/${evidence.away.n} при госта.`;

  function legFor(fixture, markets, core) {
    const [div, , league, date, time, home, away] = fixture;
    return {fixtureKey: core.keyFixture(fixture), div, league, date, time, home, away, markets};
  }

  function candidate(type, legs, probability, rank, reason, csv = null) {
    return {id: idFor(type, legs), type, legs, probability, minimum: minimum(probability), rank, reason, csv};
  }

  function collect(entries, history, core, model) {
    const singles = [], builders = [], leagueRows = new Map();
    for (const entry of entries) {
      const eligible = entry.candidates.filter(pick => pick.eligible);
      for (const pick of eligible) {
        if (!SINGLE_MARKETS.has(pick.id) || pick.probability < .55) continue;
        singles.push(candidate('single', [legFor(entry.fixture, [pick.id], core)], pick.probability,
          pick.rank, reasonFor(pick.evidence), entry.csv?.[pick.id] || null));
      }

      const totals = eligible.filter(pick => BUILDER_MARKETS.has(pick.id) && pick.family === 'total');
      const bothTeams = eligible.filter(pick => pick.family === 'btts');
      if (!totals.length || !bothTeams.length || !entry.profile) continue;
      const fixture = entry.fixture, [div, , , date] = fixture, key = `${div}|${date}`;
      if (!leagueRows.has(key)) {
        const since = String(Number(date.slice(0, 4)) - 3) + date.slice(4);
        leagueRows.set(key, history.filter(row => row[0] === div && row[3] >= since && row[3] < date && model.isPlayed(row)));
      }
      const rows = leagueRows.get(key), n = rows.length;
      if (n < Selections.RULES.leagueMinimum) continue;
      for (const total of totals) for (const both of bothTeams) {
        const markets = [total.id, both.id].sort();
        const p = Selections.probability(entry.model.distribution.matrix, markets);
        if (p === null || p < .30 || p > .78 || p >= Math.min(total.probability, both.probability) - 1e-9) continue;
        const test = (home, away) => markets.every(id => MARKETS.get(id).test(home, away));
        const reference = {n, normal: rows.filter(r => test(r[7], r[8])).length / n,
          reverse: rows.filter(r => test(r[8], r[7])).length / n};
        const e = Selections.support(fixture, entry.profile, test, reference, p, core);
        if (e.modelLift < Selections.RULES.minModelLift || e.formLift < Selections.RULES.minFormLift || e.rank <= 0) continue;
        builders.push(candidate('builder', [legFor(fixture, markets, core)], p, e.rank, reasonFor(e)));
      }
    }
    return {singles, builders};
  }

  function assess(item, quote, now) {
    if (!quote || quote.kickoffs !== kickoffKey(item.legs)) return 'missing';
    const age = now.getTime() - Date.parse(quote.checkedAt);
    if (!Number.isFinite(age) || age < 0 || age > PRICE_MINUTES * 60000) return 'stale';
    return quote.odds >= item.minimum ? 'ready' : 'below';
  }

  function rank(items, quotes, now) {
    const ready = item => assess(item, quotes[item.id], now) === 'ready';
    return items.slice().sort((a, b) => Number(ready(b)) - Number(ready(a)) || b.rank - a.rank || a.id.localeCompare(b.id));
  }

  function column(singles, quotes, now, core, count, book) {
    if (![2, 3].includes(count) || !book) return null;
    const entries = [], seen = new Set(), booksEqual = a => a?.toLowerCase() === book.toLowerCase();
    for (const item of rank(singles, quotes, now)) {
      const leg = item.legs[0];
      if (seen.has(leg.fixtureKey) || !booksEqual(quotes[item.id]?.book) || assess(item, quotes[item.id], now) !== 'ready') continue;
      seen.add(leg.fixtureKey);
      entries.push(item);
    }
    function choose(start, selected, used) {
      if (selected.length === count) return selected;
      for (let i = start; i <= entries.length - (count - selected.length); i++) {
        const item = entries[i], leg = item.legs[0], clubs = [core.keyTeam(leg.home), core.keyTeam(leg.away)];
        if (clubs[0] === clubs[1] || clubs.some(club => used.has(club))) continue;
        const found = choose(i + 1, [...selected, item], new Set([...used, ...clubs]));
        if (found) return found;
      }
      return null;
    }
    const legs = choose(0, [], new Set());
    if (!legs) return null;
    return candidate('column', legs.flatMap(item => item.legs), legs.reduce((p, item) => p * item.probability, 1),
      legs.reduce((sum, item) => sum + item.rank, 0) / count, 'Всяка селекция покрива прага при същия букмейкър. Общата вероятност е приблизителна.');
  }

  function canRecord(item, audience, records) {
    const todays = records.filter(record => record.legs[0].date === item.legs[0].date);
    if (todays.some(record => record.id === item.id)) return false;
    if (audience === 'FREE' && (item.type !== 'single' || todays.some(record => record.audience === 'FREE'))) return false;
    const sameType = todays.filter(record => record.type === item.type);
    return item.type === 'single' ? sameType.length < LIMIT && sameType.every(record => record.legs[0].fixtureKey !== item.legs[0].fixtureKey) : !sameType.length;
  }

  function validQuote(quote) {
    return !!quote && Number.isFinite(quote.odds) && quote.odds > 1 && quote.odds <= 1000 &&
      typeof quote.book === 'string' && !!quote.book.trim() && quote.book.length <= 64 && Number.isFinite(Date.parse(quote.checkedAt)) && typeof quote.kickoffs === 'string';
  }

  function recordsFrom(doc, core) {
    if (doc?.schema !== 1 || !Array.isArray(doc.records)) return [];
    return doc.records.filter(record => {
      const legs = record?.legs;
      if (!Array.isArray(legs) || ![1, 2, 3].includes(legs.length) || !Object.hasOwn(LABELS, record.type) ||
          !['FREE', 'VIP'].includes(record.audience) || !Number.isFinite(record.probability) || record.probability <= 0 || record.probability > 1 ||
          typeof record.reason !== 'string' || record.reason.length > 500 || typeof record.publishedAt !== 'string' ||
          !Number.isFinite(Date.parse(record.publishedAt)) || !validQuote(record.quote)) return false;
      if (!legs.every(leg => leg && ['div', 'league', 'date', 'time', 'home', 'away', 'fixtureKey'].every(key => typeof leg[key] === 'string' && leg[key].length <= 200) &&
          /^\d{4}-\d{2}-\d{2}$/.test(leg.date) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(leg.time) &&
          leg.fixtureKey === core.keyPick(leg) && Array.isArray(leg.markets))) return false;
      if (record.id !== idFor(record.type, legs) || record.minimum !== minimum(record.probability)) return false;
      if (record.type === 'builder' && (legs.length !== 1 || legs[0].markets.length !== 2 ||
          new Set(legs[0].markets.map(id => MARKETS.get(id)?.family)).size !== 2 || !legs[0].markets.every(id => BUILDER_MARKETS.has(id)))) return false;
      if (record.type !== 'builder' && !legs.every(leg => leg.markets.length === 1 && SINGLE_MARKETS.has(leg.markets[0]))) return false;
      if (record.type === 'column' && (legs.length < 2 || new Set(legs.map(leg => leg.date)).size !== 1 ||
          new Set(legs.flatMap(leg => [core.keyTeam(leg.home), core.keyTeam(leg.away)])).size !== legs.length * 2)) return false;
      if ((record.type === 'single' && legs.length !== 1) || (record.audience === 'FREE' && record.type !== 'single')) return false;
      return assess(record, record.quote, new Date(record.publishedAt)) === 'ready';
    });
  }

  function settlement(record, resultFor, core) {
    const legs = record.legs.map(leg => {
      const row = resultFor(leg);
      if (!row) return null;
      const flags = leg.markets.map(market => core.marketSettled({market}, row));
      if (flags.includes(null)) return null;
      return {won: flags.every(Boolean), score: `${row[7]}:${row[8]}`};
    });
    return {legs, won: legs.includes(null) ? null : legs.every(leg => leg.won)};
  }

  return {LABELS, LIMIT, PRICE_MINUTES, minimum, kickoffKey, label, collect, assess, rank, column, canRecord, validQuote, recordsFrom, settlement};
});
