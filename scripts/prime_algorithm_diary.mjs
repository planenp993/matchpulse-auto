import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { eligibleForSelection, fairPrice, forecastVersion, MARKETS, matchKey, priceFrom,
  priceReference, PRICE_BUFFER, SELECTION, selectDaily, sofiaDate } from '../docs/algorithm/catalog.js';
import { CORE_LEAGUES, MIN_LEAD, parseCoreFixtures } from '../docs/algorithm/core.js';
import { EURO_LEAGUES, euroKey, parseEuropeanFixtures, readEuropeanHistory } from '../docs/algorithm/europe.js';

const MINUTE = 60_000;
const RESULT_WAIT = 180 * MINUTE;
const PRICE_WINDOW = 60 * MINUTE;
const utc = time => new Date(time).toISOString();
const hash = data => createHash('sha256').update(data).digest('hex');
const seal = record => ({ ...record, sha256: hash(JSON.stringify(record)) });
const goodScore = score => Array.isArray(score) && score.length === 2 &&
  score.every(goals => Number.isInteger(goals) && goals >= 0 && goals <= 30);
const sameMatch = (one, two) => one?.split('|').filter((_, i) => i !== 1).join('|') ===
  two?.split('|').filter((_, i) => i !== 1).join('|');

function verifySeal({ sha256, ...record }) {
  if (sha256 !== seal(record).sha256) throw new Error('Changed Prime Algorithm diary record');
}

export function validateDiary(diary, previous) {
  if (diary.schema !== 1 || !Array.isArray(diary.days) || !Array.isArray(diary.results))
    throw new Error('Invalid Prime Algorithm diary');
  for (const field of ['days', 'results']) {
    if (previous?.[field]?.some((record, i) => record.sha256 !== diary[field][i]?.sha256))
      throw new Error('Published Prime Algorithm diary was altered');
  }
  const picks = new Map();
  let lastDay = '';
  for (const day of diary.days) {
    verifySeal(day);
    const captured = Date.parse(day.captured);
    const { fairMin, fairMax, count, buffer } = day.rule;
    if (!Number.isFinite(captured) || sofiaDate(captured) !== day.day || day.day <= lastDay ||
        !/^[a-f0-9]{64}$/.test(day.version) || !Number.isInteger(count) || count < 1 ||
        !(fairMin > 1 && fairMax >= fairMin && buffer >= 0) || !day.picks.length || day.picks.length > count)
      throw new Error('Invalid Prime Algorithm selection day');
    for (const pick of day.picks) {
      const kickoff = Date.parse(pick.m.kickoff);
      const issued = Date.parse(pick.m.issued);
      if (!Number.isFinite(kickoff) || kickoff - captured < MIN_LEAD || sofiaDate(kickoff) !== day.day ||
          !(issued <= captured) || !pick.method || picks.has(pick.id) || pick.id !== `${day.day}/${pick.m.id}` ||
          !MARKETS.includes(pick.key) || !Number.isFinite(pick.p) || pick.p !== pick.m.probabilities[pick.key] ||
          pick.fair !== fairPrice(pick.p) || pick.fair < fairMin - 1e-9 || pick.fair > fairMax + 1e-9 ||
          pick.threshold !== priceFrom(pick.p, buffer))
        throw new Error('Invalid sealed Prime Algorithm selection');
      if (pick.price) {
        const age = captured - Date.parse(pick.price.seen);
        if (!(age >= 0 && age <= PRICE_WINDOW) || !pick.price.source ||
            ![pick.price.selected, pick.price.opposite].every(odds => Number.isFinite(odds) && odds > 1))
          throw new Error('Invalid selection price observation');
      }
      picks.set(pick.id, day);
    }
    lastDay = day.day;
  }
  const latest = new Map();
  for (const result of diary.results) {
    verifySeal(result);
    const day = picks.get(result.id);
    const old = latest.get(result.id);
    const observed = Date.parse(result.observed);
    const kickoff = Date.parse(result.kickoff);
    if (!day || !(observed >= Date.parse(day.captured) && observed <= Date.parse(result.at)) ||
        (old && observed < Date.parse(old.observed)) || !Number.isFinite(kickoff) || !result.source ||
        (result.void ? result.score !== null : !goodScore(result.score) || kickoff <= Date.parse(day.captured) ||
          observed - kickoff < RESULT_WAIT))
      throw new Error('Invalid Prime Algorithm final result');
    latest.set(result.id, result);
  }
  return latest;
}

function selectionPrice(match, key, prices, now) {
  if (key !== 'over_2_5' && key !== 'under_2_5') return null;
  const quote = priceReference(match, prices, now);
  if (!quote || quote.source === 'Пазарна средна' || now - Date.parse(quote.seen) > PRICE_WINDOW) return null;
  const over = key === 'over_2_5';
  return { selected: over ? quote.over : quote.under, opposite: over ? quote.under : quote.over,
    seen: quote.seen, source: quote.source };
}

function indexUnique(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const id = key(row);
    index.set(id, index.has(id) ? null : row);
  }
  return index;
}

