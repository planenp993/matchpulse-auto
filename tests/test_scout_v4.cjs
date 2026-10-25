'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const P=require('../docs/scout-patterns.js'),S=require('../docs/scout-core.js');
const game=(date,h,a,hg,ag,extras={})=>['E0','England','Premier League',date,'17:00',h,a,hg,ag,null,null,null,null,extras];
function sample(){
 const rows=[];for(let i=1;i<=12;i++){
  const date='2026-10-'+String(i).padStart(2,'0');
  rows.push(game(date,'Alpha','Beta',3,1,{HC:5,AC:5,HY:2,AY:3,HS:14,AS:12}));
  rows.push(game(date,'Gamma','Delta',2,2,{HC:5,AC:6,HY:2,AY:3,HS:13,AS:11}));
 }
 return rows;
}
test('auto-discovery returns one fixture with distinct supported market signals',()=>{
 const h=sample(),index=S.build(h);
 const f=game('2026-10-27','Alpha','Beta',null,null);
 const out=P.runAll(index,[f],S,{minimum:5,streak:3,now:new Date('2026-10-25T11:00:00Z'),days:7});
 assert.equal(out.length,1);
 assert.ok(out[0].signals.length>=2);
 assert.ok(out[0].signals.length<=3);
 assert.ok(out[0].totalSignals>=out[0].signals.length);
 assert.equal(new Set(out[0].signals.map(x=>x.market)).size,out[0].signals.length);
});
test('all markets require real paired stats and never fabricate cards or corners',()=>{
 const h=sample().map(x=>[...x.slice(0,13),{}]);
 const f=game('2026-10-27','Alpha','Beta',null,null),index=S.build(h);
 const out=P.runAll(index,[f],S,{minimum:5,streak:3,now:new Date('2026-10-25T11:00:00Z'),days:7});
 assert.equal(out.length,1);
 assert.ok(out[0].signals.every(x=>!['corners','cards','shots'].includes(x.group)));
 for(const m of ['corners85','yellow35','shots215']){
  const p=P.inspect(S.profile(index,f),m,{minimum:5,streak:3,teamKey:S.keyTeam});
  assert.equal(p.home.rate,null);assert.equal(p.matched,false);
 }
});
test('single market minimum is not silently lowered by small sample window',()=>{
 const h=sample(),idx=S.build(h),f=game('2026-10-27','Alpha','Beta',null,null);
 const out=P.run(idx,[f],S,{market:'o25',minimum:8,streak:3,windowSize:5,
    now:new Date('2026-10-25T11:00:00Z'),days:7});
 assert.equal(out.length,0);
});
test('additional 1X2, BTTS-No and correct 12 streak observations',()=>{
 const r=game('2026-10-01','Alpha','Beta',1,0);
 for(const [m,home,away] of [
  ['1',true,false],['2',false,true],['12',true,true],
  ['X',false,false],['bttsNo',true,true]
 ]){assert.equal(P.observation(r,'Alpha','home',m,S.keyTeam),home);
     assert.equal(P.observation(r,'Beta','away',m,S.keyTeam),away)}
});
test('archive importer and full audit are included in package',()=>{
 for(const p of ['scripts/backfill_openfootball_txt.py','scripts/audit_scout.py']){
  assert.ok(fs.existsSync(p),p)
 }
});
