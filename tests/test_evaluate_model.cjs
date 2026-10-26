'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../docs/model-core.js');
const D=require('../scripts/evaluate_model.cjs');
const day=n=>new Date(Date.UTC(2022,7,1+n*7)).toISOString().slice(0,10);
const row=(date,home='Man Utd',away='Chelsea',hg=2,ag=1,division='E0',meta)=>
 [division,'England','Test league',date,'15:00',home,away,hg,ag,1.4,.9,null,null,...(meta?[meta]:[])];
const history=[];
const teams=['Manchester United','Chelsea','Arsenal','Everton','Liverpool','Fulham'];
for(let n=0;n<210;n++)for(let i=0;i<3;i++)history.push(row(day(n),teams[(2*i+n)%6],teams[(2*i+n+1)%6],n%4,(n+i)%3));
const fixture=row('2026-09-01');
const index=id=>D.MARKETS.findIndex(m=>m.id===id);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`);

test('All 30 binary markets settle from the score and complements stay coherent',()=>{
 assert.equal(D.MARKETS.length,30);
 for(const [hg,ag] of [[0,0],[1,0],[0,2],[2,1],[3,3],[5,0]]){
  const game=row('2026-09-01',undefined,undefined,hg,ag),actual=D.outcomeVector(game);
  const probs=D.probabilityVector(M.distribution(1.4,1.2,-.06).probs);
  assert.equal(actual[0]+actual[1]+actual[2],1);
  close(probs[0]+probs[1]+probs[2],1);
  for(const [i,m] of D.MARKETS.entries())if(m.complement){
   assert.equal(actual[i]+actual[index(m.complement)],1);close(probs[i]+probs[index(m.complement)],1);
  }
  assert.equal(actual[index('double1X')],actual[0]+actual[1]);
  assert.equal(actual[index('doubleX2')],actual[1]+actual[2]);
  assert.equal(actual[index('double12')],actual[0]+actual[2]);
  assert.equal(actual[index('over25')],+(hg+ag>=3));
  assert.equal(actual[index('homeOver15')],+(hg>=2));
  assert.equal(actual[index('btts')],+(hg>0&&ag>0));
 }
});
test('Indexed replay is exactly the browser evaluator, including queries out of date order',()=>{
 const replay=D.createReplay(history);
 for(const game of [fixture,history[60],history[420],history[300]])for(const settings of ['standard','recent','cautious',{sampleSize:5},{sampleSize:10},{sampleSize:20}])
  assert.deepEqual(replay.evaluate(game,settings),M.evaluate(history,game,settings));
});
test('Same-day, future and administrative scores cannot affect either model or baselines',()=>{
 const clean=D.createReplay(history).context(fixture);
 const dirty=D.createReplay([...history,row('2026-09-01',undefined,undefined,29,0),row('2026-09-02',undefined,undefined,0,29),row('2026-08-30',undefined,undefined,29,29,'E0',{AWARDED:true})]).context(fixture);
 assert.deepEqual(dirty,clean);
 assert.ok(clean.homeMatches.every(r=>r[3]<fixture[3]));
 assert.equal(M.clubKey(clean.homeMatches[0][5])===M.clubKey('Man Utd')||M.clubKey(clean.homeMatches[0][6])===M.clubKey('Man Utd'),true);
});
test('Empirical baseline uses all eligible league games in the exact three-year interval',()=>{
 const games=[row('2023-09-01'),row('2023-08-31',undefined,undefined,0,0),row('2026-08-31',undefined,undefined,0,0),row('2026-09-01',undefined,undefined,9,9),row('2026-08-30',undefined,undefined,5,5,'E0',{AWARDED:true})];
 const c=D.createReplay(games).context(fixture);
 assert.equal(c.count,2);close(c.frequencies[index('over25')],.5);
 close(c.frequencies[index('homeWin')],.5);close(c.frequencies[index('draw')],.5);
 close(c.frequencies[index('double1X')],1);
});
test('Diagnostic windows really limit model observations while default stays at 30',()=>{
 const standard=M.evaluate(history,fixture),five=M.evaluate(history,fixture,{sampleSize:5});
 assert.equal(standard.quality.homeN,30);assert.equal(five.quality.homeN,5);assert.equal(five.quality.awayN,5);
 assert.equal(five.quality.coverage,5);assert.notEqual(five.lambdaHome,standard.lambdaHome);
 assert.throws(()=>M.evaluate(history,fixture,{sampleSize:4}),RangeError);
 assert.throws(()=>M.evaluate(history,fixture,{sampleSize:31}),RangeError);
});
function observation(date,p=.8){
 const predicted=Array(30).fill(.5),baseline=Array(30).fill(.5),actual=Array(30).fill(0);
 predicted.splice(0,3,p,(1-p)/2,(1-p)/2);baseline.splice(0,3,.5,.25,.25);actual[0]=1;
 return {date,actual,predictions:{30:predicted},frequencies:baseline,poisson:baseline};
}
test('Brier, log loss, multiclass score and reliability bins match hand calculations',()=>{
 const rows=[observation('2026-01-01')],binary=D.score(rows,30,0,{detail:true}),multi=D.score(rows,30,null);
 close(binary.brier,.04);assert.equal(binary.log_loss,.223144);close(binary.mean_forecast,.8);close(binary.actual_rate,1);
 close(multi.brier,.06);assert.equal(multi.log_loss,.223144);assert.equal(multi.accuracy,1);
 assert.equal(binary.bins[0].sample,'small');assert.equal(binary.baselines.league_frequencies.evidence,'small_sample');
 assert.equal(binary.baselines.league_frequencies.approximate_95pct_interval,null);
 assert.ok(Number.isFinite(D.score([observation('2026-01-01',0)],30,0).log_loss));
});
test('Paired weekly intervals distinguish evidence from small or inconclusive samples',()=>{
 const rows=Array.from({length:600},(_,i)=>observation(new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10)));
 const good=D.score(rows,30,0).baselines.league_frequencies;
 close(good.brier_improvement,.21);assert.equal(good.evidence,'lower_error');assert.ok(good.approximate_95pct_interval[0]>0);
 assert.equal(D.score(rows.slice(0,499),30,0).baselines.league_frequencies.evidence,'small_sample');
 for(const r of rows)r.predictions[30]=r.frequencies.slice();
 assert.equal(D.score(rows,30,0).baselines.league_frequencies.evidence,'inconclusive');
});
test('Full diagnostics keep a paired cohort, disjoint periods and deterministic reports',()=>{
 const copy=JSON.stringify(history),options={until:'2026-10-25'};
 const input=[...history,row('2026-08-30',undefined,undefined,3,0,'E0',{AWARDED:true}),row('2026-08-30','Unknown','Unknown 2'),row('2026-08-30',undefined,undefined,2,1,'UCL')];
 const r=D.qualityReport(input,options),d=r.diagnostics;
 assert.equal(d.excluded.administrative,1);assert.equal(d.excluded.international,1);assert.equal(d.excluded.insufficient_team_history,1);
 assert.equal(d.markets.length,31);assert.equal(d.policy.automatic_model_change,false);
 for(const window of D.WINDOWS){
  const e=d.evaluations[window];assert.equal(e.n,d.n);
  assert.equal(Object.values(e.periods).reduce((s,p)=>s+p.markets['1x2'].n,0),d.n);
  assert.equal(Object.values(e.seasons).reduce((s,p)=>s+p['1x2'].n,0),d.n);
  for(const m of Object.values(e.overall))assert.equal(m.n,d.n);
 }
 assert.deepEqual(D.qualityReport(input,options),r);assert.equal(JSON.stringify(history),copy);
 assert.match(D.renderMarkdown(r),/Текущият модел срещу честотите/);
});
test('Legacy report remains compatible and scores the actual default engine',()=>{
 const since='2026-08-01',until='2026-08-20',r=D.report(history,{since,until});
 const games=history.filter(g=>g[3]>=since&&g[3]<=until);
 let expected=0;for(const g of games){const p=M.evaluate(history,g).distribution.probs.over25;expected+=(p-+(g[7]+g[8]>=3))**2;}
 assert.equal(r.n,games.length);assert.equal(r.brier,Math.round(expected/games.length*10000)/10000);
 assert.equal(r.market,'Over 2.5 goals');assert.equal(r.bins.reduce((s,b)=>s+b.n,0),r.n);
});
test('Empty input is explicit and season/date policy follows the repository audit',()=>{
 const r=D.qualityReport([],{until:'2026-10-25'});assert.equal(r.diagnostics.n,0);assert.equal(r.brier,null);
 assert.equal(r.diagnostics.evaluations[30].overall.over25.brier,null);
 assert.match(D.renderMarkdown(r),/няма данни/);
 assert.equal(D.seasonAt('E0','2026-06-30'),'2025/26');assert.equal(D.seasonAt('E0','2026-07-01'),'2026/27');
 assert.equal(D.seasonAt('NOR','2026-06-30'),'2026');assert.equal(D.seasonAt('SWE','2026-01-01'),'2026');
 assert.equal(D.previousDay('2026-01-01'),'2025-12-31');assert.equal(D.weekOf('2026-01-01'),'2025-12-29');
 assert.throws(()=>D.qualityReport([],{since:'2026-01-01',validationSince:'2025-01-01'}),RangeError);
});