function resultFromSources(raw, live, clocks, diary) {
  const season = slug => live.index.competitions.find(c => c.slug === slug)?.seasons[0];
  const from = new Set(diary.days.flatMap(day => day.picks.map(({ m }) => m.id.split('/')[0])));
  const major = new Map(CORE_LEAGUES.filter(slug => from.has(slug)).flatMap(slug =>
    parseCoreFixtures(live.csv[slug], season(slug)?.fixtures).map(fixture => [`${slug}/${fixture.id}`, fixture])));
  const euro = new Map(EURO_LEAGUES.filter(slug => from.has(slug)).flatMap(slug =>
    parseEuropeanFixtures(slug, live.csv[slug], season(slug)?.fixtures).map(fixture => [fixture.id, fixture])));
  const europeanKey = (code, day, teams) => [code, day, ...teams].join('|');
  const european = indexUnique(readEuropeanHistory(raw.europeHistory), match =>
    europeanKey(match.code, match.day, match.teams));
  const domestic = indexUnique(raw.history.filter(row => goodScore(row.slice(7, 9))), matchKey);

  return match => {
    const original = Date.parse(match.kickoff);
    if (match.model === 'europe') {
      const fixture = euro.get(match.id);
      if (!fixture?.named || fixture.teams.join('|') !== [euroKey(match.home), euroKey(match.away)].join('|')) return null;
      const row = european.get(europeanKey(match.league, fixture.day, fixture.teams));
      return { score: row?.goals, kickoff: fixture.kickoff, observed: clocks.europe,
        source: 'УЕФА', cancelled: fixture.status === 'cancelled' && !row };
    }
    if (match.model === 'results') {
      const link = raw.links[match.id];
      const key = link?.result_key || match.id;
      if (!sameMatch(key, match.id)) return null;
      const row = domestic.get(key);
      const kickoff = link?.kickoff_utc ? Date.parse(link.kickoff_utc) : original;
      return { score: row?.slice(7, 9), kickoff, observed: clocks.domestic,
        source: 'Архив на Prime Syndicate', cancelled: link?.state === 'cancelled' || row?.[13]?.AWARDED === true };
    }
    const fixture = major.get(match.id);
    if (!fixture || fixture.home !== match.home || fixture.away !== match.away) return null;
    return { score: fixture.goals, kickoff: fixture.kickoff, observed: clocks.xg,
      source: 'xGTables · Sportmonks', cancelled: fixture.status === 'cancelled' };
  };
}

export function advanceDiary(diary, snapshot, { raw, base, live, version, now }) {
  const latest = validateDiary(diary);
  const day = sofiaDate(now);
  const last = diary.days.at(-1);
  const captured = utc(now);
  const alreadyPicked = new Set(diary.days.flatMap(item => item.picks.map(pick => pick.m.id)));
  const picks = last?.day >= day ? [] : selectDaily(snapshot.matches.filter(match =>
    !alreadyPicked.has(match.id) && Date.parse(match.kickoff) - now >= MIN_LEAD &&
    sofiaDate(match.kickoff) === day && eligibleForSelection(match, base.fitted, base.euroFitted)));
  const days = [...diary.days];
  if (picks.length) days.push(seal({ day, captured, version, rule: { ...SELECTION, buffer: PRICE_BUFFER }, picks: picks.map(({ m, key, p }) => {
    const { quote, ...match } = m;
    return { id: `${day}/${match.id}`, m: match, key, p, fair: fairPrice(p), threshold: priceFrom(p),
      method: forecastVersion(match), price: selectionPrice(match, key, raw.prices, now) };
  }) }));

  const results = [...diary.results];
  if (diary.days.length) {
    const findResult = resultFromSources(raw, live, { domestic: Date.parse(snapshot.calendarTime),
      xg: Date.parse(snapshot.xgTime), europe: Date.parse(raw.europeCoverage.checked_utc) }, diary);
    for (const entry of diary.days) {
      for (const pick of entry.picks) {
        const actual = findResult(pick.m);
        const old = latest.get(pick.id);
        if (!actual || !Number.isFinite(actual.kickoff) || !(actual.observed <= now &&
            actual.observed >= Date.parse(entry.captured)) || (old && actual.observed < Date.parse(old.observed))) continue;
        const invalid = actual.kickoff <= Date.parse(entry.captured);
        const reason = invalid ? 'Началният час е коригиран преди записа' : actual.cancelled ? 'Отменен или служебен мач' : null;
        if (!reason && (!goodScore(actual.score) || actual.observed - actual.kickoff < RESULT_WAIT)) continue;
        const result = { id: pick.id, kickoff: utc(actual.kickoff), score: reason ? null : actual.score,
          void: reason, source: actual.source };
        if (old && Object.entries(result).every(([key, value]) => JSON.stringify(value) === JSON.stringify(old[key]))) continue;
        results.push(seal({ ...result, observed: utc(actual.observed), at: captured }));
      }
    }
  }
  const updated = { schema: 1, days, results };
  validateDiary(updated, diary);
  return updated;
}

export async function readDiary(directory, previous) {
  const load = async name => {
    try {
      const content = await readFile(new URL(name + '.jsonl', directory), 'utf8');
      if (content && !content.endsWith('\n')) throw new Error('Incomplete Prime Algorithm diary line');
      return content.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };
  const [days, results] = await Promise.all(['days', 'results'].map(load));
  const diary = { schema: 1, days, results };
  validateDiary(diary, previous);
  return diary;
}

export async function appendDiary(directory, previous, updated) {
  validateDiary(updated, previous);
  await mkdir(directory, { recursive: true });
  for (const name of ['days', 'results']) {
    const additions = updated[name].slice(previous[name].length);
    await appendFile(new URL(name + '.jsonl', directory), additions.map(item => JSON.stringify(item) + '\n').join(''));
  }
}
