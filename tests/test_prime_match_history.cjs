const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');

const day = '2026-11-27';
const kickoff = day + 'T19:45:00Z';
const match = (over, issued = day + 'T13:00:00Z', patches = {}) => ({
  id: 'ligue-1/12345', league: 'F1', model: 'similar_defence', home: 'Brest', away: 'Paris',
  kickoff, issued, facts: {}, probabilities: { over_2_5: over, under_2_5: 1-over, btts_yes: .57, btts_no: .43 }, ...patches
});
const snapshot = (m, asOf) => ({ version: 1, asOf, matches: [m] });

test('all-match forecast is the last actual publication before kickoff and never a replay', async () => {
  const { captureSnapshot, validateDay } = await import('../scripts/prime_match_history.mjs');
  const forecasts = new Map();
  const firstAt = day + 'T13:00:00Z', finalAt = day + 'T17:00:00Z';
  captureSnapshot(forecasts, snapshot(match(.55), firstAt), 'a'.repeat(40), day+'T13:01:00Z');
  captureSnapshot(forecasts, snapshot(match(.57,finalAt), finalAt), 'b'.repeat(40), day+'T17:01:00Z');
  // The snapshot may claim it was calculated early, but was committed after kickoff.
  captureSnapshot(forecasts, snapshot(match(.72,finalAt), finalAt), 'c'.repeat(40), day+'T20:15:00Z');
  captureSnapshot(forecasts, snapshot(match(.83,day+'T17:10:00Z',{model:'retrospective'}), day+'T17:10:00Z'),
    'd'.repeat(40),day+'T17:11:00Z');
  const saved=forecasts.get(day);
  assert.equal(saved.forecasts.length,1);
  assert.equal(saved.forecasts[0].commit,'b'.repeat(40));
  assert.equal(saved.forecasts[0].m.probabilities.over_2_5,.57);
  assert.doesNotThrow(()=>validateDay(saved));
  const changed=structuredClone(saved);changed.forecasts[0].published=day+'T20:00:00Z';
  assert.throws(()=>validateDay(changed),/not published before kickoff/);
});

test('historical result-only matches stay visible, and real scores never modify pre-match probabilities', async () => {
  const {captureSnapshot,settleCalendar}=await import('../scripts/prime_match_history.mjs');
  const {calendarRows,marketOutcome,forecastMarkets,calendarKey}=await import('../docs/algorithm/calendar-view.js');
  const forecasts=new Map(),asOf=day+'T13:00:00Z',observed='2026-11-28T03:00:00Z';
  const last=snapshot(match(.58),asOf);
  captureSnapshot(forecasts,last,'a'.repeat(40),day+'T13:01:00Z');
  const rows=[
    ['F1','France','Ligue 1',day,'21:45','Stade Brestois 29','Paris FC',1,0],
    ['D1','Germany','Bundesliga',day,'21:30','Bayern Munich','Union Berlin',2,1],
    ['E0','England','Premier League',day,'21:00','A','B',3,0,null,null,null,null,{AWARDED:true}],
  ];
  settleCalendar(forecasts,{history:rows,europeHistory:[],status:{last_build_utc:observed},
    europeCoverage:{checked_utc:observed},snapshot:{matches:[]},now:Date.parse(observed)});
  const actual=calendarRows(forecasts.get(day),{asOf:observed,matches:[]},day,Date.parse(observed));
  assert.equal(actual.length,2);
  const saved=actual.find(m=>m.league==='F1'),resultOnly=actual.find(m=>m.league==='D1');
  assert.deepEqual(saved.result,[1,0]);
  assert.deepEqual(saved.probabilities,last.matches[0].probabilities);
  assert.equal(resultOnly.probabilities,undefined);
  assert.equal(resultOnly.calendarState,'final');
  assert.notEqual(calendarKey('F1',day,'Brest','Paris Saint Germain'),calendarKey('F1',day,'Brest','Paris'));
  assert.deepEqual(forecastMarkets(saved.probabilities),['over_2_5','btts_yes']);
  assert.equal(marketOutcome('over_2_5',saved.result),false);
  assert.equal(marketOutcome('btts_no',saved.result),true);
});

