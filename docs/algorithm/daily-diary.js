export function selectionHit(key, score) {
  const [home, away] = score;
  return {
    over_2_5: home + away >= 3,
    under_2_5: home + away < 3,
    btts_yes: home > 0 && away > 0,
    btts_no: home === 0 || away === 0
  }[key];
}

export function dailyEntries(diary, previous = false) {
  if (!diary) return [];
  const results = new Map(diary.results.map(result => [result.id, result]));
  return diary.days.slice().reverse().flatMap(day => (previous ? day.comparison?.picks ?? [] : day.picks).map(pick => {
    const result = results.get(pick.id);
    const state = result?.score ? (selectionHit(pick.key, result.score) ? 'hit' : 'miss') :
      result?.void ? 'void' : 'pending';
    return { ...pick, day: day.day, captured: day.captured, version: day.version, rule: day.rule, result, state, paired: Boolean(day.comparison) };
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

export function dailyComparison(current, previous) {
  const days = new Map();
  for (const entry of current.filter(item => item.paired)) {
    if (!days.has(entry.day)) days.set(entry.day, { current: [], previous: [] });
    days.get(entry.day).current.push(entry);
  }
  for (const entry of previous) days.get(entry.day)?.previous.push(entry);
  const complete = [...days.values()].filter(day => day.current.length === day.previous.length &&
    [...day.current, ...day.previous].every(item => item.state === 'hit' || item.state === 'miss'));
  return {
    days: days.size,
    complete: complete.length,
    current: dailySummary(complete.flatMap(day => day.current)),
    previous: dailySummary(complete.flatMap(day => day.previous)),
  };
}
