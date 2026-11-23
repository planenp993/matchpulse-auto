import { LEAGUES, LEAGUE_BY_ID, MARKETS, PRICE_BUFFER, SELECTION, eligibleForSelection, fairPrice, forecastVersion,
  priceFrom, selectDaily, sofiaDate, SOFIA } from './catalog.js?v=fc2d95be3c2c';

import { attachFormInteraction, formView } from './form-view.js?v=08c05a43670f';
import { marketFacts } from './market-facts.js?v=08c05a43670f';
import { dailyEntries, dailySummary } from './daily-diary.js?v=fc2d95be3c2c';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const format = (value, digits = 0) => new Intl.NumberFormat('bg-BG', {
  minimumFractionDigits: digits, maximumFractionDigits: digits
}).format(value);
const pct = (p, digits = 0) => format(100 * p, digits) + '%';
const roundText = round => ({'League phase':'Фаза на лигата','Play-offs':'Плейоф','Final':'Финал'}[round] || round);
const odds = p => p == null ? '—' : format(p, 2);
const local = (stamp, options) => new Intl.DateTimeFormat('bg-BG', { timeZone: SOFIA, ...options }).format(new Date(stamp));
const clock = t => local(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortDate = t => local(t, { day: 'numeric', month: 'short' });
const dateTime = t => shortDate(t) + ', ' + clock(t);
const noon = day => day + 'T12:00:00Z';
const names = { over_2_5: 'Над 2,5', under_2_5: 'Под 2,5', btts_yes: 'Гол/Гол Да', btts_no: 'Гол/Гол Не' };
const brief = names;
const stamp = m => m.date || sofiaDate(m.kickoff);
const tonight = () => sofiaDate(Date.now());
const publicFeed = document.querySelector('meta[name="prime-public-feed"]')?.content;
async function get(path, options) {
  const url = new URL(path, import.meta.url);
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(String(r.status));
  return url.pathname.endsWith('.gz')
    ? new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json() : r.json();
}
const initial = path => get(path + (publicFeed ? '.gz' : ''));
let live, archive, validation, europeValidation;
let day = tonight(), diaryMode = 'daily', diaryLimit = 30, updated = '';
let daily = [];
let refresh;
let activeTrigger;

function showView() {
  const view = ['matches', 'diary', 'coverage'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'matches';
  for (const id of ['matches', 'diary', 'coverage']) $(id).hidden = id !== view;
  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', showView);
showView();

function scheduleDays() {
  const nowDay = tonight();
  return [...new Set([nowDay, day, ...live.matches.map(stamp).filter(d => d >= nowDay)])].sort();
}
const selectionLeague = m => eligibleForSelection(m, validation, europeValidation);
function label(m) {
  const l = LEAGUE_BY_ID[m.league];
  return l.europe ? l.name : l.name + ' · ' + l.country;
}
function empty(text, next) {
  return '<div class="empty"><p>' + escape(text) + '</p>' + (next
    ? '<button type="button" class="button small" data-day="' + escape(next) + '">Мачове на ' + escape(shortDate(noon(next))) + '</button>' : '') + '</div>';
}
function matchRow(m, diary = false) {
  const show = diary ? '' : $('market-filter').value;
  const cells = (show ? [show] : ['over_2_5', 'btts_yes']).map(key =>
    '<span class="cell-market"><small>' + brief[key] + '</small><b>' + pct(m.probabilities[key], m.league === 'UEL' ? 1 : 0) + '</b></span>').join('');
  const when = diary ? (m.result ? m.result.join(':') : shortDate(noon(stamp(m)))) : clock(m.kickoff);
  return '<button type="button" class="match-button' + (show ? ' single' : '') + (diary ? ' diary-row' : '') +
    '" data-match="' + escape(m.id) + '" data-set="' + (diary ? diaryMode : 'live') +
    '" data-market="' + show + '"><span class="time">' + escape(when) + '</span>' +
    '<span class="teams"><strong>' + escape(m.home) + '</strong><i aria-hidden="true">–</i><strong>' + escape(m.away) +
    '</strong></span>' + cells + '<span class="open-match">Анализ</span></button>';
}
function grouped(rows, diary = false) {
  return LEAGUES.flatMap(l => {
    const children = rows.filter(m => m.league === l.id);
    if (!children.length) return [];
    return '<section class="fixture-group" aria-label="' + escape(l.name + ' ' + l.country) +
      '"><div class="group-title"><span class="land">' + l.countryCode + '</span><strong>' +
      escape(l.name) + '</strong><span>' + children.length + '</span></div>' +
      children.map(m => matchRow(m, diary)).join('') + '</section>';
  }).join('');
}
function pickCard(record) {
  const { m, key, p } = record;
  return '<button type="button" class="pick" data-set="' + (record.id ? 'daily' : 'live') +
    '" data-match="' + escape(record.id ?? m.id) + '" data-market="' + key + '">' +
    '<div class="pick-head"><span class="market-chip">' + names[key] + '</span><span class="pick-meta">' +
    escape(clock(m.kickoff)) + '</span></div><h3>' + escape(m.home + ' – ' + m.away) + '</h3>' +
    '<div class="pick-values"><b class="pick-p">' + pct(p) + '</b><span class="pick-k"><small>Честен</small><b>' +
    odds(record.fair ?? fairPrice(p)) + '</b></span><span class="pick-k"><small>Праг</small><b>' +
    odds(record.threshold ?? priceFrom(p)) + '+</b></span></div>' +
    '<div class="pick-footer"><span>' + escape(label(m)) + '</span><b>Анализ</b></div></button>';
}
function updateLeagueControls(data) {
  daily = dailyEntries(data.diary);
  for (const [id, include] of [['league-filter', new Set(data.matches.map(m => m.league))],
    ['diary-league', new Set([...archive.pilot, ...archive.replay, ...daily.map(pick => pick.m)].map(m => m.league))]]) {
    const filter = $(id), prev = filter.value;
    const available = LEAGUES.filter(l => include.has(l.id));
    const option = l => '<option value="' + l.id + '">' + escape(l.europe ? l.name : l.name + ' · ' + l.country) + '</option>';
    const euro = available.filter(l => l.europe);
    const domestic = available.filter(l => !l.europe);
    filter.innerHTML = '<option value="">Всички състезания</option>' +
      (euro.length ? '<optgroup label="Евротурнири">' + euro.map(option).join('') + '</optgroup>' : '') +
      (euro.length ? '<optgroup label="Първенства">' + domestic.map(option).join('') + '</optgroup>' : domestic.map(option).join(''));
    if (include.has(prev)) filter.value = prev;
  }
}
function renderMatches() {
  const now = Date.now();
  const upcoming = live.matches.filter(m => Date.parse(m.kickoff) > now);
  const today = tonight();
  const days = scheduleDays();
  const filter = $('league-filter').value;
  const fixtures = upcoming.filter(m => stamp(m) === day && (!filter || m.league === filter));
  const official = daily.filter(entry => entry.day === day);
  const picks = official.length ? official : selectDaily(upcoming.filter(m => stamp(m) === day && selectionLeague(m)));
  $('hero-leagues').textContent = new Set(upcoming.map(m => m.league)).size;
  $('hero-matches').textContent = upcoming.length;
  $('hero-capture').textContent = dateTime(live.calendarTime);
  $('dates').innerHTML = days.map(d => '<button type="button" class="day" data-day="' + d + '" aria-pressed="' +
    (d === day) + '"><b>' + (d === today ? 'Днес' : escape(shortDate(noon(d)))) +
    '</b><span>' + (d === today ? escape(shortDate(noon(d))) : escape(local(noon(d), { weekday: 'short' }))) +
    '</span></button>').join('');
  $('date-picker').value = day;
  const next = upcoming.find(m => stamp(m) > day && (!filter || m.league === filter));
  $('pick-caption').textContent = official.length ? 'Записан в ' + clock(official[0].captured) + ' ч.' :
    'Предварителен · Честен ' + odds(SELECTION.fairMin) + '–' + odds(SELECTION.fairMax);
  $('picks').innerHTML = picks.length ? picks.map(pickCard).join('') :
    empty(fixtures.length ? 'За този ден няма предложения в диапазона за подбора.' :
      'За тази дата няма предстоящи анализи.', next && stamp(next));
  $('match-count').textContent = fixtures.length + (fixtures.length === 1 ? ' предстоящ мач' : ' предстоящи мача') +
    ' · ' + shortDate(noon(day));
  $('fixture-list').innerHTML = fixtures.length ? grouped(fixtures) :
    empty('Избери друга дата или първенство.', next && stamp(next));
}
const metric = (value, name) => '<article class="metric"><strong>' + escape(value) + '</strong><small>' + escape(name) + '</small></article>';
const diaryOutcome = entry => ({ hit: 'Позната', miss: 'Пропуск', pending: 'Чака резултат', void: 'Изключена' })[entry.state];

function dailyRow(entry) {
  const { m, key, p, result } = entry;
  const score = result?.score ? ' · ' + result.score.join(':') : '';
  return '<button type="button" class="daily-entry" data-set="daily" data-match="' + escape(entry.id) +
    '" data-market="' + key + '"><span class="daily-teams"><strong>' + escape(m.home + ' – ' + m.away) +
    '</strong><small>' + escape(label(m)) + ' · ' + escape(clock(m.kickoff)) + '</small></span>' +
    '<span class="daily-market"><span class="market-chip">' + names[key] + '</span> <b>' + pct(p, 1) + '</b></span>' +
    '<span class="daily-prices">Честен <b>' + odds(entry.fair) + '</b> · Засечен <b>' + odds(entry.price?.selected) + '</b></span>' +
    '<span class="daily-outcome ' + entry.state + '">' + diaryOutcome(entry) + escape(score) + '</span></button>';
}

function renderDailyDiary(entries) {
  const stats = dailySummary(entries);
  $('diary-subtitle').textContent = 'Подборът се записва преди мачовете при първото обновяване за деня с подходящи срещи.';
  const measured = stats.settled ? '<p class="muted diary-readout">Среден шанс ' + pct(stats.expected, 1) +
    ' · Реални попадения ' + pct(stats.rate, 1) + (stats.quoted ? ' · Със засечен коефициент ' + stats.quoted : '') + '</p>' : '';
  $('diary-summary').innerHTML = metric(format(stats.recorded), 'Записани') +
    metric(stats.settled ? format(stats.hits) + ' от ' + format(stats.settled) : '—', 'Попадения') +
    metric(format(stats.waiting), 'Чакат резултат') + measured;
  const dates = new Map();
  for (const entry of entries.slice(0, diaryLimit)) {
    if (!dates.has(entry.day)) dates.set(entry.day, []);
    dates.get(entry.day).push(entry);
  }
  $('diary-list').innerHTML = [...dates].map(([date, picks]) => '<section class="fixture-group">' +
    '<div class="group-title"><strong>' + escape(local(noon(date), { day: 'numeric', month: 'long', year: 'numeric' })) +
    '</strong><span>Записан в ' + escape(clock(picks[0].captured)) + ' ч.</span></div>' + picks.map(dailyRow).join('') +
    '</section>').join('') || empty('Все още няма записан дневен подбор за този филтър.');
}

function renderDiary() {
  const filter = $('diary-league').value;
  const shown = diaryMode === 'daily' ? daily : archive[diaryMode].map(m => ({ ...m, result: live.settlements?.[m.id] ?? m.result }));
  const filtered = shown.filter(item => !filter || (item.m ?? item).league === filter);
  if (diaryMode === 'daily') {
    renderDailyDiary(filtered);
  } else if (diaryMode === 'replay') {
    $('diary-subtitle').textContent = 'Исторически тест с предмачови входове, 2023/24–2025/26.';
    $('diary-summary').innerHTML = metric(format(archive.totalBenchmarks), 'проверени мача') +
      metric('66,32%', 'V3 · 697 от 1 051 подбрани Над/Под 2,5') +
      metric('64,40%', 'V9b · 322 от 500 подбрани Гол/Гол Да');
  } else {
    const settled = shown.filter(m => m.result).length;
    $('diary-subtitle').textContent = 'Модел „Сходни защити“. Вероятности, записани преди началния час.';
    $('diary-summary').innerHTML = metric(format(shown.length), 'запечатани прогнози') +
      metric(format(settled), 'с проверен краен резултат') + metric(format(shown.length - settled), 'очакват резултат');
  }
  if (diaryMode !== 'daily') $('diary-list').innerHTML = filtered.length ? grouped(filtered.slice(0, diaryLimit), true) :
    empty('Няма мачове за този филтър.');
  $('diary-more-wrap').hidden = filtered.length <= diaryLimit;
  document.querySelectorAll('[data-diary]').forEach(b => b.setAttribute('aria-pressed', b.dataset.diary === diaryMode));
}
function renderCoverage() {
  const eligible = live.audit.filter(x => x.eligible && x.forecastCount > 0);
  const supporting = eligible.filter(x => !LEAGUE_BY_ID[x.id].core && selectionLeague({ league: x.id, model: 'results' }));
  $('coverage-caption').textContent = eligible.length + ' първенства с предстоящи анализи · данни към ' +
    dateTime(live.calendarTime) + ' ч.';
  $('coverage-method').innerHTML = '<p>Изискването е над 80% покритие и в двата периода. За допълнителните лиги броим резултат и четирите полета за удари. За топ 5 през текущия сезон броим двойката xG.</p>' +
    '<p>Топ 5 и ' + supporting.length + ' допълнителни лиги влизат в дневния подбор. За тях лиговият модел има по-ниска средна грешка за Над/Под и Гол/Гол в теста за 2025/26. Покритието измерва наличните данни.</p>';
  $('coverage-rows').innerHTML = live.audit.map(x => {
    const l = LEAGUE_BY_ID[x.id];
    const model = l.core ? 'Сходни защити' : x.forecastCount ? 'Лигов модел' : 'Изчаква данни';
    const curr = x.currentN ? pct(x.currentRatio, 1) : '—';
    const role = l.core ? 'Топ 5 · общо xG' : !x.forecastCount ? 'Под прага или без програма' :
      selectionLeague({ league: x.id, model: 'results' }) ? 'В дневния подбор' : 'Предварителен анализ';
    return '<tr' + (x.forecastCount ? '' : ' class="inactive"') + '><td><b>' + escape(l.name) + '</b><span>' +
      escape(l.country) + '</span></td><td><b' + (x.previousRatio > .8 ? ' class="good"' : '') + '>' +
      pct(x.previousRatio, 1) + '</b><span>' + x.previousShots + ' / ' + x.denominatorPrevious +
      '</span></td><td><b' + (x.currentRatio > .8 ? ' class="good"' : '') + '>' + curr +
      '</b><span>' + x.currentShots + ' / ' + x.currentN + (l.core ? ' xG' : '') + '</span></td><td>' +
      x.forecastCount + '<span>от ' + x.upcoming + ' в календара</span></td><td><b>' + escape(model) +
      '</b><span>' + escape(role) + '</span></td></tr>';
  }).join('');
  const euros = live.euroAudit ?? [];
  const count = euros.reduce((n, row) => n + row.upcoming, 0);
  const charts = live.matches.filter(m => m.model === 'europe' && Date.parse(m.kickoff) > Date.now());
  const sourceText = live.euroCached ? 'Последно потвърденият календар.' : 'Обявени срещи с отбори и начален час.';
  $('euro-caption').textContent = charts.length + ' предстоящи анализа. ' + sourceText + ' Резултатите са за 90 минути.';
  const ratio = (n, d) => Number.isInteger(n) && Number.isInteger(d) ? n + ' / ' + d : '—';
  $('euro-rows').innerHTML = euros.map(row => {
    const planned = charts.filter(m => m.league === row.id).length;
    const active = europeValidation[row.id]?.selected ? 'В дневния подбор' :
      row.id === 'UEL' ? 'Пробна оценка по мач' : 'Турнирна голова норма';
    const clocks = row.pending ? '<span>' + row.pending + ' двойки се уточняват</span>' : '';
    return '<tr><td><b>' + escape(LEAGUE_BY_ID[row.id].name) + '</b><span>' + active +
      '</span></td><td><b class="good">' + planned + '</b>' + clocks +
      '</td><td>' + ratio(row.previousResults, row.previousN) + '</td><td>' +
      ratio(row.currentResults, row.currentN) + '</td><td>' + ratio(row.xgN, row.xgDenom) + '</td></tr>';
  }).join('');
  $('euro-title').setAttribute('aria-label', 'Евротурнири · ' + count + ' обявени срещи в календара');
}
function render() {
  renderMatches();
  renderDiary();
  renderCoverage();
  $('footer-sync').textContent = updated || 'Календар към ' + dateTime(live.calendarTime) + ' ч.';
  $('notice').textContent = $('footer-sync').textContent;
}

function explain(m, market) {
  const list = marketFacts(m, market, pct, format);
  const signals = list.map(([label, text]) =>
    '<li><strong>' + escape(label) + '</strong><span>' + escape(text) + '</span></li>').join('');
  if (!signals) return '';
  return '<ul class="match-facts">' + signals + '</ul>' + (m.league === 'UEL'
    ? '<p class="muted uel-note">Пробна оценка за съперниците спрямо головата норма на Лига Европа.</p>' : '');
}

function modelContext(m) {
  const f = m.facts;
  const lines = [];
  if (f.ranks) lines.push(m.home + ' е ' + f.ranks[0] + '. в нашето предмачово класиране, а ' + m.away + ' е ' + f.ranks[1] + '.');
  if (f.xg) lines.push('Оценка за положенията · ' + format(f.xg[0], 2) + ' xG за ' + m.home + ' и ' +
    format(f.xg[1], 2) + ' за ' + m.away + '.');
  if (f.league) lines.push('Голова норма · ' + format(f.league[0], 2) + ' за домакина и ' +
    format(f.league[1], 2) + ' за госта' + (m.model === 'similar_defence' ? ' (xG)' : '') + '.');
  if (f.euroSample) lines.push('Изиграни срещи в европейския архив · ' + f.euroSample[0] + ' за ' +
    m.home + ' и ' + f.euroSample[1] + ' за ' + m.away + '.');
  return lines.length ? '<details class="model-notes"><summary>Числата зад прогнозата</summary>' +
    lines.map(line => '<p>' + escape(line) + '</p>').join('') + '</details>' : '';
}

function openMatch(trigger) {
  const dailyPick = trigger.dataset.set === 'daily' ? daily.find(entry => entry.id === trigger.dataset.match) : null;
  const list = trigger.dataset.set === 'live' ? live.matches : archive[trigger.dataset.set];
  const m = dailyPick?.m ?? list?.find(x => x.id === trigger.dataset.match);
  if (!m) return;
  activeTrigger = trigger;
  const p = m.probabilities;
  const recommended = trigger.dataset.market || [...MARKETS].sort((a, b) => p[b] - p[a])[0];
  const title = escape(m.home + ' – ' + m.away);
  const replay = m.model === 'retrospective';
  const result = dailyPick ? dailyPick.result?.score : live.settlements?.[m.id] ?? m.result;
  const t = m.kickoff ? dateTime(m.kickoff) + ' ч.' : shortDate(noon(m.date)) + ' ' + m.date.slice(0, 4);
  const tag = label(m) + ' · ' + t;
  const explanation = explain(m, recommended) + modelContext(m);
  const chance = (key, text) => '<span><small>' + text + '</small>' + pct(p[key]) + '</span>';
  const ref = m.quote ? '<section class="detail-section"><h3>Пазарен ориентир</h3><p>' + escape(m.quote.source) +
    ' · засечка от ' + escape(dateTime(m.quote.seen)) + ' ч. · Над ' + odds(m.quote.over) + ' / Под ' +
    odds(m.quote.under) + ' за линия 2,5.</p></section>' : '';
  const diaryDetail = dailyPick ? '<section class="detail-section"><h3>Запис в дневника</h3><p>' +
    escape(dateTime(dailyPick.captured)) + ' ч. · ' + escape(dailyPick.method) + ' · версия ' +
    escape(dailyPick.version.slice(0, 8)) + '</p><p>Засечен коефициент ' + odds(dailyPick.price?.selected) +
    (dailyPick.price ? ' · ' + escape(dailyPick.price.source) + ' · CSV от ' + escape(dateTime(dailyPick.price.seen)) + ' ч.' : '') +
    '</p><p>' + diaryOutcome(dailyPick) + (dailyPick.result?.score ? ' · ' + escape(dailyPick.result.source) :
      dailyPick.result?.void ? ' · ' + escape(dailyPick.result.void) : '') + '</p></section>' : '';
  $('detail').innerHTML = '<div class="detail-top"><div class="eyebrow accent">' + escape(tag) +
    '</div><h2 class="detail-title" id="detail-title">' + title + '</h2><p class="muted">' +
    escape(forecastVersion(m)) + (m.round ? ' · ' + escape(roundText(m.round)) : '') + (result ? ' · Краен резултат ' + result.join(':') : '') + '</p></div>' +
    '<div class="detail-summary"><b>' + names[recommended] + ' · ' + pct(p[recommended], 1) +
    '</b><p>Честен ' + odds(dailyPick?.fair ?? fairPrice(p[recommended])) + ' · праг за проверка ' +
    odds(dailyPick?.threshold ?? priceFrom(p[recommended])) + '+</p></div>' + diaryDetail +
    (explanation ? '<section class="detail-section match-why"><h3>Защо този избор</h3>' +
      explanation + '</section>' : '') +
    formView(m, escape, LEAGUE_BY_ID, day => shortDate(noon(day))) +
    '<section class="detail-section"><h3>Голови пазари</h3><table class="detail-odds"><thead><tr>' +
    '<th scope="col">Пазар</th><th scope="col">Шанс</th><th scope="col">Честен</th><th scope="col">Праг</th></tr></thead><tbody>' +
    MARKETS.map(key => '<tr' + (key === recommended ? ' class="active"' : '') + '><td>' + names[key] + '</td><td>' +
      pct(p[key], 1) + '</td><td>' + odds(fairPrice(p[key])) + '</td><td>' + odds(priceFrom(p[key])) +
      '+</td></tr>').join('') +
    '</tbody></table><p class="status-line">Прагът за проверка включва пилотен резерв от ' +
    pct(dailyPick?.rule.buffer ?? PRICE_BUFFER) + ' над честния коефициент.</p></section>' +
    ref + '<section class="detail-section"><h3>Краен резултат</h3><div class="chances">' +
    chance('home', '1') + chance('draw', 'Х') + chance('away', '2') + '</div></section>' +
    '<section class="detail-section"><h3>Двоен шанс</h3><div class="chances">' + chance('home_or_draw', '1Х') +
    chance('draw_or_away', 'Х2') + chance('home_or_away', '12') + '</div></section>' +
    (m.scorelines?.length ? '<section class="detail-section"><h3>Най-вероятни резултати</h3><div class="scores">' +
      m.scorelines.map(x => '<span>' + x.h + ':' + x.a + ' · ' + pct(x.p, 1) + '</span>').join('') +
      '</div></section>' : '') + '<p class="status-line">' + escape(m.source) +
    (!replay && m.issued ? ' · изчислено на ' + escape(dateTime(m.issued)) + ' ч.' : '') + '</p>';
  $('match-dialog').showModal();
}

function requestUpdate() {
  if ((!refresh && !publicFeed) || $('refresh').disabled) return;
  $('refresh').disabled = true;
  $('refresh').textContent = 'Обновяване…';
  if (publicFeed) {
    get(publicFeed, { cache: 'no-cache' }).then(snapshot => {
      if (!Array.isArray(snapshot.matches) || !Array.isArray(snapshot.euroAudit) || snapshot.version !== live.version ||
          !Number.isFinite(Date.parse(snapshot.asOf)) || Date.parse(snapshot.asOf) > Date.now() + 60_000 ||
          Date.parse(snapshot.asOf) < Date.parse(live.asOf)) throw new Error('Невалидно обновяване');
      finishRefresh({ status: snapshot.asOf === live.asOf ? 'unchanged' : 'updated', snapshot });
    }).catch(() => finishRefresh({ status: 'error' }));
    return;
  }
  refresh.postMessage({ xgTime: live.xgTime, calendarTime: live.calendarTime,
    pilot: archive.pilot, previous: live.matches, euroAudit: live.euroAudit ?? [], euroCached: live.euroCached });
}

function finishRefresh(data) {
  $('refresh').disabled = false;
  $('refresh').textContent = 'Обнови';
  if (data.status === 'updated') {
    live = data.snapshot;
    updateLeagueControls(live);
    updated = 'Обновен календар · ' + dateTime(live.calendarTime) + ' ч.';
  } else if (data.status === 'error') {
    updated = 'Последна налична снимка · ' + dateTime(live.calendarTime) + ' ч.';
  } else {
    updated = 'Календар към ' + dateTime(live.calendarTime) + ' ч.';
  }
  render();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !live) return;
  if (button.dataset.day) {
    day = button.dataset.day;
    renderMatches();
    [...$('dates').children].find(b => b.dataset.day === day)?.focus({ preventScroll: true });
  }
  if (button.dataset.match) openMatch(button);
  if (button.dataset.diary) { diaryMode = button.dataset.diary; diaryLimit = 30; renderDiary(); }
});
attachFormInteraction($('detail'));
$('match-dialog').addEventListener('click', e => { if (e.target === $('match-dialog')) $('match-dialog').close(); });
$('match-dialog').addEventListener('close', () => activeTrigger?.focus());
$('refresh').addEventListener('click', requestUpdate);
$('date-picker').addEventListener('change', e => { if (e.target.value) { day = e.target.value; renderMatches(); } });
$('league-filter').addEventListener('change', renderMatches);
$('market-filter').addEventListener('change', renderMatches);
$('diary-league').addEventListener('change', () => { diaryLimit = 30; renderDiary(); });
$('diary-more').addEventListener('click', () => { diaryLimit += 30; renderDiary(); });
Promise.all([initial('./data/snapshot.json'), initial('./data/archive.json'), get('./data/extra-models.json'), get('./data/europe-models.json')])
  .then(([snapshot, archiveData, models, euroModels]) => {
    live = snapshot;
    archive = archiveData;
    validation = models;
    europeValidation = euroModels;
    updateLeagueControls(live);
    render();
    if (!publicFeed) {
      refresh = new Worker(new URL('./refresh-worker.js?v=08c05a43670f', import.meta.url), { type: 'module' });
      refresh.onmessage = e => finishRefresh(e.data);
      refresh.onerror = () => finishRefresh({ status: 'error' });
    }
    requestUpdate();
    setInterval(() => { if (!document.hidden) requestUpdate(); }, 20 * 60_000);
  }).catch(() => { $('picks').innerHTML = empty('Прогнозите временно са недостъпни. Обнови страницата.'); });