test('conflicting results are flagged without changing the original score', async () => {
  const {settleCalendar}=await import('../scripts/prime_match_history.mjs');
  const days=new Map(),observed='2026-11-28T02:30:00Z';
  const history=[['D1','Germany','Bundesliga',day,'20:00','Bayern','Union Berlin',2,1]];
  const ctx={history,europeHistory:[],status:{last_build_utc:observed},europeCoverage:{checked_utc:observed},
    snapshot:{matches:[]},now:Date.parse(observed)};
  settleCalendar(days,ctx);
  history[0][7]=0;
  settleCalendar(days,ctx);
  assert.deepEqual(days.get(day).results[0].score,[2,1]);
  assert.equal(days.get(day).results[0].conflict,true);
});

test('a corrected actual kickoff invalidates a forecast published too late without hiding the result', async () => {
  const {captureSnapshot,settleCalendar}=await import('../scripts/prime_match_history.mjs');
  const {calendarRows}=await import('../docs/algorithm/calendar-view.js');
  const days=new Map(),asOf=day+'T17:00:00Z',observed='2026-11-28T03:00:00Z';
  captureSnapshot(days,snapshot(match(.58,asOf),asOf),'a'.repeat(40),day+'T17:01:00Z');
  const key=days.get(day).forecasts[0].key;
  settleCalendar(days,{history:[],europeHistory:[],status:{last_build_utc:observed},
    europeCoverage:{checked_utc:observed},now:Date.parse(observed),snapshot:{calendarResults:[
      {key,league:'F1',home:'Brest',away:'Paris',kickoff:day+'T16:00:00Z',score:[2,1],observed,source:'xGTables',exactKickoff:true}
    ]}});
  const [row]=calendarRows(days.get(day),{matches:[],asOf:observed},day,Date.parse(observed));
  assert.deepEqual(row.result,[2,1]);
  assert.equal(row.probabilities,undefined);
});

test('calendar archive shards match their index and keep genuine forecasting timestamps', async()=>{
  const {validateDay}=await import('../scripts/prime_match_history.mjs');
  const file='docs/algorithm/data/match-history/';
  const index=JSON.parse(fs.readFileSync(file+'index.json'));
  assert.equal(index.start,'2026-11-23');
  assert.ok(Object.keys(index.days).length>=5);
  for(const [day,meta] of Object.entries(index.days)){
    const bytes=fs.readFileSync(file+day+'.json.gz');
    assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256);
    const bucket=JSON.parse(gunzipSync(bytes));
    validateDay(bucket);
    assert.equal(bucket.forecasts.length,meta.forecasts);
    assert.equal(bucket.results.length,meta.results);
  }
});

test('actual-price check rejects the reported short odds, accepts a sufficient price, and never forces a pick', async()=>{
  const {evaluatePrice,parseOdds,qualifyingPrices,availableQuote}=await import('../docs/algorithm/value-check.js');
  assert.equal(parseOdds('1,33'),1.33);
  assert.equal(parseOdds('1.48'),1.48);
  for(const invalid of ['','1','1,2,3','foo','Infinity','0.8']) assert.equal(parseOdds(invalid),null);
  const low=[[.5787,1.33],[.581,1.47],[.5813,1.48]].map(([p,price],i)=>({
    candidate:{m:{id:String(i)},p},assessment:evaluatePrice(p,price)
  }));
  assert.ok(low.every(row=>row.assessment.state==='negative'));
  assert.deepEqual(qualifyingPrices(low),[]);
  assert.equal(evaluatePrice(.5787,1.82).state,'passes');
  assert.equal(evaluatePrice(.58,1.75).state,'below');
  assert.equal(evaluatePrice(.58,'').state,'unknown');
  assert.equal(evaluatePrice(.8,1.50).state,'below');
  const now=Date.parse(day+'T17:00:00Z');
  const candidate={m:{...match(.58),marketPrices:{over_2_5:{selected:1.82,opposite:2.04,seen:day+'T16:30:00Z',source:'Bet365'}}},
    key:'under_2_5',price:{selected:2,opposite:1.82,seen:day+'T14:00:00Z',source:'Bet365'}};
  assert.equal(availableQuote(candidate,now).selected,2.04);
  assert.equal(availableQuote(candidate,now+3*3600000),null);
});
