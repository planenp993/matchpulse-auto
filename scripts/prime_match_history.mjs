// Preserve the Prime forecast that was actually in Git before kickoff. Never replay the model.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { CORE_CODES, CORE_LEAGUES, parseCoreFixtures } from '../docs/algorithm/core.js';
import { LEAGUE_BY_ID, MARKETS, sofiaDate, sofiaKickoff } from '../docs/algorithm/catalog.js';
import { readEuropeanHistory } from '../docs/algorithm/europe.js';
import { calendarKey, FIRST_DAY } from '../docs/algorithm/calendar-view.js';
import { validateDiary } from './prime_algorithm_diary.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SNAPSHOT = 'docs/algorithm/data/snapshot.json.gz';
const PREFIX = 'docs/algorithm/data/match-history/';
export const START = FIRST_DAY; // First public Prime Algorithm release.
const SHA = /^[a-f0-9]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WAIT = 3 * 3_600_000;
const utc = time => new Date(time).toISOString();
const instant = value => Date.parse(value);
const goodScore = score => Array.isArray(score) && score.length === 2 &&
  score.every(g => Number.isInteger(g) && g >= 0 && g <= 30);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const local = path => ROOT + path;
const read = path => JSON.parse(readFileSync(local(path), 'utf8'));
const unzip = bytes => JSON.parse(gunzipSync(bytes));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 40 * 1024 * 1024 });
const order = (a, b) => a.key.localeCompare(b.key);
const asDay = key => key.split('|')[1];
const sameScore = (a, b) => a[0] === b[0] && a[1] === b[1];

export function dayRecord(days, day) {
  if (!days.has(day)) days.set(day, { schema: 1, day, forecasts: [], results: [] });
  return days.get(day);
}

export function forecastRecord(m, snapshot, commit, published) {
  const kickoff = instant(m.kickoff), issued = instant(m.issued), built = instant(snapshot.asOf), seen = instant(published);
  if (!SHA.test(commit) || !LEAGUE_BY_ID[m.league] || !m.id || !m.home || !m.away ||
      ![kickoff, issued, built, seen].every(Number.isFinite) ||
      !(issued <= built && built <= seen && seen < kickoff) || m.model === 'retrospective' ||
      !MARKETS.every(key => Number.isFinite(m.probabilities?.[key]) && m.probabilities[key] >= 0 && m.probabilities[key] <= 1) ||
      !m.facts) return null;
  const day = sofiaDate(kickoff);
  if (day < START) return null;
  return { key: calendarKey(m.league, day, m.home, m.away), commit, published: utc(seen), snapshotAt: snapshot.asOf, m };
}

// A later published pre-match snapshot may replace a provisional forecast only
// before the original kickoff. Results never change the recorded forecast.
export function captureSnapshot(days, snapshot, commit, published) {
  if (snapshot.version !== 1 || !Array.isArray(snapshot.matches)) throw new Error('Invalid Prime forecast snapshot');
  for (const m of snapshot.matches) {
    const record = forecastRecord(m, snapshot, commit, published);
    if (!record) continue;
    const bucket = dayRecord(days, asDay(record.key));
    const i = bucket.forecasts.findIndex(old => old.key === record.key);
    if (i < 0) bucket.forecasts.push(record);
    else {
      const old = bucket.forecasts[i];
      if (record.m.id === old.m.id && instant(record.published) > instant(old.published) &&
          instant(record.published) < instant(old.m.kickoff) && instant(record.m.issued) >= instant(old.m.issued))
        bucket.forecasts[i] = record;
    }
  }
}

// The xGTables provider explicitly identifies regulation-time finals, excluding
// administrative outcomes. Keep this descriptive feed separate from the model.
export function confirmedCoreResults(live, observedAt, now) {
  const observed = instant(observedAt);
  if (!Number.isFinite(observed) || observed > now) return [];
  return CORE_LEAGUES.flatMap(slug => {
    const season = live.index.competitions.find(c => c.slug === slug)?.seasons[0];
    return parseCoreFixtures(live.csv[slug], season?.fixtures).flatMap(f => {
      if (!goodScore(f.goals) || !Number.isFinite(f.kickoff) || observed - f.kickoff < WAIT) return [];
      const day = sofiaDate(f.kickoff);
      if (day < START) return [];
      return [{ key: calendarKey(CORE_CODES[slug], day, f.home, f.away), id: slug + '/' + f.id,
        league: CORE_CODES[slug], home: f.home, away: f.away, kickoff: utc(f.kickoff), score: f.goals,
        observed: utc(observed), source: 'xGTables · Sportmonks', exactKickoff: true }];
    });
  });
}

