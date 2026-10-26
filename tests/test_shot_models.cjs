'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto');
const M=require('../docs/model-core.js'),D=require('../scripts/evaluate_model.cjs'),F=require('../scripts/fit_goal_model.cjs');
const S=require('../scripts/shot_goal_model.cjs'),C=require('../scripts/compare_shot_models.cjs');
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const row=(date,h='A',a='B',hg=1,ag=0,stats={HS:12,AS:8,HST:4,AST:3},div='E0')=>
 [div,'England','Test',date,'15:00',h,a,hg,ag,null,null,null,null,stats];
const settings={minimumLeagueMatches:1,minimumTeamMatches:1},cutoff='2026-10-19';
const fixture=row('2026-10-24','A','B',null,null,null);
const goalBase={division:'E0',cutoff,converged:true,baseHome:1.5,baseAway:1.1};
test('Missing or inconsistent shots stay unavailable; observed zero counts stay zero',()=>{
 assert.equal(S.observed(row('2026-10-01')),true);
 assert.equal(S.observed(row('2026-10-01','A','B',0,0,{HS:0,AS:0,HST:0,AST:0})),true);
 for(const stats of [null,'source',{HS:12,AS:8,HST:4},{HS:12,AS:8,HST:null,AST:3},
  {HS:-1,AS:8,HST:0,AST:3},{HS:12.1,AS:8,HST:4,AST:3},{HS:2,AS:8,HST:3,AST:3},{HS:12,AS:2,HST:4,AST:3},
  {HS:12,AS:8,HST:4,AST:3,AWARDED:true}])assert.equal(S.observed(row('2026-10-01','A','B',1,0,stats)),false);
 const zero=S.fit([row('2026-10-01','A','B',0,0,{HS:0,AS:0,HST:0,AST:0})],'E0',cutoff,settings);
 assert.equal(zero.error,'zero_shot_base');
 assert.equal(S.fit([row('2026-10-01','A','B',0,0,null)],'E0',cutoff,settings).error,'insufficient_shot_league_history');
});
test('Shot training excludes cutoff-day, future, old, other-league and awarded rows without mutating inputs',()=>{
 const history=[row('2026-10-01'),row('2026-10-02','B','A')],copy=JSON.stringify(history),clean=S.fit(history,'E0',cutoff,settings);
 const dirty=S.fit([...history,row(cutoff,'X','Y'),row('2026-10-20','X','Y'),row('2022-10-01','X','Y'),
  row('2026-10-02','X','Y',1,0,undefined,'D1'),row('2026-10-03','X','Y',1,0,{HS:50,AS:40,HST:20,AST:10,AWARDED:true})],'E0',cutoff,settings);
 assert.deepEqual(dirty,clean);assert.deepEqual(S.fit([...history].reverse(),'E0',cutoff,settings),clean);
 assert.equal(JSON.stringify(history),copy);assert.ok(clean.trainingMaxDate<cutoff);
});
test('Venue-normalized league-average shots shrink to one and retain the supplied goal bases',()=>{
 const history=[row('2026-10-01'),row('2026-10-02','B','A')],fit=S.fit(history,'E0',cutoff,settings),p=S.predict(fit,goalBase,fixture);
 for(const id of ['shots','sot']){
  close(fit.metrics[id].teams.a.attack,1);close(fit.metrics[id].teams.a.defence,1);
  close(p.predictions[id].lambdaHome,1.5);close(p.predictions[id].lambdaAway,1.1);
 }
});
test('Real calendar age affects effective evidence; sparse estimates shrink toward the league',()=>{
 const a=row('2026-10-01','A','B',1,0,{HS:24,AS:4,HST:8,AST:1}),b=row('2026-10-01','B','A');
 const fit=S.fit([a,b],'E0',cutoff,settings),old=structuredClone([a,b]);
 for(const r of old)r[3]='2026-04-04'; // Exactly 180 days earlier.
 const older=S.fit(old,'E0',cutoff,settings);
 close(fit.weightSum/older.weightSum,2);assert.ok(fit.metrics.shots.teams.a.attack>older.metrics.shots.teams.a.attack);
 assert.ok(fit.metrics.shots.teams.a.attack>1);assert.ok(fit.metrics.shots.teams.b.defence>1);
 const p=S.predict(fit,goalBase,fixture);assert.ok(p.predictions.shots.lambdaHome>goalBase.baseHome);
});
test('Shot predictions share aliases, enforce same league/cutoff, minimum history and coherent distributions',()=>{
 const fit=S.fit([row('2026-10-01','Manchester United','B')],'E0',cutoff,settings);
 const f=row('2026-10-24','Man Utd','B',null,null,null),p=S.predict(fit,goalBase,f);
 assert.equal(p.error,undefined);close(p.predictions.shots.distribution.probs.homeWin+p.predictions.shots.distribution.probs.draw+p.predictions.shots.distribution.probs.awayWin,1);
 assert.throws(()=>S.predict(fit,{...goalBase,cutoff:'2026-10-12'},f),/cutoffs/);
 assert.throws(()=>S.predict(fit,goalBase,{...f,0:'D1'}),/cross leagues/);
 assert.throws(()=>S.predict(fit,goalBase,{...f,3:'2026-10-18'}),/future/);
 assert.equal(S.predict(fit,goalBase,row('2026-10-24','constructor','B')).error,'unknown_shot_team');
 assert.equal(S.predict({...fit,settings:{...fit.settings,minimumTeamMatches:5}},goalBase,f).error,'insufficient_shot_team_history');
 for(const change of [{halfLifeDays:0},{priorMatches:0},{minimumLeagueMatches:0},{minimumTeamMatches:0},{rho:1}])assert.throws(()=>S.fit([],'E0',cutoff,change),RangeError);
});
const outcomes=[row('2024-01-01','A','B',2,1),row('2024-01-01','A','B',0,0),row('2024-01-01','A','B',0,1)].map(D.outcomeVector);
function observations(actuals){return actuals.map(actual=>({actual,predictions:{goals:outcomes[0],shots:outcomes[1]},poisson:outcomes[2]}));}
test('The nonnegative mixture recovers a hand-computable interior optimum and boundary optima',()=>{
 const r=C.fitMixture(observations([outcomes[0],outcomes[1],outcomes[1],outcomes[2]]),'shots');
 close(r.goals,.25);close(r.shot,.5);close(r.league,.25);assert.equal(r.n,4);
 for(let i=0;i<3;i++){
  const w=C.fitMixture(observations([outcomes[i],outcomes[i]]),'shots');
  close([w.goals,w.shot,w.league][i],1);
 }
 const control=C.fitMixture(observations([outcomes[0],outcomes[2]]));close(control.goals,.5);close(control.shot,0);close(control.league,.5);
 const empty=C.fitMixture([],'shots');assert.equal(empty.n,0);close(empty.goals,1);
 const degenerate=observations([outcomes[2]]).map(r=>({...r,predictions:{...r.predictions,shots:r.poisson}}));
 const w=C.fitMixture(degenerate,'shots');close(w.goals,0);close(w.shot+w.league,1);
});
test('Three-way mixtures equal a whole score-matrix mixture for wins, totals and complementary markets',()=>{
 const distributions=[M.distribution(2.1,.5,-.06),M.distribution(.8,1.7,-.06),M.distribution(1.4,1.2,0)],weights=[.5,.3,.2];
 const vectors=distributions.map(d=>D.probabilityVector(d.probs)),p=S.mixVectors(vectors,weights),index=id=>D.MARKETS.findIndex(m=>m.id===id);
 let homeWin=0,over25=0,mass=0;
 for(let h=0;h<12;h++)for(let a=0;a<12;a++){
  const v=distributions.reduce((sum,d,i)=>sum+weights[i]*d.matrix[h][a],0);mass+=v;if(h>a)homeWin+=v;if(h+a>2)over25+=v;
 }
 close(mass,1);close(p[0],homeWin);close(p[index('over25')],over25);close(p[0]+p[1]+p[2],1);
 for(const [i,m] of D.MARKETS.entries())if(m.complement)close(p[i]+p[index(m.complement)],1);
 assert.ok(p[index('over15')]>=p[index('over25')]);assert.ok(p[index('over25')]>=p[index('over35')]);
 assert.throws(()=>S.mixVectors(vectors,[.5,.5,.5]),RangeError);assert.throws(()=>S.mixVectors(vectors,[-.1,.8,.3]),RangeError);
});
const history=[],names=['A','B','C','D'];
for(let month=0;month<63;month++)for(let h=0;h<4;h++)for(let a=0;a<4;a++)if(h!==a){
 const d=new Date(Date.UTC(2021,6+month,1+(h*4+a)%12)).toISOString().slice(0,10);
 const s={HS:8+h*3+(month%4),AS:6+a*2+(month%3),HST:2+h+(month%2),AST:1+a};
 history.push(row(d,names[h],names[a],(h+month)%4,(a+month+1)%3,s));
}
history.push(row('2026-10-24','A','B',2,1,null));
const options={since:'2023-07-01',validationSince:'2025-07-01',recentSince:'2026-07-01',until:'2026-10-25'};
let report;
test('All candidates use paired cohorts, and target-match shots do not select or influence the target forecast',()=>{
 report=C.compare(history,options);
 const changed=structuredClone(history);changed.at(-1)[13]={HS:95,AS:95,HST:94,AST:94};
 assert.deepEqual(C.compare(changed,options),report);
 assert.equal(report.policy.target_match_statistics_used,false);assert.equal(report.policy.live_model_changed,false);
 assert.equal(report.policy.frozen_experiment_changed,false);assert.equal(report.policy.automatic_promotion,false);
 for(const id of C.VARIANTS){
  assert.equal(report.evaluations[id].all.overall.n,report.n);
  assert.equal(report.evaluations[id].available.overall.n,report.available_n);
  assert.equal(Object.values(report.evaluations[id].available.periods).reduce((sum,p)=>sum+p.n,0),report.available_n);
 }
 assert.ok(report.available_n>0);assert.equal(report.divisions.length,1);
});
test('Later scores and statistics cannot tune the earlier mixture or early evaluation',()=>{
 const changed=history.map(r=>r[3]<'2025-07-01'?r:[...r.slice(0,7),0,0,...r.slice(9,13),{HS:60,AS:55,HST:20,AST:18}]);
 const future=C.compare(changed,options);assert.deepEqual(future.blends,report.blends);
 for(const id of C.VARIANTS)assert.deepEqual(future.evaluations[id].available.periods.calibration_fit,report.evaluations[id].available.periods.calibration_fit);
});
test('Unavailable shots use the exact frozen forecast in every new mixture, without inventing values',()=>{
 const p=outcomes[0],w={goals:.5,shot:.2,league:.3},blends=Object.fromEntries(['goals_calibrated','shots_calibrated','sot_calibrated'].map(k=>[k,w]));
 const r={available:false,predictions:{current:outcomes[1],frozen_candidate:p}};
 C.applyMixtures([r],blends);
 for(const id of ['goals_calibrated','shots_calibrated','sot_calibrated'])assert.strictEqual(r.predictions[id],p);
 const missing=C.compare(history.map(r=>[...r.slice(0,13),null]),options);
 assert.equal(missing.available_n,0);assert.equal(missing.coverage.ratio,0);
 assert.match(C.renderMarkdown(missing),/— \/ —/);
 for(const id of ['goals_calibrated','shots_calibrated','sot_calibrated']){
  close(missing.evaluations[id].all.later.primary_brier,missing.evaluations.frozen_candidate.all.later.primary_brier);
  assert.equal(missing.evaluations[id].available.later.n,0);
 }
});
test('A lower error than current alone cannot qualify a shot variant; the paired incremental controls are required',()=>{
 const evaluations=structuredClone(report.evaluations),q=C.qualification(evaluations,'shots_calibrated',1);
 assert.equal(q.eligible_for_separate_prospective_comparison,false);assert.equal(q.automatic_promotion,false);
 const candidate=evaluations.shots_calibrated.available;
 for(const p of ['validation','recent']){
  candidate.periods[p].n=600;
  candidate.periods[p].primary_brier=evaluations.goals_calibrated.available.periods[p].primary_brier+.0001;
 }
 assert.equal(C.qualification(evaluations,'shots_calibrated',1).checks.lower_primary_brier_than_both_controls,false);
});
test('Incremental score intervals and report validation detect mislabeled cohorts and altered metrics',()=>{
 const rows=outcomes.map((actual,i)=>({date:`2026-01-${String(i*7+1).padStart(2,'0')}`,actual,poisson:outcomes[2],frequencies:outcomes[2],
  predictions:{current:outcomes[2],frozen_candidate:outcomes[2],goals_calibrated:outcomes[0],candidate:actual}}));
 const s=C.summarize(rows,'candidate');assert.ok(s.against_goals_control.improvement>0);assert.equal(s.against_goals_control.weekly_clusters,3);
 const current=C.summarize(rows,'current');
 close(current.against_goals_control.improvement,2/9,5e-7);
 assert.notEqual(current.against_goals_control.improvement,0);
 const payload={...report,provenance:{test:true}},sealed=C.seal(payload);
 const tampered=structuredClone(sealed);tampered.n++;assert.throws(()=>C.check(tampered,{test:true}),/integrity/);
 const wrong=structuredClone(payload);wrong.evaluations.current.all.overall.n++;assert.throws(()=>C.check(C.seal(wrong),{test:true}),/cohorts/);
});
test('Shot evaluation leaves every frozen candidate source fingerprint unchanged',()=>{
 const config=require('../docs/data/diary/experiments/opponent-days-v1/config.json');
 for(const [file,expected] of Object.entries(config.candidate_files)){
  const raw=fs.readFileSync(require('node:path').resolve(__dirname,'..',file));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),expected);
 }
});
