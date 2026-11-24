import { readFile, rename, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CORE_LEAGUES } from '../docs/algorithm/core.js';
import { EURO_LEAGUES } from '../docs/algorithm/europe.js';
import { makeData } from '../docs/algorithm/catalog.js';
import { advanceDiary, appendDiary, readDiary } from './prime_algorithm_diary.mjs';
import { addChances } from './prime_chances.mjs';

const xgRoot = 'https://www.xgtables.io/data/';
const leagues = [...CORE_LEAGUES, ...EURO_LEAGUES];
const root = new URL('../docs/', import.meta.url);
const relative = path => new URL(path, root);
const art = path => relative('algorithm/data/' + path);
const readLocal = async p => JSON.parse(await readFile(p, 'utf8'));
const decompress = async p => JSON.parse(gunzipSync(await readFile(p)));
const readRemote = async path => {
  const response = await fetch(xgRoot + path, { signal: AbortSignal.timeout(25_000), redirect: 'error' });
  if (!response.ok) throw new Error('xGTables ' + response.status + ' · ' + path);
  return response.text();
};

const archivePath = art('archive.json.gz');
const snapshotPath = art('snapshot.json.gz');
const diaryDirectory = art('diary/');
const chancesPath = new URL('./prime-chances-state.json.gz', import.meta.url);
const sourceFiles = ['core.js', 'catalog.js', 'europe.js', 'club-aliases.js', 'model-core.js',
  'data/scoring-config.json', 'data/extra-models.json', 'data/europe-models.json'];
const [status, history, fixtures, europeHistory, europeCoverage, config, fitted, euroFitted, archive, last,
  links, prices, sourceBytes, indexText, checkpointBytes] =
  await Promise.all([
    readLocal(relative('data/status.json')), readLocal(relative('data/history.json')),
    readLocal(relative('data/fixtures.json')), readLocal(relative('data/europe_history.json')),
    readLocal(relative('data/europe_coverage.json')), readLocal(art('scoring-config.json')),
    readLocal(art('extra-models.json')), readLocal(art('europe-models.json')),
    decompress(archivePath), decompress(snapshotPath), readLocal(relative('data/match_links.json')),
    readLocal(relative('data/selection_quotes.json')),
    Promise.all([...sourceFiles.map(path => relative('algorithm/' + path)),
      new URL('./prime_chances.mjs', import.meta.url), new URL('./prime_algorithm_diary.mjs', import.meta.url)]
      .map(path => readFile(path))), readRemote('index.json'), readFile(chancesPath)
  ]);
const index = JSON.parse(indexText);
const csv = Object.fromEntries(await Promise.all(leagues.map(async name => {
  const season = index.competitions.find(c => c.slug === name)?.seasons[0]?.year;
  if (!Number.isInteger(season) || season < 2026 || season > 2100) throw new Error('Unexpected season for ' + name);
  return [name, await readRemote('v1/' + name + '/' + season + '/fixtures.csv')];
})));
const now = Date.now();
const raw = { history, fixtures, europeHistory, europeCoverage, links: links.matches, prices };
const base = { status, config, fitted, euroFitted };
const live = { index, csv };
const current = makeData({ raw, base, live, now, keep: [...archive.pilot, ...last.matches] });
const checkpoint = JSON.parse(gunzipSync(checkpointBytes));
const next = addChances(current, { raw, live, now, checkpoint });
if (Date.parse(next.xgTime) < Date.parse(last.xgTime) || Date.parse(next.calendarTime) < Date.parse(last.calendarTime)) {
  throw new Error('A newer published data snapshot already exists');
}
for (const model of next.euroAudit) {
  const sites = next.matches.filter(m => m.league === model.id);
  if (sites.length !== model.upcoming) throw new Error('Unpublished European match in ' + model.id);
}
for (const match of next.matches) delete match.quote;
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
