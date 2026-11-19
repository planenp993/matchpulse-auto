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
check("Fair model price is the reciprocal of probability, not an offered quote",()=>{
 assert.equal(M.fairOdds(.5),2);
 assert.equal(M.fairOdds(.25),4);
 assert.equal(M.fairOdds(0),null);
 assert.equal(M.fairOdds(Number.NaN),null);
});
check("App reads only prepublished history and Soccerway calendar",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../docs/match-lab-x/index.html"),"utf8");
 const js=fs.readFileSync(path.join(__dirname,"../docs/match-lab-x/app.js"),"utf8");
 for(const pathname of ["../data/fixtures.json","../data/client_manifest.json",
                          "../data/coverage_audit.json","../data/status.json","./data/analyses.json"])
  assert.ok(js.includes(pathname),"Missing "+pathname);
 assert.ok(!/soccerway\.com|football-data\.co\.uk\/mmz4281/i.test(js),"No direct provider scraping in browser");
 assert.ok(!js.includes('fetchJSON("../data/history.json")'),"Browser must not download full history");
 assert.ok(js.includes("snapshot.history_sha256")&&js.includes("snapshot.fixtures_sha256"),"Reject out-of-sync estimates");
 for(const id of ["metricFixtures","matchSelect","fixtureGroups","analysisBody","leagueNav","coverageRows","freshnessBar","freshnessCalendar","freshnessHistory","analysisSnapshotState"])
  assert.ok(html.includes('id="'+id+'"'));
 new vm.Script(js,{filename:"app.js"});
});
check("Verified aliases resolve provider names without guessing",()=>{
 const B=require("./build_match_lab_x_snapshot.cjs");
 const dictionary=JSON.parse(fs.readFileSync(path.join(__dirname,"../docs/data/club_aliases.json"),"utf8"));
 assert.equal(dictionary.version,1);
 const a=dictionary.aliases;
 for(const [provider,archive] of [
  ["EN Avant Guingamp","Guingamp"],
  ["1. FC Nürnberg","Nurnberg"],
  ["Rayo Vallecano","Vallecano"],
  ["Hellas Verona","Verona"],
  ["Bolton Wanderers","Bolton"],
  ["Stade DE Reims","Reims"]])
  assert.equal(B.canonical(provider,a),B.canonical(archive,a),provider);
 assert.notEqual(B.canonical("Red Star Belgrade",a),B.canonical("Red Star FC",a),
   "Different clubs must remain separate");
 assert.notEqual(B.canonical("Random Unknown Team",a),B.canonical("Arsenal",a));
});
check("Compiled snapshot follows the published manifest",()=>{
 const {execFileSync}=require("node:child_process");
 const os=require("node:os");
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"mlx-check-"));
 try{
  const out=path.join(tmp,"compiled.json");
  execFileSync(process.execPath,[path.join(__dirname,"build_match_lab_x_snapshot.cjs"),"--output",out],{stdio:"pipe"});
  const compiled=JSON.parse(fs.readFileSync(out,"utf8"));
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,"../docs/data/client_manifest.json"),"utf8"));
  assert.equal(compiled.schema,1);
  assert.equal(compiled.history_sha256,manifest.files["history.json"].sha256);
  assert.equal(compiled.fixtures_sha256,manifest.files["fixtures.json"].sha256);
  assert.ok(compiled.ready_count>0);
  assert.ok(compiled.match_count>=compiled.ready_count);
  assert.ok(fs.statSync(out).size<2_000_000);
  for(const value of Object.values(compiled.estimates)){
   if(!value.ready)continue;
   assert.ok(Math.abs(value.markets.home+value.markets.draw+value.markets.away-1)<1e-8);
   assert.ok(!Object.hasOwn(value.home.all,"rows"),"No raw fixture archive replicated");
   break;
  }
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
console.log("MATCH LAB X: all public site tests passed.");
