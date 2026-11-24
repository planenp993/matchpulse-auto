// A delay is measured from the generated forecast, independently of the provider's timestamps.
export const DELAY_AFTER = 2 * 3_600_000;

export async function loadSnapshot(read, primary, mirror, now, previous) {
  let latest = null;
  for (const url of [primary, mirror].filter(Boolean)) {
    try {
      const candidate = await read(url);
      const built = Date.parse(candidate.asOf);
      if (candidate.version !== 1 || !Array.isArray(candidate.matches) || !Array.isArray(candidate.audit) ||
          !Array.isArray(candidate.euroAudit) || !Number.isFinite(Date.parse(candidate.calendarTime)) ||
          !Number.isFinite(Date.parse(candidate.xgTime)) || !Number.isFinite(built) ||
          built > now + 60_000 || (previous && built < Date.parse(previous.asOf))) continue;
      if (!latest || built > Date.parse(latest.asOf)) latest = candidate;
      if (now - built <= DELAY_AFTER) break;
    } catch {
      // The other published copy can still serve the forecast.
    }
  }
  if (!latest) throw new Error('Прогнозите временно са недостъпни.');
  return latest;
}
