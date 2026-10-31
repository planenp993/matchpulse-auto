/* Fixed, provider-free TRUE FORM replay; all production modules are read-only. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const M=require('../docs/model-core.js'),D=require('./evaluate_model.cjs'),F=require('./fit_goal_model.cjs');
const C=require('./compare_goal_models.cjs'),S=require('./shot_goal_model.cjs'),SC=require('./compare_shot_models.cjs');
const T=require('./true_form_model.cjs');
const ROOT=path.resolve(__dirname,'..'),PROTOCOL='docs/true-form-protocol.md';
const OUT='docs/data/true_form_comparison.json',MD='docs/true-form-comparison.md';
const SNAPSHOT='docs/data/research_snapshot.json',CONFIG='docs/data/diary/experiments/opponent-days-v1/config.json';
const SOURCES=[PROTOCOL,SNAPSHOT,CONFIG,'docs/model-core.js','docs/club-aliases.js','scripts/evaluate_model.cjs',
 'scripts/fit_goal_model.cjs','scripts/compare_goal_models.cjs','scripts/shot_goal_model.cjs','scripts/compare_shot_models.cjs',
 'docs/data/shot_model_comparison.json','scripts/true_form_model.cjs','scripts/compare_true_form.cjs'];
const VARIANTS=['current','frozen_candidate','goals_raw','true_form_raw','goals_calibrated','true_form_calibrated'];
const LABELS={current:'Сегашен модел',frozen_candidate:'Втори модел от дневника',goals_raw:'Голов модел · без калибрация',
 true_form_raw:'TRUE FORM · без калибрация',goals_calibrated:'Голов контрол · обща ранна извадка',true_form_calibrated:'Голове + TRUE FORM + калибрация',
 shots_frozen:'Голове + общи удари · замразена смес',sot_frozen:'Голове + точни удари · замразена смес'};
const SETTINGS=Object.freeze({...C.PERIODS,warmupSince:'2023-01-01',until:'2026-10-25'});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const round=x=>Number.isFinite(x)?Number(x.toFixed(6)):null;
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
function inputs(){
 const snapshot=JSON.parse(read(SNAPSHOT));
 for(const p of SOURCES)if(snapshot.files[p]&&hash(read(p))!==snapshot.files[p])throw Error('Frozen source changed: '+p);
 const raw=cp.execFileSync('git',['show',snapshot.commit+':docs/data/history.json'],{cwd:ROOT,maxBuffer:32*1024*1024}).toString('utf8');
 if(hash(raw)!==snapshot.history_sha256)throw Error('Pinned history hash mismatch');
 return {raw,snapshot};
}
function sourceFingerprint(raw,snapshot){return {pinned_history_commit:snapshot.commit,history_sha256:hash(raw),
 files:Object.fromEntries(SOURCES.map(p=>[p,hash(read(p))]))};}
function prepare(history,settings={}){
 const opts={...SETTINGS,...settings};
 for(const k of ['since','warmupSince','validationSince','recentSince','until'])F.dateNumber(opts[k]);
 if(!(opts.warmupSince<opts.since&&opts.since<opts.validationSince&&opts.validationSince<opts.recentSince&&opts.recentSince<=opts.until))throw Error('Invalid TRUE FORM periods');
 const frozenWeight=JSON.parse(read(CONFIG)).blend_weight,shotWeights=JSON.parse(read('docs/data/shot_model_comparison.json')).blends;
 const ordered=history.slice().sort((a,b)=>a[3].localeCompare(b[3])||T.key(a).localeCompare(T.key(b)));
 const replay=D.createReplay(ordered),byLeague=new Map(),cache=new Map(),state=T.createState(),rows=[];
 for(const r of replay.games)if(!T.INTERNATIONAL.has(r[0])){
  if(!byLeague.has(r[0]))byLeague.set(r[0],[]);byLeague.get(r[0]).push(r);
 }
 const games=ordered.filter(r=>r[3]>=opts.warmupSince&&r[3]<=opts.until);
 const excluded={administrative:0,international:0,insufficient_team_history:0,insufficient_league_history:0};
 const fitting={weekly_goal_fits:0,weekly_shot_snapshots:0,nonconverged:0,residual_source_matches:0,
  unavailable:{},shot_unavailable:{},true_form_clipped:0,strict_pregame_cutoffs_verified:true,same_day_batching:true};
 const receipts=crypto.createHash('sha256');let processed=0;
 for(let i=0;i<games.length;){
  let end=i+1;while(end<games.length&&games[end][3]===games[i][3])end++;
  const pending=[];
  for(const game of games.slice(i,end)){
   const target=game[3]>=opts.since;
   if(!M.isPlayed(game)){if(target&&game[13]?.AWARDED===true)excluded.administrative++;continue;}
   if(T.INTERNATIONAL.has(game[0])){if(target)excluded.international++;continue;}
   const division=game[0],origin=F.weekStart(game[3]);let snapshot=cache.get(division);
   if(snapshot?.cutoff!==origin){
    snapshot={cutoff:origin,goals:F.fit(byLeague.get(division)||[],division,origin)};cache.set(division,snapshot);fitting.weekly_goal_fits++;
    if(!snapshot.goals.error){
     if(!(snapshot.goals.trainingMaxDate<origin))throw Error('Historical expected goals contain future scores');
     if(!snapshot.goals.converged)fitting.nonconverged++;
    }
   }
   const base=F.predict(snapshot.goals,game);
   // Publish today's residual observations only after every prediction of the day.
   if(!base.error)pending.push([game,base]);
   if(!target)continue;
   const context=replay.context(game);
   if(Math.min(context.homeMatches.length,context.awayMatches.length)<5){excluded.insufficient_team_history++;continue;}
   if(!context.bases.has(division)||!context.count){excluded.insufficient_league_history++;continue;}
   const evaluated=M.evaluateContext(game,context,'standard');if(evaluated.error)throw Error(evaluated.error);
   const current=D.probabilityVector(evaluated.distribution.probs),league=context.bases.get(division);
   const poisson=D.probabilityVector(M.distribution(league.h,league.a,0).probs);
   const goals=base.error?current:D.probabilityVector(base.distribution.probs);
   const frozen=base.error?current:F.blendVector(goals,poisson,frozenWeight);
   const tf=T.predict(state,game,base),available=!tf.error;
   const row={key:T.key(game),division,date:game[3],actual:D.outcomeVector(game),poisson,frequencies:context.frequencies,
    available,statsAvailable:false,predictions:{current,frozen_candidate:frozen,goals,goals_raw:available?goals:frozen,
     true_form_raw:available?D.probabilityVector(tf.distribution.probs):frozen}};
   if(available){
    if(!(tf.home.maxDate<game[3]&&tf.away.maxDate<game[3]))throw Error('TRUE FORM contains same-day scores');
    if(tf.clipped)fitting.true_form_clipped++;
   }else fitting.unavailable[tf.error]=(fitting.unavailable[tf.error]||0)+1;
   // The frozen shot alternatives are diagnostics, evaluated on the same intersection.
   if(available){
    if(!snapshot.shots){snapshot.shots=S.fit(byLeague.get(division)||[],division,origin);fitting.weekly_shot_snapshots++;}
    const shot=S.predict(snapshot.shots,snapshot.goals,game);
    row.statsAvailable=!shot.error;
    if(!shot.error)for(const id of ['shots','sot']){
     const w=shotWeights[id+'_calibrated'];
     row.predictions[id+'_frozen']=S.mixVectors([goals,D.probabilityVector(shot.predictions[id].distribution.probs),poisson],[w.goals,w.shot,w.league]);
    }else fitting.shot_unavailable[shot.error]=(fitting.shot_unavailable[shot.error]||0)+1;
   }
   receipts.update(JSON.stringify({key:row.key,cutoff:origin,base:base.error?base.error:[base.lambdaHome,base.lambdaAway],
    form:available?[tf.home,tf.away]:tf.error,predictions:row.predictions})+'\n');
   rows.push(row);
  }
  for(const [r,p] of pending)if(T.add(state,r,p))fitting.residual_source_matches++;
  processed+=end-i;
  if(opts.progress&&(i===0||games[i][3].slice(0,7)!==games[Math.max(0,i-1)][3].slice(0,7)))
   process.stderr.write(`TRUE FORM ${games[i][3]}: ${rows.length} paired forecasts; ${processed} source matches processed\n`);
  i=end;
 }
 return {rows,opts,excluded,fitting,forecastReceiptsSha256:receipts.digest('hex'),frozenWeight,shotWeights};
}
function calibrate(rows,opts=SETTINGS){
 const early=rows.filter(r=>r.available&&r.date>=opts.since&&r.date<opts.validationSince);
 if(!early.length)throw Error('No early common TRUE FORM calibration cohort');
 const control=SC.fitMixture(early),raw=SC.fitMixture(early,'true_form_raw');
 const blends={goals_calibrated:{goals:control.goals,true_form:0,league:control.league,n:control.n},
  true_form_calibrated:{goals:raw.goals,true_form:raw.shot,league:raw.league,n:raw.n}};
 for(const r of rows)for(const [key,w] of Object.entries(blends))r.predictions[key]=r.available?
  S.mixVectors([r.predictions.goals,r.predictions.true_form_raw,r.poisson],[w.goals,w.true_form,w.league]):r.predictions.frozen_candidate;
 return blends;
}
function summarize(rows,key,detail=false){
 const result=C.summarize(rows,key,{detail});
 for(const [name,reference] of [['against_goals_control','goals_calibrated'],['against_frozen','frozen_candidate']])
  result[name]=C.pairedInterval(rows.map(r=>({...r,predictions:{current:r.predictions[reference],target:r.predictions[key]}})),'target');
 return result;
}
function periodRows(rows,opts){return {calibration_fit:rows.filter(r=>r.date<opts.validationSince),
 validation:rows.filter(r=>r.date>=opts.validationSince&&r.date<opts.recentSince),recent:rows.filter(r=>r.date>=opts.recentSince)};}
function qualification(evaluations,coverage){
 const candidate=evaluations.true_form_calibrated.available,refs=['goals_calibrated','frozen_candidate'],periods=['validation','recent'];
 const checks={at_least_500_per_later_period:periods.every(p=>candidate.periods[p].n>=500),
  lower_brier_than_both_controls_in_both_periods:refs.every(ref=>periods.every(p=>candidate.periods[p].primary_brier<evaluations[ref].available.periods[p].primary_brier)),
  no_primary_market_regression:refs.every(ref=>periods.every(p=>C.PRIMARY.every(i=>{
   const id=i===null?'1x2':D.MARKETS[i].id;return (i===null?.5:1)*(candidate.periods[p].markets[id].brier-evaluations[ref].available.periods[p].markets[id].brier)<=.002;
  }))),
  no_log_loss_regression:refs.every(ref=>periods.every(p=>candidate.periods[p].primary_log_loss-evaluations[ref].available.periods[p].primary_log_loss<=.002)),
  positive_paired_intervals:['against_goals_control','against_frozen'].every(id=>(candidate.later[id].approximate_95pct_interval?.[0]??-Infinity)>0),
  sufficient_later_coverage:coverage>=.9};
 return {eligible_for_separate_prospective_comparison:Object.values(checks).every(Boolean),checks,
  automatic_promotion:false,prospective_evidence:false};
}
function compare(history,settings={}){
 const {rows,opts,excluded,fitting,forecastReceiptsSha256,frozenWeight,shotWeights}=prepare(history,settings);
 const blends=calibrate(rows,opts),available=rows.filter(r=>r.available),later=rows.filter(r=>r.date>=opts.validationSince);
 const laterAvailable=later.filter(r=>r.available),intersection=available.filter(r=>r.statsAvailable&&r.date>=opts.validationSince);
 const evaluations={};
 for(const id of VARIANTS){
  if(opts.progress)process.stderr.write(`Scoring ${id}\n`);
  evaluations[id]={label:LABELS[id]};
  for(const [name,cohort] of [['all',rows],['available',available]])evaluations[id][name]={
   overall:summarize(cohort,id),periods:Object.fromEntries(Object.entries(periodRows(cohort,opts)).map(([p,part])=>[p,summarize(part,id,name==='available')])),
   later:summarize(cohort.filter(r=>r.date>=opts.validationSince),id,name==='available')};
  evaluations[id].later_available_by_league=Object.fromEntries([...new Set(laterAvailable.map(r=>r.division))].sort()
   .map(div=>[div,summarize(laterAvailable.filter(r=>r.division===div),id)]));
 }
 const coverage=later.length?laterAvailable.length/later.length:0;
 const report={schema_version:1,settings:SETTINGS,since:opts.since,requested_until:opts.until,observed_until:rows.at(-1)?.date||null,
  n:rows.length,available_n:available.length,divisions:[...new Set(rows.map(r=>r.division))].sort(),
  cohort_sha256:hash(rows.map(r=>r.key).join('\n')),available_cohort_sha256:hash(available.map(r=>r.key).join('\n')),
  forecast_receipts_sha256:forecastReceiptsSha256,
  periods:{calibration_fit:[opts.since,D.previousDay(opts.validationSince)],validation:[opts.validationSince,D.previousDay(opts.recentSince)],recent:[opts.recentSince,opts.until]},
  policy:{live_model_changed:false,frozen_experiment_changed:false,automatic_promotion:false,prospective_evidence:false,
   paired_cohort:true,calibration_fit_results_are_in_sample:true,later_periods_are_retrospective:true,target_statistics_used:false,
   frozen_candidate_weight:frozenWeight,true_form:T.DEFAULTS,goal_model:F.DEFAULTS,
   warmup_since:opts.warmupSince,fit_cutoff:'strictly before ISO Monday of each historical game; residuals use earlier dates only',
   primary_reference:'goals_calibrated',secondary_reference:'frozen_candidate',
   primary_brier:'mean(Brier(1X2)/2, Brier(over25), Brier(btts))',protocol:PROTOCOL,
   fallback:'frozen_candidate for all new variants when TRUE FORM unavailable; current if goal regression unavailable',
   limits:'Fixed, bounded residual-form variant; corrected retrospective archive, known periods, no original availability snapshots. Approximate weekly intervals, no multiplicity correction; no proof of future profit.'},
  excluded,fitting,blends,coverage:{later_eligible:later.length,later_available:laterAvailable.length,ratio:round(coverage)},evaluations,
  shot_intersection:{n:intersection.length,cohort_sha256:hash(intersection.map(r=>r.key).join('\n')),frozen_weights:shotWeights,
   evaluations:Object.fromEntries(['current','frozen_candidate','goals_calibrated','true_form_calibrated','shots_frozen','sot_frozen'].map(id=>[id,{label:LABELS[id],...summarize(intersection,id)}])),
   training_cohorts_differ:true,interpretation:'Secondary diagnostic only; shot alternatives retain their originally published early-cohort weights.'},
  qualification:qualification(evaluations,coverage)};
 return report;
}
function renderMarkdown(r){
 const num=x=>x==null?'—':x.toFixed(6).replace('.',','),pct=x=>(100*x).toFixed(2).replace('.',',')+'%';
 const lines=['# MATCHPULSE — тест на TRUE FORM','',
  `Фиксиран вариант: последни 10 мача спрямо тогавашното предмачово очакване; полуживот 60 дни, prior 6, ограничение [0.8, 1.25].`,
  '',`Архив: ${r.since}–${r.observed_until}, **${r.n} допустими мача в ${r.divisions.length} лиги**; TRUE FORM наличен за ${r.available_n}.`,
  `По-късна оценка: ${r.coverage.later_available}/${r.coverage.later_eligible} мача (${pct(r.coverage.ratio)}). Ранните резултати служат за обучение, не са независим тест.`,
  '', 'Правилата са фиксирани в [протокола](true-form-protocol.md). Живият модел, източниците, графикът и петте дневника не са променени.',
  '', '## Еднаква по-късна извадка с наличен TRUE FORM','',
  'По-ниската грешка е по-добра. Основната грешка е средното от Brier(1X2)/2, Brier(Над 2,5) и Brier(Гол/гол).',
  '', '| Вариант | Мачове | Основна грешка | 1X2 Brier | Над 2,5 | Гол/гол | Log loss |','|---|---:|---:|---:|---:|---:|---:|'];
 for(const id of VARIANTS){const s=r.evaluations[id].available.later;
  lines.push(`| ${LABELS[id]} | ${s.n} | ${num(s.primary_brier)} | ${num(s.markets['1x2'].brier)} | ${num(s.markets.over25.brier)} | ${num(s.markets.btts.brier)} | ${num(s.primary_log_loss)} |`);}
 lines.push('', '## Проверка по периоди','', '| Вариант | 2025/26 | 2026/27 до архива | 95% интервал за подобрението спрямо головия контрол |','|---|---:|---:|---|');
 for(const id of VARIANTS){const s=r.evaluations[id].available,ci=s.later.against_goals_control.approximate_95pct_interval;
  lines.push(`| ${LABELS[id]} | ${num(s.periods.validation.primary_brier)} (${s.periods.validation.n}) | ${num(s.periods.recent.primary_brier)} (${s.periods.recent.n}) | ${ci?ci.map(num).join(' до '):'—'} |`);}
 lines.push('', 'Положителното подобрение означава по-ниска грешка. Интервалът използва календарни седмици и е приблизителен.',
  '', '## Обучени само в ранния период дялове','', '| Вариант | Голов модел | TRUE FORM | Лига | Ранни мачове |','|---|---:|---:|---:|---:|');
 for(const [id,w] of Object.entries(r.blends))lines.push(`| ${LABELS[id]} | ${pct(w.goals)} | ${pct(w.true_form)} | ${pct(w.league)} | ${w.n} |`);
 lines.push('', '## Общо сечение с моделите с удари','',
  'Сравнението е върху същите мачове в тази таблица. Моделите с удари запазват старите си ранни дялове; техните обучаващи извадки се различават. Това е вторична диагностика.',
  '', '| Вариант | Мачове | Основна грешка | Над 2,5 | Гол/гол |','|---|---:|---:|---:|---:|');
 for(const s of Object.values(r.shot_intersection.evaluations))lines.push(`| ${s.label} | ${s.n} | ${num(s.primary_brier)} | ${num(s.markets.over25.brier)} | ${num(s.markets.btts.brier)} |`);
 const league=r.evaluations.true_form_calibrated.later_available_by_league,control=r.evaluations.goals_calibrated.later_available_by_league;
 const improved=Object.keys(league).filter(d=>league[d].primary_brier<control[d].primary_brier).length;
 lines.push('', '## Решение','',
  `Инженерен филтър за отделен бъдещ предмачов опит: **${r.qualification.eligible_for_separate_prospective_comparison?'покрит':'непокрит'}**. Подобрение спрямо головия контрол в ${improved}/${Object.keys(league).length} лиги.`,
  '',...Object.entries(r.qualification.checks).map(([k,v])=>`- ${k}: ${v?'да':'не'}`),
  '', 'Няма автоматично активиране. Резултатът е за този ограничен вариант на TRUE FORM. Познати ретроспективни периоди, поправен архив и приблизителни интервали не доказват бъдеща печалба.',
  '', '## Възпроизвеждане','', '```sh','node scripts/compare_true_form.cjs --write --progress','node scripts/compare_true_form.cjs --check','node --test tests/test_true_form.cjs','```',
  '', 'Скриптът чете точно закрепения Git blob, проверява SHA-256 и не изтегля спортни данни. JSON отчетът съдържа състава/прогнозните fingerprints, изключванията, липсите, периодите, лигите, калибрационните групи и интервалите.',
  '', `История SHA-256: \`${r.provenance.history_sha256}\`.`,
  `Прогнозни receipts SHA-256: \`${r.forecast_receipts_sha256}\`.`, '');
 return lines.join('\n');
}
function seal(payload){return {...payload,integrity_sha256:hash(JSON.stringify(payload))};}
function check(r,source){
 const {integrity_sha256,...payload}=r;
 if(hash(JSON.stringify(payload))!==integrity_sha256)throw Error('TRUE FORM report integrity mismatch');
 if(JSON.stringify(r.provenance)!==JSON.stringify(source))throw Error('TRUE FORM source fingerprints changed');
 if(r.policy.live_model_changed!==false||r.policy.frozen_experiment_changed!==false||r.policy.automatic_promotion!==false||r.policy.prospective_evidence!==false)throw Error('Invalid TRUE FORM policy');
 if(r.requested_until!==SETTINGS.until)throw Error('Unexpected TRUE FORM endpoint');
 for(const id of VARIANTS)if(r.evaluations[id].all.overall.n!==r.n||r.evaluations[id].available.overall.n!==r.available_n)throw Error('Different paired cohorts');
 for(const w of Object.values(r.blends))if([w.goals,w.true_form,w.league].some(v=>!Number.isFinite(v)||v<0)||Math.abs(w.goals+w.true_form+w.league-1)>1e-10||w.n!==r.evaluations.current.available.periods.calibration_fit.n)throw Error('Invalid TRUE FORM mixture');
 if(read(MD)!==renderMarkdown(r))throw Error('TRUE FORM Markdown differs');
 return true;
}
if(require.main===module)try{
 const args=process.argv.slice(2),{raw,snapshot}=inputs(),provenance=sourceFingerprint(raw,snapshot);
 if(args.includes('--check')){
  const r=JSON.parse(read(OUT));check(r,provenance);process.stdout.write(JSON.stringify({ok:true,n:r.n,available:r.available_n,live_model_changed:false})+'\n');
 }else{
  const report=seal({...compare(JSON.parse(raw),{progress:args.includes('--progress')}),provenance});
  if(args.includes('--write')){fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(report));fs.writeFileSync(path.join(ROOT,MD),renderMarkdown(report));}
  process.stdout.write(JSON.stringify({n:report.n,available:report.available_n,blends:report.blends,qualification:report.qualification,live_model_changed:false})+'\n');
 }
}catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}
module.exports={SETTINGS,VARIANTS,prepare,calibrate,compare,renderMarkdown,inputs,sourceFingerprint,seal,check};
