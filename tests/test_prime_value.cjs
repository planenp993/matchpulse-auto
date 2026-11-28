'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const DAY='2026-11-28',NOW=Date.parse(DAY+'T08:00:00Z'),AT=new Date(NOW).toISOString(),KICK=DAY+'T14:00:00.000Z';
const config={...JSON.parse(fs.readFileSync('docs/algorithm/data/prime-value/config.json')),createdAt:DAY+'T07:00:00Z'};
const seal=r=>({...r,sha256:createHash('sha256').update(JSON.stringify(r)).digest('hex')});
const probs=(o,b=.62)=>({over_2_5:o,under_2_5:1-o,btts_yes:b,btts_no:1-b});
const m=(id='epl/1',p=.63,c=.62)=>({id,league:'E0',model:'similar_defence',home:'Home '+id,away:'Away '+id,
 kickoff:KICK,issued:AT,probabilities:probs(.8),selectionForecast:{probabilities:probs(p)},chances:probs(c)});
const snapshot=matches=>({version:1,asOf:AT,forecastRelease:'prime-forecast-2026-11-v1',matches});
const makePair=(fixture,price=1.90,other=1.96,patch={})=>({matchId:fixture.id,kickoff:fixture.kickoff,family:'over_2_5',
 selected:price,opposite:other,seen:AT,source:'Test Bookmaker',kind:'owner',...patch});

test('Prime Value uses both independent probabilities and the de-margined market, not the already blended 80/20 forecast',async()=>{
 const {valueFixtures,assessPair,RULE}=await import('../docs/algorithm/prime-value-v1.js');
 const pool=valueFixtures(snapshot([m()]),{}, {},NOW);assert.equal(pool.fixtures.length,1);
 const f=pool.fixtures[0],pair=makePair(f),[r,opp]=assessPair(f,'over_2_5',pair,NOW);
 const market=(1/1.90)/(1/1.90+1/1.96);
 assert.equal(r.prime,.63);assert.equal(r.chances,.62);
 assert.ok(Math.abs(r.market-market)<1e-12);
 assert.ok(Math.abs(r.p-(.5*market+.25*.63+.25*.62))<1e-12);
 assert.equal(r.reason,'pass');assert.ok(r.edge>=RULE.minEdge);
 assert.equal(opp.key,'under_2_5');assert.equal(opp.price,1.96);assert.equal(opp.reason,'direction');
 const short=assessPair(f,'over_2_5',makePair(f,1.33,3.5),NOW);
 assert.ok(short.every(r=>r.reason==='price'));
 const disagree=valueFixtures(snapshot([m('x',.65,.45)]),{}, {},NOW).fixtures[0];
 assert.equal(assessPair(disagree,'over_2_5',makePair(disagree),NOW)[0].reason,'agreement');
 const missing={...m(),chances:null};assert.equal(valueFixtures(snapshot([missing]),{}, {},NOW).fixtures.length,0);
});

test('both sides must be fresh, correctly oriented, exact-match quote pairs with enough lead time',async()=>{
 const {valueFixtures,assessPair}=await import('../docs/algorithm/prime-value-v1.js');
 const f=valueFixtures(snapshot([m()]),{}, {},NOW).fixtures[0];
 for(const patch of [{opposite:null},{source:''},{source:'Пазарна средна'},{seen:DAY+'T06:59:59Z'},
   {seen:DAY+'T08:01:00Z'},{kickoff:DAY+'T14:05:00Z'},{matchId:'different'},{family:'btts_yes'}])
  assert.deepEqual(assessPair(f,'over_2_5',makePair(f,1.90,1.96,patch),NOW),[]);
 assert.ok(assessPair(f,'over_2_5',makePair(f,1.70,1.50),NOW).every(r=>r.reason==='margin'));
 assert.equal(valueFixtures({...snapshot([m()]),forecastRelease:'changed'},{},{},NOW).status,'release');
 assert.equal(valueFixtures(snapshot([m()]),{}, {},NOW+2*3600000+1).status,'stale');
 assert.equal(valueFixtures(snapshot([{...m(),kickoff:DAY+'T09:29:00Z'}]),{},{},NOW).fixtures.length,0);
 assert.equal(valueFixtures(snapshot([{...m(),reserveOnly:true}]),{},{},NOW).fixtures.length,0);
});

test('daily cap is three distinct fixtures, no forced entry and no replacement once sealed',async()=>{
 const {valueFixtures,assessPair,rankValue,sealValuePick}=await import('../docs/algorithm/prime-value-v1.js');
 const pool=valueFixtures(snapshot([m('a'),m('b'),m('c'),m('d')]),{}, {},NOW);
 const rows=pool.fixtures.flatMap(f=>assessPair(f,'over_2_5',makePair(f),NOW));
 assert.equal(rankValue(rows,[],DAY).length,3);
 const first=sealValuePick(rankValue(rows,[],DAY)[0],AT,AT,'public');
 const subsequent=rankValue(rows,[first],DAY);
 assert.equal(subsequent.length,2);assert.ok(subsequent.every(r=>r.fixture.id!==first.fixture.id));
 const all=[first,...subsequent.map(r=>sealValuePick(r,AT,AT,'public'))];
 assert.deepEqual(rankValue(rows,all,DAY),[]);
 assert.deepEqual(rankValue(rows.map(r=>({...r,reason:'price'})),[],DAY),[]);
});

