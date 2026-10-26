/* Registered offline model comparison; never changes the live model or diary. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('../docs/model-core.js'),D=require('./evaluate_model.cjs'),F=require('./fit_goal_model.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT='docs/data/model_comparison.json',MARKDOWN='docs/model-comparison.md';
const PROTOCOL='docs/model-comparison-protocol.md';
const SOURCE_FILES=[PROTOCOL,'docs/model-core.js','docs/club-aliases.js','scripts/evaluate_model.cjs','scripts/fit_goal_model.cjs','scripts/compare_goal_models.cjs'];
const VARIANTS=['current','current_calibrated','opponent_uniform','opponent_days','opponent_days_calibrated'];
const LABELS={current:'Сегашен модел',current_calibrated:'Сегашен + калибрация',opponent_uniform:'Атака/защита · еднакви тежести',opponent_days:'Атака/защита · тежести по дни',opponent_days_calibrated:'Атака/защита по дни + калибрация'};
const PRIMARY=[null,D.MARKETS.findIndex(m=>m.id==='over25'),D.MARKETS.findIndex(m=>m.id==='btts')];
const SELECTED=['1x2','double1X','doubleX2','double12','over15','over25','over35','btts','homeOver15','awayOver15'];
const round=(v,d=6)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const todaySofia=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia'}).format(new Date());
const PERIODS=Object.freeze({since:'2023-07-01',validationSince:'2025-07-01',recentSince:'2026-07-01'});
function periodRows(rows,{since,validationSince,recentSince}){
 return {calibration_fit:rows.filter(r=>r.date>=since&&r.date<validationSince),
  validation:rows.filter(r=>r.date>=validationSince&&r.date<recentSince),recent:rows.filter(r=>r.date>=recentSince)};
}
function primaryLoss(predicted,actual){
 let brier=0;for(let i=0;i<3;i++)brier+=(predicted[i]-actual[i])**2/2;
 brier+=(predicted[PRIMARY[1]]-actual[PRIMARY[1]])**2+(predicted[PRIMARY[2]]-actual[PRIMARY[2]])**2;
 const log=p=>Math.log(Math.max(1e-12,Math.min(1-1e-12,p)));
 let logLoss=-log(predicted[actual.slice(0,3).indexOf(1)]);
 for(const i of PRIMARY.slice(1))logLoss-=actual[i]*log(predicted[i])+(1-actual[i])*log(1-predicted[i]);
 return {brier:brier/3,logLoss:logLoss/3};
}
// Least-squares coefficient of a coherent mixture of two entire distributions.
// All market probabilities are linear sums of cells of the same score matrix.
function fitBlend(rows,key){
 let numerator=0,denominator=0,n=0;
 for(const row of rows){
  if(key.startsWith('opponent')&&!row.available.days)continue;
  const p=row.predictions[key],q=row.poisson,y=row.actual;n++;
  for(let i=0;i<p.length;i++){
   const scale=i<3?.5:PRIMARY.slice(1).includes(i)?1:0;
   if(!scale)continue;const delta=q[i]-p[i];numerator+=scale*delta*(y[i]-p[i]);denominator+=scale*delta**2;
  }
 }
 return {weight:denominator>0?Math.max(0,Math.min(1,numerator/denominator)):0,n,
  fitted_on:'calibration_fit',objective:'mean(Brier(1X2)/2, Brier(over25), Brier(btts))'};
}
function pairedInterval(rows,key){
 if(!rows.length)return {improvement:null,weekly_clusters:0,approximate_95pct_interval:null};
 const weeks=new Map();let sum=0;
 for(const r of rows){
  const delta=primaryLoss(r.predictions.current,r.actual).brier-primaryLoss(r.predictions[key],r.actual).brier;
  sum+=delta;const k=D.weekOf(r.date),c=weeks.get(k)||{n:0,sum:0};c.n++;c.sum+=delta;weeks.set(k,c);
 }
 const n=rows.length,mean=sum/n,g=weeks.size;
 const se=g>=8?Math.sqrt([...weeks.values()].reduce((s,c)=>s+(c.sum-mean*c.n)**2,0)*g/(g-1)/(n*n)):null;
 return {improvement:round(mean),weekly_clusters:g,approximate_95pct_interval:se===null?null:[round(mean-1.96*se),round(mean+1.96*se)]};
}
function summarize(rows,key,{detail=false}={}){
 const currentAsReference=rows.map(r=>({...r,frequencies:r.predictions.current})),markets={};
 for(const id of SELECTED){
  const i=id==='1x2'?null:D.MARKETS.findIndex(m=>m.id===id),s=D.score(rows,key,i,{detail});
  const paired=D.score(currentAsReference,key,i).baselines.league_frequencies;
  markets[id]={...s,against_current:paired};
 }
 const losses=rows.map(r=>primaryLoss(r.predictions[key],r.actual));
 return {n:rows.length,primary_brier:rows.length?round(losses.reduce((s,r)=>s+r.brier,0)/rows.length):null,
  primary_log_loss:rows.length?round(losses.reduce((s,r)=>s+r.logLoss,0)/rows.length):null,
  against_current:pairedInterval(rows,key),markets};
}
function qualification(evaluations,key,coverage){
 if(key==='current')return {eligible_for_prospective_comparison:false,reason:'reference'};
 const candidate=evaluations[key],current=evaluations.current,periods=['validation','recent'];
 const checks={two_later_periods:periods.every(p=>candidate.periods[p].n>=500),
  lower_primary_brier_in_both:periods.every(p=>candidate.periods[p].primary_brier<current.periods[p].primary_brier),
  no_primary_market_regression:periods.every(p=>PRIMARY.every(i=>{
   const id=i===null?'1x2':D.MARKETS[i].id,scale=i===null?.5:1;
   return scale*(candidate.periods[p].markets[id].brier-current.periods[p].markets[id].brier)<=.002;
  })),
  no_log_loss_regression:periods.every(p=>candidate.periods[p].primary_log_loss-current.periods[p].primary_log_loss<=.002),
  positive_paired_interval:(candidate.later.against_current.approximate_95pct_interval?.[0]??-Infinity)>0,
  sufficient_fitted_coverage:!key.startsWith('opponent')||coverage>=.9};
 return {eligible_for_prospective_comparison:Object.values(checks).every(Boolean),checks,
  automatic_promotion:false,prospective_evidence:false};
}
function compare(history,settings={}){
 const opts={...PERIODS,until:D.previousDay(todaySofia()),...settings};
 for(const v of [opts.since,opts.validationSince,opts.recentSince,opts.until])F.dateNumber(v);
 if(!(opts.since<opts.validationSince&&opts.validationSince<opts.recentSince&&opts.recentSince<=opts.until))throw new RangeError('Comparison periods must be ordered');
 const replay=D.createReplay(history),byLeague=new Map();
 for(const row of replay.games){if(!byLeague.has(row[0]))byLeague.set(row[0],[]);byLeague.get(row[0]).push(row);}
 const input=history.filter(r=>r[3]>=opts.since&&r[3]<=opts.until).slice().sort((a,b)=>a[3].localeCompare(b[3])||a[0].localeCompare(b[0])||M.clubKey(a[5]).localeCompare(M.clubKey(b[5]))||M.clubKey(a[6]).localeCompare(M.clubKey(b[6])));
 const excluded={administrative:0,international:0,insufficient_team_history:0,insufficient_league_history:0};
 const fitting={cadence:'ISO Monday, strictly earlier dates',uniform:{fits:0,nonconverged:0,fallbacks:{},clipped:0},days:{fits:0,nonconverged:0,fallbacks:{},clipped:0}};
 const cache=new Map(),observations=[];let lastYear='';
 for(const game of input){
  if(!M.isPlayed(game)){if(game[13]?.AWARDED===true)excluded.administrative++;continue;}
  if(['UCL','UEL','UECL'].includes(game[0])){excluded.international++;continue;}
  const context=replay.context(game);
  if(Math.min(context.homeMatches.length,context.awayMatches.length)<5){excluded.insufficient_team_history++;continue;}
  if(!context.bases.has(game[0])||!context.count){excluded.insufficient_league_history++;continue;}
  const current=M.evaluateContext(game,context,'standard');if(current.error)throw Error(current.error);
  const p=D.probabilityVector(current.distribution.probs),base=context.bases.get(game[0]);
  const observation={division:game[0],date:game[3],actual:D.outcomeVector(game),predictions:{current:p},
   frequencies:context.frequencies,poisson:D.probabilityVector(M.distribution(base.h,base.a,0).probs),available:{},origins:{}};
  const origin=F.weekStart(game[3]);
  for(const [id,halfLifeDays] of [['uniform',null],['days',180]]){
   const key=game[0]+'|'+id,cached=cache.get(key);let model;
   if(cached?.cutoff===origin)model=cached;
   else{
    model=F.fit(byLeague.get(game[0])||[],game[0],origin,{halfLifeDays});cache.set(key,model);fitting[id].fits++;
    if(!model.error&&!model.converged)fitting[id].nonconverged++;
   }
   const predicted=F.predict(model,game);observation.available[id]=!predicted.error;observation.origins[id]=origin;
   if(predicted.error)fitting[id].fallbacks[predicted.error]=(fitting[id].fallbacks[predicted.error]||0)+1;
   else if(predicted.clipped)fitting[id].clipped++;
   observation.predictions['opponent_'+id]=predicted.error?p:D.probabilityVector(predicted.distribution.probs);
  }
  observations.push(observation);
  if(opts.progress&&game[3].slice(0,4)!==lastYear){lastYear=game[3].slice(0,4);process.stderr.write(`Comparing ${lastYear} (${observations.length} paired matches)\n`);}
 }
 const periods=periodRows(observations,opts),blends={current:fitBlend(periods.calibration_fit,'current'),opponent_days:fitBlend(periods.calibration_fit,'opponent_days')};
 for(const r of observations){
  r.predictions.current_calibrated=F.blendVector(r.predictions.current,r.poisson,blends.current.weight);
  r.predictions.opponent_days_calibrated=r.available.days?F.blendVector(r.predictions.opponent_days,r.poisson,blends.opponent_days.weight):r.predictions.current;
 }
 const later=[...periods.validation,...periods.recent],evaluations={};
 for(const key of VARIANTS){
  if(opts.progress)process.stderr.write(`Scoring ${key}\n`);
  const available=key.startsWith('opponent')?observations.filter(r=>r.available[key==='opponent_uniform'?'uniform':'days']):observations;
  evaluations[key]={label:LABELS[key],overall:summarize(observations,key,{detail:true}),
   periods:Object.fromEntries(Object.entries(periods).map(([id,rows])=>[id,summarize(rows,key,{detail:true})])),
   later:summarize(later,key,{detail:true}),fitted_only:summarize(available,key),
   later_fitted_only:summarize(available.filter(r=>r.date>=opts.validationSince),key),
   leagues:Object.fromEntries([...byLeague.keys()].sort().map(id=>[id,summarize(later.filter(r=>r.division===id),key)]).filter(([,s])=>s.n))};
 }
 const coverage=later.length?later.filter(r=>r.available.days).length/later.length:0;
 const qualifications=Object.fromEntries(VARIANTS.map(key=>[key,qualification(evaluations,key,key==='opponent_uniform'?(later.length?later.filter(r=>r.available.uniform).length/later.length:0):coverage)]));
 const report={schema_version:1,since:opts.since,requested_until:opts.until,observed_until:observations.at(-1)?.date||null,n:observations.length,
  divisions:[...new Set(observations.map(r=>r.division))].sort(),periods:{calibration_fit:[opts.since,D.previousDay(opts.validationSince)],validation:[opts.validationSince,D.previousDay(opts.recentSince)],recent:[opts.recentSince,opts.until]},
  policy:{live_model_changed:false,automatic_promotion:false,prospective_evidence:false,paired_cohort:true,
   calibration_fit_results_are_in_sample:true,later_periods_are_retrospective:true,fixed_half_life_days:180,fixed_penalty:6,fixed_rho:-.06,
   training_lookback_years:3,fit_frequency:'weekly',fit_cutoff:'strictly before ISO Monday; no same-day scores',
   primary_brier:'mean(Brier(1X2)/2, Brier(over25), Brier(btts))',primary_log_loss:'mean(log_loss(1X2), log_loss(over25), log_loss(btts))',
   regression_inputs:'goals only; no xG or shots',fitted_fallback:'current, including the calibrated regression variant',
   intervals:'approximate paired calendar-week clusters; exploratory, no multiple-comparison correction',
   protocol:PROTOCOL,limits:'Corrected retrospective archive, not original historical data-availability snapshots; no evidence of future profitability or prospective model improvement'},
  excluded,fitting,blends,later_fitted_coverage:round(coverage),market_labels:{'1x2':'1X2',...Object.fromEntries(D.MARKETS.map(m=>[m.id,m.label]))},evaluations,qualifications};
 return report;
}
function renderMarkdown(r){
 const num=v=>v==null?'—':v.toFixed(4).replace('.',','),pct=v=>(100*v).toFixed(1).replace('.',',')+'%';
 const lines=['# MATCHPULSE — сравнителен тест на головите модели','',
  `**${r.n.toLocaleString('bg-BG')} едни и същи мача**, ${r.since}–${r.observed_until||'няма данни'}, ${r.divisions.length} първенства.`,
  '', '**Работещият модел, дизайнът, скенерът и дневниковите прогнози не са променени.**',
  '', 'Кандидатите и правилата са описани предварително в [протокола](model-comparison-protocol.md). Силите се обучават преди началото на всяка седмица. Калибрацията използва само ранния период; всички по-късни резултати тук остават ретроспективни.',
  '', '## По-късна проверка и последен период','',
  'По-ниска грешка е по-добра. Основната цел е средното от Brier(1X2)/2, Brier(Над 2,5) и Brier(Гол/гол); стойностите са сравними само в една и съща колона.',
  '', '| Вариант | Мачове | Основна грешка | 1X2 Brier | Над 2,5 | Гол/гол | Log loss |',
  '|---|---:|---:|---:|---:|---:|---:|'];
 for(const key of VARIANTS){const s=r.evaluations[key].later;lines.push(`| ${LABELS[key]} | ${s.n} | ${num(s.primary_brier)} | ${num(s.markets['1x2'].brier)} | ${num(s.markets.over25.brier)} | ${num(s.markets.btts.brier)} | ${num(s.primary_log_loss)} |`);}
 lines.push('', '## Стабилност по периоди','', '| Вариант | Проверка 2025/26 | Последен период | 95% интервал за подобрението спрямо сегашния |','|---|---:|---:|---|');
 for(const key of VARIANTS){const e=r.evaluations[key],ci=e.later.against_current.approximate_95pct_interval;
  lines.push(`| ${LABELS[key]} | ${num(e.periods.validation.primary_brier)} | ${num(e.periods.recent.primary_brier)} | ${ci?ci.map(num).join(' до '):'малка извадка'} |`);}
 lines.push('', 'Положителен интервал означава по-ниска средна грешка в тази извадка. Интервалите са приблизителни и не отчитат всички зависимости и множествени сравнения.',
  '', '## Калибрация','',
  `Дял на лиговата матрица: **${pct(r.blends.current.weight)}** за сегашния модел и **${pct(r.blends.opponent_days.weight)}** за варианта с атака/защита и дни. Коефициентите са обучени само върху ${r.periods.calibration_fit.join('–')}. Един коефициент променя цялата резултатна матрица и пази съгласуваността на пазарите.`,
  '', 'Показаните ранни резултати на калибрираните варианти са fit диагностика, не независим тест.',
  '', '## Покритие и числена проверка','',
  `Вариантът с дни има собствена оценка за **${pct(r.later_fitted_coverage)}** от по-късните мачове. При недостатъчни данни се използва сегашният модел; тези случаи остават в общата извадка.`,
  '', '| Обучение | Седмични fit | Неконвергирали | Причини за fallback | Ограничени lambda |','|---|---:|---:|---|---:|');
 for(const id of ['uniform','days']){const s=r.fitting[id];lines.push(`| ${id} | ${s.fits} | ${s.nonconverged} | ${Object.entries(s.fallbacks).map(([k,v])=>`${k}: ${v}`).join('; ')||'няма'} | ${s.clipped} |`);}
 lines.push('', 'Регресията използва голове и общите клубни идентичности. Сегашният модел включва и наличното xG. Еднаквите тежести срещу тежестите по дни сравняват времевия ефект в една и съща регресия; останалите сравнения включват повече от една промяна.',
  '', '## Правило за следващата стъпка','', '| Кандидат | Покрива предварителните условия за бъдещо сравнение |','|---|---|');
 for(const key of VARIANTS.filter(k=>k!=='current'))lines.push(`| ${LABELS[key]} | ${r.qualifications[key].eligible_for_prospective_comparison?'Да':'Не'} |`);
 lines.push('', 'Това е филтър за бъдещ предмачов тест, не автоматично разрешение за смяна на работещия модел. Всички вече публикувани прогнози запазват първоначалните си стойности.',
  '', 'Подробните пазари, калибрационни групи, лиги, извадки само с fitted оценка и всички условия са в [model_comparison.json](data/model_comparison.json).',
  '', `История SHA-256: \`${r.provenance?.history_sha256||'не е зададен'}\`.`,
  '', `Протокол SHA-256: \`${r.provenance?.files?.[PROTOCOL]||'не е зададен'}\`.`, '');
 return lines.join('\n');
}
function provenance(raw){return {history_sha256:hash(raw),files:Object.fromEntries(SOURCE_FILES.map(file=>[file,hash(fs.readFileSync(path.join(ROOT,file)))]))};}
function sealed(payload){return {...payload,integrity_sha256:hash(JSON.stringify(payload))};}
function check(report,source){
 const {integrity_sha256,...payload}=report;
 if(hash(JSON.stringify(payload))!==integrity_sha256)throw Error('Comparison report integrity mismatch');
 if(JSON.stringify(report.provenance)!==JSON.stringify(source))throw Error('Comparison report inputs or code changed; regenerate it');
 if(report.policy?.live_model_changed!==false||report.policy?.automatic_promotion!==false||report.policy?.prospective_evidence!==false)throw Error('Invalid comparison policy');
 if(report.requested_until>=todaySofia())throw Error('Comparison report includes today or future dates');
 if(VARIANTS.some(k=>report.evaluations[k]?.overall.n!==report.n))throw Error('Comparison cohorts differ');
 if(fs.readFileSync(path.join(ROOT,MARKDOWN),'utf8')!==renderMarkdown(report))throw Error('Comparison Markdown is stale');
 return true;
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),raw=fs.readFileSync(path.join(ROOT,'docs/data/history.json'),'utf8'),source=provenance(raw);
  const target=path.join(ROOT,OUT);let existing=null;
  if(fs.existsSync(target))try{existing=JSON.parse(fs.readFileSync(target,'utf8'));check(existing,source);}catch(e){if(args.includes('--check'))throw e;existing=null;}
  if(args.includes('--check')){if(!existing)throw Error('Missing comparison report');process.stdout.write(JSON.stringify({ok:true,n:existing.n,live_model_changed:false})+'\n');}
  else if(args.includes('--if-needed')&&existing)process.stdout.write(JSON.stringify({unchanged:true,n:existing.n})+'\n');
  else{
   const report=sealed({...compare(JSON.parse(raw),{progress:args.includes('--progress')}),provenance:source});
   if(args.includes('--write')){fs.writeFileSync(target,JSON.stringify(report));fs.writeFileSync(path.join(ROOT,MARKDOWN),renderMarkdown(report));}
   process.stdout.write(JSON.stringify({n:report.n,blends:report.blends,qualifications:report.qualifications,live_model_changed:false})+'\n');
  }
 }catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}
}
module.exports={PERIODS,VARIANTS,PRIMARY,primaryLoss,fitBlend,pairedInterval,summarize,qualification,compare,renderMarkdown,sealed};
