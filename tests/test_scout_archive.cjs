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
