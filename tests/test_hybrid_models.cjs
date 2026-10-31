'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const M=require('../docs/model-core.js'),D=require('../scripts/evaluate_model.cjs'),H=require('../scripts/compare_hybrid_models.cjs');
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const row=(date,h='A',a='B',hg=2,ag=1,stats=null,div='E0')=>[div,'Country','League',date,'15:00',h,a,hg,ag,null,null,null,null,stats];
const vectors=[row('2024-01-01','A','B',2,1),row('2024-01-01','A','B',0,0),row('2024-01-01','A','B',0,1)].map(D.outcomeVector);
const observations=actuals=>actuals.map(actual=>({actual,predictions:{current:vectors[0],candidate:vectors[1],sot:vectors[2]}}));
test('The two-component hybrid learns an exact known convex weight and admits pure-model boundaries',()=>{
 const rows=observations([vectors[0],vectors[1],vectors[1],vectors[1]]),w=H.fitWeights(rows,['current','candidate']);
 close(w.current,.25);close(w.candidate,.75);close(w.sot,0);assert.equal(w.n,4);
 const only=H.fitWeights(observations([vectors[1],vectors[1]]),['current','candidate']);close(only.current,0);close(only.candidate,1);
 assert.throws(()=>H.fitWeights([],['current','candidate']),/No early/);
 assert.throws(()=>H.fitWeights(rows,['current','current']),/Invalid hybrid/);
});
test('The three-component fitter and matched second-model/SOT control label every axis correctly',()=>{
 const rows=observations([vectors[0],vectors[1],vectors[1],vectors[2]]),w=H.fitWeights(rows,['current','candidate','sot']);
 close(w.current,.25);close(w.candidate,.5);close(w.sot,.25);
 const control=H.fitWeights(observations([vectors[1],vectors[2],vectors[2]]),['candidate','sot']);
 close(control.current,0);close(control.candidate,1/3);close(control.sot,2/3);
 const p=H.mix(rows[0].predictions,w);for(let i=0;i<p.length;i++)close(p[i],.25*vectors[0][i]+.5*vectors[1][i]+.25*vectors[2][i]);
});
test('All hybrid markets equal sums of a coherent mixture of score matrices',()=>{
 const matrices=[M.distribution(2.2,.7,-.06),M.distribution(.9,1.8,-.06),M.distribution(1.4,1.2,-.06)];
 const predictions=Object.fromEntries(['current','candidate','sot'].map((k,i)=>[k,D.probabilityVector(matrices[i].probs)]));
 const w={current:.2,candidate:.5,sot:.3},p=H.mix(predictions,w),index=id=>D.MARKETS.findIndex(m=>m.id===id);
 let mass=0,win=0,over=0;for(let h=0;h<12;h++)for(let a=0;a<12;a++){
  const v=.2*matrices[0].matrix[h][a]+.5*matrices[1].matrix[h][a]+.3*matrices[2].matrix[h][a];mass+=v;if(h>a)win+=v;if(h+a>2)over+=v;
 }
 close(mass,1);close(win,p[0]);close(over,p[index('over25')]);close(p[0]+p[1]+p[2],1);
 for(const [i,m] of D.MARKETS.entries())if(m.complement)close(p[i]+p[index(m.complement)],1);
 assert.ok(p[index('over15')]>=p[index('over25')]);assert.ok(p[index('over25')]>=p[index('over35')]);
 assert.throws(()=>H.mix(predictions,{current:.5,candidate:.5,sot:.5}),/Invalid matrix/);
});
const history=[],names=['A','B','C','D'];
for(let month=0;month<63;month++)for(let h=0;h<4;h++)for(let a=0;a<4;a++)if(h!==a){
 const date=new Date(Date.UTC(2021,6+month,1+(h*4+a)%12)).toISOString().slice(0,10);
 history.push(row(date,names[h],names[a],(h+month)%4,(a+month+1)%3,{HS:8+h*3,AS:6+a*2,HST:2+h,AST:1+a}));
}
history.push(row('2026-10-21','A','B',2,1),row('2026-10-21','C','D',1,0));
let prepared,report;
test('Reversed input and changed target-day results/statistics leave every pre-match forecast unchanged',()=>{
 prepared=H.prepare(history);
 const altered=structuredClone(history);altered.at(-1)[7]=8;altered.at(-1)[8]=7;
 altered.at(-1)[9]=9;altered.at(-1)[10]=8;altered.at(-1)[13]={HS:99,AS:99,HST:98,AST:98};
 const changed=H.prepare(altered.reverse());
 assert.equal(changed.forecast_receipts_sha256,prepared.forecast_receipts_sha256);
 assert.deepEqual(changed.rows.map(r=>r.predictions),prepared.rows.map(r=>r.predictions));
 assert.equal(changed.rows.at(-1).statsAvailable,prepared.rows.at(-1).statsAvailable);
 assert.notDeepEqual(changed.rows.at(-1).actual,prepared.rows.at(-1).actual);
 assert.equal(prepared.fitting.strict_cutoffs_verified,true);
});
test('Later outcomes cannot tune any early weight; the SOT controls have exactly the same early count',()=>{
 const a=structuredClone(prepared.rows),b=structuredClone(a);
 for(const r of b)if(r.date>=H.SETTINGS.validationSince)r.actual=vectors[2];
 const wa=H.calibrate(a),wb=H.calibrate(b);assert.deepEqual(wa,wb);
 assert.deepEqual(a.filter(r=>r.date<H.SETTINGS.validationSince),b.filter(r=>r.date<H.SETTINGS.validationSince));
 for(const id of ['hybrid_stats_control','candidate_sot_control'])assert.equal(wa[id].n,wa.hybrid_sot.n);
 assert.equal(wa.hybrid_learned.n,a.filter(r=>r.available&&r.date<H.SETTINGS.validationSince).length);
});
test('Missing statistics preserve the learned pure hybrid; missing model 2 preserves model 1 exactly',()=>{
 const rows=structuredClone(prepared.rows),last=structuredClone(rows.at(-1));
 last.statsAvailable=false;delete last.predictions.sot;
 const missing={...structuredClone(last),available:false,predictions:{current:last.predictions.current,candidate:last.predictions.current}};
 rows.push(last,missing);H.calibrate(rows);
 for(const id of ['hybrid_stats_control','candidate_sot_control','hybrid_sot'])assert.strictEqual(last.predictions[id],last.predictions.hybrid_learned);
 for(const id of ['hybrid_50','hybrid_learned','hybrid_stats_control','candidate_sot_control','hybrid_sot'])assert.strictEqual(missing.predictions[id],missing.predictions.current);
 const noEarlyStats=structuredClone(prepared.rows);for(const r of noEarlyStats)if(r.date<H.SETTINGS.validationSince)r.statsAvailable=false;
 const blends=H.calibrate(noEarlyStats);assert.equal(blends.hybrid_sot.n,0);
 for(const r of noEarlyStats)assert.strictEqual(r.predictions.hybrid_sot,r.predictions.hybrid_learned);
});
test('Every within-table cohort is paired, and the extension cannot qualify by beating model 1 alone',()=>{
 report=H.finish(structuredClone(prepared));
 for(const c of Object.values(report.cohorts))for(const e of Object.values(c.evaluations)){
  assert.equal(e.later.n,c.later_n);assert.equal(Object.values(e.periods).reduce((n,s)=>n+s.n,0),c.n);
 }
 assert.equal(report.qualifications.hybrid_sot.automatic_promotion,false);
 assert.equal(report.qualifications.hybrid_sot.prospective_evidence,false);
 assert.equal(report.policy.live_model_changed,false);assert.equal(report.policy.frozen_experiment_changed,false);
 assert.equal(report.qualifications.hybrid_learned.eligible_for_separate_prospective_comparison,false);
 const c=structuredClone(report.cohorts.stats);
 for(const p of ['validation','recent']){c.evaluations.hybrid_sot.periods[p].n=600;
  c.evaluations.hybrid_sot.periods[p].primary_brier=c.evaluations.hybrid_stats_control.periods[p].primary_brier+.0001;}
 assert.equal(H.qualification(c,'hybrid_sot',['candidate','hybrid_stats_control','candidate_sot_control'],1).checks.lower_primary_brier_in_both_periods,false);
});
test('All frozen source, original study and TRUE FORM fingerprints stay unchanged',()=>{
 const snapshot=JSON.parse(fs.readFileSync('docs/data/research_snapshot.json','utf8'));
 for(const [p,expected] of Object.entries(snapshot.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
 const tf=JSON.parse(fs.readFileSync('docs/data/true_form_comparison.json','utf8'));
 for(const [p,expected] of Object.entries(tf.provenance.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
 const bad=H.seal({...report,provenance:{test:true}});bad.n++;assert.throws(()=>H.check(bad,{test:true}),/integrity/);
});
