const outcomes = { 'П': 'Победа', 'Р': 'Равенство', 'З': 'Загуба' };
const score = row => row.gf + ':' + row.ga;
const outcome = row => row.gf > row.ga ? 'П' : row.gf === row.ga ? 'Р' : 'З';
const effect = { 'П': 1, 'Р': 0, 'З': -1 };
const tone = { 'П': 'win', 'Р': 'draw', 'З': 'loss' };
const signed = n => n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0';

export function formView(match, escape, leagueNames, shortDay) {
  const entries = match.facts.form;
  if (!entries?.some(s => s.length)) return '';
  const teams = entries.map((games, i) => {
    const name = i ? match.away : match.home;
    let sum = 0;
    const points = games.map(game => {
      const tag = outcome(game);
      sum += effect[tag];
      return { ...game, tag, value: sum };
    });
    return { name, side: i ? 'away' : 'home', points };
  });
  const extent = Math.max(1, ...teams.flatMap(team => team.points.map(m => Math.abs(m.value))));
  const maxCount = Math.max(1, ...teams.map(team => team.points.length));
  const x = n => 4 + 92 * n / maxCount;
  const y = n => 50 - 40 * n / extent;
  const date = game => game.day ? shortDay(game.day) : '';
  const location = game => game.venue ? (game.venue === 'home' ? 'Домакин' : 'Гост') : '';
  const venue = game => [date(game), location(game), leagueNames[game.competition]?.name].filter(Boolean).join(' · ');
  const describe = (team, game) => [team.name + ' ' + score(game) + ' ' + game.opponent,
    outcomes[game.tag], venue(game)].filter(Boolean).join(' · ');
  const line = team => {
    if (!team.points.length) return '';
    const first = maxCount - team.points.length;
    const xy = team.points.map((game,i) => [x(first + i + 1), y(game.value)]);
    const series = [[x(first), 50], ...xy].map(p => p.join(',')).join(' ');
    const spots = xy.map(([left, top], j) => {
      const message = escape(describe(team, team.points[j]));
      return '<button type="button" class="trend-point' + (j === xy.length - 1 ? ' latest' : '') + '" style="--px:' + left + '%;--py:' + top +
        '%" data-form-message="' + message + '" aria-label="' + message + '" aria-pressed="false"></button>';
    }).join('');
    const shape = series + ' ' + x(maxCount) + ',50';
    return { path: '<polygon class="trend-area" fill="url(#form-fill-' + team.side + ')" points="' + shape + '"/>' +
      '<polyline class="trend-line ' + team.side + '" points="' + series + '"/>',
      spots: '<div class="trend-spots ' + team.side + '">' + spots + '</div>' };
  };
  const chart = teams.map(line).filter(Boolean);
  const gradients = '<defs><linearGradient id="form-fill-home" x1="0" x2="0" y1="0" y2="1">' +
    '<stop stop-color="#c9f87b" stop-opacity=".24"/><stop offset="1" stop-color="#c9f87b" stop-opacity=".03"/>' +
    '</linearGradient><linearGradient id="form-fill-away" x1="0" x2="0" y1="0" y2="1">' +
    '<stop stop-color="#75ddbe" stop-opacity=".2"/><stop offset="1" stop-color="#75ddbe" stop-opacity=".03"/>' +
    '</linearGradient></defs>';
  const ticks = [10, 30, 50, 70, 90].map(level => '<line class="' + (level === 50 ? 'trend-zero' : 'trend-grid') +
    '" x1="4" y1="' + level + '" x2="96" y2="' + level + '"/>').join('');
  const legend = teams.map(team => '<span class="trend-series ' + team.side + '"><i aria-hidden="true"></i>' +
    escape(team.name) + '<b>' + (team.points.length ? signed(team.points.at(-1).value) : '—') + '</b></span>').join('');
  const results = teams.map(team => {
    const shown = [...team.points].reverse().slice(0, 5);
    const record = shown.map(game => '<li class="recent-result"><span class="recent-tag ' + tone[game.tag] +
      '" aria-label="' + outcomes[game.tag] + '">' + game.tag + '</span><div class="recent-opponent"><b>' +
      escape(game.opponent) + '</b><small>' + escape(venue(game)) + '</small></div><b class="recent-score" aria-label="' +
      escape(team.name + ' ' + score(game) + ' ' + game.opponent) + '">' + score(game) + '</b></li>').join('');
    return '<div class="recent-team"><h4>' + escape(team.name) + '</h4>' +
      (record ? '<ol class="recent-list">' + record + '</ol>' : '<p class="muted">Няма налични резултати.</p>') + '</div>';
  }).join('');
  return '<section class="detail-section form-section"><h3>Движение на формата</h3>' +
    '<div class="trend-card"><div class="trend-legend">' + legend + '</div><div class="trend-chart"><div class="trend-axis" aria-hidden="true"><span>' +
    signed(extent) + '</span><span>0</span><span>' + signed(-extent) + '</span></div>' +
    '<div class="trend-surface"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
    gradients + ticks + chart.map(x => x.path).join('') + '</svg>' + chart.map(x => x.spots).join('') + '</div></div>' +
    '<div class="trend-order"><span>По-стари</span><span>Най-нови</span></div>' +
    '<p class="trend-feedback" role="status">Победа +1 · Равенство 0 · Загуба −1</p></div></section>' +
    '<section class="detail-section"><h3>Последни резултати</h3><p class="muted">Най-новите са първи. П · победа, Р · равенство, З · загуба.</p>' +
    '<div class="recent-teams">' + results + '</div></section>';
}

export function attachFormInteraction(root) {
  root.addEventListener('click', e => {
    const button = e.target.closest('[data-form-message]');
    if (!button) return;
    for (const point of root.querySelectorAll('[data-form-message]')) {
      point.setAttribute('aria-pressed', String(point === button));
    }
    root.querySelector('.trend-feedback').textContent = button.dataset.formMessage;
  });
}
