'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const D=require('../scripts/curated_diary.cjs'),J=require('../scripts/forecast_diary.cjs'),S=require('../docs/scout-curated.js'),C=require('../docs/scout-core.js');
const history=JSON.parse(fs.readFileSync('docs/data/history.json')),all=JSON.parse(fs.readFileSync('tests/fixtures/selection-calendar-2026-10-28.json'));
const now=new Date('2026-10-28T07:00:00Z'),config=D.configFor(new Date('2026-10-28T06:00:00Z'));
const fixtures=all.filter(f=>['E0','I1'].includes(f[0])&&f[3]>='2026-10-28'&&f[3]<='2026-10-30');
const args={history,fixtures,now,config,matchLinks:J.readMatchLinks()};
test('Selection records start prospectively, freeze picks and deduplicate captures',()=>{
 const out=D.advance(args);assert.ok(out.newForecasts.length>0);
 const before=J.canonical(out.newForecasts);
 for(const e of out.newForecasts){
  assert.ok(Date.parse(e.kickoff_utc)-Date.parse(e.captured_at_utc)>=30*60000);
  assert.equal(e.selection.version,S.VERSION);
  if(e.selection.main)assert.equal(e.selection.main.fair,1/e.selection.main.probability);
 }
 const again=D.advance({...args,forecasts:out.newForecasts,events:out.newEvents,now:new Date('2026-10-28T07:10:00Z')});
 assert.equal(again.newForecasts.length,0);assert.equal(J.canonical(out.newForecasts),before);
 assert.equal(again.report.method.original_diary_records_included,false);
 assert.equal(again.report.method.manual_prices_included,false);
});
test('Settlements and corrections append events without recalculating the captured choice',()=>{
 const first=D.advance(args),e=first.newForecasts.find(f=>f.selection.main);assert.ok(e);
 const f=fixtures.find(f=>C.keyFixture(f)===e.fixture_key),actual=[...f];actual[7]=2;actual[8]=1;actual[13]={};
 const settled=D.advance({...args,history:[...history,actual],forecasts:first.newForecasts,events:first.newEvents,now:new Date('2026-10-31T12:00:00Z')});
 const event=settled.newEvents.find(v=>v.forecast_id===e.id);assert.equal(event.state.status,'settled');
 assert.equal(D.won(e.selection.main,[2,1]),e.selection.main.legs.every(id=>S.MARKETS.find(m=>m.id===id).test(2,1)));
 const correction=[...actual];correction[7]=0;correction[8]=0;
 const revised=D.advance({...args,history:[...history,correction],forecasts:first.newForecasts,events:[...first.newEvents,...settled.newEvents],now:new Date('2026-11-01T12:00:00Z')});
 const last=revised.newEvents.find(v=>v.forecast_id===e.id);assert.equal(last.revision,event.revision+1);assert.deepEqual(last.state.result.score,[0,0]);
 assert.equal(e.sha256,first.newForecasts.find(f=>f.id===e.id).sha256);
});
test('Changed rules pause new captures, and original diary rows cannot masquerade as selections',()=>{
 const out=D.advance({...args,files:{...config.files,'docs/scout-curated.js':'0'.repeat(64)}});
 assert.equal(out.newForecasts.length,0);assert.equal(out.report.last_run.capture_paused,true);
 const old=J.advance(args);assert.throws(()=>D.validate(old.newForecasts,old.newEvents,config),/selection capture/);
 const captured=D.advance(args);if(captured.newForecasts.length){const tampered=structuredClone(captured.newForecasts);tampered[0].selection.reason='changed';assert.throws(()=>D.validate(tampered,[],config),/hash mismatch/);}
});
test('Recorded column levels and the two-builder limit are sealed and validated separately from prior cohorts',()=>{
 const out=D.advance(args),captured=out.newForecasts.find(e=>e.selection.columns.length);assert.ok(captured);
 for(const e of out.newForecasts){assert.ok(e.selection.builders.length<=2);for(const c of e.selection.columns){assert.equal(c.odds_basis,'model_fair');assert.equal(S.bandFor(c.fair).id,c.band);}}
 const tampered=structuredClone(out.newForecasts),index=tampered.findIndex(e=>e.id===captured.id);
 const {sha256,...payload}=tampered[index];payload.selection.columns[0].band=payload.selection.columns[0].band==='3-6'?'12-24':'3-6';tampered[index]=J.seal(payload);
 assert.throws(()=>D.validate(tampered,out.newEvents,config),/column band/);
});
