'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const Scout=require('../docs/scout-core.js');
const Elo=require('../docs/scout-elo.js');
const Patterns=require('../docs/scout-patterns.js');
const file=(p)=>fs.readFileSync(path.resolve(__dirname,'../'+p),'utf8');
const game=(date,home,away,h,a,extra=null)=>['E0','England','Premier League',date,'18:30',home,away,h,a,null,null,null,null,...(extra?[extra]:[])];
const extra=(v=1)=>({HC:5+v,AC:5,HY:2,AY:2,HST:4,AST:5,HS:13,AS:14,HTHG:1,HTAG:0,HR:0,AR:0});
function rows(){
 const r=[];
 for(let i=1;i<=12;i++){
  const date='2026-10-'+String(i).padStart(2,'0');
  r.push(game(date,'Alpha','Beta',3,1,extra()));
  r.push(game(date,'Gamma','Delta',0,1,extra()));
 }
 return r;
}
const future=()=>game('2026-10-28','Alpha','Beta',null,null);
test('3, 4, 5 consecutive O2.5 are counted from real most-recent games',()=>{
 const h=rows(),p=Scout.profile(Scout.build(h),future(),{windowSize:10});
 for(const threshold of [3,4,5,6]){
  const s=Patterns.inspect(p,'o25',{streak:threshold,minimum:5,teamKey:Scout.keyTeam});
  assert.equal(s.home.currentStreak,10);
  assert.equal(s.away.currentStreak,10);
  assert.equal(s.matched,true);
 }
 const f=Patterns.inspect(p,'yellow35',{streak:5,minimum:5,teamKey:Scout.keyTeam});
 assert.equal(f.home.currentStreak,10);
});
test('unreported corners break streak, are missing, not losses or zeros',()=>{
 const r=rows();
 r[r.length-2][13]={HY:3,AY:3};
 const p=Scout.profile(Scout.build(r),future(),{windowSize:10});
 const v=Patterns.inspect(p,'corners85',{streak:3,minimum:5,teamKey:Scout.keyTeam});
 assert.equal(v.home.currentStreak,0);
 assert.equal(v.home.missing,1);
 assert.equal(v.home.n,9);
 assert.equal(v.home.hits,9);
});
test('streak respects 5/10/20 window and opposition quality filters',()=>{
 const r=rows(),idx=Scout.build(r),elo=Elo.build(r,Scout.keyTeam);
 elo.opponentClass=Elo.opponentClass;
 for(const n of [5,10,20]){
  const profile=Scout.profile(idx,future(),{windowSize:n,eloIndex:elo});
  assert.equal(Patterns.measures(profile.home.all,'Alpha','home','o25',Scout.keyTeam).total,Math.min(n,12));
 }
 const strong=Scout.profile(idx,future(),{windowSize:5,opponentFilter:'strong',eloIndex:elo});
 assert.ok(strong.home.all.length<=5);
});
test('metadata markets and halftime have no ghost percentages if optional stats absent',()=>{
 const p=Scout.profile(Scout.build([game('2026-10-01','Alpha','Beta',1,1)]),future(),{windowSize:10});
 for(const id of ['corners85','yellow35','shots215','ht05','red05']){
  const k=Patterns.inspect(p,id,{streak:3,minimum:1,teamKey:Scout.keyTeam});
  assert.equal(k.home.rate,null);assert.equal(k.home.currentStreak,0);
  assert.equal(k.matched,false);
 }
});
test('first-half + double chance patterns are computed correctly',()=>{
 const r=game('2026-10-01','Alpha','Beta',1,1,{HTHG:1,HTAG:0});
 assert.equal(Patterns.observation(r,'Alpha','home','1X',Scout.keyTeam),true);
 assert.equal(Patterns.observation(r,'Beta','away','X2',Scout.keyTeam),true);
 assert.equal(Patterns.observation(r,'Alpha','home','ht05',Scout.keyTeam),true);
 assert.equal(Patterns.observation(r,'Alpha','home','ht15',Scout.keyTeam),false);
});
test('season regression of Elo does not modify an earlier rating',()=>{
 const h=rows(),e=Elo.build(h,Scout.keyTeam);
 const original=Elo.teamAt(e,'E0','Alpha','2026-11-01').rating;
 const next=Elo.teamAt(e,'E0','Alpha','2027-11-01');
 assert.ok(Math.abs(next.rating-1500)<Math.abs(original-1500));
 assert.equal(Elo.teamAt(e,'E0','Alpha','2026-11-01').rating,original);
 const futureMatch=game('2027-08-01','Alpha','Beta',1,2);
 const e2=Elo.build([...h,futureMatch],Scout.keyTeam);
 assert.equal(Elo.teamAt(e2,'E0','Alpha','2026-11-01').rating,original);
});
test('Scout JavaScript is parseable and all research UI controls present',()=>{
 assert.doesNotThrow(()=>new vm.Script(file('docs/scout.js')));
 assert.doesNotThrow(()=>new vm.Script(file('docs/scout-patterns.js')));
 const html=file('docs/scout.html');
 for(const id of ['scanMarket','scanStreak','scanBoth','researchWindow','scanVenue'])
  assert.match(html,new RegExp(id));
 assert.match(html,/scout-patterns\.js/);
 assert.match(file('scripts/build_scout_preview.py'),/scout-patterns\.js/);
});
test('venue scanner separates home and away streaks from overall form',()=>{
 const h=[];
 for(let i=1;i<=12;i++){
  const date='2026-10-'+String(i).padStart(2,'0');
  h.push(i%2?game(date,'Alpha','Beta',3,1,extra()):game(date,'Beta','Alpha',0,0,extra()));
 }
 const index=Scout.build(h),fixture=future(),profile=Scout.profile(index,fixture);
 const overall=Patterns.inspect(profile,'o25',{minimum:5,teamKey:Scout.keyTeam});
 const venue=Patterns.inspect(profile,'o25',{minimum:5,venue:true,teamKey:Scout.keyTeam});
 assert.equal(overall.matched,false);
 assert.equal(venue.matched,true);
 assert.equal(venue.home.currentStreak,6);
 assert.equal(venue.away.currentStreak,6);
 const options={venue:true,days:7,now:new Date('2026-10-25T10:00:00Z')};
 assert.equal(Patterns.run(index,[fixture],Scout,{...options,market:'o25'}).length,1);
 assert.equal(Patterns.runAll(index,[fixture],Scout,options)[0].signal.venue,true);
});
