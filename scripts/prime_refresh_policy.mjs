/** Run from the primary data clock; a new Sofia day can seal its own selections immediately. */
import { sofiaDate } from '../docs/algorithm/catalog.js';
import { setTimeout as pause } from 'node:timers/promises';

export const MIN_REFRESH_INTERVAL = 25 * 60_000;

export function refreshDue(last, now) {
  const at = Date.parse(last.asOf);
  if (!Number.isFinite(at) || at > now + 60_000) throw new Error('Invalid Prime snapshot time');
  return sofiaDate(at) !== sofiaDate(now) || now - at >= MIN_REFRESH_INTERVAL;
}

export class SourceUnavailable extends Error {}

export async function readXgFile(path, request = fetch, wait = pause) {
  const url = new URL(path, 'https://www.xgtables.io/data/');
  for (let attempt = 0; ; attempt++) {
    let detail;
    try {
      const response = await request(url, {signal: AbortSignal.timeout(12_000), redirect: 'error'});
      if (response.ok) return await response.text();
      detail = 'HTTP ' + response.status;
      if (response.status < 500 && ![408, 429].includes(response.status)) {
        throw new SourceUnavailable(path + ' · ' + detail);
      }
    } catch (error) {
      if (error instanceof SourceUnavailable) throw error;
      detail = error.message;
    }
    if (attempt === 2) throw new SourceUnavailable(path + ' · ' + detail);
    await wait(1_000 * (attempt + 1));
  }
}
