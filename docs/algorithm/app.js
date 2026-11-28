import { DELAY_AFTER, loadSnapshot } from './refresh-state.js?v=ad7cbaff7250';
import { MIN_LEAD } from './core.js?v=d017cb640a6f';
import { LEAGUES, LEAGUE_BY_ID, MARKETS, PRICE_BUFFER, PRICE_WINDOW, SELECTION, dailySelectionPool, eligibleForSelection, europeanSelectionReview,
  fairPrice, forecastVersion, orderDaily, priceFrom, selectionMatch, sofiaDate, SOFIA } from './catalog.js?v=9880ec988a17';

import { attachFormInteraction, formView } from './form-view.js?v=46eb13c524af';
import { marketFacts } from './market-facts.js?v=08c05a43670f';
import { dailyComparison, dailyEntries, dailySummary } from './daily-diary.js?v=f24b26c50906';
import { FIRST_DAY, calendarRows, forecastMarkets, marketOutcome, shiftDay, validCalendarDay, validCalendarIndex } from './calendar-view.js?v=269732adda9d';
import { availableQuote, evaluatePrice, parseOdds, qualifyingPrices } from './value-check.js?v=0eece3b97e02';
import { createPrimeValueView } from './prime-value-view.js?v=8a233c2e1c8a';
import { conditionalPriceSelection } from './conditional-prices.js?v=977ae7720d83';

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
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000), ...options });
  if (!r.ok) throw new Error(String(r.status));
  if (!url.pathname.endsWith('.gz')) return r.json();
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const snapshotPath = './data/snapshot.json' + (publicFeed ? '.gz' : '');
const fetchSnapshot = previous => loadSnapshot(path => get(path, { cache: 'no-store', signal: AbortSignal.timeout(12_000) }),
  snapshotPath, publicFeed, Date.now(), previous);
async function reference(path) {
  try { return await get('./data/' + path); }
  catch (error) {
    if (!publicFeed) throw error;
    return get(new URL(path, publicFeed));
  }
}
const historicalArchive = () => reference('archive.json' + (publicFeed ? '.gz' : ''));
async function loadCalendarIndex() {
  const path = 'match-history/index.json';
  for (const url of ['./data/' + path, publicFeed && new URL(path, publicFeed)].filter(Boolean)) {
    try {
      const index = await get(url, { cache: 'no-store' });
      if (validCalendarIndex(index)) return index;
    } catch {}
  }
  return null;
}
let live, archive, validation, europeValidation;
let calendarIndex, calendarError = false, visibleCalendar = [];
const calendarCache = new Map(), calendarLoading = new Set(), calendarFailures = new Set();
const typedPrices = new Map();
let valueRows = [];
let day = tonight(), diaryMode = 'daily', diaryLimit = 30, updated = '';
let daily = [], previousDaily = [], previewPicks = [];
let conditionalRows = [];
let lastToday = day;
let lastRequest = 0;
let activeTrigger;

async function loadValueState() {
  const path = 'prime-value/state.json';
  for (const url of ['./data/' + path, publicFeed && new URL(path, publicFeed)].filter(Boolean)) {
    try { return await get(url, { cache: 'no-store' }); } catch {}
  }
  throw new Error('Prime Value unavailable');
}
const primeValueView = createPrimeValueView({
  getContext: () => ({ snapshot: live, fitted: validation, euroFitted: europeValidation }),
  loadPublic: loadValueState,
  loadDay: async selected => {
    const meta = calendarIndex?.days[selected];
    if (!meta || selected > tonight()) return null;
    const key = selected + '/' + meta.sha256;
    if (calendarCache.has(key)) return calendarCache.get(key);
    const bucket = await reference('match-history/' + selected + '.json.gz?v=' + meta.sha256.slice(0,12));
    if (!validCalendarDay(bucket,selected,meta)) return null;
    return bucket;
  }
});

