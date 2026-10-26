'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const M=require('../docs/scout-markets.js');
const S=require('../docs/scout-core.js');
const Model=require('../docs/model-core.js');
const row=(date,h,a,hg,ag,stats,hiXg=null,awayXg=null)=>['E0','England','Premier League',date,'18:00',h,a,hg,ag,hiXg,awayXg,null,null,...(stats?[stats]:[])];
test('corners, cards, shots thresholds use genuine match fields only',()=>{
 const observed=[
  row('2026-10-01','Alpha','Beta',1,1,{HC:5,AC:4,HY:3,AY:2,HS:12,AS:8,HST:5,AST:3,HR:0,AR:1}),
  row('2026-10-02','Beta','Alpha',1,2,{HC:3,AC:8,HY:1,AY:1,HS:9,AS:14,HST:2,AST:7,HR:0,AR:0})
 ];
 const corners=M.sample(observed,M.DEFINITIONS.find(x=>x.key==='corners'));
 assert.equal(corners.n,2);
 assert.equal(corners.average,10);
 assert.equal(corners.lines.find(x=>x.line===8.5).hits,2);
 assert.equal(corners.lines.find(x=>x.line===10.5).hits,1);
 const yellows=M.sample(observed,M.DEFINITIONS.find(x=>x.key==='yellow'));
 assert.equal(yellows.lines.find(x=>x.line===3.5).hits,1);
});
test('incomplete stats are missing, NEVER counted as zero',()=>{
 const rows=[
  row('2026-10-01','Alpha','Beta',1,0,{HC:4,AC:5}),
  row('2026-10-02','Alpha','Beta',1,0,{HC:0}),
  row('2026-10-03','Alpha','Beta',1,0,{}),
  row('2026-10-04','Alpha','Beta',1,0,null)
 ];
 const s=M.sample(rows,M.DEFINITIONS.find(x=>x.key==='corners'));
 assert.equal(s.n,1);assert.equal(s.lines[0].rate,1);
 const shot=M.sample(rows,M.DEFINITIONS.find(x=>x.key==='shots'));
 assert.equal(shot.n,0);assert.equal(shot.lines[0].rate,null);
});
test('xG samples use the actual side and refuse absent values',()=>{
 const f=row('2026-10-12','Alpha','Beta',null,null);
 const history=[
  row('2026-10-01','Alpha','Beta',1,0,null,1.8,0.6),
  row('2026-10-02','Beta','Alpha',1,2,null,1.4,2.6),
  row('2026-10-03','Alpha','Beta',0,1,null,null,null)
 ];
 const p=S.profile(S.build(history),f),x=M.xgReport(p,S.keyTeam);
 assert.equal(x.home.n,2);assert.equal(x.away.n,2);
 assert.ok(Math.abs(x.home.mean-2.2)<1e-12);
 assert.ok(Math.abs(x.away.mean-1.0)<1e-12);
});
test('1X2 and double chance personal picks settle consistently with result',()=>{
 const f=row('2026-10-05','Alpha','Beta',2,1,{HC:6,AC:3,HY:2,AY:2,HS:11,AS:12,HST:5,AST:4});
 for(const market of ['1','1X','12','corners85','yellow35','shots215','target85'])
  assert.equal(S.marketSettled({market},f),true,market);
 for(const market of ['X','2','X2','corners95'])
  assert.equal(S.marketSettled({market},f),false,market);
 const missing=row('2026-10-05','Alpha','Beta',2,1,null);
 assert.equal(S.marketSettled({market:'corners85'},missing),null);
});
test('1X2 model probabilities are normalized and double chances coherent',()=>{
 const p=Model.distribution(1.3,1.1,-0.06).probs;
 assert.ok(Math.abs(p.homeWin+p.draw+p.awayWin-1)<1e-10);
 assert.ok(Math.abs(p.double1X-(p.homeWin+p.draw))<1e-10);
 assert.ok(Math.abs(p.doubleX2-(p.awayWin+p.draw))<1e-10);
 assert.ok(Math.abs(p.double12-(1-p.draw))<1e-10);
});
test('full analysis available in standalone offline builder, without uncaught JS syntax',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../docs/scout.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../docs/scout.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(html,/scout-markets\.js/);
 assert.match(js,/1X2 и двоен шанс/);
 assert.match(js,/Удари, корнери, картони и xG/);
 assert.match(js,/няма данни/);
});
test('saved probability uses the shared score distribution and remains absent for statistical markets',()=>{
 const p=Model.distribution(1.7,1.2,-.06).probs;
 assert.equal(S.probability(p,'1X'),p.homeWin+p.draw);
 assert.equal(S.probability(p,'u25'),1-p.over25);
 assert.equal(S.probability(p,'bttsNo'),1-p.btts);
 assert.equal(S.probability(p,'corners85'),null);
 assert.equal(S.probability(null,'o25'),null);
 const result=row('2026-10-25','Alpha','Beta',2,0,{HR:0,AR:1,HS:16,AS:12,HTHG:1,HTAG:1});
 for(const market of ['u25','bttsNo','red05','shots255','ht05','ht15'])assert.equal(S.marketSettled({market},result),true,market);
 assert.equal(S.marketSettled({market:'yellow45'},result),null);
});
