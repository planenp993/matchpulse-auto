/* Offline, chronological replay of the browser engine. No provider requests. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('../docs/model-core.js'),ROOT=path.resolve(__dirname,'..');
const round=(x,d=6)=>Number.isFinite(x)?Math.round(x*10**d)/10**d:null;
const todaySofia=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia'}).format(new Date());
const previousDay=date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const INTERNATIONAL=new Set(['UCL','UEL','UECL']),WINDOWS=[5,10,20,30],MARKETS=[];
function market(id,label,probability,outcome,complement=null){MARKETS.push({id,label,probability,outcome,complement});}
market('homeWin','1 — домакин',p=>p.homeWin,r=>+(r[7]>r[8]));
market('draw','X — равен',p=>p.draw,r=>+(r[7]===r[8]));
market('awayWin','2 — гост',p=>p.awayWin,r=>+(r[7]<r[8]));
market('double1X','Двоен шанс 1X',p=>p.double1X,r=>+(r[7]>=r[8]));
market('doubleX2','Двоен шанс X2',p=>p.doubleX2,r=>+(r[7]<=r[8]));
market('double12','Двоен шанс 12',p=>p.double12,r=>+(r[7]!==r[8]));
for(const t of [0,1,2,3,4]){
 const over='over'+t+'5',under='under'+t+'5';
 market(over,`Над ${t},5 гола`,p=>p[over],r=>+(r[7]+r[8]>t),under);
 market(under,`Под ${t},5 гола`,p=>1-p[over],r=>+(r[7]+r[8]<=t),over);
}
market('btts','Гол/гол Да',p=>p.btts,r=>+(r[7]>0&&r[8]>0),'noBtts');
market('noBtts','Гол/гол Не',p=>1-p.btts,r=>+(r[7]===0||r[8]===0),'btts');
for(const [prefix,label,index] of [['home','Домакин',7],['away','Гост',8]])for(const t of [0,1,2]){
 const over=prefix+'Over'+t+'5',under=prefix+'Under'+t+'5';
 market(over,`${label} над ${t},5`,p=>p[over],r=>+(r[index]>t),under);
 market(under,`${label} под ${t},5`,p=>1-p[over],r=>+(r[index]<=t),over);
}
const probabilityVector=p=>MARKETS.map(m=>m.probability(p)),outcomeVector=r=>MARKETS.map(m=>m.outcome(r));
function lowerDate(rows,date){
 let lo=0,hi=rows.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][3]<date)lo=mid+1;else hi=mid;}
 return lo;
}
// Prefix counts use the same three-year, date-exclusive interval as league means.
function createReplay(history){
 const games=history.filter(M.isPlayed),clubs=new Map(),leagues=new Map();
 for(const r of games){
  for(const name of new Set([M.clubKey(r[5]),M.clubKey(r[6])])){
   if(!clubs.has(name))clubs.set(name,[]);clubs.get(name).push(r);
  }
  if(!leagues.has(r[0]))leagues.set(r[0],{rows:[],prefix:[new Float64Array(MARKETS.length)]});
  leagues.get(r[0]).rows.push(r);
 }
 for(const rows of clubs.values())rows.sort((a,b)=>b[3].localeCompare(a[3])||(b[4]||'').localeCompare(a[4]||''));
 for(const league of leagues.values()){
  league.rows.sort((a,b)=>a[3].localeCompare(b[3]));
  for(const r of league.rows){const last=league.prefix.at(-1),actual=outcomeVector(r);league.prefix.push(Float64Array.from(last,(v,i)=>v+actual[i]));}
 }
 let cachedDate=null,bases;
 function context(fixture){
  const date=fixture[3];
  if(date!==cachedDate){bases=M.leagueBases(games,date);cachedDate=date;}
  const before=name=>(clubs.get(M.clubKey(name))||[]).filter(r=>r[3]<date),league=leagues.get(fixture[0]);
  let frequencies=null,count=0;
  if(league){
   const end=lowerDate(league.rows,date),start=lowerDate(league.rows,String(+date.slice(0,4)-3)+date.slice(4));count=end-start;
   if(count)frequencies=Array.from(league.prefix[end],(v,i)=>(v-league.prefix[start][i])/count);
  }
  return {bases,homeMatches:before(fixture[5]),awayMatches:before(fixture[6]),frequencies,count};
 }
 return {games,context,evaluate:(fixture,preset='standard')=>M.evaluateContext(fixture,context(fixture),preset)};
}
function replay(history,{since='2023-07-01',until=previousDay(todaySofia()),windows=WINDOWS,preset='standard',progress=false}={}){
 const index=createReplay(history),observations=[],excluded={administrative:0,international:0,insufficient_team_history:0,insufficient_league_history:0};
 const candidates=history.filter(r=>r[3]>=since&&r[3]<=until).sort((a,b)=>a[3].localeCompare(b[3]));
 const cache=new Map();let lastYear='';
 for(const game of candidates){
  if(!M.isPlayed(game)){if(game[13]?.AWARDED===true)excluded.administrative++;continue;}
  if(INTERNATIONAL.has(game[0])){excluded.international++;continue;}
  const context=index.context(game);
  if(context.homeMatches.length<5||context.awayMatches.length<5){excluded.insufficient_team_history++;continue;}
  if(!context.bases.has(game[0])||!context.count){excluded.insufficient_league_history++;continue;}
  const predictions={};
  for(const window of windows){
   const settings=window===30?preset:{...M.params[preset],sampleSize:window},value=M.evaluateContext(game,context,settings);
   if(value.error)throw new Error(value.error);predictions[window]=probabilityVector(value.distribution.probs);
  }
  const own=context.bases.get(game[0]),key=game[0]+'|'+game[3];
  if(!cache.has(key))cache.set(key,probabilityVector(M.distribution(own.h,own.a,0).probs));
  observations.push({division:game[0],date:game[3],actual:outcomeVector(game),predictions,frequencies:context.frequencies,poisson:cache.get(key),homeN:context.homeMatches.length,awayN:context.awayMatches.length});
  if(progress&&game[3].slice(0,4)!==lastYear){lastYear=game[3].slice(0,4);process.stderr.write(`Replaying ${lastYear} (${observations.length} eligible so far)\n`);}
 }
 return {observations,excluded,candidates:candidates.length,since,until};
}
function weekOf(date){
 const day=new Date(date+'T12:00:00Z'),weekday=(day.getUTCDay()+6)%7;
 day.setUTCDate(day.getUTCDate()-weekday);return day.toISOString().slice(0,10);
}
const log=x=>Math.log(Math.max(1e-12,Math.min(1-1e-12,x)));
function loss(probabilities,actual,index){
 if(index!==null){const p=probabilities[index],y=actual[index];return {brier:(p-y)**2,logloss:-(y*log(p)+(1-y)*log(1-p)),hit:+((p>=.5)===(y===1)),p,y};}
 const p=probabilities.slice(0,3),winner=actual.slice(0,3).indexOf(1);
 return {brier:p.reduce((s,x,i)=>s+(x-(i===winner?1:0))**2,0),logloss:-log(p[winner]),hit:+(p.indexOf(Math.max(...p))===winner)};
}
function comparison(total,clusters,n){
 const delta=total/n,g=clusters.size;let interval=null;
 if(g>=8){const variance=[...clusters.values()].reduce((s,x)=>s+(x.sum-delta*x.n)**2,0)*g/(g-1)/(n*n),se=Math.sqrt(variance);interval=[round(delta-1.96*se),round(delta+1.96*se)];}
 const evidence=n<500||g<12?'small_sample':interval?.[0]>0?'lower_error':interval?.[1]<0?'higher_error':'inconclusive';
 return {brier_improvement:round(delta),weekly_clusters:g,approximate_95pct_interval:interval,evidence};
}
function score(rows,window,index,{detail=false}={}){
 const n=rows.length;
 if(!n){
  const empty=()=>({brier:null,log_loss:null,brier_improvement:null,weekly_clusters:0,approximate_95pct_interval:null,evidence:'small_sample'});
  return {n:0,brier:null,log_loss:null,accuracy:null,baselines:{league_frequencies:empty(),league_goal_means:empty()}};
 }
 let brier=0,logloss=0,hits=0,forecast=0,actual=0;
 const bins=Array.from({length:10},(_,i)=>({range:`${i*10}-${(i+1)*10}%`,n:0,forecast:0,actual:0}));
 const baselines={league_frequencies:{brier:0,logloss:0,improvement:0,weeks:new Map()},league_goal_means:{brier:0,logloss:0,improvement:0,weeks:new Map()}};
 for(const row of rows){
  const v=loss(row.predictions[window],row.actual,index);brier+=v.brier;logloss+=v.logloss;hits+=v.hit;
  if(index!==null){forecast+=v.p;actual+=v.y;const bin=bins[Math.min(9,Math.floor(v.p*10))];bin.n++;bin.forecast+=v.p;bin.actual+=v.y;}
  for(const [name,key] of [['league_frequencies','frequencies'],['league_goal_means','poisson']]){
   const base=baselines[name],b=loss(row[key],row.actual,index),delta=b.brier-v.brier,week=row.week||weekOf(row.date);
   base.brier+=b.brier;base.logloss+=b.logloss;base.improvement+=delta;
   const cluster=base.weeks.get(week)||{n:0,sum:0};cluster.n++;cluster.sum+=delta;base.weeks.set(week,cluster);
  }
 }
 const result={n,brier:round(brier/n),log_loss:round(logloss/n),accuracy:round(hits/n),baselines:{}};
 for(const [name,b] of Object.entries(baselines))result.baselines[name]={brier:round(b.brier/n),log_loss:round(b.logloss/n),...comparison(b.improvement,b.weeks,n)};
 if(index!==null){result.mean_forecast=round(forecast/n);result.actual_rate=round(actual/n);result.calibration_error=round(bins.reduce((s,b)=>s+Math.abs(b.forecast-b.actual),0)/n);if(detail)result.bins=bins.filter(b=>b.n).map(b=>({...b,forecast:round(b.forecast/b.n),actual:round(b.actual/b.n),sample:b.n<100?'small':'at_least_100'}));}
 return result;
}
function marketScores(rows,window,detail=false){return {'1x2':score(rows,window,null,{detail}),...Object.fromEntries(MARKETS.map((m,i)=>[m.id,score(rows,window,i,{detail})]))};}
function seasonAt(division,date){
 const y=+date.slice(0,4);return ['NOR','SWE'].includes(division)?String(y):`${+date.slice(5,7)>=7?y:y-1}/${String((+date.slice(5,7)>=7?y+1:y)%100).padStart(2,'0')}`;
}
function partition(rows,key){
 const groups=new Map();for(const row of rows){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}return [...groups].sort(([a],[b])=>a.localeCompare(b));
}
// Retain the optional legacy dashboard's Over 2.5 schema and reporting period.
function legacyReport(rows,{since,until,preset='standard'}){
 const index=MARKETS.findIndex(m=>m.id==='over25'),v=score(rows,30,index),bins=[];
 for(let low=0;low<100;low+=20){
  const part=rows.filter(r=>r.predictions[30][index]*100>=low&&r.predictions[30][index]*100<(low===80?101:low+20));
  if(part.length)bins.push({range:`${low}-${low+20}%`,n:part.length,forecast:round(part.reduce((s,r)=>s+r.predictions[30][index],0)/part.length,4),actual:round(part.reduce((s,r)=>s+r.actual[index],0)/part.length,4)});
 }
 return {n:rows.length,since,until:rows.at(-1)?.date||until,market:'Over 2.5 goals',model:`MatchpulseModel.evaluate / ${preset}`,brier:round(v.brier,4),baseline_brier:round(v.baselines.league_goal_means?.brier,4),bins,
  leagues:partition(rows,r=>r.division).map(([league,part])=>{const z=score(part,30,index);return {league,n:part.length,brier:round(z.brier,4),baseline_brier:round(z.baselines.league_goal_means.brier,4)};}),
  method:'Actual browser module; fixed preset; strict date-before-fixture cutoff; shared aliases; administrative scores excluded',limitations:'Retrospective diagnostic only; no prospective validation, bookmaker prices or yield/ROI evidence'};
}
function report(history,{since='2026-08-20',until=previousDay(todaySofia()),preset='standard'}={}){return legacyReport(replay(history,{since,until,preset,windows:[30]}).observations,{since,until,preset});}
function qualityReport(history,{since='2023-07-01',validationSince='2025-07-01',recentSince='2026-07-01',until=previousDay(todaySofia()),progress=false}={}){
 if(!(since<validationSince&&validationSince<recentSince&&recentSince<=until))throw new RangeError('Periods must be ordered: since < validationSince < recentSince <= until');
 const data=replay(history,{since,until,progress}),rows=data.observations;
 for(const row of rows)row.week=weekOf(row.date);
 const periods=[['development',since,previousDay(validationSince)],['validation',validationSince,previousDay(recentSince)],['recent',recentSince,until]],evaluations={};
 for(const window of WINDOWS){
  if(progress)process.stderr.write(`Scoring window ${window}\n`);
  evaluations[window]={role:window===30?'current_live_model':'diagnostic_candidate',n:rows.length,full_window_n:rows.filter(r=>r.homeN>=window&&r.awayN>=window).length,overall:marketScores(rows,window,true),
   periods:Object.fromEntries(periods.map(([id,from,to])=>[id,{since:from,until:to,markets:marketScores(rows.filter(r=>r.date>=from&&r.date<=to),window,true)}])),
   leagues:Object.fromEntries(partition(rows,r=>r.division).map(([id,part])=>[id,marketScores(part,window)])),
   seasons:Object.fromEntries(partition(rows,r=>seasonAt(r.division,r.date)).map(([id,part])=>[id,marketScores(part,window)]))};
 }
 return {...legacyReport(rows.filter(r=>r.date>='2026-08-20'),{since:'2026-08-20',until}),schema_version:2,
  diagnostics:{since,requested_until:until,observed_until:rows.at(-1)?.date||null,n:rows.length,candidates:data.candidates,excluded:data.excluded,divisions:[...new Set(rows.map(r=>r.division))].sort(),windows:WINDOWS,current_live_window:30,
   policy:{preset:'standard',fitted_parameters:false,automatic_model_change:false,periods_selected_before_replay:true,same_matches_for_all_windows:true,minimum_team_matches:5,minimum_league_matches:12,league_lookback_years:3,
    cutoff:'strictly before fixture date; all same-day scores excluded',binary_brier_range:[0,1],multiclass_brier_range:[0,2],log_loss_probability_clip:1e-12,
    comparison:'Positive Brier improvement means lower error than the named baseline; approximate 95% intervals cluster paired errors by calendar week',
    exploratory_groups:'League, season and market comparisons are exploratory; intervals are not adjusted for multiple comparisons',
    small_samples:'No directional evidence label below 500 games or 12 calendar weeks; calibration bins below 100 are labelled small',
    interpretation:'All periods are retrospective with the currently corrected archive and code. Later periods were separated before this replay but are not genuinely unseen prospective data. Do not select a live window from these tests alone.'},
   markets:[{id:'1x2',label:'1X2 — общ резултат',type:'multiclass'},...MARKETS.map(({id,label,complement})=>({id,label,type:'binary',complement}))],evaluations}};
}
function provenance(raw){
 const sha=data=>crypto.createHash('sha256').update(data).digest('hex'),files=['docs/model-core.js','docs/club-aliases.js','scripts/evaluate_model.cjs','scripts/evaluate.py'];
 return {history_sha256:sha(raw),files:Object.fromEntries(files.map(file=>[file,sha(fs.readFileSync(path.join(ROOT,file)))]))};
}
function renderMarkdown(result){
 const d=result.diagnostics,live=d.evaluations[30],pct=v=>(100*v).toFixed(1).replace('.',',')+'%',num=v=>v==null?'—':v.toFixed(4).replace('.',',');
 const labels=Object.fromEntries(d.markets.map(m=>[m.id,m.label])),evidence={lower_error:'по-ниска грешка',higher_error:'по-висока грешка',inconclusive:'неубедително',small_sample:'малка извадка'};
 const selected=['1x2','double1X','doubleX2','double12','over15','over25','over35','btts','homeOver15','awayOver15'];
 const lines=['# MATCHPULSE — проверка на моделните вероятности','',`Период: **${d.since} – ${d.observed_until||'няма данни'}**. Проверени са **${d.n.toLocaleString('en-US')} мача в ${d.divisions.length} първенства**.`,
  '', '## Какво е проверено','',
  '- Действителният браузърен модел със стандартните му настройки. Текущите вероятности, Elo и интерфейсът не са променени.',
  '- Прозорци 5/10/20 мача като диагностични варианти; действащият модел използва до 30. Изборът 5/10/20 в сайта управлява описателната статистика.',
  '- 1X2 и 30 двоични пазара: единичен резултат, двоен шанс, общи и отборни голове, гол/гол. Противоположните пазари не са независими доказателства.',
  '- Всеки мач използва само по-стари дати. Служебните резултати и евротурнирите са изключени.',
  '- Сравнение с действителните честоти за лигата и отделно с Поасон от средните голове за лигата. И двете бази използват само предходните три години.',
  '- Една и съща извадка за всички прозорци; при по-кратка история се използва наличната, минимум 5 мача за всеки отбор.',
  '', '## Текущият модел срещу честотите на лигата','',
  'По-ниска грешка Brier е по-добра. Общият 1X2 има скала 0–2, останалите редове — 0–1; не сравнявай стойностите между различни пазари.',
  '', '| Пазар | Модел | Лигова база | Извод в тази извадка |','|---|---:|---:|---|'];
 for(const id of selected){const m=live.overall[id],b=m.baselines.league_frequencies;lines.push(`| ${labels[id]} | ${num(m.brier)} | ${num(b.brier)} | ${evidence[b.evidence]} |`);}
 lines.push('', '## Отделени периоди','',
  'Периодите са фиксирани преди изпълнението. Това остава ретроспективен тест на текущия код и коригиран архив, а не доказателство за работа с непознати бъдещи данни. Не са настройвани параметри и не е избран нов модел.',
  '', '| Период | Дати | Мачове | Над 2,5: модел / база | 1X2: модел / база |','|---|---|---:|---:|---:|');
 for(const [key,label] of [['development','Ранна диагностика'],['validation','По-късна проверка'],['recent','Последен период']]){const p=live.periods[key],o=p.markets.over25,x=p.markets['1x2'];lines.push(`| ${label} | ${p.since} – ${p.until} | ${o.n} | ${num(o.brier)} / ${num(o.baselines.league_frequencies?.brier??null)} | ${num(x.brier)} / ${num(x.baselines.league_frequencies?.brier??null)} |`);}
 lines.push('', '## Проверка на прозорците','', '| Прозорец | Пълна извадка и за двата отбора | Над 2,5: Brier | 1X2: Brier | Гол/гол: Brier |','|---|---:|---:|---:|---:|');
 for(const w of WINDOWS){const e=d.evaluations[w];lines.push(`| ${w}${w===30?' (действащ)':''} | ${e.full_window_n} / ${e.n} | ${num(e.overall.over25.brier)} | ${num(e.overall['1x2'].brier)} | ${num(e.overall.btts.brier)} |`);}
 lines.push('', 'Най-ниската стойност в общата таблица не е автоматично основание за смяна на прозореца. По-краткият прозорец променя и наличието на xG според действащото правило за минимум 6 наблюдения.',
  '', '## Калибрация: Над 2,5, действащ модел','', '| Прогнозен интервал | Мачове | Средна прогноза | Реална честота |','|---|---:|---:|---:|');
 for(const b of live.overall.over25.bins||[])lines.push(`| ${b.range} | ${b.n}${b.sample==='small'?' (малка извадка)':''} | ${pct(b.forecast)} | ${pct(b.actual)} |`);
 lines.push('', '## Лиги: текущ модел, Над 2,5','', '| Лига | Мачове | Модел | Честоти за лигата | Извод |','|---|---:|---:|---:|---|');
 for(const [id,markets] of Object.entries(live.leagues)){const m=markets.over25,b=m.baselines.league_frequencies;lines.push(`| ${id} | ${m.n} | ${num(m.brier)} | ${num(b.brier)} | ${evidence[b.evidence]} |`);}
 lines.push('', '## Граници и следваща стъпка','',
  'Посоката на разликата е отбелязана само при поне 500 мача и 12 календарни седмици. Приблизителният 95% интервал групира разликите в грешките по седмици; не отчита всички зависимости и не е коригиран за многото сравнения. Разбивките по лига и сезон са ориентир за допълнителна проверка.',
  '', 'Историческите xG и резултати са текущите архивни стойности; не разполагаме с оригиналните им предмачови версии. Липсващи наблюдения не се заменят с нули. Няма оценка на доходност или потвърдена бъдеща успеваемост.',
  '', 'Следващата промяна трябва да се опира на устойчиви резултати по периоди и после да се провери чрез автоматичния предмачов дневник. Този отчет не променя модела и подреждането на скенера.',
  '', 'Подробните резултати за всеки пазар, прозорец, лига, сезон и период са в [model_report.json](data/model_report.json). Отчетът се преизчислява автоматично при съществуващите обновявания, без допълнителни заявки към доставчиците.',
  '', `SHA-256 на историческия файл: \`${result.provenance?.history_sha256||'не е зададен'}\`.`, '');
 return lines.join('\n');
}
if(require.main===module){
 const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1]};
 const raw=args.includes('--stdin')?fs.readFileSync(0,'utf8'):fs.readFileSync(path.join(ROOT,'docs/data/history.json'),'utf8');
 const result=args.includes('--quality')?qualityReport(JSON.parse(raw),{since:value('--since'),until:value('--until'),progress:args.includes('--progress')}):report(JSON.parse(raw),{since:value('--since'),until:value('--until')});
 if(result.diagnostics)result.provenance=provenance(raw);
 if(value('--markdown-output'))fs.writeFileSync(value('--markdown-output'),renderMarkdown(result));
 process.stdout.write(JSON.stringify(result));
}
module.exports={MARKETS,WINDOWS,probabilityVector,outcomeVector,createReplay,replay,score,report,qualityReport,renderMarkdown,weekOf,seasonAt,previousDay};
