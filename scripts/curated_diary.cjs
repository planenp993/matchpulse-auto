/* Prospective v3 two-builder cards and model-odds column bands; v1/v2 stay frozen.
 * Existing model/scanner diaries and their published bytes are never rewritten.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const J=require('./forecast_diary.cjs'),S=require('../docs/scout-curated.js');
const C=require('../docs/scout-core.js'),M=require('../docs/model-core.js'),A=require('../docs/scout-archive.js');
const ROOT=path.resolve(__dirname,'..'),DATA=path.join(ROOT,'docs/data');
const RELATIVE='docs/data/diary/selections/'+S.VERSION,DIR=path.join(ROOT,RELATIVE);
const FILES=['docs/scout-curated.js','docs/scout-combinations.js','docs/scout-selections.js','docs/model-core.js','docs/scout-core.js','docs/club-aliases.js','docs/scout-archive.js','scripts/forecast_diary.cjs','scripts/curated_diary.cjs'];
const codeVersions=()=>Object.fromEntries(FILES.map(f=>[f,J.sha(fs.readFileSync(path.join(ROOT,f)))]));
const row=f=>[f.div,f.country,f.league,f.date,f.time,f.home,f.away,null,null,null,null,null,null,f.source];
function verify(record){const {sha256,...payload}=record;if(J.seal(payload).sha256!==sha256)throw Error('Selection record hash mismatch');}
function configFor(now=new Date(),files=codeVersions()){
 return J.seal({schema:1,id:S.VERSION,created_at_utc:now.toISOString(),files,rules:S.RULES,
  policy:{horizon_days:3,minimum_minutes_before_kickoff:J.MARGIN_MINUTES,first_capture_only:true,
   columns:'Only fixtures first captured together; one frozen cohort per capture',prices:'Saved exact fixture CSV observations only; no browser/manual prices',automatic_promotion:false}});
}
function validate(forecasts,events,config){
 verify(config);
 if(config.id!==S.VERSION||config.schema!==1||!Number.isFinite(Date.parse(config.created_at_utc))||config.policy?.automatic_promotion!==false)throw Error('Invalid selection registration');
 const result=J.validate(forecasts,events);
 for(const e of forecasts){
  const s=e.selection;
  if(s?.builders?.length>2)throw Error('More than two frozen builders');
  if(!s||s.version!==config.id||s.config_sha256!==config.sha256||Date.parse(e.captured_at_utc)<Date.parse(config.created_at_utc))throw Error('Invalid selection capture');
  for(const p of [s.main,...s.alternatives,...s.builders].filter(Boolean)){
   if(!Number.isFinite(p.probability)||p.probability<=0||p.probability>1||Math.abs(p.fair-1/p.probability)>1e-10||p.legs.some(id=>!S.MARKETS.some(m=>m.id===id)))throw Error('Invalid frozen selection');
  }
  for(const c of s.columns){
   if(c.odds_basis!=='model_fair'||S.bandFor(c.fair)?.id!==c.band||c.size<2||c.size>8)throw Error('Invalid frozen column band');
   if(c.legs.length!==c.size||new Set(c.legs.map(l=>l.forecast_id)).size!==c.size||Math.abs(c.probability-c.legs.reduce((p,l)=>p*l.probability,1))>1e-10)throw Error('Invalid frozen column');
   const members=c.legs.map(l=>result.ids.get(l.forecast_id));
   if(members.some(m=>!m||m.captured_at_utc!==e.captured_at_utc||m.fixture.date!==c.date)||new Set(members.flatMap(m=>[C.keyTeam(m.fixture.home),C.keyTeam(m.fixture.away)])).size!==2*c.size)throw Error('Column cohort identity mismatch');
  }
 }
 return result;
}
function pick(p){return p?{id:p.id,label:p.label,legs:p.legs||[p.id],probability:p.probability,fair:p.fair,rank:p.rank,evidence:p.evidence,quote:p.quote}:null;}
function won(p,score){return p.legs.every(id=>S.MARKETS.find(m=>m.id===id).test(...score));}
function report(forecasts,events,config,now=new Date(),lastRun={}){
 const {latest}=validate(forecasts,events,config);
 const totals={recorded:forecasts.length,main:0,abstained:0,settled:0,pending:0,excluded:0,unmatched:0};
 const groups=Object.fromEntries(['main','alternatives','builders','columns'].map(k=>[k,{recorded:0,settled:0,hits:0,pending:0,excluded:0,hit_rate:null}]));
 function count(group,p,state){
  const g=groups[group];g.recorded++;
  if(state.status==='settled'){g.settled++;g.hits+=+won(p,state.result.score);}
  else if(state.status==='pending')g.pending++;else g.excluded++;
 }
 const stateFor=e=>latest.get(e.id)?.state||{status:'pending',result:null};
 const entries=[];
 for(const e of forecasts){
  const s=e.selection,state=stateFor(e);totals[state.status]++;totals[s.main?'main':'abstained']++;
  if(s.main)count('main',s.main,state);
  for(const p of s.alternatives)count('alternatives',p,state);
  for(const p of s.builders)count('builders',p,state);
  for(const c of s.columns){
   const g=groups.columns;g.recorded++;
   const states=c.legs.map(l=>stateFor(forecasts.find(f=>f.id===l.forecast_id)));
   if(states.some(s=>['excluded','unmatched'].includes(s.status)))g.excluded++;
   else if(states.every(s=>s.status==='settled')){g.settled++;g.hits+=+c.legs.every((l,i)=>won(l,states[i].result.score));}
   else g.pending++;
  }
  entries.push({fixture:e.fixture,captured_at_utc:e.captured_at_utc,status:state.status,main:s.main?.label||null,reason:s.reason});
 }
 for(const g of Object.values(groups))g.hit_rate=g.settled?g.hits/g.settled:null;
 return {schema:1,version:config.id,registered_at_utc:config.created_at_utc,checked_at_utc:now.toISOString(),config_sha256:config.sha256,
  totals,groups,entries:entries.sort((a,b)=>b.fixture.date.localeCompare(a.fixture.date)).slice(0,80),last_run:lastRun,
  integrity:{ledger_sha256:J.ledgerHash(forecasts,events)},method:{prospective_only:true,first_capture_only:true,manual_prices_included:false,original_diary_records_included:false,ranking_is_not_probability:true,automatic_promotion:false}};
}
function advance({history,fixtures,forecasts=[],events=[],config,now=new Date(),matchLinks={},europe=[],europeNames={},quotes={},sources={},files=codeVersions()}){
 validate(forecasts,events,config);
 if(+now<Date.parse(config.created_at_utc))throw Error('Selection capture predates registration');
 const active=J.canonical(files)===J.canonical(config.files);
 const base=J.advance({history,fixtures,forecasts,events,now,matchLinks,sources,capture:active});
 const archive=A.build(C,history,europe,{matches:matchLinks},europeNames),engine=S.createEngine(history,M,C),evaluations=[];
 for(const e of base.newForecasts){
  const f=row(e.fixture),profile=archive.profile(f,{windowSize:10}),recent=archive.recentProfile(f,{windowSize:10,now});
  const selection=engine.evaluate(f,{profile,now,quotes:quotes[e.fixture_key]||{},pending:!!(recent.home.pendingLatest||recent.away.pendingLatest)});
  evaluations.push(selection);
 }
 const columns=S.columns(evaluations,C),firstByDay=new Map();
 const newForecasts=base.newForecasts.map((e,i)=>{
  const s=evaluations[i],first=!firstByDay.has(e.fixture.date);firstByDay.set(e.fixture.date,true);
  const frozen=first?columns.filter(c=>c.date===e.fixture.date).map(c=>({date:c.date,size:c.size,band:c.band,odds_basis:c.oddsBasis,probability:c.probability,fair:c.fair,assumption:c.assumption,
   legs:c.legs.map(l=>({forecast_id:J.sha(l.key),id:l.pick.id,legs:[l.pick.id],probability:l.pick.probability}))})):[];
  const {sha256,...payload}=e;
  return J.seal({...payload,selection:{version:config.id,config_sha256:config.sha256,reason:s.reason,main:pick(s.main),alternatives:s.alternatives.map(pick),builders:s.builders.map(pick),columns:frozen}});
 });
 const all=[...forecasts,...newForecasts],allEvents=[...events,...base.newEvents];
 return {newForecasts,newEvents:base.newEvents,report:report(all,allEvents,config,now,{...base.report.last_run,capture_paused:!active})};
}
function checkPrefixes(baseRef,root=ROOT){
 J.checkPrefixes(baseRef,root,[RELATIVE]);
 const file=RELATIVE+'/config.json',exists=execFileSync('git',['ls-tree','--name-only',baseRef,'--',file],{cwd:root,encoding:'utf8'}).trim();
 if(exists&&!execFileSync('git',['show',baseRef+':'+file],{cwd:root}).equals(fs.readFileSync(path.join(root,file))))throw Error('Published selection config changed');
}
function main(){
 const args=process.argv.slice(2),configPath=path.join(DIR,'config.json'),reportPath=path.join(DATA,'curated_diary_report.json');
 if(args.includes('--init')){
  if(fs.existsSync(configPath))throw Error('Selection registration already exists');
  const config=configFor();fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(configPath,JSON.stringify(config));
  fs.writeFileSync(reportPath,JSON.stringify(report([],[],config)));console.log('Registered '+config.id);return;
 }
 const config=JSON.parse(fs.readFileSync(configPath,'utf8')),ledger=J.readLedger(DIR);
 validate(ledger.forecasts,ledger.events,config);
 const i=args.indexOf('--base-ref');if(i>=0)checkPrefixes(args[i+1]);
 if(args.includes('--check')){
  const saved=JSON.parse(fs.readFileSync(reportPath,'utf8')),expected=report(ledger.forecasts,ledger.events,config,new Date(saved.checked_at_utc),saved.last_run);
  if(J.canonical(saved)!==J.canonical(expected))throw Error('Selection report differs from frozen records');
  console.log(JSON.stringify({selection_forecasts:ledger.forecasts.length,events:ledger.events.length,append_only_check:'pass'}));return;
 }
 if(!args.includes('--write'))throw Error('Use --init, --write or --check');
 const read=name=>JSON.parse(fs.readFileSync(path.join(DATA,name+'.json'),'utf8')),now=new Date(),history=read('history'),fixtures=read('fixtures'),status=read('status');
 const calendar=J.calendarSnapshot(status,fixtures,now);
 const result=advance({...ledger,config,now,history,fixtures:calendar.fixtures,matchLinks:J.readMatchLinks(),europe:read('europe_history'),europeNames:read('europe_fixture_names'),quotes:read('selection_quotes').fixtures,
  sources:{history_sha256:J.sha(fs.readFileSync(path.join(DATA,'history.json'))),fixtures_sha256:J.sha(fs.readFileSync(path.join(DATA,'fixtures.json'))),status_sha256:J.sha(fs.readFileSync(path.join(DATA,'status.json'))),calendar_stamp_utc:calendar.stamp}});
 result.report.last_run.calendar={fresh:calendar.fresh,blocked_fixtures:calendar.blocked,stamp:calendar.stamp};
 J.appendRecords(DIR,'forecasts',result.newForecasts);
 J.appendRecords(DIR,'events',result.newEvents,new Map([...ledger.forecasts,...result.newForecasts].map(e=>[e.id,e])));
 fs.writeFileSync(reportPath,JSON.stringify(result.report));console.log(JSON.stringify({...result.report.last_run,totals:result.report.totals}));
}
if(require.main===module)main();
module.exports={RELATIVE,configFor,validate,advance,report,won,checkPrefixes};
