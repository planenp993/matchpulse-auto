'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../docs/model-core.js'),D=require('../scripts/evaluate_model.cjs');
const F=require('../scripts/fit_goal_model.cjs'),C=require('../scripts/compare_goal_models.cjs');
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const row=(date,h,a,hg,ag,div='E0',extra)=>[div,'England','Test league',date,'15:00',h,a,hg,ag,null,null,null,null,...(extra?[extra]:[])];
const clubs=['Manchester United','Chelsea','Arsenal','Everton'];
let randomState=98421;
const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return (randomState+.5)/4294967296;};
function poisson(mean){let p=1,n=0;do{p*=random();n++;}while(p>Math.exp(-mean));return n-1;}
const history=[];
for(let month=0;month<64;month++){
 const first=new Date(Date.UTC(2021,6+month,1));
 for(let i=0;i<4;i++)for(let j=0;j<4;j++)if(i!==j){
  const date=new Date(+first+((i*4+j)%12)*86400000).toISOString().slice(0,10);
  history.push(row(date,clubs[i],clubs[j],poisson(Math.exp(.4+[.5,.2,-.2,-.5][i]+[.1,-.2,.25,-.15][j])),poisson(Math.exp(.1+[.5,.2,-.2,-.5][j]+[.1,-.2,.25,-.15][i]))));
 }
}
const cutoff='2026-10-01',fixture=row('2026-10-10','Man Utd','Everton',null,null);
test('The numerical optimizer lowers its objective and resolves attacking and defensive opposition',()=>{
 const copy=JSON.stringify(history),fit=F.fit(history,'E0',cutoff);
 assert.equal(fit.converged,true);assert.ok(fit.residual<1e-5);assert.ok(fit.iterations<=F.DEFAULTS.maxIterations);
 for(let i=1;i<fit.objectiveTrace.length;i++)assert.ok(fit.objectiveTrace[i]<=fit.objectiveTrace[i-1]+1e-7);
 assert.ok(fit.teams[M.clubKey(clubs[0])].attack>fit.teams[M.clubKey(clubs[3])].attack);
 const againstWeak=F.predict(fit,fixture),againstStrong=F.predict(fit,row('2026-10-10','Man Utd','Chelsea',null,null));
 assert.ok(againstWeak.lambdaHome>againstStrong.lambdaHome);
 close(againstWeak.distribution.probs.homeWin+againstWeak.distribution.probs.draw+againstWeak.distribution.probs.awayWin,1);
 assert.equal(JSON.stringify(history),copy);
});
test('Same-day, future, awarded and other-league scores never affect a training snapshot',()=>{
 const clean=F.fit(history,'E0',cutoff),dirty=F.fit([...history,
  row(cutoff,'Future','Other',29,29),row('2026-10-02','Future','Other',29,29),
  row('2026-09-01','Future','Other',29,29,'D1'),row('2026-09-01','Future','Other',29,29,'E0',{AWARDED:true})],'E0',cutoff);
 assert.deepEqual(dirty,clean);assert.ok(clean.trainingMaxDate<cutoff);
 assert.deepEqual(F.fit([...history].reverse(),'E0',cutoff),clean);
});
test('Calendar-day decay responds to age while a uniform fit is invariant within its training window',()=>{
 const games=history.filter(r=>r[3]>='2025-01-01'&&r[3]<'2026-01-01');
 const older=games.map(r=>{const out=r.slice();out[3]=new Date(Date.parse(r[3]+'T12:00:00Z')-180*86400000).toISOString().slice(0,10);return out;});
 const a=F.fit(games,'E0',cutoff,{halfLifeDays:null}),b=F.fit(older,'E0',cutoff,{halfLifeDays:null});
 assert.deepEqual(a.teams,b.teams);close(a.homeIntercept,b.homeIntercept);
 const recent=F.fit(games,'E0',cutoff),old=F.fit(older,'E0',cutoff);
 close(recent.weightSum/old.weightSum,2);assert.notDeepEqual(recent.teams,old.teams);
});
test('Training/prediction boundaries refuse future models, cross-league use and unsupported clubs',()=>{
 const fit=F.fit(history,'E0',cutoff);
 assert.throws(()=>F.predict(fit,row('2026-09-30','Man Utd','Everton',null,null)),/future/);
 assert.throws(()=>F.predict(fit,row('2026-10-10','Man Utd','Everton',null,null,'D1')),/cross leagues/);
 assert.equal(F.predict(fit,row('2026-10-10','Unknown','Everton',null,null)).error,'unknown_team');
 assert.equal(F.fit([],'E0',cutoff).error,'insufficient_league_history');
 const sparse=F.fit([...history,row('2026-09-15','Newcomer','Chelsea',1,1)],'E0',cutoff);
 assert.equal(F.predict(sparse,row('2026-10-10','Newcomer','Chelsea',null,null)).error,'insufficient_team_history');
 assert.equal(F.predict({...fit,converged:false},fixture).error,'not_converged');
});
test('Weekly origins and options are explicit, deterministic and handle year/leap boundaries',()=>{
 assert.equal(F.weekStart('2026-10-26'),'2026-10-26');assert.equal(F.weekStart('2026-10-25'),'2026-10-19');
 assert.equal(F.weekStart('2026-01-01'),'2025-12-29');assert.equal(F.weekStart('2024-02-29'),'2024-02-26');
 for(const date of ['2026-02-29','2026-13-01','nonsense'])assert.throws(()=>F.dateNumber(date),RangeError);
 for(const change of [{halfLifeDays:0},{halfLifeDays:NaN},{penalty:0},{maxIterations:0},{rho:1},{tolerance:-1}])
  assert.throws(()=>F.fit(history,'E0',cutoff,change),RangeError);
});
test('Coherent blending preserves the score-matrix sums, complementary markets and nested totals',()=>{
 const a=M.distribution(2.1,.6,-.06),b=M.distribution(1.45,1.2,0),p=D.probabilityVector(a.probs),q=D.probabilityVector(b.probs),weight=.37;
 const copy=JSON.stringify([p,q]),mixed=F.blendVector(p,q,weight),index=id=>D.MARKETS.findIndex(m=>m.id===id);
 let win=0,over=0,mass=0;
 for(let h=0;h<a.matrix.length;h++)for(let j=0;j<a.matrix[h].length;j++){
  const v=(1-weight)*a.matrix[h][j]+weight*b.matrix[h][j];mass+=v;if(h>j)win+=v;if(h+j>=3)over+=v;
 }
 close(mass,1);close(win,mixed[0]);close(over,mixed[index('over25')]);close(mixed[0]+mixed[1]+mixed[2],1);
 for(const [i,m] of D.MARKETS.entries())if(m.complement)close(mixed[i]+mixed[index(m.complement)],1);
 assert.ok(mixed[index('over15')]>=mixed[index('over25')]);assert.ok(mixed[index('over25')]>=mixed[index('over35')]);
 assert.deepEqual(F.blendVector(p,q,0),p);assert.deepEqual(F.blendVector(p,q,1),q);assert.equal(JSON.stringify([p,q]),copy);
 assert.throws(()=>F.blendVector(p,q,1.1),RangeError);assert.throws(()=>F.blendVector(p,q.slice(1),.5),RangeError);
});
const actuals=[row('2024-01-01','A','B',2,1),row('2024-01-08','A','B',2,1),row('2024-01-15','A','B',0,0),row('2024-01-22','A','B',0,1)].map(D.outcomeVector);
const vector=weights=>actuals[0].map((_,i)=>weights[0]*actuals[0][i]+weights[1]*actuals[2][i]+weights[2]*actuals[3][i]);
test('The blend coefficient solves a hand-computable three-market squared-loss problem',()=>{
 const p=vector([.8,.1,.1]),q=vector([.2,.4,.4]);
 const rows=actuals.map(actual=>({actual,predictions:{current:p,opponent_days:p},poisson:q,available:{days:true}}));
 close(C.fitBlend(rows,'current').weight,.5);close(C.fitBlend(rows,'opponent_days').weight,.5);
 assert.equal(C.fitBlend(rows.map(r=>({...r,available:{days:false}})),'opponent_days').n,0);
 assert.equal(C.fitBlend([],'current').weight,0);
 const loss=C.primaryLoss(vector([.5,.25,.25]),actuals[0]);
 close(loss.brier,((.5**2+.25**2+.25**2)/2+.5**2+.5**2)/3);
});
const comparisonOptions={since:'2023-07-01',validationSince:'2024-07-01',recentSince:'2025-07-01',until:'2026-10-25'};
let comparison;
test('Comparison keeps the paired cohort, labels calibration fitting and records every fallback',()=>{
 comparison=C.compare(history,comparisonOptions);const r=comparison;
 assert.equal(r.policy.live_model_changed,false);assert.equal(r.policy.automatic_promotion,false);assert.equal(r.policy.prospective_evidence,false);
 assert.equal(r.policy.calibration_fit_results_are_in_sample,true);assert.equal(r.policy.later_periods_are_retrospective,true);
 for(const key of C.VARIANTS){
  const e=r.evaluations[key];assert.equal(e.overall.n,r.n);
  assert.equal(Object.values(e.periods).reduce((s,p)=>s+p.n,0),r.n);
  assert.equal(e.later.n,e.periods.validation.n+e.periods.recent.n);
  for(const metric of Object.values(e.overall.markets))assert.equal(metric.n,r.n);
 }
 assert.equal(r.blends.current.n,r.evaluations.current.periods.calibration_fit.n);
 assert.equal(r.fitting.days.nonconverged,0);
 assert.match(C.renderMarkdown(r),/Работещият модел/);
});
test('Later labels cannot change the early calibrator and future rows cannot enter the replay',()=>{
 const changed=history.map(r=>{const copy=r.slice();if(r[3]>='2026-10-01'){copy[7]=0;copy[8]=0;}return copy;});
 const next=C.compare([...changed,row('2026-10-26','Future','Other',29,29)],comparisonOptions);
 assert.deepEqual(next.blends,comparison.blends);assert.equal(next.n,comparison.n);
 const empty=C.compare([],comparisonOptions);assert.equal(empty.n,0);assert.equal(empty.evaluations.current.overall.primary_brier,null);
 assert.equal(empty.qualifications.opponent_days.eligible_for_prospective_comparison,false);
 assert.throws(()=>C.compare([],{...comparisonOptions,validationSince:'2022-01-01'}),RangeError);
});
test('The prospective eligibility rule rejects a better average with a damaged main market',()=>{
 const summary=(primary=.2)=>({n:1000,primary_brier:primary,primary_log_loss:.7,markets:{'1x2':{brier:.6},over25:{brier:.25},btts:{brier:.25}}});
 const current={periods:{validation:summary(),recent:summary()}},candidate={periods:{validation:summary(.19),recent:summary(.19)},later:{against_current:{approximate_95pct_interval:[.001,.02]}}};
 const e={current,opponent_days:candidate};assert.equal(C.qualification(e,'opponent_days',.95).eligible_for_prospective_comparison,true);
 candidate.periods.recent.markets.btts.brier=.26;
 assert.equal(C.qualification(e,'opponent_days',.95).eligible_for_prospective_comparison,false);
 candidate.periods.recent.markets.btts.brier=.25;
 assert.equal(C.qualification(e,'opponent_days',.89).eligible_for_prospective_comparison,false);
});
