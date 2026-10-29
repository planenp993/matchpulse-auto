'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const B=require('../scripts/schedule_archive.cjs'),J=require('../scripts/forecast_diary.cjs'),C=require('../docs/scout-core.js'),UI=require('../docs/scout-calendar.js');
const record=J.readLedger('docs/data/diary/selections/match-plans-v3').forecasts[0];
const now=new Date('2026-10-29T08:00:00Z');
function registry(){return {schema:1,matches:{one:{id:'one',schedule:['I1','Italy','Serie A','2026-10-28','19:30','Milan','Bologna'],kickoff_utc:record.kickoff_utc,state:'awaiting_result',result:null}}};}
const ledger=(r=record,version='match-plans-v3',events=[])=>({version,forecasts:[r],events});
test('Past calendar survives removal from the upcoming feed and preserves exact sealed forecasts',()=>{
 const source=registry(),before=JSON.stringify([source,record]);
 const doc=B.build({registry:source,ledgers:[ledger()],now});
 assert.equal(doc.entries.length,1);const e=doc.entries[0];
 assert.deepEqual(e.forecast.selection.main,record.selection.main);assert.deepEqual(e.forecast.model.probabilities,record.model.probabilities);
 assert.equal(UI.merge([],doc,C).length,1);assert.equal(C.getUpcoming(UI.merge([],doc,C),now).length,0);
 assert.equal(JSON.stringify([source,record]),before);assert.equal(e.score,null);assert.equal(UI.status(e),'Чака резултат');
 assert.match(UI.planHTML(e),/Предмачов запис/);assert.ok(!UI.planHTML(e).includes('data-selection-input'));
 assert.deepEqual(UI.model(e).distribution.probs,record.model.probabilities);
});
test('Frozen abstention of the current version cannot be replaced by an older successful selection',()=>{
 const {sha256,...payload}=structuredClone(record);payload.selection.main=null;payload.selection.reason='Няма достатъчна основа';
 const newer=J.seal(payload),doc=B.build({registry:registry(),ledgers:[ledger(record,'match-plans-v2'),ledger(newer)],now});
 assert.equal(doc.entries[0].forecast.selection.main,null);assert.match(UI.planHTML(doc.entries[0]),/Без основен избор при записа/);
});
test('Archive validates record seals and never manufactures a forecast or a missing score',()=>{
 const corrupt=structuredClone(record);corrupt.selection.main.probability=.99;
 assert.throws(()=>B.build({registry:registry(),ledgers:[ledger(corrupt)],now}),/hash mismatch/);
 const doc=B.build({registry:registry(),ledgers:[],now}),e=doc.entries[0];assert.equal(e.forecast,null);assert.equal(UI.model(e),null);
 assert.match(UI.planHTML(e),/няма запазена/);assert.ok(!UI.brief(e).includes('Победа на домакина'));
 const source=registry();source.matches.one.state='final';source.matches.one.result=[2,1];
 const final=B.build({registry:source,ledgers:[],now}).entries[0];assert.equal(UI.status(final),'Краен резултат 2:1');
 source.matches.one.state='conflict';assert.equal(B.build({registry:source,ledgers:[],now}).entries[0].score,null);
});
test('One fixture has one row, the bounded calendar does not alter immutable source ledgers',()=>{
 const doc=B.build({registry:registry(),ledgers:[ledger()],now}),f=doc.entries[0].fixture;
 assert.equal(UI.merge([f,f],doc,C).length,1);assert.equal(UI.valid(doc),true);
 assert.equal(B.build({registry:registry(),ledgers:[ledger()],now:new Date('2027-01-01T08:00Z')}).entries.length,0);
 assert.ok(!UI.planHTML(null).includes('NaN'));
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync('docs/scout-calendar.js')).digest('hex').slice(0,12);
 assert.ok(html.includes('scout-calendar.js?v='+hash));assert.ok(builder.includes('schedule_archive.json'));
});
test('A schedule correction discloses the new kickoff and preserves the original day and frozen choice',()=>{
 const event=J.seal({schema:1,forecast_id:record.id,revision:1,observed_at_utc:now.toISOString(),
  state:{status:'pending',kickoff_utc:'2026-11-01T17:30:00Z',result:null,reason:null}});
 const e=B.build({registry:registry(),ledgers:[ledger(record,'match-plans-v3',[event])],now}).entries[0];
 assert.equal(e.fixture[3],record.fixture.date);assert.deepEqual(e.forecast.selection.main,record.selection.main);
 assert.equal(UI.status(e),'Променен график');assert.match(UI.planHTML(e),/Променен начален час/);
});
