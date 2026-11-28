import { PRICE_BUFFER, PRICE_WINDOW, priceFrom } from './catalog.js?v=9880ec988a17';

// A price check is a separate, provisional model assessment. Neither manually
// supplied prices nor these estimates modify the sealed daily selection.
export const REAL_MIN = 1.70;
export function parseOdds(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) return null;
  const price = Number(text);
  return Number.isFinite(price) && price > 1 && price <= 1000 ? price : null;
}
export function evaluatePrice(p, supplied, buffer = PRICE_BUFFER, min = REAL_MIN) {
  const price = parseOdds(supplied);
  const threshold = Math.max(min, priceFrom(p, buffer) ?? Infinity);
  if (price === null || !(p > 0 && p <= 1)) return { state: 'unknown', price, threshold, ev: null };
  const ev = price * p - 1;
  const state = ev <= 0 ? 'negative' : price < threshold - 1e-9 ? 'below' : 'passes';
  return { state, price, threshold, ev, implied: 1 / price };
}

export function availableQuote(candidate, now) {
  const { m, key } = candidate;
  const family = key === 'over_2_5' || key === 'under_2_5' ? 'over_2_5' : 'btts_yes';
  const pair = m.marketPrices?.[family];
  const direct = pair && (key === family ? pair : {
    ...pair, selected: pair.opposite, opposite: pair.selected
  });
  const valid = quote => {
    const seen = Date.parse(quote?.seen);
    return quote?.source && quote.source !== 'Пазарна средна' &&
      [quote.selected, quote.opposite].every(p => Number.isFinite(p) && p > 1) &&
      seen <= now && now - seen <= PRICE_WINDOW && seen < Date.parse(m.kickoff);
  };
  return [candidate.price, direct].filter(valid).sort((a,b) => Date.parse(b.seen) - Date.parse(a.seen))[0] ?? null;
}

export function qualifyingPrices(rows, limit = 3) {
  const chosen = [];
  const used = new Set();
  for (const row of [...rows].filter(r => r.assessment.state === 'passes')
    .sort((a, b) => b.assessment.ev - a.assessment.ev || b.candidate.p - a.candidate.p)) {
    if (used.has(row.candidate.m.id)) continue;
    used.add(row.candidate.m.id);
    chosen.push(row);
    if (chosen.length === limit) break;
  }
  return chosen;
}
