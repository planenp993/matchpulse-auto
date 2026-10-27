'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const J=require('../scripts/forecast_diary.cjs'),M=require('../docs/model-core.js');
const NOW=new Date('2026-10-26T08:00:00Z'),versions={model:'test-model',scanner:'test-scanner',recorder:'test-recorder'};
const before=n=>new Date(+NOW-n*86400000).toISOString().slice(0,10);
const stats={HC:6,AC:5,HY:3,AY:2,HS:14,AS:13,HST:5,AST:5,HTHG:1,HTAG:0};
const row=(date,h='Alpha',a='Beta',hg=3,ag=1,extra=stats)=>['E0','England','Test league',date,'18:00',h,a,hg,ag,null,null,null,null,extra];
const fixture=(date='2026-10-26',h='Alpha',a='Beta',clock='18:00',source='FixtureDownload / UTC→Europe-Sofia')=>{
 const r=row(date,h,a,null,null);r[4]=clock;r[13]=source;return r;
};
function history(home='Alpha',away='Beta'){
 const rows=[];
 for(let i=1;i<=20;i++){
  rows.push(row('2026-10-'+String(i).padStart(2,'0'),home,'Home rival '+i));
  rows.push(row('2026-10-'+String(i).padStart(2,'0'),'Away rival '+i,away));
 }
 for(let i=0;i<80;i++)rows.push(row(before(90+i),'League home '+i,'League away '+i,3,1,{HC:2,AC:2,HY:1,AY:1,HS:8,AS:8,HST:1,AST:1,HTHG:1,HTAG:0}));
 return rows;
}
const capture=(options={})=>J.advance({history:history(),fixtures:[fixture()],now:NOW,versions,...options});
function settle(first,{score=[3,1],extra=stats,now=new Date('2026-10-27T08:00:00Z'),events=[]}={}){
 return capture({history:[...history(),row('2026-10-26','Alpha','Beta',...score,extra)],fixtures:[],forecasts:first.newForecasts,events,now});
}
test('Confirmed clocks convert with actual Sofia DST and refuse ambiguous or nonexistent times',()=>{
 assert.equal(J.confirmedKickoff(fixture()),'2026-10-26T16:00:00.000Z');
 assert.equal(J.confirmedKickoff(fixture('2026-07-01')),'2026-07-01T15:00:00.000Z');
 assert.equal(J.confirmedKickoff(fixture('2026-03-29','Alpha','Beta','03:30')),null);
 assert.equal(J.confirmedKickoff(fixture('2026-10-25','Alpha','Beta','03:30')),null);
 assert.equal(J.confirmedKickoff(fixture('2026-03-29','Alpha','Beta','04:30')),'2026-03-29T01:30:00.000Z');
 assert.equal(J.confirmedKickoff(fixture('2026-10-26','Alpha','Beta','','FixtureDownload / UTC→Europe-Sofia')),null);
 assert.equal(J.confirmedKickoff(fixture('2026-10-26','Alpha','Beta','18:00','unknown timezone')),null);
});
test('A real pre-match capture freezes the browser engine, baselines, selected scanner signal and provenance',()=>{
 const r=capture(),entry=r.newForecasts[0],actual=M.evaluate(history(),fixture());
 assert.equal(r.newForecasts.length,1);assert.equal(r.newEvents.length,0);
 assert.deepEqual(entry.model.probabilities,actual.distribution.probs);
 assert.equal(entry.model.lambda_home,actual.lambdaHome);assert.equal(entry.model.window_size,30);
 assert.equal(entry.scanner.window_size,10);assert.equal(entry.scanner.primary.market,'corners85');
 assert.equal(entry.scanner.primary.market,entry.scanner.signals[0].market);
 assert.equal(entry.captured_at_utc,NOW.toISOString());assert.equal(entry.inputs.history_sha256.length,64);
 assert.equal(r.report.totals.pending,1);assert.equal(r.report.totals.settled,0);
 assert.equal(r.report.markets.over25.n,0);assert.equal(r.report.markets.over25.brier,null);assert.equal(r.report.scanner.hit_rate,null);
});
test('Started, near-start and already-known final or awarded fixtures are never backfilled',()=>{
 for(const clock of ['09:00','10:29'])assert.equal(capture({fixtures:[fixture('2026-10-26','Alpha','Beta',clock)]}).newForecasts.length,0);
 assert.equal(capture({fixtures:[fixture('2026-10-26','Alpha','Beta','10:30')]}).newForecasts.length,1);
 assert.equal(capture({history:[...history(),row('2026-10-26')]}).newForecasts.length,0);
 assert.equal(capture({history:[...history(),row('2026-10-26','Alpha','Beta',3,0,{AWARDED:true})]}).newForecasts.length,0);
});
test('The capture horizon follows Sofia midnight and excludes unsupported fixtures',()=>{
 const eu=fixture();eu[0]='UCL';
 const r=capture({fixtures:[fixture('2026-10-25'),fixture('2026-10-28'),fixture('2026-10-29'),eu,fixture('2026-10-27','Unknown','Other'),fixture('2026-10-27','Alpha','Beta','')]});
 assert.equal(r.newForecasts.length,1);assert.equal(r.newForecasts[0].fixture.date,'2026-10-28');
 assert.equal(r.report.last_run.skipped.international,1);assert.equal(r.report.last_run.skipped.unconfirmed_kickoff,1);assert.equal(r.report.last_run.skipped.insufficient_history,1);
 const midnight=capture({now:new Date('2026-10-26T22:30:00Z'),fixtures:[fixture('2026-10-26'),fixture('2026-10-27')]});
 assert.equal(midnight.newForecasts.length,1);assert.equal(midnight.newForecasts[0].fixture.date,'2026-10-27');
});
test('Future scores are rejected and a backwards clock cannot change the diary',()=>{
 assert.throws(()=>capture({history:[...history(),row('2026-10-27')]}),/Future scores/);
 const first=capture();
 assert.throws(()=>capture({forecasts:first.newForecasts,now:new Date('2026-10-26T07:59:00Z')}),/clock moved backwards/);
});
test('Repeated capture and a later model version never rewrite the first snapshot',()=>{
 const first=capture(),original=JSON.stringify(first.newForecasts),updated=history();updated[0][7]=9;
 const second=capture({forecasts:first.newForecasts,history:updated,versions:{...versions,model:'next-model'},now:new Date('2026-10-26T09:00:00Z')});
 assert.equal(second.newForecasts.length,0);assert.equal(second.newEvents.length,0);
 assert.equal(JSON.stringify(first.newForecasts),original);assert.deepEqual(second.report.recent[0].probabilities,first.newForecasts[0].model.probabilities);
});
test('Reviewed aliases and duplicate fixture sources cannot create a second snapshot',()=>{
 const original=fixture('2026-10-26','Manchester United','Chelsea');
 const first=capture({history:history('Manchester United','Chelsea'),fixtures:[original,fixture('2026-10-26','Man Utd','Chelsea')]});
 assert.equal(first.newForecasts.length,1);
 const second=capture({history:history('Manchester United','Chelsea'),fixtures:[fixture('2026-10-26','Man Utd','Chelsea')],forecasts:first.newForecasts});
 assert.equal(second.newForecasts.length,0);assert.equal(second.report.totals.recorded,1);
});
test('Only a later final score settles the original saved probabilities and selected scanner market',()=>{
 const first=capture(),settled=settle(first),entry=first.newForecasts[0];
 assert.equal(settled.newEvents.length,1);assert.equal(settled.newEvents[0].state.status,'settled');
 assert.equal(settled.report.totals.settled,1);assert.equal(settled.report.markets.over25.n,1);
 const expected=(1-entry.model.probabilities.over25)**2;
 assert.ok(Math.abs(settled.report.markets.over25.brier-expected)<.000001);
 assert.equal(settled.report.scanner.settled,1);assert.equal(settled.report.scanner.hits,1);
 assert.equal(settled.report.recent[0].scanner.market,entry.scanner.primary.market);
 const repeat=settle(first,{events:settled.newEvents,now:new Date('2026-10-28T08:00:00Z')});
 assert.equal(repeat.newEvents.length,0);
});
test('Missing final-match statistics remain pending rather than losses',()=>{
 const first=capture(),settled=settle(first,{extra:{}});
 assert.equal(settled.report.totals.settled,1);assert.equal(settled.report.markets.over25.n,1);
 assert.equal(settled.report.scanner.settled,0);assert.equal(settled.report.scanner.pending_stats,1);
 assert.equal(settled.report.scanner.hit_rate,null);assert.equal(settled.report.recent[0].scanner.result,null);
 const enriched=settle(first,{events:settled.newEvents,now:new Date('2026-10-28T08:00:00Z')});
 assert.equal(enriched.newEvents.length,1);assert.equal(enriched.report.scanner.hits,1);assert.equal(enriched.newEvents[0].revision,2);
});
test('Corrected scores append a revision without editing either the forecast or earlier outcome',()=>{
 const first=capture(),one=settle(first),before=JSON.stringify([first.newForecasts,one.newEvents]);
 const two=settle(first,{score:[0,0],events:one.newEvents,now:new Date('2026-10-28T08:00:00Z')});
 assert.equal(two.newEvents[0].revision,2);assert.deepEqual(two.newEvents[0].state.result.score,[0,0]);
 assert.equal(two.report.totals.settled,1);assert.equal(two.report.markets.over25.actual_rate,0);
 assert.equal(JSON.stringify([first.newForecasts,one.newEvents]),before);
});
test('Awarded results and missing previously-settled rows are excluded from measured performance',()=>{
 const first=capture(),awarded=settle(first,{extra:{AWARDED:true}});
 assert.equal(awarded.report.totals.excluded,1);assert.equal(awarded.report.markets.over25.n,0);assert.equal(awarded.report.scanner.excluded,1);
 const settled=settle(first),missing=capture({fixtures:[],forecasts:first.newForecasts,events:settled.newEvents,now:new Date('2026-10-28T08:00:00Z')});
 assert.equal(missing.report.totals.unmatched,1);assert.equal(missing.report.markets.over25.n,0);
});
test('Schedule changes are separate events and a kickoff revised before capture excludes the snapshot',()=>{
 const first=capture(),shift=capture({forecasts:first.newForecasts,fixtures:[fixture('2026-10-26','Alpha','Beta','20:00')],now:new Date('2026-10-26T09:00:00Z')});
 assert.equal(shift.newEvents[0].state.status,'pending');assert.equal(shift.newEvents[0].state.kickoff_utc,'2026-10-26T18:00:00.000Z');
 assert.equal(first.newForecasts[0].kickoff_utc,'2026-10-26T16:00:00.000Z');
 const earlier=capture({forecasts:first.newForecasts,fixtures:[fixture('2026-10-26','Alpha','Beta','09:30')],now:new Date('2026-10-26T09:00:00Z')});
 assert.equal(earlier.report.totals.excluded,1);
 const again=capture({forecasts:first.newForecasts,events:earlier.newEvents,now:new Date('2026-10-26T10:00:00Z')});
 assert.equal(again.report.totals.excluded,1);assert.equal(again.newEvents.length,0);
});
test('An early or live score cannot settle before the finish-time guard',()=>{
 const first=capture(),early=settle(first,{now:new Date('2026-10-26T17:00:00Z')});
 assert.equal(early.newEvents.length,0);assert.equal(early.report.totals.pending,1);
 const done=settle(first,{now:new Date('2026-10-26T19:00:00Z')});assert.equal(done.report.totals.settled,1);
});
test('A postponed date is not guessed to match and a missing result can later resolve',()=>{
 const first=capture(),laterHistory=[...history(),row('2026-11-04','Other home','Other away')];
 const waiting=capture({history:laterHistory,fixtures:[],forecasts:first.newForecasts,now:new Date('2026-11-05T08:00:00Z')});
 assert.equal(waiting.report.totals.unmatched,1);assert.equal(waiting.report.markets.over25.n,0);
 const resolved=settle(first,{events:waiting.newEvents,now:new Date('2026-11-06T08:00:00Z')});
 assert.equal(resolved.report.totals.settled,1);assert.equal(resolved.newEvents[0].revision,2);
});
test('Hashes and event sequences reject tampering or orphaned revisions',()=>{
 const first=capture(),bad=JSON.parse(JSON.stringify(first.newForecasts));bad[0].model.probabilities.over25=.99;
 assert.throws(()=>J.validate(bad,[]),/hash mismatch/);
 const settled=settle(first),event=settled.newEvents[0],{sha256,...payload}=event;
 assert.throws(()=>J.validate(first.newForecasts,[J.seal({...payload,revision:2})]),/event sequence/);
 assert.throws(()=>J.validate([],[event]),/event sequence/);
});
test('Monthly files preserve published bytes and persist separate outcome revisions',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mp-diary-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const first=capture(),next=capture({fixtures:[fixture('2026-10-27')]});
 J.appendRecords(temp,'forecasts',first.newForecasts);
 const file=path.join(temp,'forecasts/2026-10.jsonl'),before=fs.readFileSync(file);
 J.appendRecords(temp,'forecasts',next.newForecasts);
 assert.ok(fs.readFileSync(file).subarray(0,before.length).equals(before));
 const settled=settle(first),owners=new Map(first.newForecasts.map(f=>[f.id,f]));J.appendRecords(temp,'events',settled.newEvents,owners);
 const read=J.readLedger(temp);assert.equal(read.forecasts.length,2);assert.equal(read.events.length,1);J.validate(read.forecasts,read.events);
});
test('The Git guard permits appends and rejects edits or deletion of published bytes',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mp-diary-git-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:temp,stdio:'pipe'});
 git(['init','-q']);const folder=path.join(temp,'docs/data/diary/forecasts');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'2026-10.jsonl');fs.writeFileSync(file,'original\n');git(['add','.']);git(['-c','user.name=Diary test','-c','user.email=test@example.invalid','commit','-qm','baseline']);
 fs.appendFileSync(file,'next\n');assert.equal(J.checkPrefixes('HEAD',temp),1);
 fs.writeFileSync(file,'edited\nnext\n');assert.throws(()=>J.checkPrefixes('HEAD',temp),/Published diary bytes/);
 fs.unlinkSync(file);assert.throws(()=>J.checkPrefixes('HEAD',temp),/Published diary bytes/);
});
test('Retrying from a newer committed ledger preserves both writers and adds no duplicate forecasts',()=>{
 const a=capture(),b=capture({fixtures:[fixture('2026-10-27')]}),forecasts=[...a.newForecasts,...b.newForecasts];
 const bytes=JSON.stringify(forecasts),retry=capture({forecasts,fixtures:[fixture(),fixture('2026-10-27')],now:new Date('2026-10-26T09:00:00Z')});
 assert.equal(retry.newForecasts.length,0);assert.equal(retry.report.totals.recorded,2);assert.equal(JSON.stringify(forecasts),bytes);
});
test('A month boundary stores forecasts and their later outcomes in the fixture month',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mp-diary-month-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const first=capture({now:new Date('2026-10-31T08:00:00Z'),fixtures:[fixture('2026-11-01')]});
 J.appendRecords(temp,'forecasts',first.newForecasts);
 assert.ok(fs.existsSync(path.join(temp,'forecasts/2026-11.jsonl')));
 const next=capture({now:new Date('2026-11-02T08:00:00Z'),fixtures:[],forecasts:first.newForecasts,history:[...history(),row('2026-11-01')]});
 J.appendRecords(temp,'events',next.newEvents,new Map(first.newForecasts.map(f=>[f.id,f])));
 assert.ok(fs.existsSync(path.join(temp,'events/2026-11.jsonl')));assert.equal(J.readLedger(temp).events.length,1);
});
test('Capture accepts only recently successful league calendars and blocks cached failed leagues',()=>{
 const a=fixture(),b=fixture();b[0]='D1';const c=fixture();c[0]='T1';
 const status={fixtures_updated_utc:NOW.toISOString(),fixtures_feed_status:'partial_secondary',secondary_fixture_counts:{E0:1,D1:1},stale_secondary_leagues:['D1']};
 const selected=J.calendarSnapshot(status,[a,b,c],NOW);
 assert.deepEqual(selected.fixtures,[a]);assert.equal(selected.blocked,2);assert.equal(selected.fresh,true);
});
test('Missing, future, old or failed calendar snapshots cannot add prospective forecasts',()=>{
 const status={fixtures_updated_utc:NOW.toISOString(),fixtures_feed_status:'ok_secondary',secondary_fixture_counts:{E0:1}};
 for(const change of [{fixtures_updated_utc:undefined},{fixtures_updated_utc:'2026-10-24T08:00:00Z'},{fixtures_updated_utc:'2026-10-27T08:00:00Z'},{fixtures_feed_status:'stale_secondary'}])
  assert.equal(J.calendarSnapshot({...status,...change},[fixture()],NOW).fixtures.length,0);
});
test('An unavailable calendar still allows existing forecasts to settle from new history',()=>{
 const first=capture(),now=new Date('2026-10-27T08:00:00Z'),calendar=J.calendarSnapshot({},[fixture()],now);
 const result=capture({now,forecasts:first.newForecasts,fixtures:calendar.fixtures,history:[...history(),row('2026-10-26')]});
 assert.equal(result.newForecasts.length,0);assert.equal(result.report.totals.settled,1);
});
test('A postponed match keeps one frozen forecast and settles against its verified new date',()=>{
 const S=require('../docs/scout-core.js'),old=fixture(),revised=fixture('2026-11-02'),oldKey=S.keyFixture(old),newKey=S.keyFixture(revised);
 const link={id:'stable-match',current_key:newKey,result_key:null,kickoff_utc:J.confirmedKickoff(revised),state:'scheduled'};
 const first=capture(),saved=JSON.stringify(first.newForecasts),matchLinks={[oldKey]:link,[newKey]:link};
 const before=J.advance({history:history(),fixtures:[revised],forecasts:first.newForecasts,now:new Date('2026-11-01T08:00:00Z'),matchLinks});
 assert.equal(before.newForecasts.length,0);assert.equal(before.report.totals.pending,1);
 assert.equal(before.newEvents[0].state.kickoff_utc,J.confirmedKickoff(revised));
 link.result_key=newKey;link.state='final';
 const after=J.advance({history:[...history(),row('2026-11-02')],fixtures:[],forecasts:first.newForecasts,events:before.newEvents,now:new Date('2026-11-03T08:00:00Z'),matchLinks});
 assert.equal(after.report.totals.settled,1);assert.equal(after.newEvents[0].state.result.actual_date,'2026-11-02');
 assert.equal(after.newEvents[0].state.result.fixture_key,newKey);assert.equal(JSON.stringify(first.newForecasts),saved);
 assert.throws(()=>J.advance({history:history(),fixtures:[],forecasts:first.newForecasts,now:new Date('2026-11-03T08:00:00Z'),matchLinks:{[oldKey]:{...link,result_key:'D1|2026-11-02|alpha|beta'}}}),/changes fixture identity/);
});
