/* Curated v3 presentation cohort. Registered v1/v2 sources remain immutable. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./scout-combinations.js'):root.MatchpulseCombinations);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseCurated=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(V2){
'use strict';
const VERSION='match-plans-v3';
const BANDS=Object.freeze([{id:'3-6',label:'3–6',minimum:3,maximum:6},{id:'6-12',label:'6–12',minimum:6,maximum:12},{id:'12-24',label:'12–24',minimum:12,maximum:24}].map(Object.freeze));
const RULES=Object.freeze({...V2.RULES,buildersPerMatch:2,columnsPerBand:6,columnMinimum:2,columnMaximum:8,columnPool:18,columnBeam:448,columnOddsBasis:'model_fair'});
const compare=(a,b)=>Number(!!b.quote?.aboveModel)-Number(!!a.quote?.aboveModel)||b.rank-a.rank||a.id.localeCompare(b.id);
function bandFor(odds){return Number.isFinite(odds)?BANDS.find(b=>odds>=b.minimum&&(odds<b.maximum||b.maximum===24&&odds<=24))||null:null;}
function chooseBuilders(builders){
 if(builders.length<=1)return [...builders];
 const first=builders[0],second=builders.slice(1).find(b=>b.familyPair!==first.familyPair)||builders[1];
 return [first,second];
}
function createEngine(history,model,core){
 const original=V2.createEngine(history,model,core);
 return {evaluate(f,options){const entry=original.evaluate(f,options);return {...entry,version:VERSION,builders:chooseBuilders(entry.builders)};}};
}
function diverseColumns(candidates,limit=RULES.columnsPerBand){
 const remaining=[...candidates].sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)),selected=[],used=new Map(),sets=new Set();
 while(remaining.length&&selected.length<limit){
  let best=-1,bestScore=-Infinity;
  for(let i=0;i<remaining.length;i++){
   const c=remaining[i],fixtureSet=c.legs.map(l=>l.key).sort().join('~'),keys=c.legs.map(l=>l.key+'|'+l.pick.id);
   if(sets.has(fixtureSet)||keys.some(k=>(used.get(k)||0)>=3))continue;
   const overlap=Math.max(0,...selected.map(s=>s.legs.filter(l=>keys.includes(l.key+'|'+l.pick.id)).length/Math.min(c.legs.length,s.legs.length)));
   if(overlap>.75)continue;
   const fixtures=Math.max(0,...selected.map(s=>s.legs.filter(l=>c.legs.some(k=>k.key===l.key)).length/Math.min(c.legs.length,s.legs.length)));
   const score=c.score-.035*overlap-.02*fixtures-.004*keys.reduce((n,k)=>n+(used.get(k)||0),0)/keys.length;
   if(score>bestScore){best=i;bestScore=score;}
  }
  if(best<0)break;
  const c=remaining.splice(best,1)[0];selected.push(c);sets.add(c.legs.map(l=>l.key).sort().join('~'));
  for(const l of c.legs){const key=l.key+'|'+l.pick.id;used.set(key,(used.get(key)||0)+1);}
 }
 return selected;
}
function columns(entries,core,{priceOnly=false}={}){
 const dated=new Map(),seen=new Set();
 for(const entry of entries){
  const f=entry.fixture,key=core.keyFixture(f);if(seen.has(key)||!entry.main)continue;seen.add(key);
  const picks=[entry.main,...(entry.alternatives||[])].filter(p=>p?.eligible&&Number.isFinite(p.probability)&&p.probability>=.55&&p.probability<=1&&(!priceOnly||p.quote?.aboveModel)).sort(compare);
  if(!picks.length)continue;
  if(!dated.has(f[3]))dated.set(f[3],[]);dated.get(f[3]).push({fixture:f,key,picks});
 }
 const output=[];
 for(const [date,rows] of dated){
  const pool=rows.sort((a,b)=>compare(a.picks[0],b.picks[0])||a.key.localeCompare(b.key)).slice(0,RULES.columnPool);
  const candidates=new Map(BANDS.map(b=>[b.id,[]]));let beam=[{legs:[],clubs:new Set(),start:0}];
  for(let size=1;size<=RULES.columnMaximum;size++){
   const next=[];
   for(const state of beam)for(let i=state.start;i<pool.length;i++){
    const row=pool[i],clubs=[core.keyTeam(row.fixture[5]),core.keyTeam(row.fixture[6])];
    if(clubs[0]===clubs[1]||clubs.some(t=>state.clubs.has(t)))continue;
    for(const pick of row.picks){
     const probability=(state.probability||1)*pick.probability,fair=1/probability;if(fair>24+1e-10)continue;
     const legs=[...state.legs,{fixture:row.fixture,key:row.key,pick}],rank=legs.reduce((n,l)=>n+l.pick.rank,0)/size;
     const key=legs.map(l=>l.key+'|'+l.pick.id).sort().join('~'),score=rank-.006*Math.max(0,size-2)+.02*Math.log(probability)/size;
     const candidate={legs,key,probability,fair,rank,score,clubs:new Set([...state.clubs,...clubs]),start:i+1};next.push(candidate);
     const band=size>=RULES.columnMinimum?bandFor(fair):null;
     if(band)candidates.get(band.id).push({...candidate,score:score-.012*Math.abs(Math.log(fair/Math.sqrt(band.minimum*band.maximum))),band:band.id});
    }
   }
   next.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
   for(const [id,list] of candidates)candidates.set(id,list.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)).slice(0,1000));
   // Retain probability ranges and end positions, not only high-probability
   // short states: otherwise the requested higher bands cannot be reached.
   const buckets=new Map();for(const c of next){const key=c.start+'|'+Math.floor(Math.log(c.fair)/Math.log(1.5));if(!buckets.has(key))buckets.set(key,[]);if(buckets.get(key).length<6)buckets.get(key).push(c);}
   beam=[];const groups=[...buckets.values()];
   for(let row=0;row<6&&beam.length<RULES.columnBeam;row++)for(const group of groups){if(group[row])beam.push(group[row]);if(beam.length===RULES.columnBeam)break;}
   if(!beam.length)break;
  }
  for(const band of BANDS){
   const selected=diverseColumns(candidates.get(band.id));
   output.push(...selected.map((c,i)=>({id:date+'|'+band.id+'|'+(i+1),key:c.key,date,size:c.legs.length,variant:i+1,band:band.id,bandLabel:band.label,
    oddsBasis:'model_fair',legs:c.legs,probability:c.probability,fair:c.fair,rank:c.rank,score:c.score,assumption:'independent_matches'})));
  }
 }
 return output.sort((a,b)=>a.date.localeCompare(b.date)||BANDS.findIndex(b=>b.id===a.band)-BANDS.findIndex(b=>b.id===b.band)||a.variant-b.variant);
}
return {...V2,VERSION,RULES,BANDS,bandFor,chooseBuilders,createEngine,columns};
});
