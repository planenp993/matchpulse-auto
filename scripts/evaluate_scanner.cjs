/* Registered scanner ranking evaluation. Retrospective, never a live forecast. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('../docs/scout-core.js'),P=require('../docs/scout-patterns.js'),M=require('../docs/model-core.js');
const R=require('./scanner_replay.cjs'),F=require('./fit_goal_model.cjs'),D=require('./evaluate_model.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT='docs/data/scanner_validation.json',MARKDOWN='docs/scanner-validation.md',PROTOCOL='docs/scanner-validation-protocol.md';
const SOURCE_FILES=[PROTOCOL,'docs/model-core.js','docs/club-aliases.js','docs/scout-core.js','docs/scout-patterns.js',
 'scripts/evaluate_model.cjs','scripts/fit_goal_model.cjs','scripts/scanner_replay.cjs','scripts/evaluate_scanner.cjs'];
const VARIANTS=R.VARIANTS,LABELS={current:'Сегашно подреждане',league_frequency:'Само лигова честота',shrunken_excess:'Свиване към лигата · prior 6'};
const PERIODS=Object.freeze({since:'2023-07-01',validationSince:'2025-07-01',recentSince:'2026-07-01'});
const PERIOD_IDS=['overall','development','validation','recent','later'];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),round=x=>Number.isFinite(x)?Number(x.toFixed(6)):null;
const todaySofia=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia'}).format(new Date());
const configuration=(windowSize,streak)=>`w${windowSize}_s${streak}`;
function summarizeMetric(m){
 const missing=m.selected-m.settled;
 return {selected:m.selected,settled:m.settled,missing,hits:m.hits,
  hit_rate:m.settled?round(m.hits/m.settled):null,mean_league_rate:m.settled?round(m.baselineSum/m.settled):null,
  mean_league_rate_all_selected:m.selected?round((m.baselineSum+m.missingBaseSum)/m.selected):null,
  excess_rate:m.settled?round(m.liftSum/m.settled):null,settled_coverage:m.selected?round(m.settled/m.selected):null,
  excess_bounds_all_selected:m.selected?[round((m.liftSum-m.missingBaseSum)/m.selected),round((m.liftSum+missing-m.missingBaseSum)/m.selected)]:null};
}
function pairedComparison(metrics,weeks,candidate,reference){
 const a=metrics[candidate],b=metrics[reference],g=weeks.size,sa=summarizeMetric(a),sb=summarizeMetric(b);
 if(!a.settled||!b.settled)return {excess_improvement:null,weekly_clusters:g,approximate_95pct_interval:null,missing_outcome_improvement_bounds:null};
 const ma=a.liftSum/a.settled,mb=b.liftSum/b.settled,delta=ma-mb;
 let se=null;
 if(g>=8){
  let variance=0;
  for(const week of weeks.values()){
   const x=week[candidate],y=week[reference];
   variance+=((x.liftSum-ma*x.settled)/a.settled-(y.liftSum-mb*y.settled)/b.settled)**2;
  }
  se=Math.sqrt(g/(g-1)*variance);
 }
 return {excess_improvement:round(delta),weekly_clusters:g,
  approximate_95pct_interval:se===null?null:[round(delta-1.96*se),round(delta+1.96*se)],
  missing_outcome_improvement_bounds:candidate===reference?[0,0]:sa.excess_bounds_all_selected&&sb.excess_bounds_all_selected?
   [round(sa.excess_bounds_all_selected[0]-sb.excess_bounds_all_selected[1]),round(sa.excess_bounds_all_selected[1]-sb.excess_bounds_all_selected[0])]:null};
}
const freshVariants=()=>Object.fromEntries(VARIANTS.map(id=>[id,R.metric()]));
const freshPeriod=()=>({pool:{candidate_days:0,candidates:0,competitive_days:0,noncompetitive_days:0,maximum_daily_pool:0},metrics:freshVariants(),weeks:new Map()});
const freshGroup=()=>({periods:Object.fromEntries(PERIOD_IDS.map(p=>[p,freshPeriod()]))});
function updateGroup(group,rankings,scope,k,date,opts,resolve){
 const lists=Object.fromEntries(VARIANTS.map(id=>[id,scope==='all'?rankings[id].all:rankings[id].markets.get(scope)||[]]));
 const count=lists.current.length;
 if(VARIANTS.some(id=>lists[id].length!==count))throw Error('Scanner candidate pools differ');
 const phase=date<opts.validationSince?'development':date<opts.recentSince?'validation':'recent';
 const periods=['overall',phase,...(date>=opts.validationSince?['later']:[])];
 const competitive=count>k,metrics=competitive?Object.fromEntries(VARIANTS.map(id=>[id,R.selectedMetric(lists[id],k,resolve)])):null;
 for(const p of periods){
  const part=group.periods[p],pool=part.pool;
  if(count){pool.candidate_days++;pool.candidates+=count;pool.maximum_daily_pool=Math.max(pool.maximum_daily_pool,count);
   if(competitive)pool.competitive_days++;else pool.noncompetitive_days++;}
  if(!competitive)continue;
  const week=D.weekOf(date);if(!part.weeks.has(week))part.weeks.set(week,freshVariants());
  for(const id of VARIANTS){R.addMetric(part.metrics[id],metrics[id]);R.addMetric(part.weeks.get(week)[id],metrics[id]);}
 }
}
function finalizeGroup(group){
 return {pools:Object.fromEntries(PERIOD_IDS.map(p=>[p,group.periods[p].pool])),
  variants:Object.fromEntries(VARIANTS.map(id=>[id,Object.fromEntries(PERIOD_IDS.map(p=>{
   const part=group.periods[p];return [p,{...summarizeMetric(part.metrics[id]),against_current:pairedComparison(part.metrics,part.weeks,id,'current'),
    against_league:pairedComparison(part.metrics,part.weeks,id,'league_frequency')}];
  }))]))};
}
function qualification(primary){
 const candidate=primary.variants.shrunken_excess,controls=['current','league_frequency'],periods=['validation','recent'];
 const checks={
  enough_settled_and_competitive_days:periods.every(p=>candidate[p].settled>=250&&primary.pools[p].competitive_days>=20),
  greater_excess_than_both_controls_in_both_periods:controls.every(id=>periods.every(p=>candidate[p].excess_rate!==null&&primary.variants[id][p].excess_rate!==null&&candidate[p].excess_rate>primary.variants[id][p].excess_rate)),
  positive_paired_weekly_intervals:['against_current','against_league'].every(id=>(candidate.later[id].approximate_95pct_interval?.[0]??-Infinity)>0&&candidate.later[id].weekly_clusters>=12),
  sufficient_settlement_coverage:VARIANTS.every(id=>periods.every(p=>(primary.variants[id][p].settled_coverage??0)>=.95)),
  positive_even_under_missing_outcome_bounds:['against_current','against_league'].every(id=>(candidate.later[id].missing_outcome_improvement_bounds?.[0]??-Infinity)>0)
 };
 return {eligible_for_separate_prospective_comparison:Object.values(checks).every(Boolean),checks,automatic_promotion:false,prospective_evidence:false};
}
function evaluate(history,settings={}){
 const opts={...PERIODS,until:D.previousDay(todaySofia()),...settings};
 for(const date of [opts.since,opts.validationSince,opts.recentSince,opts.until])F.dateNumber(date);
 if(!(opts.since<opts.validationSince&&opts.validationSince<opts.recentSince&&opts.recentSince<=opts.until))throw new RangeError('Scanner evaluation periods must be ordered');
 const seen=new Set();
 for(const row of history)if(M.isPlayed(row)){
  const key=Core.keyFixture(row);if(seen.has(key))throw Error('Duplicate archived fixture: '+key);seen.add(key);
 }
 const index=Core.build(history),references=R.referenceIndex(history),byDate=new Map();
 const excluded={administrative:0,international:0},divisionCounts={},universe=Object.fromEntries([5,10,20].map(w=>[w,{fixtures:0,matched_signals:0,without_league_reference:0,comparable_signals:0,comparable_fixtures:0}]));
 const input=history.filter(r=>r[3]>=opts.since&&r[3]<=opts.until).slice().sort((a,b)=>a[3].localeCompare(b[3])||a[0].localeCompare(b[0])||Core.keyTeam(a[5]).localeCompare(Core.keyTeam(b[5]))||Core.keyTeam(a[6]).localeCompare(Core.keyTeam(b[6])));
 let n=0;
 for(const row of input){
  if(!M.isPlayed(row)){if(row[13]?.AWARDED===true)excluded.administrative++;continue;}
  if(['UCL','UEL','UECL'].includes(row[0])){excluded.international++;continue;}
  if(!byDate.has(row[3]))byDate.set(row[3],[]);
  // Target goals/xG/statistics are absent from the fixture passed to the scanner.
  byDate.get(row[3]).push([...row.slice(0,7),null,null,null,null,null,null]);n++;
  divisionCounts[row[0]]=(divisionCounts[row[0]]||0)+1;
 }
 const groups=new Map(),cohortHash=crypto.createHash('sha256');let lastYear='';
 const resolve=entry=>Core.marketSettled({market:entry.signal.market},index.lookup.get(Core.keyFixture(entry.fixture)));
 for(const [date,fixtures] of byDate){
  for(const windowSize of [5,10,20]){
   const base=R.inspectFixtures(index,references,fixtures,windowSize),counts=universe[windowSize];
   for(const key of Object.keys(base.counts))counts[key]+=base.counts[key];counts.comparable_fixtures+=base.entries.length;
   for(const streak of [3,4,5]){
    const cfg=configuration(windowSize,streak),entries=R.withStreak(base.entries,streak);
    cohortHash.update(JSON.stringify([cfg,date,entries.map(e=>[Core.keyFixture(e.fixture),e.signals.map(x=>x.signal.market).sort()])])+'\n');
    const rankings=Object.fromEntries(VARIANTS.map(id=>[id,R.rankDay(entries,id)]));
    const scopes=['all',...(windowSize===10&&streak===3?P.MARKETS.map(m=>m.id):[])];
    for(const k of [10,20])for(const scope of scopes){
     const key=[cfg,k,scope].join('|');if(!groups.has(key))groups.set(key,freshGroup());
     updateGroup(groups.get(key),rankings,scope,k,date,opts,resolve);
    }
   }
  }
  if(opts.progress&&date.slice(0,4)!==lastYear){lastYear=date.slice(0,4);process.stderr.write(`Scanner replay ${lastYear}: ${fixtures.length} fixtures on ${date}\n`);}
 }
 const configs={};
 for(const windowSize of [5,10,20])for(const streak of [3,4,5]){
  const cfg=configuration(windowSize,streak);configs[cfg]={window_size:windowSize,streak,top:{}};
  for(const k of [10,20]){
   const get=scope=>finalizeGroup(groups.get([cfg,k,scope].join('|'))||freshGroup());
   configs[cfg].top[k]={all:get('all')};
   if(windowSize===10&&streak===3)configs[cfg].top[k].markets=Object.fromEntries(P.MARKETS.map(m=>[m.id,get(m.id)]));
  }
 }
 const primary=configs.w10_s3.top[10].all;
 return {schema_version:1,since:opts.since,requested_until:opts.until,observed_until:[...byDate.keys()].at(-1)||null,
  historical_fixtures:n,calendar_days:byDate.size,divisions:divisionCounts,excluded,universe,candidate_cohort_sha256:cohortHash.digest('hex'),
  periods:{development:[opts.since,D.previousDay(opts.validationSince)],validation:[opts.validationSince,D.previousDay(opts.recentSince)],recent:[opts.recentSince,opts.until]},
  policy:{live_scanner_changed:false,live_model_changed:false,automatic_promotion:false,prospective_evidence:false,diaries_changed:false,
   target_statistics_used_for_selection:false,paired_daily_candidate_pools:true,identical_selected_fixtures_or_markets:false,
   primary_configuration:'w10_s3',primary_top:10,competitive_days_only:true,minimum_prior_observations:5,minimum_league_observations:50,
   shrinkage_prior_matches:6,calibrated_probabilities:false,fit_cutoff:'strictly before fixture date; no same-day observations',
   single_market_diagnostics:'default 10-match / 3-streak configuration only',protocol:PROTOCOL,
   limits:'Corrected retrospective played-match archive; original calendar and provider-availability snapshots are unavailable. Selected outcomes may be missing. Approximate paired weekly intervals; related diagnostics without multiplicity correction.'},
  labels:LABELS,market_labels:Object.fromEntries(P.MARKETS.map(m=>[m.id,m.label])),configs,qualification:qualification(primary)};
}
function renderMarkdown(r){
 const pct=(x,digits=1)=>x==null?'—':(100*x).toFixed(digits).replace('.',',')+'%',pp=x=>x==null?'—':(100*x).toFixed(2).replace('.',',')+' п.п.';
 const primary=r.configs.w10_s3.top[10].all;
 const checkLabels={enough_settled_and_competitive_days:'Достатъчно отчетени предложения и дни във всеки период',
  greater_excess_than_both_controls_in_both_periods:'По-висока добавена честота от двата контрола във всеки период',
  positive_paired_weekly_intervals:'Убедителна положителна разлика спрямо двата контрола',
  sufficient_settlement_coverage:'Поне 95% отчетени сред избраните предложения',
  positive_even_under_missing_outcome_bounds:'Положителна разлика и при най-лошите липсващи резултати'};
 const lines=['# MATCHPULSE — проверка на подреждането в скенера','',
  `Проверени **${r.historical_fixtures.toLocaleString('bg-BG')} изиграни вътрешни мача** в ${Object.keys(r.divisions).length} лиги, ${r.since}–${r.observed_until||'няма данни'}.`,
  '', '**Живото подреждане, моделните вероятности, дизайнът и записаните дневникови прогнози са непроменени.**',
  '', 'Това е реконструкция от архив, не реален предмачов дневник. Предварителните правила са в [протокола](scanner-validation-protocol.md). Всеки дневен списък използва само предишни дати. Не знаем оригиналната наличност на историческата програма/статистики.',
  '', '## Основна проверка: първите 10 предложения','',
  'Последни 10 мача, серия 3+, всички терени, поне единият отбор. Използваме само дни с повече от 10 допустими карти. Всеки вариант избира един водещ пазар за мач; изборите могат да са различни, но дневният кандидатен списък е общ.',
  '', '**Добавена честота** = наблюдавана честота минус предмачовата честота за лигата. По-високото е по-добро. Отрицателното означава резултат под лиговата база. Рангът не е вероятност и не се оценява с Brier.',
  '', '| Подреждане | Избрани / отчетени | Конкурентни дни | Попадения | Лигова честота | Добавена честота |','|---|---:|---:|---:|---:|---:|'];
 for(const id of VARIANTS){const s=primary.variants[id].later;lines.push(`| ${LABELS[id]} | ${s.selected} / ${s.settled} | ${primary.pools.later.competitive_days} | ${pct(s.hit_rate)} | ${pct(s.mean_league_rate)} | ${pp(s.excess_rate)} |`);}
 lines.push('', 'Таблицата обединява двата по-късни периода. Самото „познаване“ на често събитие не доказва допълнителна стойност от отборната серия.',
  '', '## Стабилност по периоди','', '| Подреждане | Проверка 2025/26 | Последен период | 95% интервал за разликата спрямо сегашното |','|---|---:|---:|---|');
 for(const id of VARIANTS){const s=primary.variants[id],ci=s.later.against_current.approximate_95pct_interval;
  lines.push(`| ${LABELS[id]} | ${pp(s.validation.excess_rate)} | ${pp(s.recent.excess_rate)} | ${ci?ci.map(pp).join(' до '):'недостатъчна извадка'} |`);}
 lines.push('', 'Интервалите са приблизителни, със сдвоени календарни седмици. Положителна долна граница подкрепя по-добро подреждане в тази извадка; не гарантира бъдещ резултат. Ранният период е само диагностика.',
  '', '## Липсващи целеви статистики','', '| Подреждане | Липсващи сред избраните | Покритие | Възможни граници на добавената честота |','|---|---:|---:|---|');
 for(const id of VARIANTS){const s=primary.variants[id].later;lines.push(`| ${LABELS[id]} | ${s.missing} | ${pct(s.settled_coverage,2)} | ${s.excess_bounds_all_selected?s.excess_bounds_all_selected.map(pp).join(' до '):'—'} |`);}
 lines.push('', 'Липсващият резултат не е загуба или успех. Границите показват какво е възможно, ако всички липсващи избрани събития са неуспешни или успешни. Не ги заменяме с други сигнали след мача.',
  '', '## Чувствителност: прозорци и серии','', '| Последни мачове / серия | Отчетени current | Сегашно | Лигов еталон | Свиване към лигата |','|---|---:|---:|---:|---:|');
 for(const cfg of Object.values(r.configs)){const e=cfg.top[10].all.variants;lines.push(`| ${cfg.window_size} / ${cfg.streak}+ | ${e.current.later.settled} | ${pp(e.current.later.excess_rate)} | ${pp(e.league_frequency.later.excess_rate)} | ${pp(e.shrunken_excess.later.excess_rate)} |`);}
 lines.push('', 'Това са описателни разбивки. Не избираме най-успешния прозорец или серия по тези резултати; основната настройка остава предварително фиксираната 10 / 3+.',
  '', '## Единични пазари при 10 / 3+','', '| Пазар | Конкурентни дни | Отчетени current | Сегашно | Лигов еталон | Свиване към лигата |','|---|---:|---:|---:|---:|---:|');
 for(const market of P.MARKETS){const block=r.configs.w10_s3.top[10].markets[market.id],e=block.variants;
  lines.push(`| ${market.label} | ${block.pools.later.competitive_days} | ${e.current.later.settled} | ${pp(e.current.later.excess_rate)} | ${pp(e.league_frequency.later.excess_rate)} | ${pp(e.shrunken_excess.later.excess_rate)} |`);}
 lines.push('', '„—“ означава липса на отчетени конкурентни предложения, не нулева успеваемост. Редките пазари може да нямат достатъчно дни с повече от 10 кандидати. Резултатите за първите 20 и всички периоди са в JSON отчета.',
  '', '## Предварителен филтър за новия вариант','',
  `Свиването към лигата ${r.qualification.eligible_for_separate_prospective_comparison?'**покрива**':'**не покрива**'} условията за отделна бъдеща проверка.`,
  '', '| Условие | Покрито |','|---|---|');
 for(const [id,ok] of Object.entries(r.qualification.checks))lines.push(`| ${checkLabels[id]} | ${ok?'Да':'Не'} |`);
 const ci=primary.variants.shrunken_excess.later.against_current.approximate_95pct_interval;
 if(ci&&ci[0]<=0&&ci[1]>=0)lines.push('', '**Разликата между новия вариант и сегашното подреждане остава неубедителна:** интервалът включва нула. Запазваме сегашното подреждане.');
 lines.push('', 'Няма автоматично активиране и няма настройване по първите реални дневникови записи. Дори положителен исторически резултат изисква отделна бъдеща регистрация.',
  '', 'Подробности и граници: [scanner_validation.json](data/scanner_validation.json).',
  '', `История SHA-256: \`${r.provenance?.history_sha256||'не е зададен'}\`.`,
  '', `Протокол SHA-256: \`${r.provenance?.files?.[PROTOCOL]||'не е зададен'}\`.`, '');
 return lines.join('\n');
}
function provenance(raw){return {history_sha256:hash(raw),files:Object.fromEntries(SOURCE_FILES.map(file=>[file,hash(fs.readFileSync(path.join(ROOT,file)))]))};}
function seal(payload){return {...payload,integrity_sha256:hash(JSON.stringify(payload))};}
function check(report,source){
 const {integrity_sha256,...payload}=report;if(integrity_sha256!==hash(JSON.stringify(payload)))throw Error('Scanner validation integrity mismatch');
 if(JSON.stringify(report.provenance)!==JSON.stringify(source))throw Error('Scanner validation inputs or code changed; regenerate');
 for(const flag of ['live_scanner_changed','live_model_changed','automatic_promotion','prospective_evidence','diaries_changed','target_statistics_used_for_selection'])
  if(report.policy?.[flag]!==false)throw Error('Invalid scanner evaluation policy');
 if(report.requested_until>=todaySofia()||Object.keys(report.configs).length!==9)throw Error('Invalid scanner dates or configurations');
 for(const cfg of Object.values(report.configs))for(const [k,cutoff] of Object.entries(cfg.top))for(const block of [cutoff.all,...Object.values(cutoff.markets||{})])for(const p of PERIOD_IDS){
  const expected=block.pools[p].competitive_days*Number(k);
  for(const id of VARIANTS){const s=block.variants[id][p];
   if(s.selected!==expected||s.settled+s.missing!==s.selected||s.hits<0||s.hits>s.settled)throw Error('Scanner selected cohorts differ or counts are invalid');
  }
 }
 if(JSON.stringify(report.qualification)!==JSON.stringify(qualification(report.configs.w10_s3.top[10].all)))throw Error('Scanner qualification differs from metrics');
 if(fs.readFileSync(path.join(ROOT,MARKDOWN),'utf8')!==renderMarkdown(report))throw Error('Scanner Markdown is stale');
 return true;
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),raw=fs.readFileSync(path.join(ROOT,'docs/data/history.json'),'utf8'),source=provenance(raw),target=path.join(ROOT,OUT);let existing=null;
  if(fs.existsSync(target))try{existing=JSON.parse(fs.readFileSync(target,'utf8'));check(existing,source);}catch(e){if(args.includes('--check'))throw e;existing=null;}
  if(args.includes('--check')){if(!existing)throw Error('Missing scanner validation report');process.stdout.write(JSON.stringify({ok:true,fixtures:existing.historical_fixtures,live_scanner_changed:false})+'\n');}
  else if(args.includes('--if-needed')&&existing)process.stdout.write(JSON.stringify({unchanged:true,fixtures:existing.historical_fixtures})+'\n');
  else{
   const report=seal({...evaluate(JSON.parse(raw),{progress:args.includes('--progress')}),provenance:source});
   if(args.includes('--write')){fs.writeFileSync(target,JSON.stringify(report));fs.writeFileSync(path.join(ROOT,MARKDOWN),renderMarkdown(report));}
   const primary=report.configs.w10_s3.top[10].all;
   process.stdout.write(JSON.stringify({fixtures:report.historical_fixtures,days:report.calendar_days,primary_later:Object.fromEntries(VARIANTS.map(id=>[id,primary.variants[id].later])),qualification:report.qualification,live_scanner_changed:false})+'\n');
  }
 }catch(e){process.stderr.write(e.stack+'\n');process.exitCode=1;}
}
module.exports={VARIANTS,PERIODS,summarizeMetric,pairedComparison,qualification,evaluate,renderMarkdown,provenance,seal,check};
