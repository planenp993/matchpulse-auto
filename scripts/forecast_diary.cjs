/* Prospective, append-only model/scanner diary. No provider requests. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const M=require('../docs/model-core.js'),S=require('../docs/scout-core.js'),P=require('../docs/scout-patterns.js');
const D=require('./evaluate_model.cjs');
const ROOT=path.resolve(__dirname,'..'),DATA=path.join(ROOT,'docs/data'),LEDGER=path.join(DATA,'diary');
const MARGIN_MINUTES=30,HORIZON_DAYS=3,RESULT_WAIT_MINUTES=180,MISSING_RESULT_GRACE_DAYS=7;
const INTERNATIONAL=new Set(['UCL','UEL','UECL']);
const STAT_FIELDS=['HC','AC','HY','AY','HR','AR','HS','AS','HST','AST','HTHG','HTAG'];
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const seal=payload=>({...payload,sha256:sha(canonical(payload))});
function verifySeal(record){const {sha256,...payload}=record;if(sha256!==sha(canonical(payload)))throw Error('Diary record hash mismatch');}
const sofiaFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function sofiaParts(ms){return Object.fromEntries(sofiaFormat.formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
function sofiaDate(now){const p=sofiaParts(+now);return `${p.year}-${p.month}-${p.day}`;}
function confirmedKickoff(fixture){
 if(typeof fixture[13]!=='string'||!fixture[13].includes('Sofia')||!/^\d{4}-\d{2}-\d{2}$/.test(fixture[3])||!/^([01]\d|2[0-3]):[0-5]\d$/.test(fixture[4]||''))return null;
 const local=Date.parse(fixture[3]+'T'+fixture[4]+':00Z');if(!Number.isFinite(local))return null;
 const offsets=new Set([-1,0,1].map(shift=>{
  const t=local+shift*86400000,p=sofiaParts(t);
  return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-t;
 }));
 const candidates=[...offsets].map(offset=>local-offset).filter(t=>{
  const p=sofiaParts(t);return `${p.year}-${p.month}-${p.day}`===fixture[3]&&`${p.hour}:${p.minute}`===fixture[4];
 });
 // Refuse nonexistent spring clocks and ambiguous autumn clocks.
 return candidates.length===1?new Date(candidates[0]).toISOString():null;
}
function calendarSnapshot(status,fixtures,now=new Date()){
 const stamp=status.fixtures_updated_utc,age=+now-Date.parse(stamp);
 const fresh=Number.isFinite(age)&&age>=-60000&&age<=36*3600000&&['ok','ok_secondary','partial_secondary'].includes(status.fixtures_feed_status);
 const successful=new Set(Object.keys(status.secondary_fixture_counts||{})),stale=new Set(status.stale_secondary_leagues||[]);
 const eligible=fresh?fixtures.filter(f=>successful.has(f[0])&&!stale.has(f[0])):[];
 return {fixtures:eligible,stamp:stamp||null,blocked:fixtures.length-eligible.length,fresh};
}
function fixtureRow(f){return [f.div,f.country,f.league,f.date,f.time,f.home,f.away,null,null,null,null,null,null,f.source];}
const fixtureKey=f=>S.keyFixture(fixtureRow(f));
const dict=vector=>Object.fromEntries(D.MARKETS.map((m,i)=>[m.id,vector[i]]));
const vector=probabilities=>D.MARKETS.map(m=>probabilities[m.id]);
function codeVersions(){
 const digest=files=>sha(files.map(file=>file+':'+sha(fs.readFileSync(path.join(ROOT,file)))).join('\n'));
 return {model:digest(['docs/model-core.js','docs/club-aliases.js']),scanner:digest(['docs/scout-patterns.js','docs/scout-core.js','docs/club-aliases.js']),recorder:digest(['scripts/forecast_diary.cjs'])};
}
function signalSnapshot(signal){
 const side=s=>({hits:s.hits,n:s.n,streak:s.currentStreak,missing:s.missing});
 return {market:signal.market,label:signal.label,family:signal.family,rank:signal.rank,
  home:side(signal.home),away:side(signal.away),reference:signal.evidence.reference,notes:signal.evidence.notes};
}
function validate(forecasts,events){
 const ids=new Map(),latest=new Map();
 for(const entry of forecasts){
  verifySeal(entry);
  if(entry.schema!==1||entry.id!==sha(entry.fixture_key)||ids.has(entry.id)||!entry.fixture?.div||!entry.fixture.home||!entry.fixture.away||!/^\d{4}-\d{2}-\d{2}$/.test(entry.fixture.date))throw Error('Invalid or duplicate forecast identity');
  const captured=Date.parse(entry.captured_at_utc),kickoff=Date.parse(entry.kickoff_utc);
  if(!Number.isFinite(captured)||!Number.isFinite(kickoff)||kickoff-captured<MARGIN_MINUTES*60000)throw Error('Forecast is not safely pre-match');
  const p=entry.model?.probabilities,v=p&&D.probabilityVector(p);
  if(!v||v.some(x=>!Number.isFinite(x)||x<0||x>1)||Math.abs(p.homeWin+p.draw+p.awayWin-1)>1e-10)throw Error('Invalid saved model probabilities');
  for(const baseline of ['league_frequencies','league_goal_means'])if(vector(entry.model.baselines[baseline]).some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Invalid saved baseline');
  if(entry.scanner&&(!entry.scanner.signals.length||entry.scanner.primary.market!==entry.scanner.signals[0].market))throw Error('Invalid saved scanner selection');
  ids.set(entry.id,entry);
 }
 for(const event of events){
  verifySeal(event);const entry=ids.get(event.forecast_id),previous=latest.get(event.forecast_id);
  if(!entry||event.schema!==1||event.revision!==(previous?.revision||0)+1||!['pending','settled','excluded','unmatched'].includes(event.state.status))throw Error('Invalid diary event sequence');
  const time=Date.parse(event.observed_at_utc);
  if(!Number.isFinite(time)||time<Date.parse(entry.captured_at_utc)||(previous&&time<Date.parse(previous.observed_at_utc)))throw Error('Event predates its forecast or previous revision');
  if(!Number.isFinite(Date.parse(event.state.kickoff_utc)))throw Error('Invalid event kickoff');
  if(event.state.status==='settled'&&(!Array.isArray(event.state.result?.score)||event.state.result.score.length!==2||event.state.result.score.some(n=>!Number.isInteger(n)||n<0||n>30)))throw Error('Invalid settled score');
  if(event.state.status==='settled'&&time<Date.parse(event.state.kickoff_utc)+RESULT_WAIT_MINUTES*60000)throw Error('Settlement precedes finish-time guard');
  latest.set(event.forecast_id,event);
 }
 return {ids,latest};
}
const initialState=entry=>({status:'pending',kickoff_utc:entry.kickoff_utc,result:null,reason:null});
function resultRow(entry,result){const row=fixtureRow(entry.fixture);row[7]=result.score[0];row[8]=result.score[1];row[13]=result.stats;return row;}
function ledgerHash(forecasts,events){return sha(canonical({forecasts:forecasts.slice().sort((a,b)=>a.id.localeCompare(b.id)),events:events.slice().sort((a,b)=>a.forecast_id.localeCompare(b.forecast_id)||a.revision-b.revision)}));}
function report(forecasts,events,now=new Date(),run={}){
 const {latest}=validate(forecasts,events),seen=new Set(),entries=[],rows=[],totals={recorded:forecasts.length,settled:0,pending:0,excluded:0,unmatched:0};
 const scanner={tracked:0,settled:0,hits:0,pending:0,pending_stats:0,excluded:0,hit_rate:null,markets:{}};
 const sorted=forecasts.slice().sort((a,b)=>a.captured_at_utc.localeCompare(b.captured_at_utc)||a.id.localeCompare(b.id));
 for(const entry of sorted){
  const key=fixtureKey(entry.fixture),state={...(latest.get(entry.id)?.state||initialState(entry))};
  if(seen.has(key)){state.status='excluded';state.reason='duplicate_fixture_after_alias_review';}seen.add(key);
  totals[state.status]++;
  let scannerResult=null;
  if(state.status==='settled'){
   const actual=resultRow(entry,state.result);
   rows.push({date:entry.fixture.date,division:entry.fixture.div,version:entry.versions.model,week:D.weekOf(entry.fixture.date),
    actual:D.outcomeVector(actual),predictions:{30:D.probabilityVector(entry.model.probabilities)},frequencies:vector(entry.model.baselines.league_frequencies),poisson:vector(entry.model.baselines.league_goal_means)});
   if(entry.scanner)scannerResult=S.marketSettled({market:entry.scanner.primary.market},actual);
  }
  if(entry.scanner){
   scanner.tracked++;
   const market=entry.scanner.primary.market,group=scanner.markets[market]||(scanner.markets[market]={label:entry.scanner.primary.label,tracked:0,settled:0,hits:0,pending_stats:0,excluded:0});group.tracked++;
   if(['excluded','unmatched'].includes(state.status)){scanner.excluded++;group.excluded++;}
   else if(scannerResult!==null){scanner.settled++;scanner.hits+=+scannerResult;group.settled++;group.hits+=+scannerResult;}
   else{scanner.pending++;if(state.status==='settled'){scanner.pending_stats++;group.pending_stats++;}}
  }
  entries.push({id:entry.id,fixture:entry.fixture,kickoff_utc:state.kickoff_utc,captured_at_utc:entry.captured_at_utc,
   status:state.status,reason:state.reason,score:state.result?.score||null,probabilities:entry.model.probabilities,
   scanner:entry.scanner?{label:entry.scanner.primary.label,market:entry.scanner.primary.market,result:scannerResult,pending_stats:state.status==='settled'&&scannerResult===null}:null});
 }
 scanner.hit_rate=scanner.settled?scanner.hits/scanner.settled:null;
 const scores=sample=>({'1x2':D.score(sample,30,null,{detail:true}),...Object.fromEntries(D.MARKETS.map((m,i)=>[m.id,D.score(sample,30,i,{detail:true})]))});
 const versions=Object.fromEntries([...new Set(forecasts.map(f=>f.versions.model))].sort().map(version=>[version,{recorded:forecasts.filter(f=>f.versions.model===version).length,markets:scores(rows.filter(r=>r.version===version))}]));
 return {schema_version:1,checked_at_utc:now.toISOString(),started_at_utc:sorted[0]?.captured_at_utc||null,totals,scanner,
  markets:scores(rows),versions,market_labels:Object.fromEntries([['1x2','1X2 — общ резултат'],...D.MARKETS.map(m=>[m.id,m.label])]),
  recent:entries.sort((a,b)=>b.captured_at_utc.localeCompare(a.captured_at_utc)||a.kickoff_utc.localeCompare(b.kickoff_utc)||a.id.localeCompare(b.id)).slice(0,20),
  integrity:{forecast_count:forecasts.length,event_count:events.length,ledger_sha256:ledgerHash(forecasts,events)},last_run:run,
  method:{type:'prospective',model_window:30,scanner_window:10,scanner_selection:'Primary signal frozen at first capture; no later market substitution',
   capture_horizon_days:HORIZON_DAYS,minimum_minutes_before_kickoff:MARGIN_MINUTES,minimum_minutes_after_kickoff_for_results:RESULT_WAIT_MINUTES,
   missing_result_grace_days:MISSING_RESULT_GRACE_DAYS,
   production_calendar_policy:'Only successful league feeds from a calendar snapshot no older than 36 hours can create new forecasts or update kickoffs; settlement remains independent of calendar availability',
   immutable_forecasts:true,append_only_result_revisions:true,missing_statistics:'pending, never losses',
   note:'Forecasts use only the archived inputs available at capture. Results arrive with historical refreshes. Earlier historical backtests are not included. Baselines, code versions and inputs are frozen with each forecast.'}};
}
function advance({history,fixtures,forecasts=[],events=[],now=new Date(),sources={},versions=codeVersions(),capture=true}){
 const {latest}=validate(forecasts,events),today=sofiaDate(now),nowISO=now.toISOString();
 if(history.some(r=>M.isPlayed(r)&&r[3]>today))throw Error('Future scores in diary inputs');
 if(forecasts.some(f=>Date.parse(f.captured_at_utc)>+now)||events.some(e=>Date.parse(e.observed_at_utc)>+now))throw Error('Diary clock moved backwards');
 const source={history_sha256:sources.history_sha256||sha(canonical(history)),fixtures_sha256:sources.fixtures_sha256||sha(canonical(fixtures)),
  ...(sources.status_sha256?{status_sha256:sources.status_sha256,calendar_stamp_utc:sources.calendar_stamp_utc}: {})};
 const index=S.build(history),replay=D.createReplay(history),captured=new Set(forecasts.map(f=>fixtureKey(f.fixture))),newForecasts=[],newEvents=[];
 const knownResults=new Set(history.filter(r=>Number.isInteger(r[7])&&Number.isInteger(r[8])).map(S.keyFixture));
 const awardedResults=new Map(history.filter(r=>r[13]?.AWARDED===true).map(r=>[S.keyFixture(r),r]));
 const latestLeagueDate=new Map();for(const row of history)if(M.isPlayed(row)&&row[3]>(latestLeagueDate.get(row[0])||''))latestLeagueDate.set(row[0],row[3]);
 const scans=capture?P.runAll(index,fixtures,S,{days:HORIZON_DAYS,windowSize:10,minimum:5,streak:3,both:false,venue:false,now}):[];
 const scanMap=new Map(scans.map((entry,i)=>[S.keyFixture(entry.fixture),{...entry,position:i+1}]));
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+HORIZON_DAYS-1);const last=end.toISOString().slice(0,10);
 const skipped={already_recorded:0,already_played:0,unconfirmed_kickoff:0,too_late:0,international:0,insufficient_history:0};
 for(const f of (capture?fixtures:[]).slice().sort((a,b)=>String(a[3]+' '+a[4]).localeCompare(String(b[3]+' '+b[4]))||S.keyFixture(a).localeCompare(S.keyFixture(b)))){
  if(f[3]<today||f[3]>last)continue;
  const key=S.keyFixture(f);
  if(captured.has(key)){skipped.already_recorded++;continue;}
  if(knownResults.has(key)||M.isPlayed(f)){skipped.already_played++;continue;}
  if(INTERNATIONAL.has(f[0])){skipped.international++;continue;}
  const kickoff=confirmedKickoff(f);
  if(!kickoff){skipped.unconfirmed_kickoff++;continue;}
  if(Date.parse(kickoff)-+now<MARGIN_MINUTES*60000){skipped.too_late++;continue;}
  const context=replay.context(f),model=M.evaluateContext(f,context,'standard');
  if(model.error||!model.bases.count||!context.frequencies){skipped.insufficient_history++;continue;}
  const scan=scanMap.get(key),entry=seal({schema:1,id:sha(key),fixture_key:key,captured_at_utc:nowISO,kickoff_utc:kickoff,
   fixture:{div:f[0],country:f[1],league:f[2],date:f[3],time:f[4],home:f[5],away:f[6],source:f[13]},versions,inputs:source,
   model:{preset:'standard',window_size:30,settings:model.settings,lambda_home:model.lambdaHome,lambda_away:model.lambdaAway,
    probabilities:model.distribution.probs,baselines:{league_frequencies:dict(context.frequencies),league_goal_means:dict(D.probabilityVector(M.distribution(model.bases.home,model.bases.away,0).probs))},
    samples:{home:model.quality.homeN,away:model.quality.awayN,league:model.bases.count,xg:model.quality.coverage}},
   scanner:scan?{window_size:10,streak:3,venue:false,both:false,position:scan.position,candidate_count:scans.length,
    primary:signalSnapshot(scan.signal),signals:scan.signals.map(signalSnapshot)}:null});
  newForecasts.push(entry);captured.add(key);
 }
 const allForecasts=[...forecasts,...newForecasts],currentFixtures=new Map(fixtures.map(f=>[S.keyFixture(f),f]));
 for(const entry of allForecasts){
  const previous=latest.get(entry.id),old=previous?.state||initialState(entry),state={...old},key=fixtureKey(entry.fixture),actual=index.lookup.get(key);
  // lookup intentionally excludes awarded scores; inspect the raw same-key row too.
  const awarded=awardedResults.get(key);
  const changed=confirmedKickoff(currentFixtures.get(key)||[]);
  if(changed&&old.status!=='settled'&&old.reason!=='kickoff_revised_before_capture')state.kickoff_utc=changed;
  if(old.reason==='kickoff_revised_before_capture'||Date.parse(state.kickoff_utc)<=Date.parse(entry.captured_at_utc)){
   state.status='excluded';state.reason='kickoff_revised_before_capture';state.result=null;
  }else if(awarded){state.status='excluded';state.reason='administrative_result';state.result=null;}
  else if(actual&&+now>=Date.parse(state.kickoff_utc)+RESULT_WAIT_MINUTES*60000){
   const extra=actual[13]&&typeof actual[13]==='object'?actual[13]:{};
   state.status='settled';state.reason=null;state.result={score:actual.slice(7,9),stats:Object.fromEntries(STAT_FIELDS.filter(f=>Number.isInteger(extra[f])&&extra[f]>=0).map(f=>[f,extra[f]]))};
  }else if(!actual&&latestLeagueDate.has(entry.fixture.div)&&
   Date.parse(latestLeagueDate.get(entry.fixture.div))-Date.parse(entry.fixture.date)>=MISSING_RESULT_GRACE_DAYS*86400000){
   state.status='unmatched';state.reason='result_not_found_after_archive_advanced';state.result=null;
  }else if(old.status==='settled'||old.status==='unmatched'){
   state.status='unmatched';state.reason='previous_result_missing_or_unconfirmed';state.result=null;
  }else{state.status='pending';state.reason=null;state.result=null;}
  if(canonical(state)!==canonical(old))newEvents.push(seal({schema:1,forecast_id:entry.id,revision:(previous?.revision||0)+1,
   observed_at_utc:nowISO,history_sha256:source.history_sha256,state}));
 }
 const allEvents=[...events,...newEvents],run={new_forecasts:newForecasts.length,new_events:newEvents.length,skipped};
 return {newForecasts,newEvents,report:report(allForecasts,allEvents,now,run)};
}
function readLedger(directory=LEDGER){
 const read=kind=>{
  const folder=path.join(directory,kind);if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(n=>/^\d{4}-\d{2}\.jsonl$/.test(n)).sort().flatMap(name=>{
   const raw=fs.readFileSync(path.join(folder,name),'utf8');if(raw&&!raw.endsWith('\n'))throw Error('Diary file must end with a complete line');
   return raw.split('\n').filter(Boolean).map(line=>{const r=JSON.parse(line);if(kind==='forecasts'&&r.fixture.date.slice(0,7)!==name.slice(0,7))throw Error('Forecast in wrong monthly file');return r;});
  });
 };
 return {forecasts:read('forecasts'),events:read('events')};
}
function appendRecords(directory,kind,records,forecastMap){
 const grouped=new Map();
 for(const record of records){const month=(kind==='forecasts'?record.fixture:forecastMap.get(record.forecast_id).fixture).date.slice(0,7);if(!grouped.has(month))grouped.set(month,[]);grouped.get(month).push(record);}
 for(const [month,rows] of grouped){fs.mkdirSync(path.join(directory,kind),{recursive:true});fs.appendFileSync(path.join(directory,kind,month+'.jsonl'),rows.map(r=>JSON.stringify(r)+'\n').join(''));}
}
function checkPrefixes(baseRef,repositoryRoot=ROOT,roots=['docs/data/diary/forecasts','docs/data/diary/events']){
 const files=execFileSync('git',['ls-tree','-r','--name-only',baseRef,'--',...roots],{cwd:repositoryRoot,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 for(const file of files){
  if(!file.endsWith('.jsonl'))continue;
  const before=execFileSync('git',['show',baseRef+':'+file],{cwd:repositoryRoot,maxBuffer:100*1024*1024}),current=path.join(repositoryRoot,file);
  if(!fs.existsSync(current)||!fs.readFileSync(current).subarray(0,before.length).equals(before))throw Error('Published diary bytes were altered: '+file);
 }
 return files.length;
}
function main(){
 const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?null:args[i+1]},ledger=readLedger();
 validate(ledger.forecasts,ledger.events);
 if(value('--base-ref'))checkPrefixes(value('--base-ref'));
 if(args.includes('--check')){
  const file=path.join(DATA,'diary_report.json');
  if(ledger.forecasts.length&&!fs.existsSync(file))throw Error('Missing diary summary');
  if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file,'utf8'));if(r.integrity.ledger_sha256!==ledgerHash(ledger.forecasts,ledger.events))throw Error('Diary report does not match its ledger');}
  console.log(JSON.stringify({diary_forecasts:ledger.forecasts.length,events:ledger.events.length,append_only_check:'pass'}));return;
 }
 if(!args.includes('--write'))throw Error('Use --check or --write');
 const historyRaw=fs.readFileSync(path.join(DATA,'history.json'),'utf8'),fixturesRaw=fs.readFileSync(path.join(DATA,'fixtures.json'),'utf8');
 const statusRaw=fs.readFileSync(path.join(DATA,'status.json'),'utf8'),now=new Date(),calendar=calendarSnapshot(JSON.parse(statusRaw),JSON.parse(fixturesRaw),now);
 const result=advance({...ledger,now,history:JSON.parse(historyRaw),fixtures:calendar.fixtures,sources:{history_sha256:sha(historyRaw),fixtures_sha256:sha(fixturesRaw),status_sha256:sha(statusRaw),calendar_stamp_utc:calendar.stamp}});
 result.report.last_run.calendar={fresh:calendar.fresh,blocked_fixtures:calendar.blocked,stamp:calendar.stamp};
 appendRecords(LEDGER,'forecasts',result.newForecasts);
 const forecastMap=new Map([...ledger.forecasts,...result.newForecasts].map(f=>[f.id,f]));
 appendRecords(LEDGER,'events',result.newEvents,forecastMap);
 fs.writeFileSync(path.join(DATA,'diary_report.json'),JSON.stringify(result.report));
 console.log(JSON.stringify({...result.report.last_run,totals:result.report.totals,ledger_sha256:result.report.integrity.ledger_sha256}));
}
if(require.main===module)main();
module.exports={advance,report,validate,seal,sha,canonical,confirmedKickoff,calendarSnapshot,sofiaDate,readLedger,appendRecords,checkPrefixes,ledgerHash,MARGIN_MINUTES,HORIZON_DAYS,RESULT_WAIT_MINUTES};
