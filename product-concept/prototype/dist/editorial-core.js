(function (root) {
  'use strict';
  const markets = ['over25', 'under25', 'bttsYes', 'bttsNo', 'homeOver15', 'awayOver15'];
  function validateReview(input, knownIds) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Очаква се JSON обект.'];
    if (input.kind !== 'demo_review') errors.push('Прототипът приема само demo_review.');
    if (!Array.isArray(input.selections) || !input.selections.length) return [...errors, 'Липсват селекции.'];
    if (input.selections.length > 5) errors.push('Максимум 5 селекции в едно издание.');
    const seen = new Set();
    for (const s of input.selections) {
      if (!s || typeof s !== 'object') { errors.push('Невалиден запис.'); continue; }
      if (!knownIds.includes(s.fixture_id)) errors.push('Непознат fixture_id.');
      if (seen.has(s.fixture_id)) errors.push('Една селекция на мач в изданието.');
      seen.add(s.fixture_id);
      if (!markets.includes(s.market)) errors.push('Неподдържан голов пазар.');
      if (!['free', 'vip'].includes(s.access)) errors.push('Достъпът трябва да е free или vip.');
      if (typeof s.thesis !== 'string' || s.thesis.trim().length < 20) errors.push('Добави конкретна футболна теза.');
      if (typeof s.counterargument !== 'string' || s.counterargument.trim().length < 15) errors.push('Добави основния риск.');
      if (!Array.isArray(s.evidence) || !s.evidence.length || s.evidence.some(e => !e || typeof e.url !== 'string' || !/^https:\/\//.test(e.url) || typeof e.checked_at !== 'string' || !Number.isFinite(Date.parse(e.checked_at)))) errors.push('Нужно е доказателство с HTTPS източник и време на проверка.');
      if (s.news_status !== 'reviewed') errors.push('Актуалната информация още не е проверена.');
      if (!s.quote || !Number.isFinite(s.quote.decimal) || s.quote.decimal <= 1 || typeof s.quote.url !== 'string' || !/^https:\/\//.test(s.quote.url) || !Number.isFinite(Date.parse(s.quote.checked_at || ''))) errors.push('Нужна е цена с източник и време.');
    }
    return [...new Set(errors)];
  }
  function publicProjection(selections) {
    // Deliberately allowlist fields: unpublished VIP data cannot enter a public build.
    return selections.filter(s => s.access === 'free' && s.state === 'approved' && s.kind !== 'demo').map(s => ({
      id:s.id, fixture_id:s.fixture_id, market:s.market, thesis:s.thesis,
      counterargument:s.counterargument, published_at:s.published_at
    }));
  }
  function summarizeLedger(rows) {
    const closed=rows.filter(r => ['won','lost','void'].includes(r.status));
    const risked=closed.filter(r => r.status!=='void');
    const stake=risked.reduce((s,r)=>s+r.stake,0);
    const profit=risked.reduce((s,r)=>s+(r.status==='won'?r.stake*(r.odds-1):-r.stake),0);
    return {n:closed.length,won:risked.filter(r=>r.status==='won').length,lost:risked.filter(r=>r.status==='lost').length,
      void:closed.filter(r=>r.status==='void').length,stake,profit,yield:stake?profit/stake:null};
  }
  const api={markets,validateReview,publicProjection,summarizeLedger};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  root.PrimeCore=api;
})(typeof window !== 'undefined' ? window : globalThis);
