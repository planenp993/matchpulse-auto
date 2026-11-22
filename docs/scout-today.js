/* Public cards and the browser-local matchday editor. */
(function(root) {
  'use strict';
  const Logic = root.MatchpulseTodayCore, Core = root.MatchpulseScout, Daily = root.MatchpulseDaily;
  const View = root.MatchpulsePresentation, Selection = root.MatchpulseSelectionUI;
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
  const storeKey = 'prime-syndicate-matchday-v1';
  const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit'});
  const headerDate = new Intl.DateTimeFormat('bg-BG', {timeZone: 'Europe/Sofia', weekday: 'long', day: 'numeric', month: 'long'});
  const clock = new Intl.DateTimeFormat('bg-BG', {timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit'});
  const price = value => value.toFixed(2).replace('.', ',');
  const time = value => clock.format(new Date(value));
  const marketText = leg => leg.markets.map(Logic.label).join(' + ');
  const matchText = leg => `${leg.home} – ${leg.away}`;
  const empty = {quotes: {}, records: [], book: ''};
  let app, saved = empty, remote = [], feed, fixtureByKey = new Map();
  let review, loading, singles = [], builders = [], tab = 'single', limit = 8;
  let visible = [];

  function readSaved() {
    try {
      const doc = JSON.parse(localStorage.getItem(storeKey));
      if (doc?.schema !== 1) return empty;
      const quotes = Object.fromEntries(Object.entries(doc.quotes || {}).filter(([, quote]) => Logic.validQuote(quote)));
      return {quotes, records: Logic.recordsFrom(doc, Core), book: typeof doc.book === 'string' ? doc.book : ''};
    } catch {
      return empty;
    }
  }

  function writeSaved(next) {
    try {
      localStorage.setItem(storeKey, JSON.stringify({schema: 1, ...next}));
      saved = next;
      return true;
    } catch {
      el('goalFeedback').textContent = 'Браузърът не успя да запази записа.';
      return false;
    }
  }

  function loadFeed() {
    if (!feed) feed = (root.SCOUT_EMBEDDED_DATA ? Promise.resolve(root.SCOUT_EMBEDDED_DATA.goalPublications) :
      fetch('goal_publications.json', {cache: 'no-store', signal: AbortSignal.timeout(5000)}).then(res => {
        if (!res.ok) throw Error('Публичен отчет');
        return res.json();
      })).then(doc => { remote = Logic.recordsFrom(doc, Core); }).catch(() => { feed = null; });
    return feed;
  }

  function allRecords() {
    return [...new Map([...saved.records, ...remote].map(record => [record.id, record])).values()]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  function stillUpcoming(item, now, lead = false) {
    const rows = item.legs.map(leg => fixtureByKey.get(leg.fixtureKey));
    const cutoff = lead ? Daily.cutoff(now) : new Date((Math.floor(now.getTime() / 60000) + 1) * 60000);
    return rows.every((row, i) => row && row[4] === item.legs[i].time && Daily.isFixture(row, View)) &&
      Core.getUpcoming(rows, cutoff).length === rows.length;
  }

  function headings(leg) {
    return `<div class="goal-match-meta"><span>${esc(leg.league)}</span><time>${esc(leg.time)}</time></div>
      <h3 class="goal-match-name">${View.clubMark(leg.div, leg.home, 'small')}<span>${esc(leg.home)}</span><span class="goal-versus">–</span>${View.clubMark(leg.div, leg.away, 'small')}<span>${esc(leg.away)}</span></h3>
      <p class="goal-market">${esc(marketText(leg))}</p>`;
  }

  function numbers(item, quote) {
    return `<div class="goal-numbers-row"><div><span>Проверен коефициент</span><strong>${quote ? price(quote.odds) : '—'}</strong>${quote ? `<small>${esc(quote.book)} · ${time(quote.checkedAt)}</small>` : ''}</div>
      <div><span>Минимална цена</span><strong>${price(item.minimum)}</strong><small>${Math.round(item.probability * 100)}% модел</small></div></div>`;
  }

  function paintPublic() {
    const now = new Date(), today = dateFormat.format(now);
    el('goalTodayDate').textContent = `${headerDate.format(now)} · часове София`;
    const records = allRecords().filter(record => record.audience === 'FREE' && record.type === tab &&
      record.legs[0].date === today && stillUpcoming(record, now));
    if (!records.length) {
      el('goalTodayCards').innerHTML = `<div class="goal-empty"><span class="goal-empty-icon">${View.icon('goal')}</span><div><strong>Няма селекция</strong><p>${tab === 'single' ? 'Тук излиза дневната FREE селекция с проверена цена.' : 'Проверените комбинации излизат във VIP.'}</p></div></div>`;
      return;
    }
    el('goalTodayCards').innerHTML = records.map(record => {
      const recent = saved.quotes[record.id];
      const recentState = Logic.assess(record, recent, now);
      const quote = ['ready', 'below'].includes(recentState) ? recent : record.quote;
      const state = Logic.assess(record, quote, now), status = {ready: 'Цена над прага', below: 'Под прага · пропусни', stale: 'Провери цената отново'}[state];
      return `<article class="goal-card goal-feature"><div class="goal-card-top"><span class="goal-audience">FREE</span><span class="goal-status" data-state="${state}">${status}</span></div>
        ${headings(record.legs[0])}${numbers(record, quote)}<p class="goal-reason">${esc(record.reason)}</p>
        <button type="button" class="button secondary" data-goal-match="${esc(record.legs[0].fixtureKey)}">Анализ на мача</button></article>`;
    }).join('');
  }

  function editorItems(now) {
    const recorded = new Set(saved.records.map(record => record.id));
    const available = items => items.filter(item => stillUpcoming(item, now, !recorded.has(item.id)));
    const currentSingles = available(singles);
    if (tab === 'single') return currentSingles;
    if (tab === 'builder') return available(builders);
    const column = Logic.column(currentSingles, saved.quotes, now, Core, +el('goalColumnSize').value, el('goalBook').value.trim());
    return column ? [column] : [];
  }

  function priceForm(item, i, state, quote) {
    const record = allRecords().find(row => row.id === item.id), book = el('goalBook').value.trim();
    const quoteBook = quote?.book?.toLowerCase() === book.toLowerCase();
    const canRecord = audience => state === 'ready' && Logic.canRecord(item, audience, allRecords());
    return `<form class="goal-price-form" data-goal-quote="${i}">
      <label class="control-label">Цена от букмейкъра<input name="odds" type="text" inputmode="decimal" required autocomplete="off" placeholder="Напр. 1,85" value="${quoteBook ? price(quote.odds) : ''}"></label>
      <button type="submit" class="button secondary">${quoteBook ? 'Провери отново' : 'Потвърди цена'}</button>
      </form><div class="goal-card-actions">
      ${record ? `<span class="goal-audience">Записана за ${record.audience}</span>` : ''}
      ${canRecord('FREE') ? `<button type="button" class="button" data-goal-record="${i}" data-audience="FREE">Запиши FREE</button>` : ''}
      ${canRecord('VIP') ? `<button type="button" class="button" data-goal-record="${i}" data-audience="VIP">Запиши VIP</button>` : ''}
      ${item.type === 'column' ? '' : `<button type="button" class="button secondary" data-goal-match="${esc(item.legs[0].fixtureKey)}">Анализ</button>`}
      </div>`;
  }

  function editorCard(item, i, now) {
    const savedQuote = saved.quotes[item.id], state = Logic.assess(item, savedQuote, now);
    const quote = state !== 'missing' ? savedQuote : null;
    const status = {ready: 'Цена над прага', below: 'Под прага', missing: 'Чака цена', stale: 'Провери цената отново'}[state];
    const combinations = `<ol class="goal-column-list">${item.legs.map(leg => `<li><strong>${esc(matchText(leg))}</strong><span>${esc(marketText(leg))}</span></li>`).join('')}</ol>`;
    const csv = Number.isFinite(item.csv?.odds) && Number.isFinite(Date.parse(item.csv.observed_at_utc)) ?
      `<p class="goal-csv">Архивна CSV цена ${price(item.csv.odds)} · ${esc(new Date(item.csv.observed_at_utc).toLocaleString('bg-BG', {timeZone: 'Europe/Sofia', dateStyle: 'short', timeStyle: 'short'}))}</p>` : '';
    return `<article class="goal-card goal-candidate" data-goal-id="${esc(item.id)}"><div class="goal-card-top"><span>${Logic.LABELS[item.type]}</span><span class="goal-status" data-state="${state}">${status}</span></div>
      ${item.type === 'column' ? combinations : headings(item.legs[0])}${numbers(item, quote)}${csv}<p class="goal-reason">${esc(item.reason)}</p>${priceForm(item, i, state, quote)}</article>`;
  }

  function paintEditor() {
    const now = new Date(), search = el('goalSearch').value.trim().toLocaleLowerCase('bg-BG');
    el('goalSearchField').hidden = tab === 'column';
    el('goalColumnField').hidden = tab !== 'column';
    el('goalChoices').setAttribute('aria-busy', String(!!loading));
    const records = allRecords(), available = records.filter(record => stillUpcoming(record, now));
    el('goalCopyFree').disabled = !available.some(record => record.audience === 'FREE');
    el('goalCopyVip').disabled = !available.length;
    el('goalExport').disabled = !records.length;
    if (loading || !review || review.blocked || review.date !== dateFormat.format(now)) {
      el('goalEditorSummary').textContent = loading ? 'Преглеждам потвърдената програма…' : (review?.blocked || 'Презареди страницата за актуалния ден.');
      el('goalChoices').replaceChildren();
      el('goalMore').hidden = true;
      return;
    }
    const items = Logic.rank(editorItems(now), saved.quotes, now);
    const found = items.filter(item => tab === 'column' || !search || item.legs.some(leg => `${matchText(leg)} ${leg.league}`.toLocaleLowerCase('bg-BG').includes(search)));
    const ready = items.filter(item => Logic.assess(item, saved.quotes[item.id], now) === 'ready').length;
    el('goalEditorSummary').textContent = `${review.reviewed} прегледани мача · ${items.length} за проверка · ${ready} с цена над прага`;
    visible = found.slice(0, limit);
    el('goalChoices').innerHTML = visible.map((item, i) => editorCard(item, i, now)).join('') ||
      `<p class="goal-editor-empty">${tab === 'column' ? 'Потвърди цените на единични селекции от различни мачове при един букмейкър.' : 'Няма предложения за проверка.'}</p>`;
    el('goalMore').hidden = visible.length === found.length;
  }

  async function startReview() {
    if (loading) return loading;
    const now = new Date();
    loading = (async () => {
      await app.loadData();
      review = await Selection.reviewToday(now);
      const pool = Logic.collect(review.entries, app.history(), Core, root.MatchpulseModel);
      singles = pool.singles;
      builders = pool.builders;
    })().catch(() => { review = {blocked: 'Данните временно са недостъпни. Презареди страницата.'}; })
      .finally(() => { loading = null; paintEditor(); });
    paintEditor();
    return loading;
  }

  function actionBlock(item, now, lead = false) {
    if (!stillUpcoming(item, now, lead)) return lead ? 'Нужни са поне 30 минути до потвърденото начало.' : 'Началният час е променен или мачът е започнал.';
    return item.legs.map(leg => Selection.publicationBlock(fixtureByKey.get(leg.fixtureKey), now)).find(Boolean) || '';
  }

  function columnPricesReady(item, book, now) {
    return item.type !== 'column' || item.legs.every(leg => singles.some(single => {
      const singleLeg = single.legs[0], quote = saved.quotes[single.id];
      return singleLeg.fixtureKey === leg.fixtureKey && singleLeg.markets[0] === leg.markets[0] &&
        quote?.book.toLowerCase() === book.toLowerCase() && Logic.assess(single, quote, now) === 'ready';
    }));
  }

  function confirmPrice(event) {
    const form = event.target.closest('[data-goal-quote]');
    if (!form) return;
    event.preventDefault();
    const item = visible[+form.dataset.goalQuote], now = new Date(), book = el('goalBook').value.trim();
    const recheck = saved.records.some(record => record.id === item.id);
    const blocked = actionBlock(item, now, !recheck);
    const input = form.elements.odds, value = input.value.trim().replace(',', '.'), odds = Number(value);
    if (blocked) { el('goalFeedback').textContent = blocked; return; }
    if (!book) { el('goalBook').focus(); el('goalFeedback').textContent = 'Въведи името на букмейкъра.'; return; }
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || odds <= 1 || odds > 1000) {
      input.setCustomValidity('Въведи десетичен коефициент над 1, например 1,85.'); input.reportValidity(); return;
    }
    saved = readSaved();
    if (!columnPricesReady(item, book, now)) { el('goalFeedback').textContent = 'Провери отново цените на мачовете в колонката.'; paintEditor(); return; }
    const quote = {book, odds, checkedAt: now.toISOString(), kickoffs: Logic.kickoffKey(item.legs)};
    if (!writeSaved({...saved, book, quotes: {...saved.quotes, [item.id]: quote}})) return;
    paintEditor(); paintPublic();
    el('goalFeedback').textContent = Logic.assess(item, quote, now) === 'ready' ? 'Цената покрива прага. Можеш да запишеш селекцията.' : 'Цената е под прага.';
  }

  function recordItem(item, audience) {
    const now = new Date(), blocked = actionBlock(item, now, true);
    saved = readSaved();
    const quote = saved.quotes[item.id];
    if (blocked || Logic.assess(item, quote, now) !== 'ready' || !Logic.canRecord(item, audience, allRecords()) || !columnPricesReady(item, quote.book, now)) {
      el('goalFeedback').textContent = blocked || 'Провери цената и свободните места в подбора.'; paintEditor(); return;
    }
    const {id, type, legs, probability, minimum, reason} = item;
    const record = {id, type, legs, probability, minimum, reason, audience, publishedAt: now.toISOString(), quote};
    if (!writeSaved({...saved, records: [...saved.records, record]})) return;
    el('goalFeedback').textContent = `Записана за ${audience} на това устройство.`;
    paintPublic(); paintEditor(); paintResults();
  }

  async function copyPost(audience) {
    const now = new Date(), records = allRecords().filter(record => (audience === 'VIP' || record.audience === 'FREE') && !actionBlock(record, now));
    const lines = records.flatMap(record => {
      const quote = saved.quotes[record.id] || record.quote, state = Logic.assess(record, quote, now);
      if (!['ready', 'below'].includes(state)) return [];
      return ['', ...record.legs.map(leg => `${matchText(leg)} · ${leg.time}\n${marketText(leg)}`),
        `${state === 'below' ? 'Пропусни · ' : ''}${price(quote.odds)} при ${quote.book} · проверка ${time(quote.checkedAt)} · минимум ${price(record.minimum)}`,
        record.reason];
    });
    const output = el('goalPost'); output.hidden = true;
    if (!lines.length) { el('goalFeedback').textContent = 'Нужна е актуална проверка на записаните цени.'; return; }
    const text = [`PRIME SYNDICATE · ${audience}`, `${headerDate.format(now)} · часове София`, ...lines].join('\n');
    try { await navigator.clipboard.writeText(text); el('goalFeedback').textContent = 'Текстът е копиран.'; }
    catch { output.value = text; output.hidden = false; output.select(); el('goalFeedback').textContent = 'Текстът е готов за ръчно копиране.'; }
  }

  function resolution(record) { return Logic.settlement(record, app.result, Core); }

  function paintResults() {
    const records = allRecords(), list = el('goalPublishedResults');
    if (!records.length) {
      list.innerHTML = '<p class="goal-editor-empty">Няма записани публикации.</p>';
      el('goalResultSummary').textContent = '';
      return;
    }
    const resolved = records.map(record => ({record, ...resolution(record)}));
    const settled = resolved.filter(record => record.won !== null);
    el('goalResultSummary').textContent = `${records.length} записани · ${settled.filter(record => record.won).length}/${settled.length} успешни от приключилите`;
    list.innerHTML = resolved.map(({record, won, legs}) => `<article class="goal-result-row"><div><span class="goal-result-meta">${record.legs[0].date} · ${record.audience} · ${Logic.LABELS[record.type]}</span>
      ${record.legs.map((leg, i) => `<p><strong>${esc(matchText(leg))}${legs[i] ? ` · ${legs[i].score}` : ''}</strong> · ${esc(marketText(leg))}</p>`).join('')}</div>
      <div class="goal-result-price"><strong>${price(record.quote.odds)}</strong><small>${esc(record.quote.book)} · ${time(record.quote.checkedAt)}</small><span>${won === null ? 'Чака резултат' : won ? 'Успешна' : 'Неуспешна'}</span></div></article>`).join('');
  }

  function exportPublic() {
    const records = allRecords().filter(record => record.audience === 'FREE' || resolution(record).won !== null);
    if (!records.length) { el('goalFeedback').textContent = 'Отчетът изчаква FREE публикация или приключил VIP запис.'; return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify({schema: 1, records}, null, 2) + '\n'], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'goal_publications.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    el('goalFeedback').textContent = 'Публичният отчет е изтеглен.';
  }

  function show() {
    fixtureByKey = new Map(app.fixtures().map(row => [Core.keyFixture(row), row]));
    paintPublic();
    loadFeed().then(() => { paintPublic(); if (el('goalDesk').open) paintEditor(); });
    if (el('goalDesk').open) startReview();
  }

  async function results() {
    paintResults(); await loadFeed();
    if (allRecords().length) await app.loadData().catch(() => {});
    paintResults();
  }

  function mount(options) {
    app = options;
    saved = readSaved();
    el('goalBook').value = saved.book;
    el('goalDesk').addEventListener('toggle', () => { if (el('goalDesk').open) startReview(); });
    el('view-today').addEventListener('click', event => {
      const button = event.target.closest('[data-goal-tab], [data-goal-match], [data-goal-record]');
      if (!button) return;
      if (button.dataset.goalMatch) { app.openMatch(fixtureByKey.get(button.dataset.goalMatch)); return; }
      if (button.dataset.goalRecord !== undefined) { recordItem(visible[+button.dataset.goalRecord], button.dataset.audience); return; }
      tab = button.dataset.goalTab;
      limit = 8;
      document.querySelectorAll('[data-goal-tab]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      paintPublic(); if (el('goalDesk').open) paintEditor();
    });
    el('goalChoices').addEventListener('submit', confirmPrice);
    el('goalChoices').addEventListener('input', event => { if (event.target.name === 'odds') event.target.setCustomValidity(''); });
    el('goalBook').onchange = () => { if (tab === 'column') paintEditor(); };
    el('goalSearch').oninput = () => { limit = 8; paintEditor(); };
    el('goalColumnSize').onchange = paintEditor;
    el('goalMore').onclick = () => { limit += 8; paintEditor(); };
    el('goalCopyFree').onclick = () => copyPost('FREE');
    el('goalCopyVip').onclick = () => copyPost('VIP');
    el('goalExport').onclick = exportPublic;
    root.addEventListener('storage', event => {
      if (event.key !== storeKey || !fixtureByKey) return;
      saved = readSaved(); paintPublic(); paintResults();
      if (el('goalDesk').open) paintEditor();
    });
  }

  root.MatchpulseToday = {mount, show, results};
})(window);
