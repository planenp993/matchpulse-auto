/* Frozen, paired prospective forecasts. Reuses the existing diary's selection,
 * settlement, correction and persistence rules. No provider requests. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const J=require('./forecast_diary.cjs'),F=require('./fit_goal_model.cjs'),C=require('./compare_goal_models.cjs');
const D=require('./evaluate_model.cjs'),M=require('../docs/model-core.js'),S=require('../docs/scout-core.js');
const ROOT=path.resolve(__dirname,'..'),DATA=path.join(ROOT,'docs/data');
const ID='opponent-days-v1',RELATIVE='docs/data/diary/experiments/'+ID,DIR=path.join(ROOT,RELATIVE);
const CANDIDATE_FILES=['scripts/fit_goal_model.cjs','docs/model-core.js','docs/club-aliases.js'];
const SELECTED=['1x2','double1X','doubleX2','double12','over15','over25','over35','btts','homeOver15','awayOver15'];
const vector=p=>D.MARKETS.map(m=>p[m.id]),dict=v=>Object.fromEntries(D.MARKETS.map((m,i)=>[m.id,v[i]]));
const stripSeal=record=>{const {sha256,...payload}=record;return payload;};
const fingerprint=files=>Object.fromEntries(files.map(f=>[f,J.sha(fs.readFileSync(path.join(ROOT,f)))]));
function codeVersions(){
 const files=fingerprint(CANDIDATE_FILES);
 return {files,candidate:J.sha(J.canonical(files)),recorder:J.sha(J.canonical(fingerprint(['scripts/paired_model_diary.cjs','scripts/forecast_diary.cjs','scripts/compare_goal_models.cjs','scripts/evaluate_model.cjs','docs/scout-core.js'])))};
}
function verifySeal(record){if(!record||J.seal(stripSeal(record)).sha256!==record.sha256)throw Error('Paired record hash mismatch');}
function makeConfig(comparison,{now=new Date(),comparisonSha=null,versions=codeVersions()}={}){
 if(!comparison.qualifications?.opponent_days_calibrated?.eligible_for_prospective_comparison)throw Error('Candidate did not pass the registered historical filter');
 return J.seal({schema:1,id:ID,created_at_utc:now.toISOString(),candidate:'opponent_days_calibrated',
  fit_settings:{...F.DEFAULTS},blend_weight:comparison.blends.opponent_days.weight,
  calibration_period:comparison.periods.calibration_fit,comparison_sha256:comparisonSha,
  candidate_files:versions.files,candidate_code_sha256:versions.candidate,
  policy:{horizon_days:3,minimum_minutes_before_kickoff:60,minimum_settled_for_review:500,minimum_calendar_weeks:12,
   minimum_fitted_coverage:.9,maximum_primary_market_brier_regression:.002,maximum_mean_log_loss_regression:.002,
   fit_cutoff:'ISO Monday of capture date; strictly earlier scores',paired_inputs_and_capture_time:true,
   frozen_calibration:true,fallback:'current, without calibration',automatic_promotion:false}});
}
function validateConfig(config){
 verifySeal(config);
 if(config.schema!==1||config.id!==ID||config.candidate!=='opponent_days_calibrated'||!Number.isFinite(Date.parse(config.created_at_utc))||
  !Number.isFinite(config.blend_weight)||config.blend_weight<0||config.blend_weight>1||
  !Array.isArray(config.calibration_period)||config.calibration_period.length!==2||config.calibration_period[1]>=config.created_at_utc.slice(0,10)||
  J.sha(J.canonical(config.candidate_files))!==config.candidate_code_sha256||config.policy?.automatic_promotion!==false||
  config.policy.minimum_minutes_before_kickoff<60||config.policy.horizon_days!==J.HORIZON_DAYS)
  throw Error('Invalid frozen experiment configuration');
 for(const file of CANDIDATE_FILES)if(!/^[a-f0-9]{64}$/.test(config.candidate_files?.[file]||''))throw Error('Missing candidate source fingerprint');
 return config;
}
function validate(forecasts,events,config){
 validateConfig(config);const result=J.validate(forecasts,events);
 for(const entry of forecasts){
  const t=entry.trial,c=t?.candidate;
  if(t?.experiment_id!==config.id||t.config_sha256!==config.sha256||t.candidate_code_sha256!==config.candidate_code_sha256||
   Date.parse(entry.captured_at_utc)<Date.parse(config.created_at_utc)||
   Date.parse(entry.kickoff_utc)-Date.parse(entry.captured_at_utc)<config.policy.minimum_minutes_before_kickoff*60000)
   throw Error('Invalid paired capture identity or timing');
  if(typeof c?.available!=='boolean'||c.blend_weight!==(c.available?config.blend_weight:0))throw Error('Invalid candidate availability');
  const p=vector(c.probabilities),raw=vector(c.raw_probabilities),base=vector(entry.model.baselines.league_goal_means);
  for(const values of [p,raw]){
   if(values.some(v=>!Number.isFinite(v)||v<0||v>1+1e-12)||Math.abs(values[0]+values[1]+values[2]-1)>1e-10)throw Error('Invalid paired probabilities');
   for(const [i,m] of D.MARKETS.entries())if(m.complement&&Math.abs(values[i]+values[D.MARKETS.findIndex(x=>x.id===m.complement)]-1)>1e-10)throw Error('Incoherent paired markets');
  }
  if(p.some((v,i)=>Math.abs(v-((1-c.blend_weight)*raw[i]+c.blend_weight*base[i]))>1e-12))throw Error('Candidate blend differs from the frozen policy');
  if(!c.available&&p.some((v,i)=>Math.abs(v-D.probabilityVector(entry.model.probabilities)[i])>1e-12))throw Error('Fallback differs from the paired current forecast');
  const cutoff=F.weekStart(J.sofiaDate(new Date(entry.captured_at_utc)));
  if(c.training_cutoff!==cutoff||c.training_max_date&&c.training_max_date>=cutoff)throw Error('Candidate training contains future data');
  if(c.available&&(!c.converged||c.home_n<config.fit_settings.minimumTeamMatches||c.away_n<config.fit_settings.minimumTeamMatches||c.league_n<config.fit_settings.minimumLeagueMatches))throw Error('Unsupported fitted forecast');
 }
 return result;
}
function summary(report){
 return {schema_version:1,experiment_id:report.experiment_id,started_at_utc:report.started_at_utc,checked_at_utc:report.checked_at_utc,
  totals:report.totals,current:report.evaluations.current,candidate:report.evaluations.candidate,
  decision:report.decision,capture_paused:report.last_run.capture_paused,integrity:report.integrity};
}
function report(forecasts,events,config,now=new Date(),run={}){
 const {latest}=validate(forecasts,events,config),seen=new Set(),rows=[],totals={recorded:forecasts.length,settled:0,pending:0,excluded:0,unmatched:0,fitted:0};
 const sorted=forecasts.slice().sort((a,b)=>a.captured_at_utc.localeCompare(b.captured_at_utc)||a.id.localeCompare(b.id));
 for(const entry of sorted){
  const f=entry.fixture,key=S.keyFixture([f.div,null,null,f.date,null,f.home,f.away]);
  const state={...(latest.get(entry.id)?.state||{status:'pending'})};
  if(seen.has(key))state.status='excluded';seen.add(key);totals[state.status]++;
  if(entry.trial.candidate.available)totals.fitted++;
  if(state.status!=='settled')continue;
  const actual=[f.div,f.country,f.league,f.date,f.time,f.home,f.away,...state.result.score];
  rows.push({date:f.date,division:f.div,actual:D.outcomeVector(actual),available:entry.trial.candidate.available,
   predictions:{current:D.probabilityVector(entry.model.probabilities),candidate:vector(entry.trial.candidate.probabilities)},
   frequencies:vector(entry.model.baselines.league_frequencies),poisson:vector(entry.model.baselines.league_goal_means)});
 }
 const evaluations={current:C.summarize(rows,'current',{detail:true}),candidate:C.summarize(rows,'candidate',{detail:true})};
 const weeks=new Set(rows.map(r=>D.weekOf(r.date))).size,p=config.policy,coverage=rows.length?rows.filter(r=>r.available).length/rows.length:null;
 const a=evaluations.current,b=evaluations.candidate,ready=rows.length>=p.minimum_settled_for_review&&weeks>=p.minimum_calendar_weeks;
 const checks={enough_results:rows.length>=p.minimum_settled_for_review,enough_weeks:weeks>=p.minimum_calendar_weeks,
  fitted_coverage:coverage!==null&&coverage>=p.minimum_fitted_coverage,lower_primary_error:rows.length>0&&b.primary_brier<a.primary_brier,
  positive_paired_interval:(b.against_current.approximate_95pct_interval?.[0]??-Infinity)>0,
  no_primary_market_regression:rows.length>0&&['1x2','over25','btts'].every(id=>(id==='1x2'?.5:1)*(b.markets[id].brier-a.markets[id].brier)<=p.maximum_primary_market_brier_regression),
  no_log_loss_regression:rows.length>0&&b.primary_log_loss-a.primary_log_loss<=p.maximum_mean_log_loss_regression};
 return {schema_version:1,experiment_id:config.id,config_sha256:config.sha256,started_at_utc:sorted[0]?.captured_at_utc||null,
  checked_at_utc:now.toISOString(),totals,evaluations,settled_fitted_coverage:coverage,
  decision:{status:!ready?'collecting':Object.values(checks).every(Boolean)?'ready_for_review':'insufficient_evidence',
   checks,settled:rows.length,calendar_weeks:weeks,minimum_settled:p.minimum_settled_for_review,minimum_weeks:p.minimum_calendar_weeks,automatic_promotion:false},
  integrity:{forecast_count:forecasts.length,event_count:events.length,ledger_sha256:J.ledgerHash(forecasts,events)},last_run:run,
  method:{paired_same_capture_and_inputs:true,frozen_candidate:config.candidate_code_sha256,frozen_calibration:config.blend_weight,
   retrospective_results_included:false,original_diary_records_included:false,minimum_minutes_before_kickoff:p.minimum_minutes_before_kickoff,
   results_follow_history_refresh:true,intervals:'Approximate paired calendar-week clusters; not an automatic activation rule'}};
}
function advance({history,fixtures,forecasts=[],events=[],config,now=new Date(),sources={},versions=codeVersions()}){
 validate(forecasts,events,config);
 if(+now<Date.parse(config.created_at_utc))throw Error('Experiment clock predates registration');
 const active=versions.candidate===config.candidate_code_sha256;
 const eligible=active?fixtures.filter(f=>{
  const kickoff=J.confirmedKickoff(f);return kickoff&&Date.parse(kickoff)-+now>=config.policy.minimum_minutes_before_kickoff*60000;
 }):[];
 // Retain all fresh fixtures for schedule updates, while capture has the stricter
 // one-hour margin. Existing records can always settle, including during a pause.
 const captureAndSettle=J.advance({history,fixtures:eligible,forecasts,events,now,sources});
 const fits=new Map(),cutoff=F.weekStart(J.sofiaDate(now)),newForecasts=[];
 for(const entry of captureAndSettle.newForecasts){
  const f=entry.fixture,fixture=[f.div,f.country,f.league,f.date,f.time,f.home,f.away,null,null,null,null,null,null,f.source];
  if(!fits.has(f.div))fits.set(f.div,F.fit(history,f.div,cutoff,config.fit_settings));
  const fit=fits.get(f.div),candidate=F.predict(fit,fixture),available=!candidate.error;
  const raw=available?D.probabilityVector(candidate.distribution.probs):D.probabilityVector(entry.model.probabilities);
  const weight=available?config.blend_weight:0,probabilities=F.blendVector(raw,vector(entry.model.baselines.league_goal_means),weight);
  newForecasts.push(J.seal({...stripSeal(entry),scanner:null,trial:{experiment_id:config.id,config_sha256:config.sha256,
   candidate_code_sha256:config.candidate_code_sha256,recorder_sha256:versions.recorder,
   candidate:{available,reason:candidate.error||null,blend_weight:weight,probabilities:dict(probabilities),raw_probabilities:dict(raw),
    lambda_home_raw:candidate.lambdaHome??null,lambda_away_raw:candidate.lambdaAway??null,
    training_cutoff:cutoff,training_max_date:fit.trainingMaxDate||null,league_n:fit.n||0,
    home_n:candidate.homeN??0,away_n:candidate.awayN??0,converged:fit.converged||false}}}));
 }
 const allForecasts=[...forecasts,...newForecasts];
 // Reuse the diary's established outcome/schedule handling with the fully sealed
 // paired records and every fresh fixture, even if too near kickoff for capture.
 const settlement=J.advance({history,fixtures,forecasts:allForecasts,events,now,sources,capture:false});
 const run={new_pairs:newForecasts.length,new_events:settlement.newEvents.length,capture_paused:!active,
  skipped:captureAndSettle.report.last_run.skipped,weekly_fits:fits.size};
 return {newForecasts,newEvents:settlement.newEvents,
  report:report(allForecasts,[...events,...settlement.newEvents],config,now,run)};
}
function checkPrefixes(baseRef,root=ROOT){
 const relative='docs/data/diary/experiments';J.checkPrefixes(baseRef,root,[relative]);
 const files=execFileSync('git',['ls-tree','-r','--name-only',baseRef,'--',relative],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('/config.json'));
 for(const file of files){
  const before=execFileSync('git',['show',baseRef+':'+file],{cwd:root,maxBuffer:1024*1024}),current=path.join(root,file);
  if(!fs.existsSync(current)||!fs.readFileSync(current).equals(before))throw Error('Published experiment config was altered: '+file);
 }
 return files.length;
}
function checkOutputs(ledger,config,saved,diary){
 validate(ledger.forecasts,ledger.events,config);
 if(saved?.integrity?.ledger_sha256!==J.ledgerHash(ledger.forecasts,ledger.events)||saved.config_sha256!==config.sha256)throw Error('Paired summary does not match its records');
 const expected=report(ledger.forecasts,ledger.events,config,new Date(saved.checked_at_utc),saved.last_run);
 if(J.canonical(saved)!==J.canonical(expected))throw Error('Paired metrics differ from the frozen records');
 if(J.canonical(diary?.paired_model_test)!==J.canonical(summary(saved)))throw Error('Diary comparison summary is missing or stale');
 return true;
}
function main(){
 const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];},configFile=path.join(DIR,'config.json');
 if(args.includes('--init')){
  if(fs.existsSync(configFile))throw Error('Experiment configuration already exists');
  const raw=fs.readFileSync(path.join(DATA,'model_comparison.json'),'utf8'),comparison=JSON.parse(raw),versions=codeVersions();
  const {integrity_sha256,...payload}=comparison;if(J.sha(JSON.stringify(payload))!==integrity_sha256)throw Error('Historical comparison is invalid');
  for(const file of CANDIDATE_FILES)if(comparison.provenance.files[file]!==versions.files[file])throw Error('Historical comparison uses a different candidate');
  const config=makeConfig(comparison,{comparisonSha:J.sha(raw),versions});validateConfig(config);
  fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(configFile,JSON.stringify(config));console.log(JSON.stringify({registered:config.id,created_at_utc:config.created_at_utc,blend_weight:config.blend_weight}));return;
 }
 const config=JSON.parse(fs.readFileSync(configFile,'utf8')),ledger=J.readLedger(DIR);
 validate(ledger.forecasts,ledger.events,config);if(value('--base-ref'))checkPrefixes(value('--base-ref'));
 const reportFile=path.join(DATA,'paired_model_report.json'),diaryFile=path.join(DATA,'diary_report.json');
 if(args.includes('--check')){
  checkOutputs(ledger,config,JSON.parse(fs.readFileSync(reportFile,'utf8')),JSON.parse(fs.readFileSync(diaryFile,'utf8')));
  console.log(JSON.stringify({paired_forecasts:ledger.forecasts.length,events:ledger.events.length,append_only_check:'pass'}));return;
 }
 if(!args.includes('--write'))throw Error('Use --init, --check or --write');
 const h=fs.readFileSync(path.join(DATA,'history.json'),'utf8'),f=fs.readFileSync(path.join(DATA,'fixtures.json'),'utf8'),s=fs.readFileSync(path.join(DATA,'status.json'),'utf8');
 const now=new Date(),calendar=J.calendarSnapshot(JSON.parse(s),JSON.parse(f),now);
 const result=advance({...ledger,config,now,history:JSON.parse(h),fixtures:calendar.fixtures,
  sources:{history_sha256:J.sha(h),fixtures_sha256:J.sha(f),status_sha256:J.sha(s),calendar_stamp_utc:calendar.stamp}});
 result.report.last_run.calendar={fresh:calendar.fresh,blocked_fixtures:calendar.blocked,stamp:calendar.stamp};
 J.appendRecords(DIR,'forecasts',result.newForecasts);
 J.appendRecords(DIR,'events',result.newEvents,new Map([...ledger.forecasts,...result.newForecasts].map(e=>[e.id,e])));
 fs.writeFileSync(reportFile,JSON.stringify(result.report));
 const diary=JSON.parse(fs.readFileSync(diaryFile,'utf8'));diary.paired_model_test=summary(result.report);fs.writeFileSync(diaryFile,JSON.stringify(diary));
 console.log(JSON.stringify({...result.report.last_run,totals:result.report.totals,decision:result.report.decision.status}));
}
if(require.main===module)main();
module.exports={ID,RELATIVE,codeVersions,makeConfig,validateConfig,validate,report,summary,advance,checkPrefixes,checkOutputs};
