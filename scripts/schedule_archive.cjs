/* Read-only calendar view of saved schedules and sealed pre-match forecasts. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const J=require('./forecast_diary.cjs'),C=require('../docs/scout-core.js');
const ROOT=path.resolve(__dirname,'..'),OUTPUT='docs/data/schedule_archive.json',DAYS=30;
const VERSIONS=[['model-v1','docs/data/diary'],['selections-v1','docs/data/diary/selections/selections-v1'],
 ['match-plans-v2','docs/data/diary/selections/match-plans-v2'],['match-plans-v3','docs/data/diary/selections/match-plans-v3']];
const row=f=>[f.div,f.country,f.league,f.date,f.time,f.home,f.away,null,null,null,null,null,null,f.source];
function build({registry,ledgers,now=new Date()}){
 const end=J.sofiaDate(now),startDate=new Date(end+'T12:00:00Z');startDate.setUTCDate(startDate.getUTCDate()-DAYS);
 const start=startDate.toISOString().slice(0,10),entries=new Map(),inRange=f=>f[3]>=start&&f[3]<=end;
 for(const m of Object.values(registry.matches)){
  if(!Array.isArray(m.schedule)||!inRange(m.schedule))continue;
  const f=[...m.schedule.slice(0,7),null,null,null,null,null,null,m.kickoff_utc?'Saved calendar / Europe-Sofia':'Saved calendar / unconfirmed timezone'];
  const key=C.keyFixture(f),validScore=['final','final_awaiting_stats'].includes(m.state)&&(!m.actual_date||m.actual_date===f[3])&&Array.isArray(m.result)&&m.result.length===2&&m.result.every(x=>Number.isInteger(x)&&x>=0);
  entries.set(key,{key,fixture:f,match_id:m.id,kickoff_utc:m.kickoff_utc||null,state:m.state,score:validScore?m.result:null,forecast:null});
 }
 // A later registered version wins explicitly; a failed/absent main choice is
 // still a real frozen abstention, never a reason to substitute an older pick.
 for(const {version,forecasts,events} of ledgers){
  const {latest}=J.validate(forecasts,events);
  for(const e of forecasts){
   const f=row(e.fixture);if(!inRange(f))continue;
   const key=C.keyFixture(f),state=latest.get(e.id)?.state;
   const item=entries.get(key)||{key,fixture:f,match_id:null,kickoff_utc:e.kickoff_utc,state:'awaiting_result',score:null,forecast:null};
   if(state?.status==='settled'){item.score=state.result.score;item.state='final';}
   else if(state&&['excluded','unmatched'].includes(state.status))item.state=state.status;
   if(state&&Date.parse(state.kickoff_utc)!==Date.parse(e.kickoff_utc)){
    item.current_kickoff_utc=state.kickoff_utc;if(!item.score)item.state='rescheduled';
   }
   item.forecast={id:e.id,version,captured_at_utc:e.captured_at_utc,kickoff_utc:e.kickoff_utc,record_sha256:e.sha256,
    model:{lambda_home:e.model.lambda_home,lambda_away:e.model.lambda_away,probabilities:e.model.probabilities},
    selection:e.selection?{reason:e.selection.reason,main:e.selection.main,alternatives:e.selection.alternatives,builders:e.selection.builders}:null};
   entries.set(key,item);
  }
 }
 return {schema:1,as_of_utc:now.toISOString(),start_date:start,end_date:end,retention_days:DAYS,
  method:{saved_forecasts_only:true,retrospective_predictions:false,missing_result_is_not_cancellation:true},
  entries:[...entries.values()].sort((a,b)=>a.fixture[3].localeCompare(b.fixture[3])||String(a.fixture[4]).localeCompare(String(b.fixture[4]))||a.key.localeCompare(b.key))};
}
function run(){
 const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8')),file=path.join(ROOT,OUTPUT),check=process.argv.includes('--check');
 const saved=check?read(OUTPUT):null;
 const ledgers=VERSIONS.map(([version,p])=>({version,...J.readLedger(path.join(ROOT,p))}));
 const expected=build({registry:read('data/match_registry.json'),ledgers,now:saved?new Date(saved.as_of_utc):new Date()});
 if(check){if(J.canonical(saved)!==J.canonical(expected))throw Error('Schedule archive differs from saved schedules/forecasts');}
 else fs.writeFileSync(file,JSON.stringify(expected)+'\n');
 console.log(JSON.stringify({schedule_archive:expected.entries.length,forecasts:expected.entries.filter(x=>x.forecast).length,start:expected.start_date,end:expected.end_date,check}));
}
if(require.main===module)run();
module.exports={build,VERSIONS,DAYS};