function addResult(days, result, now) {
  const day = asDay(result.key), observed = instant(result.observed), kickoff = instant(result.kickoff);
  if (!DAY.test(day) || day < START || day > sofiaDate(now) || !goodScore(result.score) ||
      !Number.isFinite(observed) || observed > now + 60_000 || !LEAGUE_BY_ID[result.league] ||
      Number.isFinite(kickoff) && (observed < kickoff + WAIT || sofiaDate(kickoff) !== day) ||
      !Number.isFinite(kickoff) && day >= sofiaDate(observed)) return;
  const bucket = dayRecord(days, day);
  const i = bucket.results.findIndex(old => old.key === result.key);
  if (i < 0) bucket.results.push(result);
  else {
    const prior = bucket.results[i];
    if (!sameScore(prior.score, result.score)) {
      // Retain the original confirmed result and flag the conflict for review.
      prior.conflict = true;
    } else if (!prior.exactKickoff && result.exactKickoff) {
      bucket.results[i] = { ...prior, kickoff: result.kickoff, exactKickoff: true, id: result.id ?? prior.id,
        source: result.source, observed: result.observed };
    }
  }
}

export function settleCalendar(days, { history, europeHistory, status, europeCoverage, links = {}, snapshot, now }) {
  const observed = instant(status.last_build_utc);
  for (const row of history) {
    const [league,,, day, time, home, away, h, a] = row;
    if (!LEAGUE_BY_ID[league] || LEAGUE_BY_ID[league].europe || day < START || !goodScore([h, a]) ||
        row[13]?.AWARDED === true || !home || !away || !Number.isFinite(observed)) continue;
    const key = calendarKey(league, day, home, away);
    const link = links[key];
    const linkedTime = instant(link?.kickoff_utc);
    const timeOf = Number.isFinite(linkedTime) && link?.result_key === key ? linkedTime : sofiaKickoff(day, time);
    if (link?.state === 'cancelled') continue;
    addResult(days, { key, league, home, away, kickoff: Number.isFinite(timeOf) ? utc(timeOf) : null,
      score: [h, a], observed: utc(observed), source: 'Архив на Prime Syndicate',
      exactKickoff: Number.isFinite(linkedTime) && link?.result_key === key }, now);
  }
  const euroObserved = instant(europeCoverage.checked_utc);
  if (Number.isFinite(euroObserved)) {
    // The official UEFA history is already validated for 90-minute results.
    const recent = europeHistory.filter(row => row[3] >= START);
    const rows = new Map(recent.map(row => [row[13]?.SRC, row]));
    for (const game of readEuropeanHistory(recent)) {
      const key = calendarKey(game.code, game.day, game.home, game.away);
      const row = rows.get(game.id), kickoff = sofiaKickoff(game.day, row?.[4]);
      addResult(days, { key, league: game.code, home: game.home, away: game.away,
        kickoff: Number.isFinite(kickoff) ? utc(kickoff) : null, score: game.goals, observed: utc(euroObserved), source: 'УЕФА' }, now);
    }
  }
  for (const result of snapshot.calendarResults ?? []) addResult(days, result, now);
  if (snapshot.diary) {
    const latest = validateDiary(snapshot.diary);
    for (const day of snapshot.diary.days) {
      for (const { id, m } of [...day.picks, ...(day.comparison?.picks ?? [])]) {
        const actual = latest.get(id);
        if (!actual || actual.void) continue;
        const key = calendarKey(m.league, sofiaDate(actual.kickoff), m.home, m.away);
        addResult(days, { key, id: m.id, league: m.league, home: m.home, away: m.away, kickoff: actual.kickoff,
          score: actual.score, source: actual.source, observed: actual.observed, exactKickoff: true }, now);
      }
    }
  }
}

