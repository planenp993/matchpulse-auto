/* Isolated, preregistered hybrid test. No provider requests or live imports. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const M=require('../docs/model-core.js'),D=require('./evaluate_model.cjs'),F=require('./fit_goal_model.cjs');
const C=require('./compare_goal_models.cjs'),S=require('./shot_goal_model.cjs'),SC=require('./compare_shot_models.cjs');
const ROOT=path.resolve(__dirname,'..'),PROTOCOL='docs/hybrid-model-protocol.md',OUT='docs/data/hybrid_model_comparison.json',MD='docs/hybrid-model-comparison.md';
const SNAPSHOT='docs/data/research_snapshot.json',CONFIG='docs/data/diary/experiments/opponent-days-v1/config.json';
const REGISTRATION='60436c5504c8a13cd6b085c392c96d2cf412657e';
const SOURCES=[PROTOCOL,SNAPSHOT,CONFIG,'docs/model-core.js','docs/club-aliases.js','scripts/evaluate_model.cjs',
 'scripts/fit_goal_model.cjs','scripts/compare_goal_models.cjs','scripts/shot_goal_model.cjs','scripts/compare_shot_models.cjs',
 'docs/data/shot_model_comparison.json','scripts/compare_hybrid_models.cjs'];
const SETTINGS=Object.freeze({...C.PERIODS,until:'2026-10-25'});
const VARIANTS=['current','candidate','hybrid_50','hybrid_learned','hybrid_stats_control','candidate_sot_control','hybrid_sot','sot_frozen'];
const PURE=['current','candidate','hybrid_50','hybrid_learned'];
const LABELS={current:'Модел 1',candidate:'Модел 2',hybrid_50:'Хибрид 50/50',hybrid_learned:'Хибрид с ранно обучени дялове',
 hybrid_stats_control:'Модел 1 + модел 2 · контрол със същите ранни мачове',candidate_sot_control:'Модел 2 + точни удари · контрол',
 hybrid_sot:'Модел 1 + модел 2 + точни удари',sot_frozen:'Предишна замразена смес с точни удари'};
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const round=x=>Number.isFinite(x)?Number(x.toFixed(6)):null;
const key=r=>[r[0],r[3],M.clubKey(r[5]),M.clubKey(r[6])].join('|');
function inputs(){
 const snapshot=JSON.parse(read(SNAPSHOT));
 for(const p of SOURCES)if(snapshot.files[p]&&hash(read(p))!==snapshot.files[p])throw Error('Frozen source changed: '+p);
 const raw=cp.execFileSync('git',['show',snapshot.commit+':docs/data/history.json'],{cwd:ROOT,maxBuffer:32*1024*1024}).toString('utf8');
 if(hash(raw)!==snapshot.history_sha256)throw Error('Pinned hybrid history mismatch');
 return {raw,snapshot};
}
function provenance(raw,snapshot){return {registration_commit:REGISTRATION,pinned_history_commit:snapshot.commit,history_sha256:hash(raw),
 files:Object.fromEntries(SOURCES.map(p=>[p,hash(read(p))]))};}
// Reuse the frozen analytic simplex solver, explicitly relabeling its axes.
// Its generic 'league' coefficient means the last supplied component here.
function fitWeights(rows,components){
 if(![2,3].includes(components.length)||new Set(components).size!==components.length||components.some(k=>!['current','candidate','sot'].includes(k)))throw Error('Invalid hybrid components');
 if(!rows.length)throw Error('No early hybrid calibration observations');
 const mapped=rows.map(r=>({actual:r.actual,predictions:{goals:r.predictions[components[0]],extra:r.predictions[components[1]]},
  poisson:r.predictions[components.at(-1)]}));
 if(mapped.some(r=>!r.predictions.goals||!r.predictions.extra||!r.poisson))throw Error('Unavailable calibration component');
 const fit=SC.fitMixture(mapped,components.length===3?'extra':null),w={current:0,candidate:0,sot:0,n:rows.length};
 w[components[0]]=fit.goals;
 if(components.length===3)w[components[1]]=fit.shot;
 w[components.at(-1)]=fit.league;
 return w;
}
function mix(predictions,w){return S.mixVectors([predictions.current,predictions.candidate,predictions.sot||predictions.candidate],[w.current,w.candidate,w.sot]);}
function prepare(history,settings={}){
 const opts={...SETTINGS,...settings};
 for(const k of ['since','validationSince','recentSince','until'])F.dateNumber(opts[k]);
 if(!(opts.since<opts.validationSince&&opts.validationSince<opts.recentSince&&opts.recentSince<=opts.until))throw Error('Invalid hybrid periods');
 const frozenWeight=JSON.parse(read(CONFIG)).blend_weight,shotWeights=JSON.parse(read('docs/data/shot_model_comparison.json')).blends.sot_calibrated;
 const ordered=history.slice().sort((a,b)=>a[3].localeCompare(b[3])||key(a).localeCompare(key(b)));
 const replay=D.createReplay(ordered),byLeague=new Map(),cache=new Map(),rows=[];
 for(const game of replay.games){if(!byLeague.has(game[0]))byLeague.set(game[0],[]);byLeague.get(game[0]).push(game);}
 const excluded={administrative:0,international:0,insufficient_team_history:0,insufficient_league_history:0};
 const fitting={weekly_goal_fits:0,weekly_shot_snapshots:0,nonconverged:0,unavailable:{},stats_unavailable:{},strict_cutoffs_verified:true};
 const receipts=crypto.createHash('sha256');let lastMonth='';
 for(const game of ordered.filter(r=>r[3]>=opts.since&&r[3]<=opts.until)){
  if(!M.isPlayed(game)){if(game[13]?.AWARDED===true)excluded.administrative++;continue;}
  if(['UCL','UEL','UECL'].includes(game[0])){excluded.international++;continue;}
  const context=replay.context(game);
  if(Math.min(context.homeMatches.length,context.awayMatches.length)<5){excluded.insufficient_team_history++;continue;}
  if(!context.bases.has(game[0])||!context.count){excluded.insufficient_league_history++;continue;}
  const value=M.evaluateContext(game,context,'standard');if(value.error)throw Error(value.error);
  const current=D.probabilityVector(value.distribution.probs),league=context.bases.get(game[0]);
  const poisson=D.probabilityVector(M.distribution(league.h,league.a,0).probs),origin=F.weekStart(game[3]);
  let snapshot=cache.get(game[0]);
  if(snapshot?.cutoff!==origin){
   snapshot={cutoff:origin,goals:F.fit(byLeague.get(game[0])||[],game[0],origin),shots:S.fit(byLeague.get(game[0])||[],game[0],origin)};
   cache.set(game[0],snapshot);fitting.weekly_goal_fits++;fitting.weekly_shot_snapshots++;
   for(const m of [snapshot.goals,snapshot.shots])if(!m.error&&!(m.trainingMaxDate<origin))throw Error('Hybrid training contains same-day/future data');
   if(!snapshot.goals.error&&!snapshot.goals.converged)fitting.nonconverged++;
  }
  const base=F.predict(snapshot.goals,game),available=!base.error;
  const goals=available?D.probabilityVector(base.distribution.probs):current;
  const candidate=available?F.blendVector(goals,poisson,frozenWeight):current;
  const shot=available?S.predict(snapshot.shots,snapshot.goals,game):{error:base.error},statsAvailable=!shot.error;
  const predictions={current,candidate,goals};
  if(statsAvailable){
   predictions.sot=D.probabilityVector(shot.predictions.sot.distribution.probs);
   predictions.sot_frozen=S.mixVectors([goals,predictions.sot,poisson],[shotWeights.goals,shotWeights.shot,shotWeights.league]);
  }else{predictions.sot_frozen=candidate;fitting.stats_unavailable[shot.error]=(fitting.stats_unavailable[shot.error]||0)+1;}
  if(!available)fitting.unavailable[base.error]=(fitting.unavailable[base.error]||0)+1;
  const row={key:key(game),division:game[0],date:game[3],actual:D.outcomeVector(game),poisson,frequencies:context.frequencies,
   available,statsAvailable,predictions};
  receipts.update(JSON.stringify({key:row.key,cutoff:origin,available,statsAvailable,predictions})+'\n');rows.push(row);
  if(opts.progress&&game[3].slice(0,7)!==lastMonth){lastMonth=game[3].slice(0,7);process.stderr.write(`Hybrid ${lastMonth}: ${rows.length} paired forecasts\n`);}
 }
 return {rows,opts,excluded,fitting,frozenWeight,shotWeights,forecast_receipts_sha256:receipts.digest('hex')};
}
function calibrate(rows,opts=SETTINGS){
 const early=rows.filter(r=>r.available&&r.date>=opts.since&&r.date<opts.validationSince),stats=early.filter(r=>r.statsAvailable);
 const global=fitWeights(early,['current','candidate']);
 const statsEnabled=stats.length>0;
 const fallback={...global,n:0};
 const blends={hybrid_learned:{...global,trained_on:'early_fitted'},
  hybrid_stats_control:{...(statsEnabled?fitWeights(stats,['current','candidate']):fallback),trained_on:'early_stats'},
  candidate_sot_control:{...(statsEnabled?fitWeights(stats,['candidate','sot']):fallback),trained_on:'early_stats'},
  hybrid_sot:{...(statsEnabled?fitWeights(stats,['current','candidate','sot']):fallback),trained_on:'early_stats'}};
 for(const row of rows){
  const p=row.predictions;
  p.hybrid_50=row.available?F.blendVector(p.current,p.candidate,.5):p.current;
  p.hybrid_learned=row.available?mix(p,blends.hybrid_learned):p.current;
  for(const id of ['hybrid_stats_control','candidate_sot_control','hybrid_sot'])p[id]=row.statsAvailable&&statsEnabled?mix(p,blends[id]):p.hybrid_learned;
 }
 return blends;
}
function summarize(rows,id,references=[],detail=false){
 const s=C.summarize(rows,id,{detail});
 s.comparisons=Object.fromEntries(references.map(ref=>[ref,C.pairedInterval(rows.map(r=>({...r,predictions:{current:r.predictions[ref],target:r.predictions[id]}})),'target')]));
 return s;
}
function parts(rows,opts){return {calibration_fit:rows.filter(r=>r.date<opts.validationSince),
 validation:rows.filter(r=>r.date>=opts.validationSince&&r.date<opts.recentSince),recent:rows.filter(r=>r.date>=opts.recentSince)};}
function cohort(rows,ids,refs,opts,leagueIds=[]){
 const byPeriod=parts(rows,opts),later=rows.filter(r=>r.date>=opts.validationSince),divisions=[...new Set(later.map(r=>r.division))].sort();
 const evaluations={};
 for(const id of ids){
  if(opts.progress)process.stderr.write(`Scoring ${id}: ${rows.length} cohort matches\n`);
  const e={label:LABELS[id],periods:Object.fromEntries(Object.entries(byPeriod).map(([k,r])=>[k,summarize(r,id,refs)])),later:summarize(later,id,refs,true)};
  if(leagueIds.includes(id))e.later_by_league=Object.fromEntries(divisions.map(div=>[div,summarize(later.filter(r=>r.division===div),id,refs)]));
  evaluations[id]=e;
 }
 return {n:rows.length,later_n:later.length,cohort_sha256:hash(rows.map(r=>r.key).join('\n')),
  period_counts:Object.fromEntries(Object.entries(byPeriod).map(([p,r])=>[p,r.length])),divisions,evaluations};
}
function qualification(cohort,id,refs,coverage){
 const e=cohort.evaluations[id],periods=['validation','recent'];
 const checks={at_least_500_in_each_later_period:periods.every(p=>e.periods[p].n>=500),
  lower_primary_brier_in_both_periods:refs.every(ref=>periods.every(p=>e.periods[p].primary_brier<cohort.evaluations[ref].periods[p].primary_brier)),
  no_primary_market_regression:refs.every(ref=>periods.every(p=>C.PRIMARY.every(i=>{
   const m=i===null?'1x2':D.MARKETS[i].id;return (i===null?.5:1)*(e.periods[p].markets[m].brier-cohort.evaluations[ref].periods[p].markets[m].brier)<=.002;
  }))),
  no_log_loss_regression:refs.every(ref=>periods.every(p=>e.periods[p].primary_log_loss-cohort.evaluations[ref].periods[p].primary_log_loss<=.002)),
  positive_paired_intervals:refs.every(ref=>(e.later.comparisons[ref].approximate_95pct_interval?.[0]??-Infinity)>0),sufficient_coverage:coverage>=.9};
 return {eligible_for_separate_prospective_comparison:Object.values(checks).every(Boolean),checks,references:refs,automatic_promotion:false,prospective_evidence:false};
}
function finish(prepared){
 const {rows,opts,excluded,fitting,frozenWeight,shotWeights,forecast_receipts_sha256}=prepared;
 const blends=calibrate(rows,opts),fitted=rows.filter(r=>r.available),stats=rows.filter(r=>r.statsAvailable),later=rows.filter(r=>r.date>=opts.validationSince);
 const statsDen=later.filter(r=>SC.STATS_DIVISIONS.includes(r.division)).length;
 const coverage={model2_later:later.filter(r=>r.available).length,later_eligible:later.length,
  model2_ratio:round(later.length?later.filter(r=>r.available).length/later.length:0),
  stats_later:stats.filter(r=>r.date>=opts.validationSince).length,stats_league_later_eligible:statsDen,
  stats_ratio:round(statsDen?stats.filter(r=>r.date>=opts.validationSince).length/statsDen:0)};
 const cohorts={all:cohort(rows,VARIANTS,['candidate'],opts),
  fitted:cohort(fitted,PURE,['current','candidate'],opts,PURE),
  stats:cohort(stats,VARIANTS,['candidate','hybrid_stats_control','candidate_sot_control'],opts,['hybrid_stats_control','candidate_sot_control','hybrid_sot'])};
 return {schema_version:1,settings:Object.fromEntries(Object.keys(SETTINGS).map(k=>[k,opts[k]])),n:rows.length,
  observed_until:rows.at(-1)?.date||null,forecast_receipts_sha256,periods:{calibration_fit:[opts.since,D.previousDay(opts.validationSince)],validation:[opts.validationSince,D.previousDay(opts.recentSince)],recent:[opts.recentSince,opts.until]},
  policy:{live_model_changed:false,frozen_experiment_changed:false,automatic_promotion:false,prospective_evidence:false,
   target_statistics_used:false,later_periods_are_retrospective:true,calibration_is_early_only:true,coherent_whole_matrix_mixtures:true,
   frozen_candidate_weight:frozenWeight,goal_settings:F.DEFAULTS,shot_settings:S.DEFAULTS,protocol:PROTOCOL,
   fit_cutoff:'strictly before each fixture ISO Monday; current uses strictly earlier dates',
   primary_brier:'mean(Brier(1X2)/2, Brier(over25), Brier(btts))',
   fallback:'model1 when model2 unavailable; learned pure hybrid when shots unavailable; frozen SOT benchmark retains its original fallback',
   limits:'Known corrected retrospective archive, no original availability snapshots. SOT was selected from previously seen research. Approximate weekly paired intervals, no multiplicity correction; no proof of future profit.'},
  excluded,fitting,blends,coverage,cohorts,frozen_sot_benchmark_weights:shotWeights,
  qualifications:{hybrid_learned:qualification(cohorts.fitted,'hybrid_learned',['current','candidate'],coverage.model2_ratio),
   hybrid_sot:qualification(cohorts.stats,'hybrid_sot',['candidate','hybrid_stats_control','candidate_sot_control'],coverage.stats_ratio)}};
}
function compare(history,settings={}){return finish(prepare(history,settings));}
function renderMarkdown(r){
 const num=x=>x==null?'—':x.toFixed(6).replace('.',','),pct=x=>x==null?'—':(100*x).toFixed(2).replace('.',',')+'%';
 const lines=['# MATCHPULSE — тест на хибриден трети модел','',
  `${r.n} допустими мача, ${r.settings.since}–${r.observed_until}. Обучение само до ${D.previousDay(r.settings.validationSince)}; по-късните резултати не променят дяловете.`,
  '', 'Изследването е отделно. Живият модел, петте дневника, източниците и старите отчети не са променени. [Предварителен протокол](hybrid-model-protocol.md).',
  '', '## Чист хибрид между двата модела','',
  'Еднакви по-късни мачове с наличен модел 2. По-ниската грешка е по-добра: средно Brier(1X2)/2, Brier(Над 2,5), Brier(Гол/гол).',
  '', '| Вариант | Мачове | Основна грешка | 1X2 Brier | Над 2,5 | Гол/гол | Log loss |','|---|---:|---:|---:|---:|---:|---:|'];
 for(const id of PURE){const e=r.cohorts.fitted.evaluations[id],s=e.later;lines.push(`| ${LABELS[id]} | ${s.n} | ${num(s.primary_brier)} | ${num(s.markets['1x2'].brier)} | ${num(s.markets.over25.brier)} | ${num(s.markets.btts.brier)} | ${num(s.primary_log_loss)} |`);}
 lines.push('', '## Хибрид с точни удари и равностойни контроли','',
  'Всички варианти тук са върху общата извадка с налични предмачови статистики. Контролите са обучени върху същите ранни мачове като тройната смес. Последният замразен benchmark запазва първоначалните си дялове.',
  '', '| Вариант | Мачове | Основна грешка | Над 2,5 | Гол/гол | Log loss |','|---|---:|---:|---:|---:|---:|');
 for(const id of VARIANTS){const s=r.cohorts.stats.evaluations[id].later;lines.push(`| ${LABELS[id]} | ${s.n} | ${num(s.primary_brier)} | ${num(s.markets.over25.brier)} | ${num(s.markets.btts.brier)} | ${num(s.primary_log_loss)} |`);}
 lines.push('', '## Дялове, избрани само в ранния период','', '| Вариант | Модел 1 | Модел 2 | Точни удари | Ранни мачове |','|---|---:|---:|---:|---:|');
 for(const [id,w] of Object.entries(r.blends))lines.push(`| ${LABELS[id]} | ${pct(w.current)} | ${pct(w.candidate)} | ${pct(w.sot)} | ${w.n} |`);
 lines.push('', 'Нулев дял означава, че ранното обучение не намира полезен принос от съответната съставка в тази смес.',
  '', '## По-късни периоди и сдвоена несигурност','', '| Вариант | 2025/26 | Последен период | 95% интервал за подобрението спрямо модел 2 |','|---|---:|---:|---|');
 for(const [cohort,ids] of [['fitted',PURE],['stats',['hybrid_stats_control','candidate_sot_control','hybrid_sot']]])for(const id of ids){
  const e=r.cohorts[cohort].evaluations[id],ci=e.later.comparisons.candidate.approximate_95pct_interval;
  lines.push(`| ${LABELS[id]} (${cohort}) | ${num(e.periods.validation.primary_brier)} / ${e.periods.validation.n} | ${num(e.periods.recent.primary_brier)} / ${e.periods.recent.n} | ${ci?ci.map(num).join(' до '):'—'} |`);
 }
 lines.push('', 'Положителен интервал означава по-ниска грешка. Интервалите са приблизителни и групирани по календарни седмици; няма корекция за множествени сравнения.',
  '', '## Покритие и филтър за бъдеща проверка','',
  `Модел 2: ${r.coverage.model2_later}/${r.coverage.later_eligible} по-късни мача (${pct(r.coverage.model2_ratio)}). Точни удари в 18-те лиги със статистика: ${r.coverage.stats_later}/${r.coverage.stats_league_later_eligible} (${pct(r.coverage.stats_ratio)}).`,
  '', '| Вариант | Преминава филтъра | Непокрити условия |','|---|---|---|');
 for(const [id,q] of Object.entries(r.qualifications))lines.push(`| ${LABELS[id]} | ${q.eligible_for_separate_prospective_comparison?'Да':'Не'} | ${Object.entries(q.checks).filter(([,ok])=>!ok).map(([k])=>k).join('; ')||'няма'} |`);
 lines.push('', 'Няма автоматично активиране. Това е ретроспективно изследване върху вече познати и по-късно поправени данни, а не нов бъдещ тест. Не доказва печалба.',
  '', '## Възпроизвеждане','', '```sh','node scripts/compare_hybrid_models.cjs --write --progress','node scripts/compare_hybrid_models.cjs --check','node --test tests/test_hybrid_models.cjs','```',
  '', 'JSON отчетът съдържа калибрационните групи, периодите, лигите, липсите, пълните общи извадки с fallback, сдвоените интервали и fingerprints. Спортни данни не се изтеглят.',
  '', `История SHA-256: \`${r.provenance.history_sha256}\`.`, `Предмачови прогнози SHA-256: \`${r.forecast_receipts_sha256}\`.`, '');
 return lines.join('\n');
}
function seal(payload){return {...payload,integrity_sha256:hash(JSON.stringify(payload))};}
function check(r,source){
 const {integrity_sha256,...payload}=r;if(hash(JSON.stringify(payload))!==integrity_sha256)throw Error('Hybrid report integrity mismatch');
 if(JSON.stringify(r.provenance)!==JSON.stringify(source))throw Error('Hybrid source fingerprints changed');
 if(r.policy.live_model_changed!==false||r.policy.frozen_experiment_changed!==false||r.policy.automatic_promotion!==false||r.policy.prospective_evidence!==false||r.policy.target_statistics_used!==false)throw Error('Invalid hybrid policy');
 if(JSON.stringify(r.settings)!==JSON.stringify(SETTINGS))throw Error('Unexpected registered hybrid periods');
 if(r.cohorts.all.n!==r.n)throw Error('Hybrid target count mismatch');
 for(const c of Object.values(r.cohorts))for(const e of Object.values(c.evaluations)){
  if(Object.values(e.periods).reduce((n,s)=>n+s.n,0)!==c.n||e.later.n!==c.later_n||e.later.n!==e.periods.validation.n+e.periods.recent.n)throw Error('Hybrid paired cohorts differ');
 }
 for(const w of Object.values(r.blends)){
  if([w.current,w.candidate,w.sot].some(x=>!Number.isFinite(x)||x<0)||Math.abs(w.current+w.candidate+w.sot-1)>1e-10)throw Error('Invalid hybrid simplex');
  if(w.n!==r.cohorts[w.trained_on==='early_fitted'?'fitted':'stats'].period_counts.calibration_fit)throw Error('Hybrid early calibration count mismatch');
 }
 if(read(MD)!==renderMarkdown(r))throw Error('Hybrid Markdown differs');return true;
}
if(require.main===module)try{
 const args=process.argv.slice(2),{raw,snapshot}=inputs(),source=provenance(raw,snapshot);
 if(args.includes('--check')){const r=JSON.parse(read(OUT));check(r,source);process.stdout.write(JSON.stringify({ok:true,n:r.n,live_model_changed:false})+'\n');}
 else{const r=seal({...compare(JSON.parse(raw),{progress:args.includes('--progress')}),provenance:source});
  if(args.includes('--write')){fs.writeFileSync(path.join(ROOT,OUT),JSON.stringify(r));fs.writeFileSync(path.join(ROOT,MD),renderMarkdown(r));}
  process.stdout.write(JSON.stringify({n:r.n,blends:r.blends,coverage:r.coverage,qualifications:r.qualifications,live_model_changed:false})+'\n');}
}catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}
module.exports={SETTINGS,VARIANTS,PURE,fitWeights,mix,prepare,calibrate,finish,compare,qualification,renderMarkdown,inputs,provenance,seal,check};
