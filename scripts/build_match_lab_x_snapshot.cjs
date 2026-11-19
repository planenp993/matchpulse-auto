"use strict";
/* Publish derived match estimates from published sources.
   Team identity resolution uses the existing manually verified alias dictionary.
   Unrecognized teams remain unavailable, never fuzzy-matched. */
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const M=require("../docs/match-lab-x/model.js");
const ROOT=path.resolve(__dirname,".."),OUT=path.join(ROOT,"docs/match-lab-x/data/analyses.json");
const CORE=["E0","E1","D1","D2","I1","I2","SP1","SP2","F1","F2"];
const EXTRA=["E2","E3","SC0","N1","B1","P1","T1","G1"];
const ALLOWED=new Set([...CORE,...EXTRA]);
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const read=name=>{const bytes=fs.readFileSync(path.join(ROOT,"docs/data",name));return {bytes,data:JSON.parse(bytes.toString("utf8"))};};
const num=v=>Number.isInteger(v)&&v>=0?v:null;
const raw=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();
function canonical(name,aliases){
 const normalized=raw(name);
 return M.norm(aliases[normalized]||normalized);
}
function convert(r,aliases={}){
 if(!Array.isArray(r)||!ALLOWED.has(r[0])||typeof r[3]!=="string"||
    typeof r[5]!=="string"||typeof r[6]!=="string"||num(r[7])===null||num(r[8])===null)return null;
 const e=r[13]&&typeof r[13]==="object"&&!Array.isArray(r[13])?r[13]:{};
 return [r[3],canonical(r[5],aliases),canonical(r[6],aliases),r[7],r[8],num(e.HTHG),num(e.HTAG),
   num(e.HS),num(e.AS),num(e.HST),num(e.AST),num(e.HC),num(e.AC),num(e.HY),num(e.AY)];
}
function team(t){
 const a=t.all;
 return {seen:t.seen,all:{n:a.n,for:a.for,against:a.against,w:a.w,d:a.d,l:a.l,sot:a.sot,shotN:a.shotN,form:a.form},
  home:{n:t.home.n},away:{n:t.away.n}};
}
function compact(e,display=new Map(),div=""){
 if(!e.ready)return {ready:false,reason:e.reason};
 return {ready:true,n:e.n,lh:e.lh,la:e.la,halfShare:e.halfShare,
  markets:e.markets,home:team(e.home),away:team(e.away),
  h2h:e.h2h.map(r=>[r[0],display.get(div+"|"+r[1])||r[1],
                         display.get(div+"|"+r[2])||r[2],r[3],r[4]])};
}
const key=f=>[f.div,f.date,f.home,f.away].join("|");
function build({history,fixtures,manifest,historyHash,fixturesHash,modelHash,aliases={},aliasHash=""}){
 if(!Array.isArray(history)||!Array.isArray(fixtures))throw Error("Expected history and fixture arrays");
 if(manifest?.files?.["history.json"]?.sha256!==historyHash||
    manifest?.files?.["fixtures.json"]?.sha256!==fixturesHash)
  throw Error("Inconsistent source hashes: manifest/history/fixtures");
 const divisions=manifest.files["history.json"].divisions;
 const supported=new Set(CORE.concat(EXTRA.filter(d=>(divisions[d]||0)>=500)));
 const byDiv=new Map(),display=new Map();
 for(const r of history){
  const v=convert(r,aliases);
  if(!v||!supported.has(r[0]))continue;
  if(!byDiv.has(r[0]))byDiv.set(r[0],[]);
  byDiv.get(r[0]).push(v);
  display.set(r[0]+"|"+v[1],r[5]);
  display.set(r[0]+"|"+v[2],r[6]);
 }
 for(const rows of byDiv.values())rows.sort((a,b)=>a[0].localeCompare(b[0]));
 const estimates=Object.create(null);let ready=0,unavailable=0;
 for(const f of fixtures){
  if(!Array.isArray(f)||f.length<14||!supported.has(f[0]))continue;
  const [div,,,date,time,home,away]=f;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date))||!/^\d{2}:\d{2}$/.test(String(time))||
     typeof home!=="string"||typeof away!=="string"||!home||!away||
     !String(f[13]||"").toLowerCase().includes("soccerway"))continue;
  const fixture={div,date,time,home,away},id=key(fixture);
  if(Object.hasOwn(estimates,id))throw Error("Duplicate fixture "+id);
  const matched={...fixture,home:canonical(home,aliases),away:canonical(away,aliases)};
  const estimate=compact(M.estimate(byDiv.get(div)||[],matched),display,div);
  if(estimate.ready)ready++;else unavailable++;
  estimates[id]=estimate;
 }
 const count=Object.keys(estimates).length;
 if(!count||!ready)throw Error("No valid analyzed Soccerway fixtures");
 return {schema:1,model:"Public empirical Poisson v1",model_sha256:modelHash,
  history_sha256:historyHash,fixtures_sha256:fixturesHash,aliases_sha256:aliasHash,
  match_count:count,ready_count:ready,unavailable_count:unavailable,estimates};
}
function main(){
 const ix=process.argv.indexOf("--output");
 if(ix>=0&&!process.argv[ix+1])throw Error("--output requires path");
 const output=ix>=0?path.resolve(process.argv[ix+1]):OUT;
 const h=read("history.json"),f=read("fixtures.json"),aliasFile=read("club_aliases.json");
 const manifest=read("client_manifest.json").data;
 if(aliasFile.data.version!==1||!aliasFile.data.aliases)throw Error("Missing verified alias mapping");
 const snapshot=build({history:h.data,fixtures:f.data,manifest,historyHash:sha(h.bytes),
   fixturesHash:sha(f.bytes),modelHash:sha(fs.readFileSync(path.join(ROOT,"docs/match-lab-x/model.js"))),
   aliases:aliasFile.data.aliases,aliasHash:sha(aliasFile.bytes)});
 const encoded=JSON.stringify(snapshot)+"\n",bytes=Buffer.byteLength(encoded);
 if(bytes>2_000_000)throw Error("Unusually large analysis snapshot");
 if(process.argv.includes("--check")){
  if(!fs.existsSync(output)||fs.readFileSync(output,"utf8")!==encoded)throw Error("Analysis snapshot stale");
 }else{
  fs.mkdirSync(path.dirname(output),{recursive:true});
  if(!fs.existsSync(output)||fs.readFileSync(output,"utf8")!==encoded)fs.writeFileSync(output,encoded);
 }
 console.log("MATCH LAB X: "+snapshot.match_count+" matches, "+snapshot.ready_count+" modeled, "+bytes+" bytes");
}
if(require.main===module)main();
module.exports={build,convert,compact,key,canonical};