import { readFile, rename, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CORE_LEAGUES } from '../docs/algorithm/core.js';
import { EURO_LEAGUES } from '../docs/algorithm/europe.js';
import { europeanPricePairs, makeData } from '../docs/algorithm/catalog.js';
import { confirmedCoreResults } from './prime_match_history.mjs';
import { advanceDiary, appendDiary, readDiary } from './prime_algorithm_diary.mjs';
import { addChances } from './prime_chances.mjs';
import { applyForecastRelease } from './prime_full_forecast.mjs';

import { refreshDue, readXgFile, SourceUnavailable } from './prime_refresh_policy.mjs';
import { DELAY_AFTER } from '../docs/algorithm/refresh-state.js';
const leagues = [...CORE_LEAGUES, ...EURO_LEAGUES];
const root = new URL('../docs/', import.meta.url);
const relative = path => new URL(path, root);
const art = path => relative('algorithm/data/' + path);
const readLocal = async p => JSON.parse(await readFile(p, 'utf8'));
const decompress = async p => JSON.parse(gunzipSync(await readFile(p)));
const archivePath = art('archive.json.gz');
const snapshotPath = art('snapshot.json.gz');
const diaryDirectory = art('diary/');
const last = await decompress(snapshotPath);
if (process.argv.includes('--check-age')) {
  const age = Date.now() - Date.parse(last.asOf);
  if (!Number.isFinite(age) || age < -60_000 || age > DELAY_AFTER) throw new Error('Prime forecast overdue: ' + last.asOf);
  console.log('Verified Prime forecast age: ' + Math.max(0, Math.round(age / 60_000)) + ' minutes');
  process.exit(0);
}
const clockRun = process.argv.includes('--if-due');
if (clockRun && !refreshDue(last, Date.now())) {
  console.log('Prime already refreshed at ' + last.asOf);
  process.exit(0);
}

// Fetch and validate every input before opening the append-only diary for writing.
// An upstream outage leaves the last successful forecast available to the primary publisher.
let live;
try {
  const index = JSON.parse(await readXgFile('index.json'));
  const entries = await Promise.all(leagues.map(async name => {
    const season = index.competitions.find(c => c.slug === name)?.seasons[0]?.year;
    if (!Number.isInteger(season) || season < 2026 || season > 2100) throw new Error('Unexpected season for ' + name);
    return [name, await readXgFile('v1/' + name + '/' + season + '/fixtures.csv')];
  }));
  live = { index, csv: Object.fromEntries(entries) };
} catch (error) {
  if (!(clockRun && error instanceof SourceUnavailable)) throw error;
  console.warn('::warning::Prime source unavailable · ' + error.message + ' · latest forecast ' + last.asOf);
  process.exit(0);
}
const chancesPath = new URL('./prime-chances-state.json.gz', import.meta.url);
const sourceFiles = ['core.js', 'catalog.js', 'europe.js', 'club-aliases.js', 'model-core.js',
  'data/scoring-config.json', 'data/extra-models.json', 'data/europe-models.json', 'data/champion.json'];
const [status, history, fixtures, europeHistory, europeCoverage, config, fitted, euroFitted, archive,
  links, prices, euroPrices, release, sourceBytes, checkpointBytes] =
  await Promise.all([
    readLocal(relative('data/status.json')), readLocal(relative('data/history.json')),
    readLocal(relative('data/fixtures.json')), readLocal(relative('data/europe_history.json')),
    readLocal(relative('data/europe_coverage.json')), readLocal(art('scoring-config.json')),
    readLocal(art('extra-models.json')), readLocal(art('europe-models.json')),
    decompress(archivePath), readLocal(relative('data/match_links.json')),
    readLocal(relative('data/selection_quotes.json')),
    readLocal(new URL('../ops/prime_europe_prices.json', import.meta.url)), readLocal(art('champion.json')),
    Promise.all([...sourceFiles.map(path => relative('algorithm/' + path)),
      new URL('./prime_chances.mjs', import.meta.url), new URL('./prime_algorithm_diary.mjs', import.meta.url),
      new URL('./prime_full_forecast.mjs', import.meta.url)]
      .map(path => readFile(path))), readFile(chancesPath)
  ]);
const now = Date.now();
const raw = { history, fixtures, europeHistory, europeCoverage, links: links.matches, prices };
const base = { status, config, fitted, euroFitted, release };
const current = makeData({ raw, base, live, now, keep: [...archive.pilot, ...last.matches] });
const checkpoint = JSON.parse(gunzipSync(checkpointBytes));
const withChances = addChances(current, { raw, live, now, checkpoint });
const next = applyForecastRelease(withChances, { release, scoring: config, fitted });
if (Date.parse(next.xgTime) < Date.parse(last.xgTime) || (last.archiveTime && Date.parse(next.calendarTime) < Date.parse(last.calendarTime)) ||
    Date.parse(next.archiveTime) < Date.parse(last.archiveTime ?? last.calendarTime)) {
  throw new Error('A newer published data snapshot already exists');
}
for (const model of next.euroAudit) {
  const sites = next.matches.filter(m => m.league === model.id);
  if (sites.length !== model.upcoming) throw new Error('Unpublished European match in ' + model.id);
}
for (const match of next.matches) {
  match.marketPrices = europeanPricePairs(match, match.model === 'europe' ? euroPrices : null, prices, now);
  delete match.quote;
}
next.calendarResults = confirmedCoreResults(live, next.xgTime, now);
const version = createHash('sha256').update(JSON.stringify([...sourceBytes, checkpointBytes].map(bytes =>
  createHash('sha256').update(bytes).digest('hex')))).digest('hex');
const diary = await readDiary(diaryDirectory, last.diary);
next.diary = advanceDiary(diary, next, { raw, base, live, version, now });
const tmp = new URL(snapshotPath.href + '.tmp');
await writeFile(tmp, gzipSync(JSON.stringify(next), { level: 9 }));
await appendDiary(diaryDirectory, diary, next.diary);
await rename(tmp, snapshotPath);
const secondOpinions = next.matches.filter(match => match.chances).length;
console.log(next.asOf + ' · ' + next.matches.length + ' предстоящи анализа · ' + secondOpinions + ' с модел за положения');
console.log(next.diary.days.length + ' дни в дневника · ' + next.diary.results.length + ' събития с резултати');
console.log(next.matches.filter(match => match.forecastEdition).length + ' анализа с новите модели');
