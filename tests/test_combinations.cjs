'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const V1=require('../docs/scout-selections.js'),S=require('../docs/scout-combinations.js'),C=require('../docs/scout-core.js'),M=require('../docs/model-core.js'),A=require('../docs/scout-archive.js');
const read=n=>JSON.parse(fs.readFileSync('docs/data/'+n+'.json')),history=read('history'),fixtures=JSON.parse(fs.readFileSync('tests/fixtures/selection-calendar-2026-10-28.json'));
const now=new Date('2026-10-28T07:00:00Z'),archive=A.build(C,history,read('europe_history'),read('match_links'),read('europe_fixture_names'));
const current=S.createEngine(history,M,C),old=V1.createEngine(history,M,C);
const week=fixtures.filter(f=>f[3]>='2026-10-28'&&f[3]<='2026-11-03');
const options=f=>{const recent=archive.recentProfile(f,{windowSize:10,now});return {profile:archive.profile(f,{windowSize:10}),now,pending:!!(recent.home.pendingLatest||recent.away.pendingLatest)};};
const entries=week.map(f=>current.evaluate(f,options(f)));
test('Moved match forecasts preserve the frozen v1 choice, alternatives and all unrounded model probabilities',()=>{
 for(const result of entries){const before=old.evaluate(result.fixture,options(result.fixture));
  assert.deepEqual(result.main,before.main);assert.deepEqual(result.alternatives,before.alternatives);
  assert.deepEqual(result.model,before.model);assert.equal(result.reason,before.reason);
 }
});
test('More builders remain nonredundant intersections, supported jointly and diverse in score outcomes',()=>{
 let oldCount=0,total=0;
 for(const entry of entries){
  oldCount+=old.evaluate(entry.fixture,options(entry.fixture)).builders.length;total+=entry.builders.length;
  assert.ok(entry.builders.length<=6);const family=new Map();
  for(const builder of entry.builders){
   family.set(builder.familyPair,(family.get(builder.familyPair)||0)+1);assert.ok(family.get(builder.familyPair)<=2);
   const matrix=entry.model.distribution.matrix;assert.equal(builder.probability,S.probability(matrix,builder.legs));
   assert.ok(builder.probability>=.3&&builder.probability<=.78);
   assert.ok(builder.probability<Math.min(...builder.legs.map(id=>S.probability(matrix,[id])))-1e-9);
   assert.ok(builder.evidence.modelLift>=S.RULES.minModelLift&&builder.evidence.formLift>=S.RULES.minFormLift);
  }
  for(let i=0;i<entry.builders.length;i++)for(let j=i+1;j<entry.builders.length;j++)assert.ok(S.overlap(entry.model.distribution.matrix,entry.builders[i].legs,entry.builders[j].legs)<=.92);
 }
 assert.ok(total>oldCount);assert.ok(entries.some(e=>e.builders.length>=4));
});
test('Columns expand through both fixtures and eligible alternative markets without duplicating clubs or dates',()=>{
 const out=S.columns(entries,C),before=V1.columns(entries,C);assert.ok(out.length>before.length);
 const seen=new Set(),sets=new Map(),groups=new Map();
 for(const column of out){
  assert.equal(new Set(column.legs.map(l=>l.key)).size,column.size);
  assert.equal(new Set(column.legs.flatMap(l=>[C.keyTeam(l.fixture[5]),C.keyTeam(l.fixture[6])])).size,column.size*2);
  assert.ok(column.legs.every(l=>l.fixture[3]===column.date&&l.pick.eligible&&l.pick.probability>=.55));
  assert.equal(column.probability,column.legs.reduce((p,l)=>p*l.pick.probability,1));assert.equal(column.fair,1/column.probability);
  assert.equal(column.assumption,'independent_matches');assert.ok(!seen.has(column.key));seen.add(column.key);
  const group=column.date+'|'+column.size;groups.set(group,(groups.get(group)||0)+1);assert.ok(groups.get(group)<=6);
  const key=group+'|'+column.legs.map(l=>l.key).sort().join('~');sets.set(key,(sets.get(key)||0)+1);assert.ok(sets.get(key)<=2);
 }
 assert.ok([...groups.values()].some(n=>n===6));
 assert.ok(out.some(c=>c.legs.some(l=>entries.find(e=>C.keyFixture(e.fixture)===l.key).main.id!==l.pick.id)));
});
test('Column price filters apply to every exact leg and do not alter the main forecast to fill slots',()=>{
 const copy=structuredClone(entries);for(const e of copy)for(const p of [e.main,...e.alternatives].filter(Boolean))p.quote={aboveModel:false};
 assert.equal(S.columns(copy,C,{priceOnly:true}).length,0);
 for(const e of copy)if(e.alternatives[0])e.alternatives[0].quote.aboveModel=true;
 const out=S.columns(copy,C,{priceOnly:true});assert.ok(out.length>0);assert.ok(out.every(c=>c.legs.every(l=>l.pick.quote.aboveModel)));
});
test('Duplicate fixtures, aliases, tiny pools and unsupported games cannot force combination slots',()=>{
 const eligible=entries.find(e=>e.main),copy=structuredClone(eligible);copy.fixture[5]=copy.fixture[6];
 assert.equal(S.columns([eligible,eligible,copy],C).length,0);
 for(const f of fixtures.filter(f=>['UCL','UEL','UECL'].includes(f[0])).slice(0,3)){
  const r=current.evaluate(f,options(f));assert.equal(r.main,null);assert.equal(r.builders.length,0);
 }
});
test('Both selection versions and new browser assets are independently content-versioned and embedded offline',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 assert.ok(!html.includes('data-selection-tab="matches"'));assert.ok(html.includes('data-selection-tab="builders" aria-selected="true"'));
 for(const name of ['scout-combinations.js','scout-selection-ui.js']){
  const hash=crypto.createHash('sha256').update(fs.readFileSync('docs/'+name)).digest('hex').slice(0,12);assert.ok(html.includes(name+'?v='+hash));assert.ok(builder.includes(name));
 }
 assert.ok(fs.readFileSync('scripts/selection_diary.cjs','utf8').includes("require('../docs/scout-selections.js')"));
 assert.ok(fs.readFileSync('scripts/match_plan_diary.cjs','utf8').includes("require('../docs/scout-combinations.js')"));
});