export function validateDay(bucket) {
  if (bucket.schema !== 1 || !DAY.test(bucket.day) || bucket.day < START ||
      !Array.isArray(bucket.forecasts) || !Array.isArray(bucket.results)) throw new Error('Invalid Prime calendar day');
  for (const field of ['forecasts', 'results']) {
    const keys = new Set();
    for (const item of bucket[field]) {
      if (keys.has(item.key) || asDay(item.key) !== bucket.day) throw new Error('Duplicate or misplaced calendar match');
      keys.add(item.key);
      if (field === 'forecasts') {
        const expected = forecastRecord(item.m, { asOf: item.snapshotAt }, item.commit, item.published);
        if (!expected || expected.key !== item.key) throw new Error('Calendar forecast was not published before kickoff');
      } else if (!goodScore(item.score) || !item.source || !Number.isFinite(instant(item.observed)) ||
          calendarKey(item.league, bucket.day, item.home, item.away) !== item.key) {
        throw new Error('Invalid confirmed calendar result');
      }
    }
  }
}

function atomic(path, bytes) {
  writeFileSync(local(path + '.tmp'), bytes);
  renameSync(local(path + '.tmp'), local(path));
}

function readCalendar() {
  const index = existsSync(local(PREFIX + 'index.json')) ? read(PREFIX + 'index.json') : null;
  const days = new Map();
  if (!index) return { index, days };
  if (index.schema !== 1 || index.start !== START || !SHA.test(index.cursor) || !index.days)
    throw new Error('Invalid Prime calendar index');
  for (const [day, metadata] of Object.entries(index.days)) {
    if (!DAY.test(day)) throw new Error('Invalid calendar file name');
    const bytes = readFileSync(local(PREFIX + day + '.json.gz'));
    if (digest(bytes) !== metadata.sha256) throw new Error('Changed calendar shard ' + day);
    const bucket = unzip(bytes);
    validateDay(bucket);
    if (bucket.day !== day || bucket.forecasts.length !== metadata.forecasts || bucket.results.length !== metadata.results)
      throw new Error('Prime calendar index differs from its day ' + day);
    days.set(day, bucket);
  }
  return { index, days };
}

function main() {
  const { index, days } = readCalendar();
  if (process.argv.includes('--check')) {
    if (!index) throw new Error('Missing Prime calendar index');
    console.log('Verified Prime all-match calendar · ' + days.size + ' days');
    return;
  }
  const ref = git('rev-parse', 'HEAD').toString().trim();
  if (index) git('merge-base', '--is-ancestor', index.cursor, ref);
  const revision = index ? index.cursor + '..' + ref : ref;
  const commits = git('log', '--first-parent', '--reverse', '--format=%H %cI', revision, '--', SNAPSHOT)
    .toString().trim().split('\n').filter(Boolean);
  for (const line of commits) {
    const [sha, published] = line.split(' ');
    const snapshot = unzip(git('show', sha + ':' + SNAPSHOT));
    captureSnapshot(days, snapshot, sha, published);
  }
  const cursor = commits.at(-1)?.split(' ')[0] ?? index?.cursor;
  if (!cursor) throw new Error('No actual published Prime snapshot found');
  const now = Date.now();
  const snapshot = unzip(readFileSync(local(SNAPSHOT)));
  settleCalendar(days, { history: read('docs/data/history.json'), europeHistory: read('docs/data/europe_history.json'),
    status: read('docs/data/status.json'), europeCoverage: read('docs/data/europe_coverage.json'),
    links: read('docs/data/match_links.json').matches, snapshot, now });
  mkdirSync(local(PREFIX), { recursive: true });
  const metadata = {};
  for (const [day, bucket] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    bucket.forecasts.sort(order);
    bucket.results.sort(order);
    validateDay(bucket);
    const bytes = gzipSync(JSON.stringify(bucket), { level: 9 });
    const sha256 = digest(bytes);
    metadata[day] = { forecasts: bucket.forecasts.length, results: bucket.results.length, sha256 };
    if (sha256 !== index?.days[day]?.sha256) atomic(PREFIX + day + '.json.gz', bytes);
  }
  const nextIndex = { schema: 1, start: START, cursor, days: metadata };
  if (JSON.stringify(nextIndex) !== JSON.stringify(index)) atomic(PREFIX + 'index.json', JSON.stringify(nextIndex) + '\n');
  const today = sofiaDate(now);
  for (const [day, m] of Object.entries(metadata)) if (day <= today) {
    const bucket = days.get(day), keys = new Set(bucket.forecasts.map(f => f.key));
    console.log(day + ' · ' + m.forecasts + ' archived forecasts · ' + m.results + ' final results · ' +
      bucket.results.filter(r => keys.has(r.key)).length + ' matched');
  }
  console.log('Prime archive: ' + commits.length + ' new published snapshots; ' + days.size + ' calendar days');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
