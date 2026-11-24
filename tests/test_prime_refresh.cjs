const assert = require('node:assert/strict');
const test = require('node:test');

test('Prime clock uses the latest build and the calendar date in Sofia', async () => {
  const {refreshDue} = await import('../scripts/prime_refresh_policy.mjs');
  const last = {asOf:'2026-11-24T10:12:00Z'};
  assert.equal(refreshDue(last, Date.parse('2026-11-24T10:36:59Z')), false);
  assert.equal(refreshDue(last, Date.parse('2026-11-24T10:37:00Z')), true);
  assert.equal(refreshDue({asOf:'2026-11-24T21:58:00Z'}, Date.parse('2026-11-24T22:00:00Z')), true);
  assert.throws(() => refreshDue(last, Date.parse('2026-11-23T10:13:00Z')));
});

test('temporary source errors retry, an unavailable source never returns fabricated rows', async () => {
  const {readXgFile, SourceUnavailable} = await import('../scripts/prime_refresh_policy.mjs');
  let calls = 0;
  const request = async () => (++calls === 1 ? new Response('',{status:503}) : new Response('verified'));
  assert.equal(await readXgFile('index.json', request, async()=>{}), 'verified');
  assert.equal(calls,2);
  calls=0;
  await assert.rejects(readXgFile('index.json', async()=>{calls++;throw Error('timeout');}, async()=>{}), SourceUnavailable);
  assert.equal(calls,3);
  await assert.rejects(readXgFile('index.json', async()=>new Response('',{status:404}), async()=>{}), /404/);
});

test('a stale or unreachable Pages feed falls back to a valid mirror without rollback', async () => {
  const {loadSnapshot}=await import('../docs/algorithm/refresh-state.js');
  const now = Date.parse('2026-11-25T09:00:00Z');
  const snapshot = at => ({asOf:at, xgTime:at, calendarTime:at, version:1, matches:[], audit:[], euroAudit:[]});
  const old = snapshot('2026-11-25T04:30:00Z'), fresh=snapshot('2026-11-25T08:55:00Z');
  const read = async path => path==='pages'?old:fresh;
  assert.deepEqual(await loadSnapshot(read,'pages','mirror',now),fresh);
  assert.deepEqual(await loadSnapshot(async path => {if(path==='pages') throw Error(); return fresh;},'pages','mirror',now),fresh);
  assert.deepEqual(await loadSnapshot(async path => {if(path==='mirror') throw Error(); return old;},'pages','mirror',now),old);
  await assert.rejects(loadSnapshot(async()=>old,'pages','mirror',now,fresh));
  await assert.rejects(loadSnapshot(async()=>snapshot('2026-11-26T00:00:00Z'),'pages','mirror',now));
});
