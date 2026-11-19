/* MATCH LAB X offline tests: no new scraping, inspect safe public snapshot reader. */
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const M=require("../docs/match-lab-x/model.js");
function check(name,fn){fn();console.log("✓ "+name);}
check("Poisson 1X2 probability is normalized",()=>{
 const m=M.markets(M.scoreMatrix(1.7,1.05));
 assert.ok(Math.abs(m.home+m.draw+m.away-1)<1e-9);
 assert.ok(m.over15>=m.over25&&m.over25>=m.over35);
 assert.ok(m.btts>=0&&m.btts<=1);
});
check("Model cannot use future results",()=>{
 const rows=[];
 for(let i=0;i<350;i++){
  const date=new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10);
  rows.push([date,i%2?"Home":"Other",i%2?"Away":"Third",i%3+1,1,1,0,12,10,5,3]);
 }
 const f={date:"2025-02-02",home:"Home",away:"Away"},a=M.estimate(rows,f);
 assert.equal(a.ready,true);
 const changed=rows.concat([["2025-02-03","Home","Away",15,0,8,0,40,1,20,0]]);
 const b=M.estimate(changed,f);
 assert.deepEqual(a.markets,b.markets);
});
check("Unknown team does not receive invented model probability",()=>{
 const rows=Array.from({length:200},(_,i)=>{
  const date=new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10);
  return [date,"Alpha","Beta",1,0,0,0];
 });
 assert.equal(M.estimate(rows,{date:"2025-02-01",home:"Unknown",away:"Beta"}).ready,false);
});
check("HT scenarios remain normalized",()=>{
 const rows=[];
 for(let i=0;i<350;i++){
  const date=new Date(Date.UTC(2024,0,1)+i*86400000).toISOString().slice(0,10);
  rows.push([date,i%2?"Home":"Other",i%2?"Away":"Third",2,1,1,0]);
 }
 const e=M.estimate(rows,{date:"2025-02-01",home:"Home",away:"Away"});
 assert.equal(e.ready,true);
 const after=M.afterHalf(e,1,0);
 assert.ok(Math.abs(after.markets.home+after.markets.draw+after.markets.away-1)<1e-8);
 const mc=M.sample(after.matrix,10000);
 assert.ok(Math.abs(mc.home-after.markets.home)<.03);
});
check("Explicit team aliases protect important matches",()=>{
 assert.equal(M.norm("Manchester United"),M.norm("Man United"));
 assert.equal(M.norm("Nottingham Forest"),M.norm("Nott'm Forest"));
 assert.equal(M.norm("FC Bayern München"),M.norm("Bayern Munich"));
});
check("App reads only prepublished history and Soccerway calendar",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../docs/match-lab-x/index.html"),"utf8");
 const js=fs.readFileSync(path.join(__dirname,"../docs/match-lab-x/app.js"),"utf8");
 for(const pathname of ["../data/fixtures.json","../data/history.json",
                          "../data/client_manifest.json","../data/coverage_audit.json"])
  assert.ok(js.includes(pathname),"Missing "+pathname);
 assert.ok(!/soccerway\.com|football-data\.co\.uk\/mmz4281/i.test(js),"No direct provider scraping in browser");
 for(const id of ["metricFixtures","matchSelect","fixtureGroups","analysisBody","leagueNav","coverageRows"])
  assert.ok(html.includes('id="'+id+'"'));
 new vm.Script(js,{filename:"app.js"});
});
console.log("MATCH LAB X: all public site tests passed.");
