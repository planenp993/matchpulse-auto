/* Shared rules for the Telegram composer and its prospective comparison. */
(function(root, factory) {
  const daily = factory();
  if (typeof module === 'object' && module.exports) module.exports = daily;
  if (root) root.MatchpulseDaily = daily;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const LIMIT = 5;
  const MIN_PROBABILITY = .55;
  const cutoff = now => new Date((Math.ceil(now.getTime() / 60000) + 30) * 60000);
  const isFixture = (f, view) => Array.isArray(f) && view.isEuropeanLeague(f) &&
    typeof f[13] === 'string' && f[13].includes('Sofia') &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(f[4] || '');

  function candidates(entry) {
    return entry.candidates.filter(p => p.eligible &&
      (p.family === 'total' || p.family === 'btts') && p.probability >= MIN_PROBABILITY);
  }

  function shortlist(evaluated, core, view, score = p => p.rank) {
    const strongest = evaluated.flatMap(entry => {
      const pick = candidates(entry)
        .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
      return pick ? [{entry, pick, key: core.keyFixture(entry.fixture)}] : [];
    }).sort((a, b) => score(b.pick) - score(a.pick) ||
      view.leagueOrder(a.entry.fixture) - view.leagueOrder(b.entry.fixture) ||
      a.key.localeCompare(b.key));

    const seen = new Set();
    const selected = [];
    for (const item of strongest) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      selected.push(item);
      if (selected.length === LIMIT) break;
    }
    return selected;
  }

  return {LIMIT, MIN_PROBABILITY, cutoff, isFixture, candidates, shortlist};
});
