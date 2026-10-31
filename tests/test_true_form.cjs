'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const M=require('../docs/model-core.js'),D=require('../scripts/evaluate_model.cjs'),F=require('../scripts/fit_goal_model.cjs');
const T=require('../scripts/true_form_model.cjs'),C=require('../scripts/compare_true_form.cjs');
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const row=(date,h='A',a='B',hg=2,ag=1,div='E0',stats=null)=>[div,'Country','League',date,'15:00',h,a,hg,ag,null,null,null,null,stats];
const expected=(r,h=2,a=1)=>({lambdaHome:h,lambdaAway:a,cutoff:F.weekStart(r[3])});
const fixture=row('2026-10-24','A','B',null,null),base=expected(fixture);
function neutral(){const s=T.createState();for(let d=1;d<=8;d++){const r=row(`2026-10-${String(d).padStart(2,'0')}`);T.add(s,r,expected(r));}return s;}
test('Neutral actual/expected performance leaves both base intensities unchanged',()=>{
 const p=T.predict(neutral(),fixture,base);assert.equal(p.error,undefined);
 close(p.lambdaHome,2);close(p.lambdaAway,1);close(p.home.attack,1);close(p.away.vulnerability,1);
 assert.ok(p.home.maxDate<fixture[3]);assert.equal(p.home.n,8);
});
test('The six-match shrinkage and real-day age match the registered formula',()=>{
 const s=T.createState();for(let i=0;i<5;i++){const r=row('2026-10-14','A','B'+i,3,1);T.add(s,r,expected(r));}
 const form=T.teamForm(s,'E0','A',fixture[3]),w=2**(-10/60);
 close(form.rawAttack,(6*2+5*w*3)/(6*2+5*w*2));close(form.vulnerability,1);
 const old=T.teamForm(s,'E0','A','2027-02-21');assert.ok(old.attack<form.attack);
});
test('The same goals against higher expected opposition mean weaker residual attack',()=>{
 const s1=T.createState(),s2=T.createState();
 for(let d=1;d<=5;d++){const r=row(`2026-10-0${d}`);T.add(s1,r,expected(r,1,1));T.add(s2,r,expected(r,3,1));}
 assert.ok(T.teamForm(s1,'E0','A',fixture[3]).attack>1);
 assert.ok(T.teamForm(s2,'E0','A',fixture[3]).attack<1);
});
test('Same-day, future, awarded and other-league scores cannot enter a club form',()=>{
 const s=neutral(),before=T.predict(s,fixture,base);
 for(const r of [row(fixture[3],'A','B',9,9),row('2027-01-01','A','B',9,9),row('2026-10-09','A','B',9,9,'D1')])T.add(s,r,expected(r));
 assert.equal(T.add(s,row('2026-10-10','A','B',9,9,'E0',{AWARDED:true}),expected(row('2026-10-10'))),false);
 assert.equal(T.add(s,row('2026-10-10','A','B',9,9,'UCL'),expected(row('2026-10-10'))),false);
 assert.deepEqual(T.predict(s,fixture,base),before);
});
test('Last-ten selection, aliases, missing histories and historical forecast cutoffs are enforced',()=>{
 const s=neutral();for(let d=9;d<=15;d++){const r=row(`2026-10-${d<10?'0':''}${d}`);T.add(s,r,expected(r));}
 const p=T.predict(s,fixture,base);assert.equal(p.home.n,10);assert.equal(p.home.minDate,'2026-10-06');
 assert.equal(T.predict(s,row('2026-10-24','New Club','B'),base).error,'insufficient_true_form_history');
 assert.equal(T.predict(s,fixture,{error:'not_converged'}).error,'not_converged');
 assert.throws(()=>T.add(s,row('2026-10-01'),{...expected(row('2026-10-01')),cutoff:'2026-10-19'}),/historical match week/);
 assert.throws(()=>T.predict(s,fixture,{...base,cutoff:'2026-10-12'}),/fixture week/);
 const alias=T.createState();for(let d=1;d<=5;d++){const r=row(`2026-10-0${d}`,'Manchester United');T.add(alias,r,expected(r));}
 assert.equal(T.teamForm(alias,'E0','Man Utd',fixture[3]).n,5);
});
test('Extreme form is bounded and all markets remain sums of one coherent matrix',()=>{
 const s=T.createState();for(let d=1;d<=10;d++){const r=row(`2026-10-${String(d).padStart(2,'0')}`,'A','B',20,0);T.add(s,r,expected(r));}
 const p=T.predict(s,fixture,{...base,lambdaHome:4.2,lambdaAway:.15});
 close(p.home.attack,1.25);close(p.home.vulnerability,.8);close(p.factorHome,1.25);close(p.factorAway,.8);
 close(p.lambdaHome,4.2);close(p.lambdaAway,.15);assert.equal(p.clipped,true);
 const v=D.probabilityVector(p.distribution.probs),index=id=>D.MARKETS.findIndex(m=>m.id===id);
 close(v[0]+v[1]+v[2],1);close(p.distribution.matrix.flat().reduce((a,b)=>a+b,0),1);
 for(const [i,m] of D.MARKETS.entries())if(m.complement)close(v[i]+v[index(m.complement)],1);
 assert.ok(v[index('over15')]>=v[index('over25')]);assert.ok(v[index('over25')]>=v[index('over35')]);
});
const history=[],names=['A','B','C','D'];
for(let month=0;month<63;month++)for(let h=0;h<4;h++)for(let a=0;a<4;a++)if(h!==a){
 const date=new Date(Date.UTC(2021,6+month,1+(h*4+a)%12)).toISOString().slice(0,10);
 history.push(row(date,names[h],names[a],(h+month)%4,(a+month+1)%3,'E0',{HS:8+h*3,AS:6+a*2,HST:2+h,AST:1+a}));
}
history.push(row('2026-10-21','A','B',2,1));
let prepared,report;
test('The full prequential replay is order-invariant and the target result/statistics do not affect its forecast',()=>{
 prepared=C.prepare(history);
 const changed=structuredClone(history);changed.at(-1)[7]=9;changed.at(-1)[8]=8;changed.at(-1)[13]={HS:99,AS:99,HST:98,AST:98};
 const altered=C.prepare(changed.reverse());
 assert.deepEqual(altered.rows.at(-1).predictions,prepared.rows.at(-1).predictions);
 assert.equal(altered.rows.at(-1).available,prepared.rows.at(-1).available);
 assert.equal(altered.forecastReceiptsSha256,prepared.forecastReceiptsSha256);
 assert.notDeepEqual(altered.rows.at(-1).actual,prepared.rows.at(-1).actual);
 assert.equal(prepared.fitting.strict_pregame_cutoffs_verified,true);
 assert.ok(prepared.rows.some(r=>r.available));
});
test('Later outcomes cannot change early calibration weights or early predictions',()=>{
 const a=structuredClone(prepared.rows),b=structuredClone(a);
 for(const r of b)if(r.date>=C.SETTINGS.validationSince)r.actual=D.outcomeVector(row(r.date,'A','B',8,8));
 assert.deepEqual(C.calibrate(a),C.calibrate(b));
 assert.deepEqual(a.filter(r=>r.date<C.SETTINGS.validationSince),b.filter(r=>r.date<C.SETTINGS.validationSince));
 const frozen=a.at(-1).predictions.frozen_candidate,pending={...a.at(-1),available:false,predictions:{frozen_candidate:frozen}};
 C.calibrate([...a,pending]);
 assert.strictEqual(pending.predictions.goals_calibrated,frozen);assert.strictEqual(pending.predictions.true_form_calibrated,frozen);
});
test('All models share target cohorts; shot comparisons use their exact common intersection',()=>{
 report=C.compare(history);
 for(const id of C.VARIANTS){assert.equal(report.evaluations[id].all.overall.n,report.n);
  assert.equal(report.evaluations[id].available.overall.n,report.available_n);
  assert.equal(Object.values(report.evaluations[id].available.periods).reduce((s,p)=>s+p.n,0),report.available_n);}
 for(const s of Object.values(report.shot_intersection.evaluations))assert.equal(s.n,report.shot_intersection.n);
 assert.equal(report.policy.live_model_changed,false);assert.equal(report.policy.frozen_experiment_changed,false);
 assert.equal(report.qualification.automatic_promotion,false);assert.equal(report.qualification.prospective_evidence,false);
 assert.equal(report.qualification.eligible_for_separate_prospective_comparison,false);
 assert.equal(report.blends.true_form_calibrated.n,report.evaluations.current.available.periods.calibration_fit.n);
});
test('Report integrity and frozen production/research fingerprints are protected',()=>{
 const sealed=C.seal({...report,provenance:{test:true}}),bad=structuredClone(sealed);bad.n++;
 assert.throws(()=>C.check(bad,{test:true}),/integrity/);
 const snapshot=JSON.parse(fs.readFileSync('docs/data/research_snapshot.json','utf8'));
 for(const [p,expected] of Object.entries(snapshot.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
 const config=JSON.parse(fs.readFileSync('docs/data/diary/experiments/opponent-days-v1/config.json','utf8'));
 for(const [p,expected] of Object.entries(config.candidate_files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
});
