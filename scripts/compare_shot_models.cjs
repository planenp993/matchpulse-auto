/* Registered, chronological test of incremental shot-volume information. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('../docs/model-core.js'),D=require('./evaluate_model.cjs'),F=require('./fit_goal_model.cjs');
const C=require('./compare_goal_models.cjs'),S=require('./shot_goal_model.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT='docs/data/shot_model_comparison.json',MARKDOWN='docs/shot-model-comparison.md';
const PROTOCOL='docs/shot-model-protocol.md',CONFIG='docs/data/diary/experiments/opponent-days-v1/config.json';
const SOURCE_FILES=[PROTOCOL,CONFIG,'docs/model-core.js','docs/club-aliases.js','scripts/evaluate_model.cjs',
 'scripts/fit_goal_model.cjs','scripts/compare_goal_models.cjs','scripts/shot_goal_model.cjs','scripts/compare_shot_models.cjs'];
const VARIANTS=['current','frozen_candidate','goals_calibrated','shots_calibrated','sot_calibrated'];
const LABELS={current:'Сегашен модел',frozen_candidate:'Замразен кандидат от дневника',goals_calibrated:'Голов контрол · обща калибрация',
 shots_calibrated:'Голове + общи удари + калибрация',sot_calibrated:'Голове + точни удари + калибрация'};
const STATS_DIVISIONS=['B1','D1','D2','E0','E1','E2','E3','F1','F2','G1','I1','I2','N1','P1','SC0','SP1','SP2','T1'];
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const round=v=>Number.isFinite(v)?Number(v.toFixed(6)):null;
const todaySofia=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia'}).format(new Date());
const frozenConfig=()=>JSON.parse(fs.readFileSync(path.join(ROOT,CONFIG),'utf8'));
// The objective is quadratic in the shot and league weights. Enumerating its
// three edges, vertices and interior stationary point solves the whole simplex.
function fitMixture(rows,shotKey=null){
 let a=0,b=0,c=0,u=0,v=0;
 for(const row of rows){
  const p=row.predictions.goals,q=row.poisson,t=shotKey?row.predictions[shotKey]:p;
  for(let i=0;i<p.length;i++){
   const scale=i<3?.5:C.PRIMARY.slice(1).includes(i)?1:0;if(!scale)continue;
   const x=t[i]-p[i],y=q[i]-p[i],error=row.actual[i]-p[i];
   a+=scale*x*x;b+=scale*x*y;c+=scale*y*y;u+=scale*x*error;v+=scale*y*error;
  }
 }
 const clamp=x=>Math.max(0,Math.min(1,x)),candidates=[[0,0],[0,1]];
 if(c>0)candidates.push([0,clamp(v/c)]);
 if(shotKey){
  candidates.push([1,0]);if(a>0)candidates.push([clamp(u/a),0]);
  const edge=a-2*b+c;if(edge>0){const x=clamp((u-v-b+c)/edge);candidates.push([x,1-x]);}
  const det=a*c-b*b;
  if(det>1e-12*Math.max(a*c,1e-30)){
   const x=(u*c-v*b)/det,y=(v*a-u*b)/det;
   if(x>=0&&y>=0&&x+y<=1)candidates.push([x,y]);
  }
 }
 const objective=([x,y])=>a*x*x+2*b*x*y+c*y*y-2*u*x-2*v*y;
 const [shot,league]=candidates.reduce((best,p)=>objective(p)<objective(best)-1e-14?p:best,[0,0]);
 return {goals:Math.max(0,1-shot-league),shot,league,n:rows.length,fitted_on:'calibration_fit',
  objective:'mean(Brier(1X2)/2, Brier(over25), Brier(btts))'};
}
function applyMixtures(rows,blends){
 for(const row of rows)for(const [key,shotKey] of [['goals_calibrated',null],['shots_calibrated','shots'],['sot_calibrated','sot']]){
  const w=blends[key];row.predictions[key]=row.available?
   S.mixVectors([row.predictions.goals,shotKey?row.predictions[shotKey]:row.predictions.goals,row.poisson],[w.goals,w.shot,w.league]):row.predictions.frozen_candidate;
 }
 return rows;
}
function summarize(rows,key,detail=false){
 const r=C.summarize(rows,key,{detail});
 for(const [name,reference] of [['against_goals_control','goals_calibrated'],['against_frozen','frozen_candidate']])
  r[name]=C.pairedInterval(rows.map(row=>({...row,predictions:{current:row.predictions[reference],target:row.predictions[key]}})),'target');
 if(detail)r.calibration_1x2=Object.fromEntries([0,1,2].map(i=>[D.MARKETS[i].id,D.score(rows,key,i,{detail:true})]));
 return r;
}
function periodRows(rows,opts){return {
 calibration_fit:rows.filter(r=>r.date>=opts.since&&r.date<opts.validationSince),
 validation:rows.filter(r=>r.date>=opts.validationSince&&r.date<opts.recentSince),recent:rows.filter(r=>r.date>=opts.recentSince)
};}
function qualification(evaluations,key,coverage){
 const candidate=evaluations[key].available,refs=['goals_calibrated','frozen_candidate'];
 const periods=['validation','recent'],checks={
  at_least_500_in_each_period:periods.every(p=>candidate.periods[p].n>=500),
  lower_primary_brier_than_both_controls:refs.every(ref=>periods.every(p=>candidate.periods[p].primary_brier<evaluations[ref].available.periods[p].primary_brier)),
  no_primary_market_regression:refs.every(ref=>periods.every(p=>C.PRIMARY.every(i=>{
   const id=i===null?'1x2':D.MARKETS[i].id;return (i===null?.5:1)*(candidate.periods[p].markets[id].brier-evaluations[ref].available.periods[p].markets[id].brier)<=.002;
  }))),
  no_log_loss_regression:refs.every(ref=>periods.every(p=>candidate.periods[p].primary_log_loss-evaluations[ref].available.periods[p].primary_log_loss<=.002)),
  positive_intervals_against_both_controls:['against_goals_control','against_frozen'].every(id=>(candidate.later[id].approximate_95pct_interval?.[0]??-Infinity)>0),
  sufficient_stats_league_coverage:coverage>=.9
 };
 return {eligible_for_separate_prospective_comparison:Object.values(checks).every(Boolean),checks,automatic_promotion:false,prospective_evidence:false};
}
function compare(history,settings={}){
 const opts={...C.PERIODS,until:D.previousDay(todaySofia()),frozenWeight:frozenConfig().blend_weight,...settings};
 for(const date of [opts.since,opts.validationSince,opts.recentSince,opts.until])F.dateNumber(date);
 if(!(opts.since<opts.validationSince&&opts.validationSince<opts.recentSince&&opts.recentSince<=opts.until)||
  !Number.isFinite(opts.frozenWeight)||opts.frozenWeight<0||opts.frozenWeight>1)throw new RangeError('Invalid shot comparison settings');
 const replay=D.createReplay(history),byLeague=new Map(),cache=new Map(),rows=[];
 for(const game of replay.games){if(!byLeague.has(game[0]))byLeague.set(game[0],[]);byLeague.get(game[0]).push(game);}
 const input=history.filter(r=>r[3]>=opts.since&&r[3]<=opts.until).slice().sort((a,b)=>a[3].localeCompare(b[3])||a[0].localeCompare(b[0])||M.clubKey(a[5]).localeCompare(M.clubKey(b[5]))||M.clubKey(a[6]).localeCompare(M.clubKey(b[6])));
 const excluded={administrative:0,international:0,insufficient_team_history:0,insufficient_league_history:0};
 const fitting={weekly_goal_fits:0,weekly_shot_snapshots:0,nonconverged:0,unavailable:{},clipped:{shots:0,sot:0}};
 let lastYear='';
 for(const game of input){
  if(!M.isPlayed(game)){if(game[13]?.AWARDED===true)excluded.administrative++;continue;}
  if(['UCL','UEL','UECL'].includes(game[0])){excluded.international++;continue;}
  const context=replay.context(game);
  if(Math.min(context.homeMatches.length,context.awayMatches.length)<5){excluded.insufficient_team_history++;continue;}
  if(!context.bases.has(game[0])||!context.count){excluded.insufficient_league_history++;continue;}
  const value=M.evaluateContext(game,context,'standard');if(value.error)throw Error(value.error);
  const current=D.probabilityVector(value.distribution.probs),base=context.bases.get(game[0]);
  const poisson=D.probabilityVector(M.distribution(base.h,base.a,0).probs),origin=F.weekStart(game[3]),key=game[0];
  let snapshot=cache.get(key);
  if(snapshot?.cutoff!==origin){
   snapshot={cutoff:origin,goals:F.fit(byLeague.get(key)||[],key,origin),shots:S.fit(byLeague.get(key)||[],key,origin)};
   cache.set(key,snapshot);fitting.weekly_goal_fits++;fitting.weekly_shot_snapshots++;
   if(!snapshot.goals.error&&!snapshot.goals.converged)fitting.nonconverged++;
  }
  const goal=F.predict(snapshot.goals,game),shots=goal.error?{error:goal.error}:S.predict(snapshot.shots,snapshot.goals,game);
  const available=!goal.error&&!shots.error,goals=goal.error?current:D.probabilityVector(goal.distribution.probs);
  const frozen=goal.error?current:F.blendVector(goals,poisson,opts.frozenWeight);
  const row={division:key,date:game[3],week:origin,key:[key,game[3],M.clubKey(game[5]),M.clubKey(game[6])].join('|'),
   actual:D.outcomeVector(game),predictions:{current,frozen_candidate:frozen,goals},poisson,frequencies:context.frequencies,available};
  if(available){
   for(const id of ['shots','sot']){row.predictions[id]=D.probabilityVector(shots.predictions[id].distribution.probs);if(shots.predictions[id].clipped)fitting.clipped[id]++;}
  }else{const reason=goal.error||shots.error;fitting.unavailable[reason]=(fitting.unavailable[reason]||0)+1;}
  rows.push(row);
  if(opts.progress&&game[3].slice(0,4)!==lastYear){lastYear=game[3].slice(0,4);process.stderr.write(`Shot comparison ${lastYear}: ${rows.length} paired matches\n`);}
 }
 const early=rows.filter(r=>r.available&&r.date>=opts.since&&r.date<opts.validationSince);
 const blends={goals_calibrated:fitMixture(early),shots_calibrated:fitMixture(early,'shots'),sot_calibrated:fitMixture(early,'sot')};
 applyMixtures(rows,blends);
 const available=rows.filter(r=>r.available),later=rows.filter(r=>r.date>=opts.validationSince),laterAvailable=available.filter(r=>r.date>=opts.validationSince);
 const denominator=later.filter(r=>STATS_DIVISIONS.includes(r.division)).length,numerator=laterAvailable.filter(r=>STATS_DIVISIONS.includes(r.division)).length;
 const coverage=denominator?numerator/denominator:0,evaluations={};
 for(const id of VARIANTS){
  if(opts.progress)process.stderr.write(`Scoring ${id}\n`);
  evaluations[id]={label:LABELS[id]};
  for(const [name,cohort] of [['all',rows],['available',available]]){
   evaluations[id][name]={overall:summarize(cohort,id),periods:Object.fromEntries(Object.entries(periodRows(cohort,opts)).map(([p,part])=>[p,summarize(part,id,name==='available')])),
    later:summarize(cohort.filter(r=>r.date>=opts.validationSince),id,name==='available')};
  }
  evaluations[id].later_available_by_league=Object.fromEntries([...new Set(laterAvailable.map(r=>r.division))].sort().map(div=>[div,summarize(laterAvailable.filter(r=>r.division===div),id)]));
 }
 return {schema_version:1,since:opts.since,requested_until:opts.until,observed_until:rows.at(-1)?.date||null,n:rows.length,available_n:available.length,
  cohort_sha256:hash(rows.map(r=>r.key).join('\n')),available_cohort_sha256:hash(available.map(r=>r.key).join('\n')),
  divisions:[...new Set(rows.map(r=>r.division))].sort(),available_divisions:[...new Set(available.map(r=>r.division))].sort(),
  periods:{calibration_fit:[opts.since,D.previousDay(opts.validationSince)],validation:[opts.validationSince,D.previousDay(opts.recentSince)],recent:[opts.recentSince,opts.until]},
  policy:{live_model_changed:false,automatic_promotion:false,prospective_evidence:false,paired_cohort:true,
   frozen_experiment_changed:false,target_match_statistics_used:false,calibration_fit_results_are_in_sample:true,later_periods_are_retrospective:true,
   frozen_candidate_weight:opts.frozenWeight,shot_settings:S.DEFAULTS,goal_settings:F.DEFAULTS,fit_cutoff:'strictly before ISO Monday',
   primary_reference:'goals_calibrated',secondary_reference:'frozen_candidate',fallback:'frozen_candidate for all new mixtures; current when goal fit unavailable',
   primary_brier:'mean(Brier(1X2)/2, Brier(over25), Brier(btts))',protocol:PROTOCOL,
   limits:'Corrected retrospective archive, not original availability snapshots. Simple shot-volume components, not event-level xG or a complete shot-success model. Approximate weekly intervals; related hypotheses, no multiplicity correction.'},
  excluded,fitting,blends,coverage:{stats_divisions:STATS_DIVISIONS,later_eligible_in_stats_leagues:denominator,later_available_in_stats_leagues:numerator,ratio:round(coverage)},
  evaluations,qualifications:Object.fromEntries(['shots_calibrated','sot_calibrated'].map(id=>[id,qualification(evaluations,id,coverage)]))};
}
function renderMarkdown(r){
 const num=n=>n==null?'—':n.toFixed(4).replace('.',','),interval=n=>n.toFixed(6).replace('.',','),pct=n=>n==null?'—':(100*n).toFixed(1).replace('.',',')+'%';
 const lines=['# MATCHPULSE — какво добавят ударите','',
  `**${r.n.toLocaleString('bg-BG')} едни и същи мача**, ${r.since}–${r.observed_until||'няма данни'}.`,
  `Предмачови данни за двата компонента има за **${r.available_n.toLocaleString('bg-BG')}** срещи в ${r.available_divisions.length} лиги. Допускането не зависи от статистиката на прогнозирания мач.`,
  '', '**Това е ретроспективен тест. Живият анализ и замразените двойки в дневника са непроменени.**',
  '', 'Правилата са записани преди изпълнението в [протокола](shot-model-protocol.md). Няма търсене на други настройки по по-късните резултати. Ударите са обем на опитите, а не измерено xG.',
  '', '## Принос върху общата налична извадка','',
  'Таблицата обединява двата по-късни периода. По-ниската грешка е по-добра. Основната цел е средното от Brier(1X2)/2, Brier(Над 2,5) и Brier(Гол/гол).',
  '', '| Вариант | Мачове | Основна грешка | 1X2 Brier | Над 2,5 | Гол/гол | Log loss |','|---|---:|---:|---:|---:|---:|---:|'];
 for(const id of VARIANTS){const s=r.evaluations[id].available.later;lines.push(`| ${LABELS[id]} | ${s.n} | ${num(s.primary_brier)} | ${num(s.markets['1x2'].brier)} | ${num(s.markets.over25.brier)} | ${num(s.markets.btts.brier)} | ${num(s.primary_log_loss)} |`);}
 lines.push('', 'Основното сравнение за ударите е с **Голов контрол · обща калибрация**: той използва същата ранна извадка за калибратора. Подобрение само спрямо сегашния модел не доказва, че ударите помагат.',
  '', '## Периоди и сдвоена разлика','', '| Вариант | Проверка 2025/26 | Последен период | 95% интервал за подобрение спрямо головия контрол |','|---|---:|---:|---|');
 for(const id of VARIANTS.filter(x=>x!=='current')){const s=r.evaluations[id].available,ci=s.later.against_goals_control.approximate_95pct_interval;
  lines.push(`| ${LABELS[id]} | ${num(s.periods.validation.primary_brier)} | ${num(s.periods.recent.primary_brier)} | ${ci?ci.map(interval).join(' до '):'малка извадка'} |`);}
 lines.push('', 'Положителният интервал означава по-ниска грешка в тази извадка. Интервалите са приблизителни, групират по календарна седмица и не коригират множествените сравнения.',
  '', '## Обучени дялове на цялата матрица','', '| Вариант | Голове | Удари | Лигова основа | Ранни мачове |','|---|---:|---:|---:|---:|');
 for(const [id,w] of Object.entries(r.blends))lines.push(`| ${LABELS[id]} | ${pct(w.goals)} | ${pct(w.shot)} | ${pct(w.league)} | ${w.n} |`);
 lines.push('', `Обучение само през ${r.periods.calibration_fit.join('–')}; дяловете са замразени за следващите периоди. Нулев дял на ударите е допустим. Замразеният кандидат от дневника запазва оригиналните ${pct(r.policy.frozen_candidate_weight)} лигов дял.`,
  '', 'Трите компонента се смесват с общи неотрицателни дялове със сбор 1. Това запазва сумата 1X2, допълващите се пазари и вложените линии за голове. Ранните показатели са fit диагностика.',
  '', '## Калибрация в по-късната налична извадка','', '| Вариант | Над 2,5: средна оценка / честота | Гол/гол: средна оценка / честота |','|---|---|---|');
 for(const id of VARIANTS){const s=r.evaluations[id].available.later.markets;lines.push(`| ${LABELS[id]} | ${pct(s.over25.mean_forecast)} / ${pct(s.over25.actual_rate)} | ${pct(s.btts.mean_forecast)} / ${pct(s.btts.actual_rate)} |`);}
 lines.push('', 'Средните стойности не доказват калибрация при всяко ниво на вероятност. JSON отчетът пази и групите 0–10%, 10–20% и т.н. с брой наблюдения, включително отделните 1/X/2. За избора използваме и Brier, и log loss.',
  '', '## Покритие и поведение при липси','',
  `Покритие в 18-те лиги със статистика, по-късни периоди: **${pct(r.coverage.ratio)}** (${r.coverage.later_available_in_stats_leagues}/${r.coverage.later_eligible_in_stats_leagues}). Шестте лиги без удари не се представят като покрити.`,
  `Седмични голови fit: ${r.fitting.weekly_goal_fits}; неконвергирали: ${r.fitting.nonconverged}. Причини за неналичност: ${Object.entries(r.fitting.unavailable).map(([k,n])=>`${k}: ${n}`).join('; ')||'няма'}.`,
  '', 'При липса на предмачови статистики трите нови смеси се връщат към замразения кандидат; ако и головата регресия е недостъпна — към current. Следващата таблица включва и тези случаи върху всички лиги.',
  '', '| Вариант | Всички по-късни мачове | Основна грешка |','|---|---:|---:|');
 for(const id of VARIANTS){const s=r.evaluations[id].all.later;lines.push(`| ${LABELS[id]} | ${s.n} | ${num(s.primary_brier)} |`);}
 lines.push('', '## Разлики между лигите','', 'Общото подобрение не важи еднакво за всяка лига. Следните разбивки са описателни; не настройваме отделни коефициенти по тях.');
 for(const id of ['shots_calibrated','sot_calibrated']){
  const parts=Object.entries(r.evaluations[id].later_available_by_league),better=parts.filter(([div,s])=>s.primary_brier<r.evaluations.goals_calibrated.later_available_by_league[div].primary_brier).length;
  const worse=parts.filter(([div,s])=>s.primary_brier>r.evaluations.goals_calibrated.later_available_by_league[div].primary_brier).map(([div,s])=>`${div} (${s.n} мача)`);
  lines.push('', `${LABELS[id]}: по-ниска грешка в **${better}/${parts.length}** лиги спрямо головия контрол; по-висока в ${worse.join(', ')||'няма'}.`);
 }
 lines.push('', '## Извод по предварителния филтър','', '| Компонент | Подходящ за отделна бъдеща проверка | Непокрити условия |','|---|---|---|');
 for(const [id,q] of Object.entries(r.qualifications))lines.push(`| ${LABELS[id]} | ${q.eligible_for_separate_prospective_comparison?'Да':'Не'} | ${Object.entries(q.checks).filter(([,ok])=>!ok).map(([k])=>k).join('; ')||'няма'} |`);
 lines.push('', 'Дори положителен филтър не активира модел. Нужна е отделна бъдеща проверка, защото архивът е коригиран ретроспективно и тези периоди вече са известни. Тестът оценява описаните два прости компонента; не отхвърля всички възможни подходи с удари.',
  '', 'Подробности: [shot_model_comparison.json](data/shot_model_comparison.json).',
  '', `История SHA-256: \`${r.provenance?.history_sha256||'не е зададен'}\`.`,
  '', `Протокол SHA-256: \`${r.provenance?.files?.[PROTOCOL]||'не е зададен'}\`.`, '');
 return lines.join('\n');
}
function provenance(raw){return {history_sha256:hash(raw),files:Object.fromEntries(SOURCE_FILES.map(file=>[file,hash(fs.readFileSync(path.join(ROOT,file)))]))};}
function seal(payload){return {...payload,integrity_sha256:hash(JSON.stringify(payload))};}
function check(report,source){
 const {integrity_sha256,...payload}=report;
 if(integrity_sha256!==hash(JSON.stringify(payload)))throw Error('Shot report integrity mismatch');
 if(JSON.stringify(report.provenance)!==JSON.stringify(source))throw Error('Shot comparison inputs or code changed; regenerate');
 const policy=report.policy;
 if(policy?.live_model_changed!==false||policy?.automatic_promotion!==false||policy?.prospective_evidence!==false||policy?.frozen_experiment_changed!==false||policy?.target_match_statistics_used!==false)throw Error('Invalid shot comparison policy');
 if(report.requested_until>=todaySofia()||report.available_n>report.n)throw Error('Invalid shot comparison dates or cohort');
 for(const id of VARIANTS)for(const name of ['all','available']){
  const e=report.evaluations[id]?.[name],n=name==='all'?report.n:report.available_n;
  if(e?.overall.n!==n||Object.values(e.periods).reduce((sum,s)=>sum+s.n,0)!==n||e.later.n!==e.periods.validation.n+e.periods.recent.n)throw Error('Shot comparison cohorts differ');
 }
 for(const w of Object.values(report.blends))if([w.goals,w.shot,w.league].some(v=>!Number.isFinite(v)||v<0)||Math.abs(w.goals+w.shot+w.league-1)>1e-10||w.n!==report.evaluations.current.available.periods.calibration_fit.n)throw Error('Invalid shot mixture');
 if(fs.readFileSync(path.join(ROOT,MARKDOWN),'utf8')!==renderMarkdown(report))throw Error('Shot comparison Markdown is stale');
 return true;
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),raw=fs.readFileSync(path.join(ROOT,'docs/data/history.json'),'utf8'),source=provenance(raw),target=path.join(ROOT,OUT);let existing=null;
  if(fs.existsSync(target))try{existing=JSON.parse(fs.readFileSync(target,'utf8'));check(existing,source);}catch(e){if(args.includes('--check'))throw e;existing=null;}
  if(args.includes('--check')){if(!existing)throw Error('Missing shot comparison report');process.stdout.write(JSON.stringify({ok:true,n:existing.n,available:existing.available_n,live_model_changed:false})+'\n');}
  else if(args.includes('--if-needed')&&existing)process.stdout.write(JSON.stringify({unchanged:true,n:existing.n})+'\n');
  else{
   const report=seal({...compare(JSON.parse(raw),{progress:args.includes('--progress')}),provenance:source});
   if(args.includes('--write')){fs.writeFileSync(target,JSON.stringify(report));fs.writeFileSync(path.join(ROOT,MARKDOWN),renderMarkdown(report));}
   process.stdout.write(JSON.stringify({n:report.n,available:report.available_n,blends:report.blends,qualifications:report.qualifications,live_model_changed:false})+'\n');
  }
 }catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}
}
module.exports={VARIANTS,STATS_DIVISIONS,fitMixture,applyMixtures,summarize,qualification,compare,renderMarkdown,provenance,seal,check};