test('public evaluation replays its exact fixed rule, keeps quote provenance, zero coverage and settlement separate',async()=>{
 const {buildEvaluation,validateLedger,buildState}=await import('../scripts/prime_value_diary.mjs');
 const {valueFixtures,valueSettlement}=await import('../docs/algorithm/prime-value-v1.js');
 const one=m(),snap=snapshot([one]),f=valueFixtures(snap,{}, {},NOW).fixtures[0];
 const options={snapshot:snap,fitted:{},euroFitted:{},raw:{fixtures:{}},submissions:{schema:1,fixtures:{}},
  snapshotHash:'a'.repeat(64),quoteHash:'b'.repeat(64),compatible:true,now:NOW,previous:[]};
 const none=buildEvaluation(options);assert.equal(none.status,'no_quotes');assert.equal(none.picks.length,0);
 assert.equal(none.counts.twoModels,1);
 const submitted={schema:1,fixtures:{[f.id]:{kickoff:KICK,markets:{over_2_5:{selected:1.9,opposite:1.96,seen:AT,source:'Test Bookmaker'}}}}};
 const ev=buildEvaluation({...options,submissions:submitted});
 assert.equal(ev.status,'selected');assert.equal(ev.picks.length,1);assert.equal(ev.picks[0].pair.kind,'owner');
 assert.equal(ev.evidence.length,1);
 assert.equal(buildEvaluation({...options,submissions:submitted,compatible:false}).status,'fingerprint');
 assert.equal(buildEvaluation({...options,submissions:submitted,previous:ev.picks}).picks.length,0);
 const evaluations=[seal(none),seal(ev)];
 const observed=DAY+'T18:00:00.000Z',bucket={results:[{key:f.calendarKey,score:[2,1],observed,source:'Regulation archive',exactKickoff:true,kickoff:KICK}]};
 const actual=valueSettlement(ev.picks[0],bucket,Date.parse(observed));assert.equal(actual.state,'hit');
 const results=[seal({id:ev.picks[0].id,at:observed,result:actual})];
 const state=buildState(config,evaluations,results);
 assert.equal(state.stats.recorded,1);assert.equal(state.stats.hits,1);assert.ok(Math.abs(state.stats.roi-.9)<1e-12);
 assert.equal(state.days[0].checked,2);assert.equal(state.days[0].selected,1);
 const conflict=valueSettlement(ev.picks[0],{results:[{...bucket.results[0],conflict:true}]},Date.parse(observed));
 assert.equal(conflict.state,'review');
 const later=[...results,seal({id:ev.picks[0].id,at:observed,result:conflict})];
 assert.equal(buildState(config,evaluations,later).stats.settled,0);
 assert.equal(buildState(config,evaluations,later).stats.roi,null);
 const tampered=structuredClone(evaluations);tampered[1].picks[0].price=2;
 assert.throws(()=>validateLedger(config,tampered,results),/Changed sealed/);
 const resealed=seal({...ev,picks:[{...ev.picks[0],price:2}]});
 assert.throws(()=>validateLedger(config,[seal(none),resealed],results),/fixed rule/);
});

test('raw same-book O/U pair is accepted only while fresh; BTTS is not inferred',async()=>{
 const {buildEvaluation}=await import('../scripts/prime_value_diary.mjs');
 const {matchKey}=await import('../docs/algorithm/catalog.js');
 const fixture=m(),key=matchKey(['E0',null,null,DAY,null,fixture.home,fixture.away]);
 const line={o25:{odds:1.90,column:'B365>2.5',book:'bet365',observed_at_utc:AT},u25:{odds:1.96,column:'B365<2.5',book:'bet365',observed_at_utc:AT}};
 const args={snapshot:snapshot([fixture]),fitted:{},euroFitted:{},submissions:{schema:1,fixtures:{}},
  snapshotHash:'a'.repeat(64),quoteHash:'b'.repeat(64),compatible:true,now:NOW,previous:[]};
 const ev=buildEvaluation({...args,raw:{fixtures:{[key]:line}}});
 assert.equal(ev.evidence.length,1);assert.equal(ev.evidence[0].pair.kind,'csv');assert.equal(ev.evidence[0].family,'over_2_5');
 const mismatched={...line,u25:{...line.u25,book:'pinnacle'}};
 assert.equal(buildEvaluation({...args,raw:{fixtures:{[key]:mismatched}}}).counts.quotedPairs,0);
 const old={o25:{...line.o25,observed_at_utc:DAY+'T06:00:00Z'},u25:{...line.u25,observed_at_utc:DAY+'T06:00:00Z'}};
 assert.equal(buildEvaluation({...args,raw:{fixtures:{[key]:old}}}).counts.quotedPairs,0);
});
