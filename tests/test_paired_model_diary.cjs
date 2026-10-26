'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const T=require('../scripts/paired_model_diary.cjs'),J=require('../scripts/forecast_diary.cjs'),D=require('../scripts/evaluate_model.cjs'),F=require('../scripts/fit_goal_model.cjs'),M=require('../docs/model-core.js');
const NOW=new Date('2026-10-26T08:00:00Z');
const history=Array.from({length:80},(_,i)=>{
 const date=new Date(+NOW-(i+1)*86400000).toISOString().slice(0,10);
 return ['E0','England','Test league',date,'18:00',i%2?'Alpha':'Beta',i%2?'Beta':'Alpha',i%3?2:1,i%4?1:0,null,null,null,null];
});
const fixture=(date='2026-10-26',home='Alpha',away='Beta',time='18:00')=>['E0','England','Test league',date,time,home,away,null,null,null,null,null,null,'FixtureDownload / UTC→Europe-Sofia'];
const row=(date,hg=2,ag=1,extra={})=>{const r=fixture(date);r[7]=hg;r[8]=ag;r[13]=extra;return r;};
const comparison={qualifications:{opponent_days_calibrated:{eligible_for_prospective_comparison:true}},blends:{opponent_days:{weight:.16496332938501473}},periods:{calibration_fit:['2023-07-01','2025-06-30']}};
const config=T.makeConfig(comparison,{now:new Date('2026-10-26T07:00:00Z')});
const capture=(options={})=>T.advance({history,fixtures:[fixture()],config,now:NOW,...options});
const settle=(first,options={})=>capture({forecasts:first.newForecasts,events:[],fixtures:[],history:[...history,row('2026-10-26')],now:new Date('2026-10-27T08:00:00Z'),...options});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`);
test('A paired capture freezes two forecasts at one instant and uses the unchanged browser baseline',()=>{
 const original=JSON.stringify(history),first=capture(),entry=first.newForecasts[0],model=M.evaluate(history,fixture());
 assert.equal(first.newForecasts.length,1);assert.equal(entry.captured_at_utc,NOW.toISOString());
 assert.deepEqual(entry.model.probabilities,model.distribution.probs);assert.equal(entry.scanner,null);
 assert.equal(entry.trial.candidate.available,true);assert.equal(entry.trial.config_sha256,config.sha256);
 assert.equal(entry.trial.candidate.blend_weight,config.blend_weight);
 const fitted=F.predict(F.fit(history,'E0','2026-10-26'),fixture()),candidate=entry.trial.candidate;
 const p=D.probabilityVector(fitted.distribution.probs),q=D.MARKETS.map(m=>entry.model.baselines.league_goal_means[m.id]);
 for(const [i,m] of D.MARKETS.entries())close(candidate.probabilities[m.id],(1-config.blend_weight)*p[i]+config.blend_weight*q[i]);
 assert.equal(first.report.totals.recorded,1);assert.equal(first.report.evaluations.candidate.n,0);
 assert.equal(first.report.decision.status,'collecting');assert.equal(first.report.decision.automatic_promotion,false);
 assert.equal(JSON.stringify(history),original);
});
test('The original diary is not amended or used as an earlier baseline for the pair',()=>{
 const original=J.advance({history,fixtures:[fixture()],now:new Date('2026-10-26T06:00:00Z')}),saved=JSON.stringify(original);
 const first=capture();assert.notEqual(first.newForecasts[0].captured_at_utc,original.newForecasts[0].captured_at_utc);
 assert.equal(JSON.stringify(original),saved);assert.equal(first.report.method.original_diary_records_included,false);
 assert.equal(first.report.method.retrospective_results_included,false);
});
test('Settlement-only mode can update a result without capturing another upcoming fixture',()=>{
 const original=J.advance({history,fixtures:[fixture()],now:NOW});
 const done=J.advance({history:[...history,row('2026-10-26')],fixtures:[fixture('2026-10-27')],forecasts:original.newForecasts,now:new Date('2026-10-27T08:00:00Z'),capture:false});
 assert.equal(done.newForecasts.length,0);assert.equal(done.newEvents.length,1);
});
test('Capture enforces a full hour, confirmed kickoffs and the current three-day horizon',()=>{
 for(const time of ['09:00','10:59',''])assert.equal(capture({fixtures:[fixture('2026-10-26','Alpha','Beta',time)]}).newForecasts.length,0);
 assert.equal(capture({fixtures:[fixture('2026-10-26','Alpha','Beta','11:00')]}).newForecasts.length,1);
 assert.equal(capture({fixtures:[fixture('2026-10-28')]}).newForecasts.length,1);
 assert.equal(capture({fixtures:[fixture('2026-10-29')]}).newForecasts.length,0);
 const eu=fixture();eu[0]='UCL';assert.equal(capture({fixtures:[eu]}).newForecasts.length,0);
 assert.equal(capture({history:[...history,row('2026-10-26')]}).newForecasts.length,0);
});
test('Future scores and backwards clocks cannot create paired evidence',()=>{
 assert.throws(()=>capture({history:[...history,row('2026-10-27')]}),/Future scores/);
 assert.throws(()=>capture({now:new Date('2026-10-26T06:00:00Z')}),/predates registration/);
 const first=capture();assert.throws(()=>capture({forecasts:first.newForecasts,now:new Date('2026-10-26T07:59:00Z')}),/clock moved backwards/);
});
test('The fit origin follows the capture week even for a fixture in the following week',()=>{
 const first=capture({now:new Date('2026-11-01T08:00:00Z'),fixtures:[fixture('2026-11-02')],history:[...history,row('2026-10-31',4,0)]});
 const c=first.newForecasts[0].trial.candidate;
 assert.equal(c.training_cutoff,'2026-10-26');assert.ok(c.training_max_date<c.training_cutoff);
});
test('Unsupported fitted clubs use the current forecast unchanged and remain explicitly counted',()=>{
 const extra=Array.from({length:8},(_,i)=>{const r=row('2026-10-'+String(i+1).padStart(2,'0'));r[0]='D1';r[5]='Newcomer';r[6]='Other';return r;});
 const first=capture({history:[...history,...extra],fixtures:[fixture('2026-10-26','Newcomer','Beta')]});
 const entry=first.newForecasts[0];assert.equal(entry.trial.candidate.available,false);assert.equal(entry.trial.candidate.reason,'unknown_team');
 assert.equal(entry.trial.candidate.blend_weight,0);assert.equal(first.report.totals.fitted,0);
 assert.deepEqual(D.MARKETS.map(m=>entry.trial.candidate.probabilities[m.id]),D.probabilityVector(entry.model.probabilities));
});
test('Repeated runs, alias duplicates and recorder revisions never replace a published pair',()=>{
 const first=capture(),saved=JSON.stringify(first.newForecasts),versions=T.codeVersions();versions.recorder='changed-recorder';
 const again=capture({forecasts:first.newForecasts,fixtures:[fixture(),fixture()],versions});
 assert.equal(again.newForecasts.length,0);assert.equal(again.newEvents.length,0);assert.equal(JSON.stringify(first.newForecasts),saved);
 const named=history.map(r=>r.map(v=>v==='Alpha'?'Manchester United':v));
 const aliases=capture({history:named,fixtures:[fixture('2026-10-26','Manchester United','Beta'),fixture('2026-10-26','Man Utd','Beta')]});
 assert.equal(aliases.newForecasts.length,1);
});
test('Candidate code changes pause new captures but existing pairs still settle',()=>{
 const first=capture(),versions=T.codeVersions();versions.candidate='different-code';
 const next=settle(first,{versions,fixtures:[fixture('2026-10-27')]});
 assert.equal(next.newForecasts.length,0);assert.equal(next.report.last_run.capture_paused,true);
 assert.equal(next.report.totals.settled,1);assert.equal(next.report.evaluations.current.n,1);assert.equal(next.report.evaluations.candidate.n,1);
});
test('Both models are evaluated on the same final result and their frozen probabilities',()=>{
 const first=capture(),done=settle(first),entry=first.newForecasts[0];
 assert.equal(done.newEvents.length,1);assert.equal(done.report.evaluations.current.n,1);assert.equal(done.report.evaluations.candidate.n,1);
 close(done.report.evaluations.current.markets.over25.brier,Number(((entry.model.probabilities.over25-1)**2).toFixed(6)));
 close(done.report.evaluations.candidate.markets.over25.brier,Number(((entry.trial.candidate.probabilities.over25-1)**2).toFixed(6)));
 assert.equal(done.report.decision.status,'collecting');
 const repeated=settle(first,{events:done.newEvents});assert.equal(repeated.newEvents.length,0);
});
test('Corrections append events for both scores without editing either original forecast',()=>{
 const first=capture(),one=settle(first),saved=JSON.stringify([first.newForecasts,one.newEvents]);
 const two=settle(first,{events:one.newEvents,history:[...history,row('2026-10-26',0,0)],now:new Date('2026-10-28T08:00:00Z')});
 assert.equal(two.newEvents[0].revision,2);assert.equal(two.report.evaluations.current.markets.over25.actual_rate,0);
 assert.equal(two.report.evaluations.candidate.markets.over25.actual_rate,0);assert.equal(JSON.stringify([first.newForecasts,one.newEvents]),saved);
});
test('Awarded scores, missing settled results and early live scores never become scored pairs',()=>{
 const first=capture();
 const awarded=settle(first,{history:[...history,row('2026-10-26',3,0,{AWARDED:true})]});
 assert.equal(awarded.report.totals.excluded,1);assert.equal(awarded.report.evaluations.current.n,0);
 const early=settle(first,{now:new Date('2026-10-26T17:00:00Z')});assert.equal(early.report.totals.pending,1);
 const done=settle(first),missing=settle(first,{events:done.newEvents,history});
 assert.equal(missing.report.totals.unmatched,1);assert.equal(missing.report.evaluations.candidate.n,0);
});
test('Schedule updates remain visible inside the no-capture margin and exclude pre-capture kickoffs',()=>{
 const first=capture(),changed=capture({forecasts:first.newForecasts,now:new Date('2026-10-26T16:15:00Z'),fixtures:[fixture('2026-10-26','Alpha','Beta','19:00')]});
 assert.equal(changed.newForecasts.length,0);assert.equal(changed.newEvents[0].state.kickoff_utc,'2026-10-26T17:00:00.000Z');
 const invalid=capture({forecasts:first.newForecasts,fixtures:[fixture('2026-10-26','Alpha','Beta','09:00')]});
 assert.equal(invalid.report.totals.excluded,1);
});
test('Paired hashes and blend coherence reject edited or resealed inconsistent forecasts',()=>{
 const first=capture(),bad=structuredClone(first.newForecasts);bad[0].trial.candidate.probabilities.over25=.99;
 assert.throws(()=>T.validate(bad,[],config),/hash mismatch/);
 const payload={...bad[0]};delete payload.sha256;const resealed=J.seal(payload);
 assert.throws(()=>T.validate([resealed],[],config),/Incoherent|blend differs/);
 const modified={...config,blend_weight:.5};delete modified.sha256;
 assert.throws(()=>T.validate(first.newForecasts,[],J.seal(modified)),/identity/);
});
test('Published experiment records permit appends while config changes, deletion and edits are blocked',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mp-paired-git-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'}),dir=path.join(root,T.RELATIVE);fs.mkdirSync(path.join(dir,'forecasts'),{recursive:true});
 const cfg=path.join(dir,'config.json'),file=path.join(dir,'forecasts/2026-10.jsonl');fs.writeFileSync(cfg,JSON.stringify(config));fs.writeFileSync(file,'original\n');
 git(['init','-q']);git(['add','.']);git(['-c','user.name=Paired test','-c','user.email=test@example.invalid','commit','-qm','published']);
 fs.appendFileSync(file,'next\n');assert.equal(T.checkPrefixes('HEAD',root),1);
 fs.writeFileSync(cfg,'changed');assert.throws(()=>T.checkPrefixes('HEAD',root),/config was altered/);fs.writeFileSync(cfg,JSON.stringify(config));
 fs.writeFileSync(file,'edited\n');assert.throws(()=>T.checkPrefixes('HEAD',root),/Published diary bytes/);
 fs.unlinkSync(file);assert.throws(()=>T.checkPrefixes('HEAD',root),/Published diary bytes/);
});
test('Outcome/config consistency and the embedded UI summary are independently checked',()=>{
 const first=capture(),ledger={forecasts:first.newForecasts,events:[]},diary={paired_model_test:T.summary(first.report)};
 assert.equal(T.checkOutputs(ledger,config,first.report,diary),true);
 assert.throws(()=>T.checkOutputs(ledger,config,first.report,{}),/missing or stale/);
 const bad=structuredClone(first.report);bad.evaluations.candidate.primary_brier=.01;
 assert.throws(()=>T.checkOutputs(ledger,config,bad,{paired_model_test:T.summary(bad)}),/metrics differ/);
});
test('Reading a newer ledger during a retry preserves both writers and does not duplicate pairs',()=>{
 const a=capture(),b=capture({fixtures:[fixture('2026-10-27')]}),records=[...a.newForecasts,...b.newForecasts];
 const saved=JSON.stringify(records),next=capture({forecasts:records,fixtures:[fixture(),fixture('2026-10-27')]});
 assert.equal(next.newForecasts.length,0);assert.equal(next.report.totals.recorded,2);assert.equal(JSON.stringify(records),saved);
});
test('A single record cannot change the registered calibration or trigger automatic promotion',()=>{
 const first=capture(),laterComparison=structuredClone(comparison);laterComparison.blends.opponent_days.weight=.9;
 assert.equal(T.makeConfig(laterComparison,{now:NOW}).blend_weight,.9);
 const done=settle(first);assert.equal(first.newForecasts[0].trial.candidate.blend_weight,config.blend_weight);
 assert.equal(done.report.decision.checks.enough_results,false);assert.equal(done.report.decision.automatic_promotion,false);
 assert.throws(()=>T.makeConfig({...comparison,qualifications:{}},{now:NOW}),/historical filter/);
});
test('The published UI asset has a content version so cached clients receive the paired table',()=>{
 const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'docs/scout.html'),'utf8');
 const version=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'docs/scout.js'))).digest('hex').slice(0,12);
 assert.ok(html.includes('src="scout.js?v='+version+'"'));
});
