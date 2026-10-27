'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../docs/scout-core.js'),A=require('../docs/scout-archive.js');
const row=(div,date,h='Home',a='Away',hg=2,ag=1)=>[div,'Country','League',date,'18:00',h,a,hg,ag,null,null,null,null,{}];
test('UEFA archive cannot enter domestic profiles or scanner index',()=>{
 const domestic=[row('E0','2026-10-20')],europe=[row('UCL','2026-10-21','Home','Away',8,8)],before=JSON.stringify(domestic);
 const archive=A.build(S,domestic,europe),fixture=row('E0','2026-10-28',undefined,undefined,null,null);
 assert.deepEqual(archive.profile(fixture,{windowSize:10}),S.profile(S.build(domestic),fixture,{windowSize:10}));
 assert.equal(archive.main.history.length,1);assert.equal(JSON.stringify(domestic),before);
});
test('European dossier uses its own 90-minute history before fixture date and retains qualification phase',()=>{
 const one=row('UCL','2026-07-20');one[13]={PHASE:'QUALIFYING',AFTER_PLAY:[3,1],PENALTIES:[5,4]};
 const current=row('UCL','2026-10-28'),future=row('UCL','2026-11-01');
 const archive=A.build(S,[row('E0','2026-10-20')],[one,current,future]);
 const p=archive.profile(row('UCL','2026-10-28'),{windowSize:10});
 assert.equal(p.home.proxy,false);assert.equal(p.home.all.length,1);assert.equal(p.home.overall.gf,2);
 assert.equal(p.home.all[0][13].PHASE,'QUALIFYING');assert.equal(p.international,true);
});
test('Exact official fixture name crosswalk joins a differently labelled club without changing saved fixture',()=>{
 const fixture=row('UCL','2026-10-28','Leipzig','Away',null,null),before=JSON.stringify(fixture);
 const names={[S.keyFixture(fixture)]:{home:'RB Leipzig',away:'Away',provider_id:'UEFA:1'}};
 const archive=A.build(S,[],[row('UCL','2026-10-21','RB Leipzig')],{},names),p=archive.profile(fixture,{windowSize:5});
 assert.equal(p.home.overall.n,1);assert.equal(p.home.name,'RB Leipzig');assert.equal(JSON.stringify(fixture),before);
 assert.equal(archive.direct(fixture).home,'RB Leipzig');
});
test('Saved European pick settles from regulation score through a reviewed legacy result link',()=>{
 const final=row('UCL','2026-10-25','Canonical Home','Away',2,1);final[13]={AFTER_PLAY:[3,1]};
 const pick={div:'UCL',date:'2026-10-24',home:'Home',away:'Away',market:'o25'};
 const links={matches:{[S.keyPick(pick)]:{state:'final',result_key:S.keyFixture(final)}}};
 const archive=A.build(S,[],[final],links);assert.deepEqual(archive.result(pick).slice(7,9),[2,1]);
 links.matches[S.keyPick(pick)].state='conflict';assert.equal(archive.result(pick),null);
 links.matches[S.keyPick(pick)].state='awarded';assert.equal(archive.result(pick),null);
});
test('UEFA history remains descriptive and cannot qualify the domestic trend scanner',()=>{
 const history=Array.from({length:10},(_,i)=>row('UCL','2026-10-'+String(i+1).padStart(2,'0')));
 const archive=A.build(S,[],history),p=archive.profile(row('UCL','2026-10-28'),{windowSize:10});
 assert.equal(p.home.overall.n,10);assert.equal(S.trend(p,'o25',5).qualified,false);
});
test('Recent descriptive form merges league and UEFA matches in date order while the original profile stays isolated',()=>{
 const domestic=[row('E0','2026-10-25'),row('E0','2026-10-18')],europe=[row('UEL','2026-10-22','Home','Away',0,3)];
 const archive=A.build(S,domestic,europe),f=row('E0','2026-10-28',undefined,undefined,null,null),before=JSON.stringify([domestic,europe]);
 const recent=archive.recentProfile(f,{windowSize:5,now:new Date('2026-10-27T20:00:00Z')});
 assert.deepEqual(recent.home.all.map(r=>r[0]),['E0','UEL','E0']);assert.equal(recent.home.overall.n,3);
 assert.deepEqual(archive.profile(f,{windowSize:5}).home.all.map(r=>r[0]),['E0','E0']);assert.equal(archive.main.history.length,2);
 assert.equal(JSON.stringify([domestic,europe]),before);
});
test('Recent form shares canonical club aliases, rejects same-day scores and keeps actual venue cohorts',()=>{
 const domestic=[row('I1','2026-10-25','Udinese','Milan'),row('I1','2026-10-18','Milan','Inter')];domestic.forEach(r=>r[1]='Italy');
 const archive=A.build(S,domestic,[row('UEL','2026-10-22','AC Milan','Benfica',0,2),row('UEL','2026-10-28','AC Milan','Benfica',9,0)]);
 const f=row('I1','2026-10-28','Milan','Inter',null,null);f[1]='Italy';
 const recent=archive.recentProfile(f,{windowSize:5});assert.equal(recent.home.all.length,3);assert.equal(recent.home.all[1][5],'AC Milan');
 assert.deepEqual(recent.home.venue.map(r=>r[0]),['UEL','I1']);assert.ok(recent.home.all.every(r=>r[3]<f[3]));
});
test('Ambiguous same-name clubs in different countries cannot contaminate recent form',()=>{
 const one=row('E0','2026-10-25'),other=row('F1','2026-10-26');one[1]='England';other[1]='France';
 const f=row('E0','2026-10-28');f[1]='England';
 const recent=A.build(S,[one,other],[row('UEL','2026-10-27')]).recentProfile(f,{windowSize:5});
 assert.equal(recent.home.proxy,true);assert.deepEqual(recent.home.all.map(r=>r[0]),['E0']);
});
test('An explicit unresolved match after the latest known score is carried as a freshness barrier',()=>{
 const f=row('E0','2026-10-28'),key='E0|2026-10-26|home|away';
 const link={matches:{[key]:{id:'one',current_key:key,state:'awaiting_result',kickoff_utc:'2026-10-26T18:00:00Z'}}};
 const recent=A.build(S,[row('E0','2026-10-25')],[],link).recentProfile(f,{windowSize:5,now:new Date('2026-10-27T20:00:00Z')});
 assert.equal(recent.home.pendingLatest.date,'2026-10-26');assert.equal(recent.home.overall.n,1);
});
test('A dispute about the most-recent published score also blocks a claimed active streak',()=>{
 const f=row('E0','2026-10-28'),key='E0|2026-10-25|home|away';
 const archive=A.build(S,[row('E0','2026-10-25')],[],{matches:{[key]:{id:'conflict',current_key:key,state:'conflict',kickoff_utc:null}}});
 const recent=archive.recentProfile(f,{windowSize:5,now:new Date('2026-10-27T20:00:00Z')});
 assert.equal(recent.home.pendingLatest.state,'conflict');assert.equal(recent.home.overall.n,1);
});
