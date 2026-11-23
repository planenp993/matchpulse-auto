const matchGoals = g => g.gf + g.ga;
const markets = {
  over_2_5: { hit: g => matchGoals(g) >= 3, seen: 'имаше поне три гола', streak: 'с поне три гола' },
  under_2_5: { hit: g => matchGoals(g) <= 2, seen: 'имаше най-много два гола', streak: 'с най-много два гола' },
  btts_yes: { hit: g => g.gf > 0 && g.ga > 0, seen: 'се разписаха и двата отбора', streak: 'с голове в двете врати' },
  btts_no: { hit: g => g.gf === 0 || g.ga === 0, seen: 'поне единият отбор остана без гол',
    streak: 'с поне един отбор без гол' }
};

function rate(games, yes) {
  return games.length < 3 ? null : [games.filter(yes).length, games.length];
}
const readCount = ([hit, n]) => hit + ' от ' + n;

export function marketFacts(match, key, pct, number) {
  const f = match.facts, p = match.probabilities;
  const teams = [match.home, match.away];
  const goalMarket = key.startsWith('btts_');
  const goals = match.expectedGoals ?? f.goals;
  const scoring = match.scoring ?? f.first;
  const facts = [];
  const trend = markets[key];
  const recent = (f.form ?? []).map(s => s.slice(-5));
  const atVenue = (f.form ?? []).map((s, i) => s.filter(m => m.venue === (i === 0 ? 'home' : 'away')).slice(-5));
  const bothScore = key === 'btts_yes';
  const probability = p[key];

  if (goalMarket && scoring) {
    const weak = scoring[0] <= scoring[1] ? 0 : 1;
    const probabilities = teams[0] + ' има ' + pct(scoring[0]) + ' шанс за гол, ' + teams[1] + ' — ' + pct(scoring[1]) + '.';
    const lead = key === 'btts_no' && probability > .50 ? 'По-несигурният гол е този на ' + teams[weak] + '. ' : '';
    facts.push(['Шанс за гол по отбори', lead + probabilities]);
  } else if (!goalMarket && goals) {
    const line = teams[0] + ' · ' + number(goals[0], 2) + ' гола, ' + teams[1] +
      ' · ' + number(goals[1], 2) + '. Общо ' + number(goals[0] + goals[1], 2) + ' според модела.';
    facts.push(['Очаквани голове', line]);
  }

  if (!trend) return facts;
  const counts = recent.map(s => rate(s, trend.hit));
  if (counts.length === 2 && counts.every(Boolean)) {
    facts.push(['Последни мачове', 'При ' + teams[0] + ' ' + trend.seen + ' в ' + readCount(counts[0]) +
      ' мача, а при ' + teams[1] + ' — в ' + readCount(counts[1]) + '.']);
  }

  if (atVenue.length === 2 && atVenue.every(x => x.length >= 3)) {
    const venues = ['домакинства', 'гостувания'];
    if (goalMarket) {
      const side = key === 'btts_no' && scoring && scoring[1] < scoring[0] ? 1 : 0;
      const own = atVenue[side], opp = atVenue[1 - side];
      const ownHit = rate(own, g => bothScore ? g.gf > 0 : g.gf === 0);
      const oppHit = rate(opp, g => bothScore ? g.ga > 0 : g.ga === 0);
      facts.push(['Домакинство и гостуване', teams[side] + (bothScore ? ' вкара в ' : ' остана без гол в ') +
        readCount(ownHit) + ' ' + venues[side] + '. ' + teams[1 - side] +
        (bothScore ? ' допусна гол в ' : ' запази суха мрежа в ') + readCount(oppHit) + ' ' + venues[1 - side] + '.']);
    } else {
      const records = atVenue.map(s => rate(s, trend.hit));
      facts.push(['Домакинство и гостуване', 'В ' + readCount(records[0]) + ' домакинства на ' + teams[0] +
        ' и в ' + readCount(records[1]) + ' гостувания на ' + teams[1] + ' ' + trend.seen + '.']);
    }
  }

  const runs = (f.form ?? []).map((s,i) => {
    let n = 0;
    for (const match of [...s].reverse()) {
      if (!trend.hit(match)) break;
      n++;
    }
    return { name: teams[i], n };
  }).filter(x => x.n >= 3);
  if (runs.length) facts.push(['Поредна серия', runs.map(row => row.name + ' е с ' + row.n +
    ' поредни мача ' + trend.streak + '.').join(' ')]);
  return facts;
}
