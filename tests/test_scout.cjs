'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const S=require('../docs/scout-core.js');
const row=(date,h,a,hg,ag,div='E0')=>[div,'England','Premier League',date,'17:00',h,a,hg,ag,null,null,null,null,'Football-Data'];
function data(){
 const history=[];
 const t=['Arsenal','Everton','Chelsea','Liverpool'];
 for(let day=1;day<=20;day++){
  let d='2026-10-'+String(day).padStart(2,'0');
  history.push(row(d,t[day%4],t[(day+1)%4],2+(day%2),1));
  history.push(row(d,t[(day+2)%4],t[(day+3)%4],1,2));
 }
 const upcoming=row('2026-10-28','Arsenal','Everton',null,null);
 upcoming[13]='FixtureDownload / UTC→Europe-Sofia';
 return {history,upcoming,index:S.build(history)};
}
test('counts match events and venue, and does not invent xG',()=>{
 const {upcoming,index}=data(),p=S.profile(index,upcoming);
 assert.ok(p.home.overall.n>=8&&p.away.overall.n>=8);
 const m=p.home.overall;
 assert.equal(m.o25,Math.round(m.o25));assert.ok(m.o25<=m.n);
 assert.ok(m.btts<=m.n);assert.ok(m.gf>=0);
 assert.ok(p.home.local.n<=p.home.overall.n+10);
});
test('only uses matches BEFORE kickoff date and prevents outcome leakage',()=>{
 const {history,upcoming,index}=data(),prev=S.profile(index,upcoming);
 const leak=row('2026-10-28','Arsenal','Everton',15,15);
 const after=row('2026-11-01','Everton','Arsenal',0,15);
 const second=S.profile(S.build([...history,leak,after]),upcoming);
 assert.deepEqual(second.home.overall,prev.home.overall);
 assert.deepEqual(second.away.overall,prev.away.overall);
});
test('trend rates are counted events rather than modeled probabilities',()=>{
 const {index,upcoming}=data(),p=S.profile(index,upcoming);
 const x=S.trend(p,'o25',5);
 assert.equal(x.homeRecent,x.homeCount/x.homeTotal);
 assert.equal(x.awayRecent,x.awayCount/x.awayTotal);
 assert.ok(x.strength>=0&&x.strength<=1);
});
test('insufficient team history is excluded from trend scanner',()=>{
 const {index,upcoming}=data();
 const p=S.profile(index,[...upcoming.slice(0,6),'Unknown Team',upcoming[6],...upcoming.slice(7)]);
 const z=S.trend(p,'o25',8);
 assert.equal(z.qualified,false);assert.equal(z.signalFound,false);
});
test('correct market settlement and pending results',()=>{
 let f=row('2026-10-20','Arsenal','Everton',2,1);
 assert.equal(S.marketSettled({market:'o25'},f),true);
 assert.equal(S.marketSettled({market:'u35'},f),true);
 assert.equal(S.marketSettled({market:'btts'},f),true);
 assert.equal(S.marketSettled({market:'home2'},f),true);
 assert.equal(S.marketSettled({market:'away2'},f),false);
 f[7]=null;f[8]=null;
 assert.equal(S.marketSettled({market:'o25'},f),null);
});
test('scans only scheduled future matches and actual coincident form',()=>{
 const {index,upcoming}=data();
 const now=new Date('2026-10-25T10:00:00Z');
 const res=S.scan(index,[upcoming,row('2026-10-20','Arsenal','Everton',null,null)],{market:'o25',days:7,minSample:5,now});
 assert.ok(res.every(x=>x.trend.qualified&&x.trend.signalFound));
 assert.ok(res.every(x=>x.fixture[3]>='2026-10-25'));
});
test('unique fixture key is stable and normalizes equivalent club names',()=>{
 const a=row('2026-10-28','Manchester United','Everton',null,null);
 const b=row('2026-10-28','Man Utd','Everton',null,null);
 assert.equal(S.keyFixture(a),S.keyFixture(b));
});
test('standalone Scout HTML and browser JS are syntactically valid',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../docs/scout.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../docs/scout.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(html,/scout-core\.js/);assert.match(html,/scout\.css/);
 for(const name of ['view-schedule','view-scanner','view-picks','matchOverlay'])
  assert.ok(html.includes(name));
});
test('no hidden claims of guaranteed bets and uses no remote paid API',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../docs/scout.js'),'utf8');
 assert.match(js,/не сигурни прогнози/);
 assert.ok(!js.includes('api-key'));
});