function showView() {
  const hash = location.hash.slice(1);
  const view = hash === 'sources' ? 'coverage' : ['matches', 'value', 'diary', 'coverage'].includes(hash) ? hash : 'matches';
  for (const id of ['matches', 'value', 'diary', 'coverage']) $(id).hidden = id !== view;
  if (view === 'value' && live) void primeValueView.refresh();
  if (hash === 'sources') {
    $('sources').open = true;
    requestAnimationFrame(() => $('sources').scrollIntoView({block: 'start'}));
  }
  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', showView);
showView();

function scheduleDays() {
  const first = shiftDay(day, -2) < FIRST_DAY ? FIRST_DAY : shiftDay(day, -2);
  return Array.from({ length: 8 }, (_, i) => shiftDay(first, i));
}
function readCalendarDay(selected) {
  if (!calendarIndex || selected > tonight()) return null;
  const meta = calendarIndex.days[selected];
  if (!meta) return null;
  const key = selected + '/' + meta.sha256;
  if (calendarCache.has(key)) return calendarCache.get(key);
  if (!calendarLoading.has(key) && !calendarFailures.has(key)) {
    calendarLoading.add(key);
    reference('match-history/' + selected + '.json.gz?v=' + meta.sha256.slice(0, 12))
      .then(bucket => {
        if (!validCalendarDay(bucket, selected, meta)) throw new Error('Archive changed');
        calendarCache.set(key, bucket);
        if (calendarCache.size > 12) calendarCache.delete(calendarCache.keys().next().value);
      })
      .catch(() => calendarFailures.add(key))
      .finally(() => {
        calendarLoading.delete(key);
        if (day === selected) renderMatches();
      });
  }
  return null;
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
  const historical = !diary && m.calendarState !== 'upcoming';
  const final = historical && m.calendarState === 'final';
  const keys = show ? [show] : historical && m.probabilities ? forecastMarkets(m.probabilities) : ['over_2_5', 'btts_yes'];
  const cells = m.probabilities ? keys.map(key => {
    const outcome = final && !m.resultConflict ? marketOutcome(key, m.result) : null;
    return '<span class="cell-market' + (outcome === null ? '' : outcome ? ' result-hit' : ' result-miss') + '"><small>' +
      brief[key] + '</small><b>' + pct(m.probabilities[key], m.league === 'UEL' ? 1 : 0) + '</b>' +
      (outcome === null ? '' : '<span class="result-mark" aria-label="' + (outcome ? 'Пазарът се е случил' : 'Пазарът не се е случил') +
        '">' + (outcome ? '✓' : '×') + '</span>') + '</span>';
  }).join('') : '<span class="cell-market no-forecast"><small>Няма запазена<br>прогноза</small></span>';
  const when = diary ? (m.result ? m.result.join(':') : shortDate(noon(stamp(m)))) :
    final ? m.result.join(':') : m.kickoff ? clock(m.kickoff) : '—';
  const badge = final ? '<small>' + (m.resultConflict ? 'СВЕРИ' : 'КРАЕН') + '</small>' : historical ? '<small>ЧАКА</small>' : '';
  return '<button type="button" class="match-button' + (show ? ' single' : '') + (diary ? ' diary-row' : '') +
    (historical ? ' historical-row' : '') + (final ? ' final-row' : '') + (!m.probabilities ? ' without-forecast' : '') +
    '" data-match="' + escape(m.id) + '" data-set="' + (diary ? diaryMode : 'calendar') +
    '" data-market="' + show + '"><span class="time">' + escape(when) + badge + '</span>' +
    '<span class="teams"><strong>' + escape(m.home) + '</strong><i aria-hidden="true">–</i><strong>' + escape(m.away) +
    '</strong></span>' + cells + '<span class="open-match">' + (m.probabilities ? 'Анализ' : 'Резултат') + '</span></button>';
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
function reviewText(check, p) {
  if (check.reason === 'domestic') return 'Липсва свързана местна история за ' + check.missing.join(' и ') + '.';
  if (check.reason === 'price') return 'Няма потвърдени коефициенти и за двете страни на пазара през последния час.';
  const gap = Math.abs(p - check.marketProbability) * 100;
  return 'Разлика с пазара ' + format(gap, 1) + ' пр. п. · Пазар без маржа ' + pct(check.marketProbability, 1) + '.';
}
function pickCard(record) {
  const { m, key, p } = record;
  const set = record.id ? 'daily' : record.check ? 'selection-review' : 'selection-live';
  return '<button type="button" class="pick" data-set="' + set +
    '" data-match="' + escape(record.id ?? m.id) + '" data-market="' + key + '">' +
    '<div class="pick-head"><span class="market-chip">' + names[key] + '</span><span class="pick-meta">' +
    escape(record.result?.score ? record.result.score.join(':') + ' · ' + diaryOutcome(record) : clock(m.kickoff)) +
    '</span></div><h3>' + escape(m.home + ' – ' + m.away) + '</h3>' +
    '<div class="pick-values"><b class="pick-p">' + pct(p) + '</b><span class="pick-k"><small>Честен</small><b>' +
    odds(record.fair ?? fairPrice(p)) + '</b></span><span class="pick-k"><small>Мин. цена</small><b>' +
    odds(record.threshold ?? priceFrom(p)) + '+</b></span></div>' +
    '<div class="pick-footer"><span>' + escape(label(m)) + '</span><b>Анализ</b></div>' +
    (record.check ? '<p class="review-note">' + escape(reviewText(record.check, p)) + '</p>' : '') +
    (!record.check && day >= tonight() && Date.parse(m.kickoff) > Date.now() ?
      '<p class="pick-price-note">' + (availableQuote(record, Date.now()) ?
        'Засечен: ' + odds(availableQuote(record, Date.now()).selected) : 'Без потвърден актуален коефициент') + '</p>' : '') + '</button>';
}
function updateLeagueControls(data) {
  daily = dailyEntries(data.diary);
  previousDaily = dailyEntries(data.diary, true);
  for (const [id, include] of [['league-filter', new Set(LEAGUES.map(l => l.id))],
    ['diary-league', new Set([...archive.pilot, ...archive.replay, ...[...daily, ...previousDaily].map(pick => pick.m)].map(m => m.league))]]) {
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

const valueKey = ({ m, key }) => m.id + '|' + m.kickoff + '|' + key;
function priceLabel(row) {
  const { state, ev } = row.assessment;
  if (state === 'unknown') return 'Нужна е реална цена';
  const estimate = (ev > 0 ? '+' : '') + pct(ev, 1);
  return (state === 'negative' ? 'Под честния' : state === 'below' ? 'Под прага' : 'Покрива прага') +
    ' · моделно ' + estimate;
}
function assessValueRow(row, supplied) {
  row.assessment = evaluatePrice(row.candidate.p, supplied);
}
function renderValueSummary() {
  const now = Date.now();
  const active = now - Date.parse(live.asOf) <= DELAY_AFTER
    ? valueRows.filter(row => Date.parse(row.candidate.m.kickoff) - now >= MIN_LEAD) : [];
  const selected = qualifyingPrices(active);
  const checked = valueRows.filter(row => row.assessment.state !== 'unknown').length;
  $('value-summary').innerHTML = '<strong>' + selected.length + ' от максимум 3 покриват моделния праг</strong><span class="muted"> · Въведени/засечени цени ' +
    checked + '/' + valueRows.length + '</span>' + (selected.length
    ? '<div class="value-qualified">' + selected.map(({ candidate, assessment }) =>
      '<div><b>' + escape(candidate.m.home + ' – ' + candidate.m.away) + '</b><small>' + names[candidate.key] +
      ' · ' + odds(assessment.price) + ' · моделно +' + pct(assessment.ev, 1) + '</small></div>').join('') + '</div>'
    : '<p class="muted">Няма потвърдена от въведените цени стойност над прага. Не допълваме насила до три.</p>');
}
function renderValueReview(official, eligible, delayed, now) {
  const visible = day === tonight() && !delayed;
  $('value-review').hidden = !visible;
  if (!visible) { valueRows = []; return; }
  const activeMatch = record => live.matches.some(m => m.id === record.m.id && m.kickoff === record.m.kickoff);
  const candidates = [...official.filter(record => Date.parse(record.m.kickoff) - now >= MIN_LEAD && activeMatch(record)),
    ...orderDaily(eligible, true, eligible.length)];
  const seen = new Set();
  valueRows = candidates.flatMap(candidate => {
    const id = valueKey(candidate);
    if (seen.has(id)) return [];
    seen.add(id);
    const liveMatch = live.matches.find(m => m.id === candidate.m.id && m.kickoff === candidate.m.kickoff);
    const quote = availableQuote({ ...candidate, m: liveMatch ?? candidate.m }, now) ?? availableQuote(candidate, now);
    const typed = typedPrices.get(id);
    const manual = typed && now - typed.at <= PRICE_WINDOW && typed.at <= now ? typed : null;
    const supplied = manual ? manual.text : quote?.selected ?? '';
    const row = { id, candidate, quote, manual, supplied };
    assessValueRow(row, supplied);
    return [row];
  });
  $('value-list').innerHTML = valueRows.map((row, i) => {
    const { candidate, quote, manual, supplied, assessment } = row;
    return '<article class="value-row"><div class="value-match"><b>' + escape(candidate.m.home + ' – ' + candidate.m.away) +
      '</b><small>' + escape(label(candidate.m)) + ' · ' + clock(candidate.m.kickoff) + '</small><small>' +
      names[candidate.key] + ' · ' + pct(candidate.p, 1) + ' · минимум <b>' + odds(assessment.threshold) +
      '</b></small></div><label class="value-field"><span>Реален коеф.</span><input type="text" inputmode="decimal" autocomplete="off" ' +
      'placeholder="—" data-price-row="' + i + '" aria-label="' +
      escape('Реален коефициент: ' + candidate.m.home + ' – ' + candidate.m.away + ' · ' + names[candidate.key]) +
      '" value="' + escape(String(supplied).replace('.', ',')) + '"><small data-price-source="' + i + '">' +
      (manual ? 'Въведен от теб' : quote ? escape(quote.source + ' · ' + clock(quote.seen)) : 'Няма засечка') +
      '</small></label><span class="value-status ' + assessment.state + '" data-price-status="' + i + '">' +
      escape(priceLabel(row)) + '</span></article>';
  }).join('') || '<p class="muted">Няма предстоящи допустими кандидати с поне 90 минути до началото.</p>';
  renderValueSummary();
}

function renderConditionalPrices(now) {
  const result = conditionalPriceSelection({ snapshot: live, fitted: validation, day, now });
  const visible = result.status === 'ready';
  $('conditional-prices').hidden = !visible;
  conditionalRows = visible ? result.rows : [];
  if (!visible) return;
  const scope = result.scope === 'top5' ? 'Топ 5' : result.scope === 'other' ? 'Други одобрени първенства · няма кандидат в топ 5' : 'Без подходящ кандидат';
  $('conditional-caption').textContent = scope + ' · Проверени ' + result.checked + ' · Моделна минимална цена до 2,00: ' + result.qualified;
  $('conditional-list').innerHTML = conditionalRows.map(({ m, key, p, floor }) =>
    '<button type="button" class="conditional-row" data-set="selection-conditional" data-match="' + escape(m.id) +
    '" data-market="' + key + '" data-floor="' + floor.toFixed(2) + '"><span class="conditional-match"><strong>' +
    escape(m.home + ' – ' + m.away) + '</strong><small>' + escape(label(m)) + ' · ' + clock(m.kickoff) +
    ' · ' + names[key] + '</small></span><span class="conditional-prob"><b>' + pct(p, 1) +
    '</b><small>Prime</small></span><span class="conditional-floor"><b>' + odds(floor) +
    '+</b><small>Мин. цена</small></span></button>').join('') ||
    '<p class="empty">Няма предстоящ мач, който покрива условния диапазон. Не допълваме насила до три.</p>';
}

function renderMatches() {
  const now = Date.now();
  const upcoming = live.matches.filter(m => Date.parse(m.kickoff) > now);
  const today = tonight();
  if (today !== lastToday && day === lastToday) day = today;
  lastToday = today;
  const days = scheduleDays();
  const filter = $('league-filter').value;
  const bucket = readCalendarDay(day);
  visibleCalendar = calendarRows(bucket, live, day, now);
  const fixtures = visibleCalendar.filter(m => !filter || m.league === filter);
  const official = daily.filter(entry => entry.day === day);
  const delayed = now - Date.parse(live.asOf) > DELAY_AFTER;
  const available = upcoming.filter(m => stamp(m) === day && selectionLeague(m) && Date.parse(m.kickoff) - now >= MIN_LEAD);
  const { eligible, review } = dailySelectionPool(available, now);
  previewPicks = official.length || delayed ? [] : orderDaily(eligible, true);
  const picks = official.length ? official : previewPicks;
  $('selection-review').hidden = delayed || !review.length;
  $('selection-review-title').textContent = 'За проверка · ' + review.length;
  $('review-picks').innerHTML = delayed ? '' : orderDaily(review, true, review.length).map(pickCard).join('');
  $('hero-leagues').textContent = new Set(upcoming.map(m => m.league)).size;
  $('hero-matches').textContent = upcoming.length;
  $('hero-capture').textContent = dateTime(live.asOf);
  $('forecast-delay').hidden = !delayed;
  $('forecast-delay').textContent = delayed ? 'Обновяването закъснява. Последните прогнози са изчислени на ' +
    dateTime(live.asOf) + ' ч.' : '';
  $('dates').innerHTML = days.map(d => '<button type="button" class="day" data-day="' + d + '" aria-pressed="' +
    (d === day) + '"><b>' + (d === today ? 'Днес' : escape(shortDate(noon(d)))) +
    '</b><span>' + (d === today ? escape(shortDate(noon(d))) : escape(local(noon(d), { weekday: 'short' }))) +
    '</span></button>').join('');
  $('previous-day').disabled = day <= FIRST_DAY;
  $('date-picker').min = FIRST_DAY;
  $('date-picker').value = day;
  const activeDate = $('dates').querySelector('[aria-pressed="true"]');
  if (activeDate && (activeDate.offsetLeft < $('dates').scrollLeft ||
      activeDate.offsetLeft + activeDate.offsetWidth > $('dates').scrollLeft + $('dates').clientWidth))
    $('dates').scrollLeft = activeDate.offsetLeft - 6;
  $('calendar-caption').textContent = 'Архив от 23.11.2026 г. · Последната запазена предмачова прогноза и резултат за 90 минути.';
  const next = upcoming.find(m => stamp(m) > day && (!filter || m.league === filter));
  const captureLabel = 'Записан в дневника';
  const trialPrefix = picks.some(record => record.m.trialMarket) ? 'Пробен резерв · ' : '';
  $('pick-caption').textContent = trialPrefix + (official.length ? captureLabel + ' · ' + clock(official[0].captured) + ' ч.' :
    'Предварителен · Честен ' + odds(SELECTION.fairMin) + '–' + odds(SELECTION.fairMax));
  if (day >= today) $('pick-caption').textContent += ' · Подбор по модел';
  let reason = 'За тази дата няма предстоящи анализи.';
  if (upcoming.some(m => stamp(m) === day)) {
    reason = available.length
      ? 'Брой проверени мачове за подбора · ' + available.length + '. Няма подходящ пазар с честен коефициент от 1,70 до 2,00.'
      : 'За подбора са нужни одобрено първенство и поне 90 минути до началото.';
  }
  if (review.length && !eligible.length) reason = 'Кандидатите за деня са в „За проверка“.';
  if (delayed) reason = 'Предварителният подбор ще се покаже при следващото успешно обновяване.';
  $('picks').innerHTML = picks.length ? picks.map(pickCard).join('') : empty(day < today ? 'Няма записан дневен подбор.' : reason,
    day < today ? null : next && stamp(next));
  renderConditionalPrices(now);
  renderValueReview(official, eligible, delayed, now);
  const finished = fixtures.filter(m => m.calendarState === 'final').length;
  const pending = fixtures.filter(m => m.calendarState === 'pending').length;
  const future = fixtures.length - finished - pending;
  const count = [finished && finished + ' приключили', pending && pending + ' чакат резултат',
    future && future + ' предстоящи'].filter(Boolean).join(' · ') || '0 мача';
  $('match-count').textContent = count + ' · ' + shortDate(noon(day));
  const calendarMeta = calendarIndex?.days[day];
  const failed = calendarMeta && calendarFailures.has(day + '/' + calendarMeta.sha256);
  const loading = day <= today && calendarMeta && !bucket && !failed;
  const notice = day <= today && (calendarError || failed)
    ? '<p class="muted archive-note">Архивът временно не е достъпен. Натисни „Обнови“.</p>'
    : loading ? '<p class="muted archive-note" role="status">Зареждане на приключилите мачове…</p>'
    : finished ? '<p class="muted archive-note">✓ Пазарът се е случил · × Не се е случил · Процентите са предмачови.</p>' : '';
  $('fixture-list').innerHTML = notice + (fixtures.length ? grouped(fixtures) :
    loading || calendarError && day <= today || failed ? '' : empty('Няма мачове за тази дата или първенство.', next && stamp(next)));
}
const metric = (value, name) => '<article class="metric"><strong>' + escape(value) + '</strong><small>' + escape(name) + '</small></article>';
const diaryOutcome = entry => ({ hit: 'Позната', miss: 'Пропуск', pending: 'Чака резултат', void: 'Изключена' })[entry.state];

function dailyRow(entry, previous = false) {
  const { m, key, p, result } = entry;
  const score = result?.score ? ' · ' + result.score.join(':') : '';
  return '<button type="button" class="daily-entry" data-set="' + (previous ? 'daily-previous' : 'daily') + '" data-match="' + escape(entry.id) +
    '" data-market="' + key + '"><span class="daily-teams"><strong>' + escape(m.home + ' – ' + m.away) +
    '</strong><small>' + escape(label(m)) + ' · ' + escape(clock(m.kickoff)) + (m.trialMarket ? ' · Пробен резерв' : '') + '</small></span>' +
    '<span class="daily-market"><span class="market-chip">' + names[key] + '</span> <b>' + pct(p, 1) + '</b></span>' +
    '<span class="daily-prices">Честен <b>' + odds(entry.fair) + '</b> · Засечен <b>' + odds(entry.price?.selected) + '</b></span>' +
    '<span class="daily-outcome ' + entry.state + '">' + diaryOutcome(entry) + escape(score) + '</span></button>';
}

function renderDailyDiary(entries, controls) {
  const stats = dailySummary(entries);
  $('diary-subtitle').textContent = 'Всеки избор се записва преди началото. Успеваемостта се смята само за мачове с потвърден резултат.';
  const hitRate = stats.settled ? pct(stats.rate, 1) : '—';
  const sample = stats.hits + ' от ' + stats.settled + ' приключили';
  $('diary-summary').innerHTML = metric(hitRate, sample) +
    metric(format(stats.recorded), 'Записани избора') + metric(format(stats.waiting), 'Чакат резултат');
  if (live.selectionVersion && !$('diary-league').value) {
    const paired = dailyComparison(daily, previousDaily);
    const compare = row => row.hits + '/' + row.settled;
    const detail = paired.complete
      ? 'С положения ' + compare(paired.current) + ' · само Prime ' + compare(paired.previous) +
          ' · ' + paired.complete + ' завършени дни.'
      : 'Изчакваме първия ден с крайни резултати за всички избори и на двата варианта.';
    $('diary-summary').innerHTML += '<p class="muted diary-readout">Сравнение на двата подбора за едни и същи дни. ' +
      escape(detail) + '</p>';
  }
  const dates = new Map();
  for (const [key, choices] of [['main', entries], ['control', controls]]) {
    for (const entry of choices) {
      if (!dates.has(entry.day)) dates.set(entry.day, { main: [], control: [] });
      dates.get(entry.day)[key].push(entry);
    }
  }
  const shownDays = Math.ceil(diaryLimit / SELECTION.count);
  $('diary-list').innerHTML = [...dates.keys()].sort().reverse().slice(0, shownDays).map(date => {
    const { main, control } = dates.get(date);
    const first = main[0] ?? control[0];
    const badge = first.paired ? 'С положения' : 'Предишен подбор';
    const alternative = control.length ? '<details class="daily-previous"><summary>Предишен подбор · ' +
      control.length + '</summary>' + control.map(entry => dailyRow(entry, true)).join('') + '</details>' : '';
    return '<section class="fixture-group"><div class="group-title"><strong>' +
      escape(local(noon(date), { day: 'numeric', month: 'long', year: 'numeric' })) +
      '</strong><span>' + badge + ' · ' + escape(clock(first.captured)) + ' ч.</span></div>' +
      (main.length ? main.map(entry => dailyRow(entry)).join('') :
        '<p class="muted daily-filter-empty">С този филтър има мачове в предишния подбор.</p>') +
      alternative + '</section>';
  }).join('') || empty('Все още няма записан дневен подбор за този филтър.');
  return dates.size > shownDays;
}

function renderDiary() {
  const filter = $('diary-league').value;
  const included = item => !filter || (item.m ?? item).league === filter;
  const shown = diaryMode === 'daily' ? daily : archive[diaryMode].map(m => ({ ...m, result: live.settlements?.[m.id] ?? m.result }));
  const filtered = shown.filter(included);
  let hasMore = filtered.length > diaryLimit;
  if (diaryMode !== 'daily' && archive.unavailable) {
    $('diary-subtitle').textContent = 'Архивните прогнози временно са недостъпни.';
    $('diary-summary').innerHTML = '';
    $('diary-list').innerHTML = empty('Натисни „Обнови“ за нова проверка на архива.');
    $('diary-more-wrap').hidden = true;
    document.querySelectorAll('[data-diary]').forEach(b => b.setAttribute('aria-pressed', b.dataset.diary === diaryMode));
    return;
  }
  if (diaryMode === 'daily') {
    hasMore = renderDailyDiary(filtered, previousDaily.filter(included));
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
  $('diary-more-wrap').hidden = !hasMore;
  document.querySelectorAll('[data-diary]').forEach(b => b.setAttribute('aria-pressed', b.dataset.diary === diaryMode));
}

function renderCoverage() {
  const eligible = live.audit.filter(x => x.eligible && x.forecastCount > 0);
  const supporting = eligible.filter(x => !LEAGUE_BY_ID[x.id].core && selectionLeague({ league: x.id, model: 'results' }));
  $('coverage-caption').textContent = eligible.length + ' първенства с предстоящи анализи · данни към ' +
    dateTime(live.calendarTime) + ' ч.';
  $('coverage-method').innerHTML = '<p>Изискването е над 80% покритие и в двата периода. За допълнителните лиги броим резултат и четирите полета за удари. За топ 5 през текущия сезон броим двойката xG.</p>' +
    '<p>Топ 5 и ' + supporting.length + ' допълнителни лиги влизат в дневния подбор. За тях лиговият модел има по-ниска средна грешка за Над/Под и Гол/Гол в теста за 2025/26. Покритието измерва наличните данни.</p>';
  const feeds = [['Прогнозите са изчислени', live.asOf], ['Програма на Prime', live.calendarTime],
    ['Публикация на xGTables', live.xgTime], ['Проверка на резултатите от УЕФА', live.europeTime]];
  $('source-times').innerHTML = feeds.filter(([, t]) => t && Number.isFinite(Date.parse(t))).map(([name, t]) =>
    '<div><dt>' + escape(name) + '</dt><dd>' + escape(dateTime(t)) + ' ч.</dd></div>').join('');
  $('coverage-rows').innerHTML = live.audit.map(x => {
    const l = LEAGUE_BY_ID[x.id];
    const upgraded = live.matches.filter(m => m.league === x.id && m.forecastEdition === 'Prime 80/20').length;
    const model = upgraded ? 'Prime 80/20 · ' + upgraded + ' мача' :
      l.core && x.forecastCount ? 'Сходни защити' : x.forecastCount ? 'Лигов модел' : 'Изчаква данни';
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
    const active = europeValidation[row.id]?.selected ? 'В подбора след проверка' :
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
  if (location.hash === '#value') void primeValueView.refresh({force:true});
  $('footer-sync').textContent = updated || 'Прогнози от ' + dateTime(live.asOf) + ' ч.';
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

function modelContext(m, market, ranked) {
  const f = m.facts;
  const lines = [];
  if (m.forecastEdition === 'Prime 80/20') {
    const original = m.selectionForecast.probabilities[market];
    lines.push('За този пазар Prime дава ' + pct(original, 1) + ', а моделът за положенията дава ' +
      pct(m.chances[market], 1) + '. Общата оценка използва 80% от Prime и 20% от модела за положенията.');
  }
  if (m.model === 'europe' && Number.isFinite(f.domesticWeight)) {
    lines.push(f.domesticWeight > 0
      ? 'Оценката отчита представянето в Европа и в националните първенства.'
      : 'Оценката използва европейските резултати. Местните мачове са показани за справка.');
  }
  if (ranked && Number.isFinite(m.chances?.[market])) {
    lines.push('За този пазар Prime дава ' + pct(m.probabilities[market], 1) + ', а моделът за положенията дава ' +
      pct(m.chances[market], 1) + '. Средната от двете оценки определя реда в подбора.');
  }
  if (f.ranks) lines.push(m.home + ' е ' + f.ranks[0] + '. в нашето предмачово класиране, а ' + m.away + ' е ' + f.ranks[1] + '.');
  if (f.xg) lines.push('Оценка за положенията · ' + format(f.xg[0], 2) + ' xG за ' + m.home + ' и ' +
    format(f.xg[1], 2) + ' за ' + m.away + '.');
  if (f.league) lines.push('Голова норма · ' + format(f.league[0], 2) + ' за домакина и ' +
    format(f.league[1], 2) + ' за госта' + (m.model === 'similar_defence' ? ' (xG)' : '') + '.');
  if (f.euroSample) lines.push('Изиграни срещи в европейския архив · ' + f.euroSample[0] + ' за ' +
    m.home + ' и ' + f.euroSample[1] + ' за ' + m.away + '.');
  if (f.domesticSample) lines.push('Мачове в свързания местен архив · ' + f.domesticSample[0] + ' за ' +
    m.home + ' и ' + f.domesticSample[1] + ' за ' + m.away + '.');
  return lines.length ? '<details class="model-notes"><summary>Числата зад прогнозата</summary>' +
    lines.map(line => '<p>' + escape(line) + '</p>').join('') + '</details>' : '';
}

function openMatch(trigger) {
  const previous = trigger.dataset.set === 'daily-previous';
  const records = previous ? previousDaily : trigger.dataset.set === 'daily' ? daily : [];
  const dailyPick = records.find(entry => entry.id === trigger.dataset.match);
  const inReview = trigger.dataset.set === 'selection-review';
  const inConditional = trigger.dataset.set === 'selection-conditional';
  const isSelection = trigger.dataset.set === 'selection-live' || inReview || inConditional;
  const list = trigger.dataset.set === 'calendar' ? visibleCalendar :
    trigger.dataset.set === 'live' || isSelection ? live.matches : archive[trigger.dataset.set];
  const match = list?.find(x => x.id === trigger.dataset.match);
  const preview = inConditional ? conditionalRows.find(entry => entry.m.id === trigger.dataset.match) :
    trigger.dataset.set === 'selection-live' ? previewPicks.find(entry => entry.m.id === trigger.dataset.match) : null;
  const m = dailyPick?.m ?? preview?.m ?? (isSelection && match ? selectionMatch(match) : match);
  if (!m) return;
  activeTrigger = trigger;
  const p = m.probabilities;
  const title = escape(m.home + ' – ' + m.away);
  const result = dailyPick ? dailyPick.result?.score : m.result ?? live.settlements?.[m.id];
  const t = m.kickoff ? dateTime(m.kickoff) + ' ч.' : shortDate(noon(m.date)) + ' ' + m.date.slice(0, 4);
  const tag = label(m) + ' · ' + t;
  if (!p) {
    $('detail').innerHTML = '<div class="detail-top"><div class="eyebrow accent">' + escape(tag) +
      '</div><h2 class="detail-title" id="detail-title">' + title + '</h2></div><div class="detail-summary"><b>Краен резултат ' +
      escape(result?.join(':') ?? '—') + '</b><p>Източник: ' + escape(m.resultSource) +
      (m.resultConflict ? ' · Разминаване в източниците — за проверка.' : '') +
      '</p></div><p class="muted">За този мач няма запазена предмачова Prime прогноза. Не изчисляваме прогноза след резултата.</p>';
    $('match-dialog').showModal();
    return;
  }
  const historical = trigger.dataset.set === 'calendar' && m.calendarState !== 'upcoming';
  const recommended = trigger.dataset.market || [...MARKETS].sort((a, b) => p[b] - p[a])[0];
  const replay = m.model === 'retrospective';
  const outcome = historical && result && !m.resultConflict ? marketOutcome(recommended, result) : null;
  const ranked = !inReview && !previous && (dailyPick?.paired || (!dailyPick && trigger.classList.contains('pick')));
  const explanation = explain(m, recommended) + modelContext(m, recommended, ranked);
  const separate = m.matchForecast?.probabilities[recommended];
  const fullForecast = Number.isFinite(separate) && Math.abs(separate - p[recommended]) > 1e-9
    ? '<p class="status-line">Общ анализ по ' + escape(m.matchForecast.edition) + ' · ' +
      pct(separate, 1) + ' · честен ' + odds(fairPrice(separate)) + '</p>' : '';
  const chance = (key, text) => '<span><small>' + text + '</small>' + pct(p[key]) + '</span>';
  const check = isSelection && europeanSelectionReview({ m, key: recommended, p: p[recommended] }, Date.now());
  const ref = check?.price ? '<section class="detail-section"><h3>Пазарен ориентир</h3><p>' + escape(check.price.source) +
    ' · засечка от ' + escape(dateTime(check.price.seen)) + ' ч. · ' + names[recommended] + ' ' +
    odds(check.price.selected) + ' / обратна страна ' + odds(check.price.opposite) +
    ' · пазар без маржа ' + pct(check.marketProbability, 1) + '.</p></section>' :
    m.quote ? '<section class="detail-section"><h3>Пазарен ориентир</h3><p>' + escape(m.quote.source) +
    ' · засечка от ' + escape(dateTime(m.quote.seen)) + ' ч. · Над ' + odds(m.quote.over) + ' / Под ' +
    odds(m.quote.under) + ' за линия 2,5.</p></section>' : '';
  const diaryDetail = dailyPick ? '<section class="detail-section"><h3>Запис в дневника</h3><p>' +
    escape(dateTime(dailyPick.captured)) + ' ч. · ' +
    (dailyPick.paired && !previous ? 'С положения' : 'Предишен подбор') + ' · версия ' +
    escape(dailyPick.version.slice(0, 8)) + '</p><p>Засечен коефициент ' + odds(dailyPick.price?.selected) +
    (dailyPick.price ? ' · ' + escape(dailyPick.price.source) + ' · засечка от ' + escape(dateTime(dailyPick.price.seen)) + ' ч.' : '') +
    '</p><p>' + diaryOutcome(dailyPick) + (dailyPick.result?.score ? ' · ' + escape(dailyPick.result.source) :
      dailyPick.result?.void ? ' · ' + escape(dailyPick.result.void) : '') + '</p></section>' : '';
  const calendarDetail = historical ? '<section class="detail-section"><h3>Предмачов запис</h3><p>Изчислен на ' +
    escape(dateTime(m.issued)) + ' ч. · запазен на ' + escape(dateTime(m.calendarSaved)) + ' ч.' +
    (m.calendarCommit ? ' · <a target="_blank" rel="noopener" href="https://github.com/planenp993/matchpulse-auto/commit/' +
      escape(m.calendarCommit) + '">Оригинален запис</a>' : '') + '</p><p>' +
    (result ? 'Краен резултат ' + escape(result.join(':')) + ' · ' + escape(m.resultSource) +
      (m.resultConflict ? ' · Разминаване в източниците — за проверка.' : '') : 'Очакваме потвърден краен резултат.') +
    '</p></section>' : '';
  $('detail').innerHTML = '<div class="detail-top"><div class="eyebrow accent">' + escape(tag) +
    '</div><h2 class="detail-title" id="detail-title">' + title + '</h2><p class="muted">' +
    escape(forecastVersion(m)) + (m.round ? ' · ' + escape(roundText(m.round)) : '') + (result ? ' · Краен резултат ' + result.join(':') : '') + '</p></div>' +
    '<div class="detail-summary"><b>' + names[recommended] + ' · ' + pct(p[recommended], 1) +
    '</b>' + (outcome === null ? '' : '<p class="forecast-outcome ' + (outcome ? 'result-hit' : 'result-miss') +
      '">' + (outcome ? '✓ Прогнозата е позната' : '× Прогнозата не е позната') + '</p>') +
    '<p>' + (fullForecast ? 'Честен за подбора ' : 'Честен ') +
    odds(dailyPick?.fair ?? fairPrice(p[recommended])) + ' · праг за проверка ' +
    odds(dailyPick?.threshold ?? priceFrom(p[recommended])) + '+</p>' + fullForecast +
    (inReview && check?.reason ? '<p class="review-note">' + escape(reviewText(check, p[recommended])) + '</p>' : '') +
    '</div>' + diaryDetail + calendarDetail +
    (explanation ? '<section class="detail-section match-why"><h3>' + (inReview ? 'Данни за прогнозата' : 'Защо този избор') + '</h3>' +
      explanation + '</section>' : '') +
    formView(m, escape, LEAGUE_BY_ID, day => shortDate(noon(day))) +
    '<section class="detail-section"><h3>Голови пазари</h3><table class="detail-odds"><thead><tr>' +
    '<th scope="col">Пазар</th><th scope="col">Шанс</th><th scope="col">Честен</th><th scope="col">Праг</th>' +
    (historical && result && !m.resultConflict ? '<th scope="col">Изход</th>' : '') + '</tr></thead><tbody>' +
    MARKETS.map(key => '<tr' + (key === recommended ? ' class="active"' : '') + '><td>' + names[key] + '</td><td>' +
      pct(p[key], 1) + '</td><td>' + odds(fairPrice(p[key])) + '</td><td>' + odds(priceFrom(p[key])) +
      '+</td>' + (historical && result && !m.resultConflict
        ? '<td class="' + (marketOutcome(key, result) ? 'result-hit">✓' : 'result-miss">×') + '</td>' : '') + '</tr>').join('') +
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

async function requestUpdate() {
  if ($('refresh').disabled) return;
  if (!live) return start();
  $('refresh').disabled = true;
  $('refresh').textContent = 'Обновяване…';
  lastRequest = Date.now();
  try {
    const [snapshot, archiveUpdate, historyIndex] = await Promise.all([fetchSnapshot(live),
      archive.unavailable ? historicalArchive().catch(() => archive) : archive, loadCalendarIndex()]);
    archive = archiveUpdate;
    calendarError = !historyIndex && !calendarIndex;
    calendarIndex = historyIndex ?? calendarIndex;
    calendarFailures.clear();
    live = snapshot;
    updateLeagueControls(live);
    updated = 'Прогнози от ' + dateTime(live.asOf) + ' ч.';
  } catch {
    updated = 'Последни достъпни прогнози от ' + dateTime(live.asOf) + ' ч.';
  } finally {
    $('refresh').disabled = false;
    $('refresh').textContent = 'Обнови';
    render();
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !live) return;
  if (button.dataset.day) {
    day = button.dataset.day < FIRST_DAY ? FIRST_DAY : button.dataset.day;
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
$('date-picker').addEventListener('change', e => { if (e.target.value) {
  day = e.target.value < FIRST_DAY ? FIRST_DAY : e.target.value;
  renderMatches();
} });
$('previous-day').addEventListener('click', () => {
  if (live && day > FIRST_DAY) { day = shiftDay(day, -1); renderMatches(); }
});
$('next-day').addEventListener('click', () => { if (live) { day = shiftDay(day, 1); renderMatches(); } });
$('today-date').addEventListener('click', () => { if (live) { day = tonight(); renderMatches(); } });
$('value-list').addEventListener('input', event => {
  const input = event.target.closest('[data-price-row]');
  if (!input) return;
  const i = Number(input.dataset.priceRow), row = valueRows[i];
  if (!row) return;
  const text = input.value.trim();
  if (text) typedPrices.set(row.id, { text, at: Date.now() });
  else typedPrices.delete(row.id);
  const manual = Boolean(text);
  const quote = availableQuote({ ...row.candidate, price: row.quote }, Date.now());
  assessValueRow(row, manual ? text : quote?.selected);
  const status = $('value-list').querySelector('[data-price-status="' + i + '"]');
  status.className = 'value-status ' + row.assessment.state;
  status.textContent = text && parseOdds(text) === null ? 'Въведи валиден десетичен коефициент' : priceLabel(row);
  $('value-list').querySelector('[data-price-source="' + i + '"]').textContent = manual ? 'Въведен от теб' :
    quote ? quote.source + ' · ' + clock(quote.seen) : 'Няма засечка';
  renderValueSummary();
});
$('league-filter').addEventListener('change', renderMatches);
$('market-filter').addEventListener('change', renderMatches);
$('diary-league').addEventListener('change', () => { diaryLimit = 30; renderDiary(); });
$('diary-more').addEventListener('click', () => { diaryLimit += 30; renderDiary(); });
async function start() {
  $('refresh').disabled = true;
  lastRequest = Date.now();
  try {
    const [snapshot, archiveData, models, euroModels, historyIndex] = await Promise.all([
      fetchSnapshot(), historicalArchive().catch(() => ({ pilot: [], replay: [], unavailable: true })),
      reference('extra-models.json'), reference('europe-models.json'), loadCalendarIndex()
    ]);
    live = snapshot;
    archive = archiveData;
    validation = models;
    europeValidation = euroModels;
    calendarIndex = historyIndex;
    calendarError = !historyIndex;
    updateLeagueControls(live);
    render();
  } catch {
    $('footer-sync').textContent = $('notice').textContent = 'Данните временно са недостъпни.';
    $('picks').innerHTML = empty('Прогнозите временно са недостъпни. Натисни „Обнови“ за нова проверка.');
  } finally {
    $('refresh').disabled = false;
  }
}
start();
setInterval(() => { if (!document.hidden) requestUpdate(); }, 20 * 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastRequest >= 5 * 60_000) requestUpdate();
});
