export function selectionHit(key, score) {
  const [home, away] = score;
  return {
    over_2_5: home + away >= 3,
    under_2_5: home + away < 3,
    btts_yes: home > 0 && away > 0,
    btts_no: home === 0 || away === 0
  }[key];
}

export function dailyEntries(diary) {
  if (!diary) return [];
  const results = new Map(diary.results.map(result => [result.id, result]));
  return diary.days.slice().reverse().flatMap(day => day.picks.map(pick => {
    const result = results.get(pick.id);
    const state = result?.score ? (selectionHit(pick.key, result.score) ? 'hit' : 'miss') :
      result?.void ? 'void' : 'pending';
    return { ...pick, day: day.day, captured: day.captured, version: day.version, rule: day.rule, result, state };
  }));
}

export function dailySummary(entries) {
  const settled = entries.filter(entry => entry.result?.score);
  const hits = settled.filter(entry => entry.state === 'hit').length;
  return {
    recorded: entries.length,
    settled: settled.length,
    hits,
    waiting: entries.filter(entry => entry.state === 'pending').length,
    quoted: entries.filter(entry => entry.price).length,
    expected: settled.length ? settled.reduce((sum, entry) => sum + entry.p, 0) / settled.length : null,
    rate: settled.length ? hits / settled.length : null
  };
}
