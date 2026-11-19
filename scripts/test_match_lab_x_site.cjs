/* Offline smoke tests for MATCH LAB X published Poisson viewer. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const model=require("../docs/match-lab-x/model.js");
function test(name,fn){fn();process.stdout.write("✓ "+name+"\n");}
test("Poisson mass is normalized",()=>{
 const q=model.scoreMatrix(1.6,1.0),p=model.markets(q);
 assert.ok(Math.abs(p.home+p.draw+p.away-1)<1e-9);
 assert.ok(p.over15>=p.over25&&p.over25>=p.over35);
 assert.ok(p.btts>=0&&p.btts<=1);
});
test("No future score leakage or dependency on another match outcome",()=>{
 const rows=[];
 for(let i=0;i<300;i++){
  const date=new Date(Date.UTC(2024,0,1)+86400000*i).toISOString().slice(0,10);
  rows.push([date,i%2?"Home":"Other",i%2?"Away":"Third",i%3,1,0,0,13,9,4,3]);
 }
 const f={date:"2025-01-02",home:"Home",away:"Away"};
 const a=model.estimate(rows,f);
 assert.ok(a.ready);
 const changed=rows.map(x=>x.slice());
 changed.push(["2025-02-01","Home","Away",15,0,9,0,40,1,19,0]);
 const b=model.estimate(changed,f);
 assert.deepEqual(a.markets,b.markets);
});
test("Missing teams do not get invented model probabilities",()=>{
 const rows=Array.from({length:200},(_,i)=>{
  const d=new Date(Date.UTC(2024,0,1)+86400000*i).toISOString().slice(0,10);
  return [d,"Alpha","Beta",2,1,1,0];
 });
 assert.equal(model.estimate(rows,{date:"2025-01-01",home:"Unknown",away:"Beta"}).ready,false);
});
test("HT conditioning stays normalized and over2.5 consistent",()=>{
 const rows=[];
 for(let i=0;i<260;i++){
  const d=new Date(Date.UTC(2024,0,1)+86400000*i).toISOString().slice(0,10);
  rows.push([d,i%2?"Home":"Other",i%2?"Away":"Third",i%4,1,1,0,12,8,4,2]);
 }
 const est=model.estimate(rows,{date:"2025-07-01",home:"Home",away:"Away"});
 assert.ok(est.ready);
 const h=model.afterHalf(est,1,0);
 assert.ok(Math.abs(h.markets.home+h.markets.draw+h.markets.away-1)<1e-8);
 assert.ok(h.markets.over25>=h.markets.over35);
 const mc=model.sample(h.matrix,6000,Math.random);
 assert.ok(Math.abs(mc.home-h.markets.home)<.05);
});
test("Static entry and local data references exist",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../docs/match-lab-x/index.html"),"utf8");
 const js=fs.readFileSync(path.join(__dirname,"../docs/match-lab-x/app.js"),"utf8");
 for(const name of ["../data/fixtures.json","./data/coverage.json","./data/history/"])assert.ok(js.includes(name));
 for(const name of ["#metricFixtures","#matchSelect","#fixtureGroups"]){
  assert.ok(html.includes("id=\""+name.slice(1)+"\""));
 }
 const vm=require("node:vm");
 new vm.Script(js,{filename:"app.js"});
});
console.log("MATCH LAB X: all offline frontend tests passed.");
