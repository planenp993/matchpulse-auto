'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const V2=require('../docs/scout-combinations.js'),S=require('../docs/scout-curated.js'),C=require('../docs/scout-core.js'),M=require('../docs/model-core.js'),A=require('../docs/scout-archive.js');
const read=n=>JSON.parse(fs.readFileSync('docs/data/'+n+'.json')),history=read('history'),fixtures=JSON.parse(fs.readFileSync('tests/fixtures/selection-calendar-2026-10-28.json')),now=new Date('2026-10-28T07:00Z');
const archive=A.build(C,history,read('europe_history'),read('match_links'),read('europe_fixture_names')),engine=S.createEngine(history,M,C),v2=V2.createEngine(history,M,C);
const opts=f=>{const r=archive.recentProfile(f,{windowSize:10,now});return {profile:archive.profile(f,{windowSize:10}),now,pending:!!(r.home.pendingLatest||r.away.pendingLatest)};};
const entries=fixtures.filter(f=>f[3]>='2026-10-28'&&f[3]<='2026-11-03').map(f=>engine.evaluate(f,opts(f)));
test('Exactly the existing singles and probabilities survive, with at most two legitimate builders per fixture',()=>{
 let foundTwo=false;
 for(const e of entries){const old=v2.evaluate(e.fixture,opts(e.fixture));assert.deepEqual(e.main,old.main);assert.deepEqual(e.alternatives,old.alternatives);assert.deepEqual(e.model,old.model);
  assert.ok(e.builders.length<=2);foundTwo||=e.builders.length===2;
  assert.ok(e.builders.every(b=>old.builders.some(o=>o.id===b.id&&o.probability===b.probability)));
  if(e.builders.length===2&&old.builders.some(b=>b.familyPair!==old.builders[0].familyPair))assert.notEqual(e.builders[0].familyPair,e.builders[1].familyPair);
 }
 assert.ok(foundTwo);
});
test('Odds bands have precise unrounded boundaries and never turn model odds into market quotes',()=>{
 for(const [odds,id] of [[3,'3-6'],[5.999,'3-6'],[6,'6-12'],[11.999,'6-12'],[12,'12-24'],[24,'12-24']])assert.equal(S.bandFor(odds).id,id);
 for(const odds of [2.999,24.001,NaN,Infinity,null])assert.equal(S.bandFor(odds),null);
});
test('All three odds levels use supported picks, exact products, one date and unique canonical clubs',()=>{
 const columns=S.columns(entries,C),seen=new Set(),counts=new Map();assert.ok(columns.length);
 for(const band of S.BANDS)assert.ok(columns.some(c=>c.band===band.id),band.id);
 for(const c of columns){assert.equal(c.probability,c.legs.reduce((p,l)=>p*l.pick.probability,1));assert.equal(c.fair,1/c.probability);assert.equal(S.bandFor(c.fair).id,c.band);
  assert.equal(c.oddsBasis,'model_fair');assert.equal(c.assumption,'independent_matches');assert.ok(c.size>=2&&c.size<=8);
  assert.equal(new Set(c.legs.map(l=>l.key)).size,c.size);assert.equal(new Set(c.legs.flatMap(l=>[C.keyTeam(l.fixture[5]),C.keyTeam(l.fixture[6])])).size,c.size*2);
  assert.ok(c.legs.every(l=>l.fixture[3]===c.date&&l.pick.eligible&&l.pick.probability>=.55));assert.ok(!seen.has(c.key));seen.add(c.key);
  const key=c.date+'|'+c.band;counts.set(key,(counts.get(key)||0)+1);assert.ok(counts.get(key)<=6);
 }
 assert.ok(columns.some(c=>c.band==='12-24'&&c.size>=5));
});
test('Price filter covers every leg; tiny and duplicated pools cannot manufacture high-odds columns',()=>{
 const copy=structuredClone(entries);for(const e of copy)for(const p of [e.main,...e.alternatives].filter(Boolean))p.quote={aboveModel:false};
 assert.equal(S.columns(copy,C,{priceOnly:true}).length,0);
 for(const e of copy)if(e.alternatives[0])e.alternatives[0].quote.aboveModel=true;
 const columns=S.columns(copy,C,{priceOnly:true});assert.ok(columns.length);assert.ok(columns.every(c=>c.legs.every(l=>l.pick.quote.aboveModel)));
 const one=entries.find(e=>e.main);assert.equal(S.columns([one,one],C).length,0);
});
test('Diversified columns have distinct fixture sets and limit reuse of one exact selection',()=>{
 const columns=S.columns(entries,C),groups=new Map();
 for(const c of columns){const id=c.date+'|'+c.band;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(c);}
 for(const list of groups.values()){
  assert.equal(new Set(list.map(c=>c.legs.map(l=>l.key).sort().join('~'))).size,list.length);
  const uses=new Map();for(const c of list)for(const l of c.legs){const key=l.key+'|'+l.pick.id;uses.set(key,(uses.get(key)||0)+1);}assert.ok([...uses.values()].every(n=>n<=3));
 }
});
test('New assets are content-versioned and offline, while v1 and v2 recorders keep their engines',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 for(const name of ['scout-curated.js','scout-selection-ui.js']){const h=crypto.createHash('sha256').update(fs.readFileSync('docs/'+name)).digest('hex').slice(0,12);assert.ok(html.includes(name+'?v='+h));assert.ok(builder.includes(name));}
 for(const b of S.BANDS)assert.ok(html.includes('data-selection-band="'+b.id+'"'));
 assert.ok(fs.readFileSync('scripts/match_plan_diary.cjs','utf8').includes("require('../docs/scout-combinations.js')"));
 assert.ok(fs.readFileSync('scripts/curated_diary.cjs','utf8').includes("require('../docs/scout-curated.js')"));
});
