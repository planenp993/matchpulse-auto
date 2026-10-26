'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../docs/scout-core.js'),P=require('../docs/scout-patterns.js');
const R=require('../scripts/scanner_replay.cjs'),E=require('../scripts/evaluate_scanner.cjs');
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const day='2026-10-24',ago=(n,date=day)=>new Date(Date.parse(date+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
const stats=()=>({HC:6,AC:5,HY:3,AY:2,HR:0,AR:0,HS:15,AS:12,HST:5,AST:5,HTHG:1,HTAG:0});
const row=(date,h='Alpha',a='Beta',hg=2,ag=1,extra=stats(),division='E0')=>[division,'England','Test',date,'18:00',h,a,hg,ag,null,null,null,null,extra];
function seed(){return Array.from({length:100},(_,i)=>row(ago(40+i),'Home '+i,'Away '+i,i%4,i%3));}
function samples(n=20,h='Alpha',a='Beta'){
 const rows=[];for(let i=1;i<=n;i++){rows.push(row(ago(i),h,'H rival '+i));rows.push(row(ago(i),'A rival '+i,a));}return rows;
}
const fixture=(h='Alpha',a='Beta',date=day)=>row(date,h,a,null,null,null);
test('Indexed league references exactly match all markets and all four roles, including missing fields and date boundaries',()=>{
 const history=[...seed(),...samples(),row(day),row('2026-11-01'),row('2022-01-01'),
  row(ago(2),'Awarded','Other',3,0,{...stats(),AWARDED:true}),row(ago(3),'No stats','Other',1,1,null),row(ago(5),'Other league','Rival',4,4,stats(),'D1')];
 const before=JSON.stringify(history),index=Core.build(history),fast=R.referenceIndex(history);
 for(const date of [day,ago(30),'2026-11-02',day]){
  const f=fixture('Alpha','Beta',date),a=fast.forFixture(f,date),b=P.leagueReference(index,f,Core,date);
  assert.deepEqual(a,b);
 }
 assert.deepEqual(fast.forFixture(fixture(),ago(30)),P.leagueReference(index,fixture(),Core,ago(30)));
 assert.equal(JSON.stringify(history),before);
});
test('Current replay reproduces live all-market leaders and single-market ordering for each window and streak',()=>{
 const history=[...seed(),...samples(),...samples(10,'Gamma','Delta')],index=Core.build(history),refs=R.referenceIndex(history),fixtures=[fixture(),fixture('Gamma','Delta')];
 const now=new Date(day+'T08:00:00Z');
 for(const windowSize of [5,10,20])for(const streak of [3,4,5]){
  const entries=R.withStreak(R.inspectFixtures(index,refs,fixtures,windowSize).entries,streak),actual=R.rankDay(entries,'current');
  const expected=P.runAll(index,fixtures,Core,{windowSize,streak,days:1,now}).filter(e=>e.signal.evidence.reference.available);
  assert.deepEqual(actual.all.map(e=>[Core.keyFixture(e.fixture),e.signal]),expected.map(e=>[Core.keyFixture(e.fixture),e.signal]));
  for(const market of P.MARKETS){
   const one=P.run(index,fixtures,Core,{windowSize,streak,days:1,market:market.id,now}).filter(e=>e.signal.evidence.reference.available);
   assert.deepEqual((actual.markets.get(market.id)||[]).map(e=>[Core.keyFixture(e.fixture),e.signal]),one.map(e=>[Core.keyFixture(e.fixture),e.signal]));
  }
 }
});
test('Same-day and future scores or statistics cannot influence a selected historical signal',()=>{
 const history=[...seed(),...samples()],f=fixture(),replay=rows=>{
  const index=Core.build(rows);return R.rankDay(R.inspectFixtures(index,R.referenceIndex(rows),[f],10).entries,'current');
 };
 const clean=replay(history),dirty=replay([...history,row(day,'Alpha','Beta',29,29,{...stats(),HS:99}),row('2026-10-25','Alpha','Beta',0,0,null)]);
 assert.deepEqual(dirty,clean);
});
test('Shrinkage uses six league pseudo-observations, retains coverage/freshness and does not mutate live evidence',()=>{
 const history=[...seed(),...samples(10)],index=Core.build(history),refs=R.referenceIndex(history),entry=R.inspectFixtures(index,refs,[fixture()],10).entries[0];
 const {signal:s,reference}=entry.signals.find(x=>x.signal.market==='o25'),before=JSON.stringify(s),out=R.rerank(s,reference,'shrunken_excess');
 const h=s.evidence.home,a=s.evidence.away;
 const hs=(s.home.hits+6*h.baseline)/(s.home.n+6)*h.coverage*h.freshness,as=(s.away.hits+6*a.baseline)/(s.away.n+6)*a.coverage*a.freshness;
 close(out.rank,1+Math.min(hs-h.baseline,as-a.baseline));close(out.evidence.minimumSupport,Math.min(hs,as));
 assert.equal(JSON.stringify(s),before);assert.strictEqual(R.rerank(s,reference,'current'),s);
 const league=R.rerank(s,reference,'league_frequency');close(league.rank,1+reference.homeAsHome);
 assert.throws(()=>R.rerank(s,reference,'unknown'),RangeError);
});
test('Missing target observations remain unresolved and never cause replacement or a secondary-market substitution',()=>{
 const seen=[],entry=(name,base)=>({fixture:fixture(name,'Rival'),signal:{market:'corners95'},reference:{homeAsHome:base}});
 const ranked=[entry('First',.6),entry('Second',.4),entry('Third',.2)];
 const m=R.selectedMetric(ranked,2,e=>{seen.push(e.fixture[5]);return e.fixture[5]==='First'?null:true;});
 assert.deepEqual(seen,['First','Second']);assert.equal(m.selected,2);assert.equal(m.settled,1);assert.equal(m.hits,1);
 close(m.liftSum,.6);close(m.missingBaseSum,.6);
 const s=E.summarizeMetric(m);assert.equal(s.missing,1);close(s.hit_rate,1);close(s.settled_coverage,.5);
 close(s.excess_bounds_all_selected[0],0);close(s.excess_bounds_all_selected[1],.5);
});
test('All 25 target market outcomes agree with the existing diary settlement logic',()=>{
 for(const result of [row(day),row(day,'A','B',0,0,{...stats(),HC:0,AC:0}),row(day,'A','B',1,2,null)])for(const market of P.MARKETS){
  const p=P.observation(result,result[5],'home',market.id,Core.keyTeam),s=Core.marketSettled({market:market.id},result);
  assert.equal(p,s,market.id);
 }
});
test('Weekly paired comparisons match a hand calculation and preserve current-versus-current labels',()=>{
 const m=(hits,base)=>({selected:2,settled:2,hits,baselineSum:base,liftSum:hits-base,missingBaseSum:0});
 const weeks=new Map(Array.from({length:8},(_,i)=>[String(i),{current:m(1,1),shrunken_excess:m(2,1),league_frequency:m(1,1)}]));
 const metrics=Object.fromEntries(R.VARIANTS.map(id=>[id,R.metric()]));for(const week of weeks.values())for(const id of R.VARIANTS)R.addMetric(metrics[id],week[id]);
 const s=E.pairedComparison(metrics,weeks,'shrunken_excess','current');close(s.excess_improvement,.5);assert.deepEqual(s.approximate_95pct_interval,[.5,.5]);
 assert.deepEqual(s.missing_outcome_improvement_bounds,[.5,.5]);
 const self=E.pairedComparison(metrics,weeks,'current','current');close(self.excess_improvement,0);assert.deepEqual(self.approximate_95pct_interval,[0,0]);
 assert.deepEqual(self.missing_outcome_improvement_bounds,[0,0]);
});
const history=[];
for(let month=0;month<40;month++)for(const d of [7,21])for(let i=0;i<13;i++){
 const date=new Date(Date.UTC(2023,month,d)).toISOString().slice(0,10),hg=(i+month+d)%9===0?0:2,ag=(i+month)%4===0?0:1;
 history.push(row(date,'Team H '+i,'Team A '+((i+month)%13),hg,ag));
}
for(const r of history)if(r[3]==='2026-04-21')r[13]=null;
const options={since:'2024-01-01',validationSince:'2025-01-01',recentSince:'2026-01-01',until:'2026-10-25'};
let report;
test('Full evaluation keeps identical daily pools/selected counts, nine fixed configurations and explicit competitive-day diagnostics',()=>{
 const before=JSON.stringify(history);report=E.evaluate(history,options);
 assert.equal(JSON.stringify(history),before);assert.equal(Object.keys(report.configs).length,9);
 assert.equal(report.policy.target_statistics_used_for_selection,false);assert.equal(report.policy.live_scanner_changed,false);
 assert.equal(report.policy.diaries_changed,false);assert.equal(report.policy.automatic_promotion,false);
 for(const cfg of Object.values(report.configs))for(const [k,cutoff] of Object.entries(cfg.top))for(const block of [cutoff.all,...Object.values(cutoff.markets||{})])for(const period of ['development','validation','recent','later']){
  for(const id of R.VARIANTS){const s=block.variants[id][period];assert.equal(s.selected,Number(k)*block.pools[period].competitive_days);assert.equal(s.settled+s.missing,s.selected);}
 }
 const primary=report.configs.w10_s3.top[10].all;assert.ok(primary.pools.later.competitive_days>0);
 const tooFew=report.configs.w10_s3.top[20].all;assert.equal(tooFew.pools.later.competitive_days,0);assert.equal(tooFew.variants.current.later.selected,0);
 assert.ok(report.configs.w10_s3.top[10].markets.corners95.variants.current.recent.missing>0);
});
test('No target stats, duplicates or uncertain results can be silently recast as evidence',()=>{
 assert.throws(()=>E.evaluate([...history,history[0]],options),/Duplicate archived fixture/);
 const cfg=report.configs.w10_s3.top[10].all,copy=structuredClone(cfg);
 for(const id of R.VARIANTS)for(const p of ['validation','recent'])copy.variants[id][p].settled_coverage=.5;
 const q=E.qualification(copy);assert.equal(q.checks.sufficient_settlement_coverage,false);assert.equal(q.eligible_for_separate_prospective_comparison,false);
 const bad=structuredClone(cfg);bad.variants.shrunken_excess.later.against_current.missing_outcome_improvement_bounds=[-.1,.2];
 assert.equal(E.qualification(bad).checks.positive_even_under_missing_outcome_bounds,false);
});
test('Empty markets remain explicit, and malformed reports fail before their results can be used',()=>{
 const empty=E.evaluate([],options),primary=empty.configs.w10_s3.top[10].all;
 assert.equal(empty.historical_fixtures,0);assert.equal(primary.variants.current.later.excess_rate,null);
 assert.equal(empty.qualification.eligible_for_separate_prospective_comparison,false);assert.match(E.renderMarkdown(empty),/—/);
 const payload={...report,provenance:{test:true}},sealed=E.seal(payload),tampered=structuredClone(sealed);tampered.historical_fixtures++;
 assert.throws(()=>E.check(tampered,{test:true}),/integrity/);
 const changed=structuredClone(payload);changed.configs.w10_s3.top[10].all.variants.current.later.selected++;
 assert.throws(()=>E.check(E.seal(changed),{test:true}),/cohorts/);
});
