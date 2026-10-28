/* Selections v2: existing single-match decisions, more distinct combinations.
 * The registered v1 engine is intentionally left byte-for-byte unchanged. */
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./scout-selections.js'):root.MatchpulseSelections);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseCombinations=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(S){
'use strict';
const VERSION='match-plans-v2';
const RULES=Object.freeze({...S.RULES,buildersPerMatch:6,buildersPerFamily:2,columnsPerSize:6,columnPool:18,columnBeam:384});
const MAP=new Map(S.MARKETS.map(m=>[m.id,m]));
const compare=(a,b)=>Number(!!b.quote?.aboveModel)-Number(!!a.quote?.aboveModel)||b.rank-a.rank||a.id.localeCompare(b.id);
function overlap(matrix,a,b){
 const pa=S.probability(matrix,a),pb=S.probability(matrix,b),joint=S.probability(matrix,[...new Set([...a,...b])]);
 return joint/(pa+pb-joint);
}
function distinctBuilders(candidates,matrix,limit=RULES.buildersPerMatch){
 const remaining=[...candidates].sort(compare),selected=[],families=new Map();
 while(remaining.length&&selected.length<limit){
  let best=-1,bestScore=-Infinity;
  for(let i=0;i<remaining.length;i++){
   const candidate=remaining[i],used=families.get(candidate.familyPair)||0;
   if(used>=RULES.buildersPerFamily)continue;
   const similarity=Math.max(0,...selected.map(p=>overlap(matrix,p.legs,candidate.legs)));
   if(similarity>.92)continue;
   const score=candidate.rank+.015*Number(!!candidate.quote?.aboveModel)-.035*similarity-.025*used;
   if(score>bestScore){best=i;bestScore=score;}
  }
  if(best<0)break;
  const chosen=remaining.splice(best,1)[0];selected.push(chosen);families.set(chosen.familyPair,(families.get(chosen.familyPair)||0)+1);
 }
 return selected;
}
function createEngine(history,model,core){
 const original=S.createEngine(history,model,core),references=new Map(),leagueRows=new Map();
 function reference(f,ids){
  const key=f[0]+'|'+f[3],eventKey=key+'|'+ids.join('+');
  if(references.has(eventKey))return references.get(eventKey);
  if(!leagueRows.has(key)){
   const since=String(+f[3].slice(0,4)-3)+f[3].slice(4);
   leagueRows.set(key,history.filter(r=>r[0]===f[0]&&r[3]<f[3]&&r[3]>=since&&model.isPlayed(r)));
  }
  const rows=leagueRows.get(key),test=(h,a)=>ids.every(id=>MAP.get(id).test(h,a)),n=rows.length;
  const out={n,normal:n?rows.reduce((v,r)=>v+test(r[7],r[8]),0)/n:0,reverse:n?rows.reduce((v,r)=>v+test(r[8],r[7]),0)/n:0};
  references.set(eventKey,out);return out;
 }
 function evaluate(f,options={}){
  const result=original.evaluate(f,options);result.version=VERSION;
  if(!result.main)return result;
  const matrix=result.model.distribution.matrix,candidates=result.candidates.filter(c=>c.eligible).sort(compare),builders=[];
  for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
   const a=candidates[i],b=candidates[j];if(a.family===b.family)continue;
   const ids=[a.id,b.id].sort(),p=S.probability(matrix,ids);
   if(p===null||p<.30||p>.78||p>=Math.min(a.probability,b.probability)-1e-9)continue;
   const test=(h,v)=>ids.every(id=>MAP.get(id).test(h,v));
   const evidence=S.support(f,options.profile,test,reference(f,ids),p,core);
   if(evidence.modelLift<RULES.minModelLift||evidence.formLift<RULES.minFormLift||evidence.rank<=0)continue;
   const id=ids.join('+');
   builders.push({id,label:ids.map(x=>MAP.get(x).label).join(' + '),legs:ids,familyPair:[a.family,b.family].sort().join('+'),
    probability:p,fair:S.fair(p),evidence,rank:evidence.rank,quote:S.quoteAssessment(options.quotes?.[id],p,options.now),eligible:true});
  }
  result.builders=distinctBuilders(builders,matrix);return result;
 }
 return {evaluate};
}
function columns(entries,core,{priceOnly=false}={}){
 const dated=new Map(),seen=new Set();
 for(const entry of entries){
  const f=entry.fixture,key=core.keyFixture(f);if(seen.has(key)||!entry.main)continue;seen.add(key);
  const picks=[entry.main,...entry.alternatives].filter(p=>p?.eligible&&p.probability>=.55&&(!priceOnly||p.quote?.aboveModel)).sort(compare);
  if(!picks.length)continue;
  if(!dated.has(f[3]))dated.set(f[3],[]);
  dated.get(f[3]).push({fixture:f,key,picks});
 }
 const output=[];
 for(const [date,rows] of dated){
  const pool=rows.sort((a,b)=>compare(a.picks[0],b.picks[0])||a.key.localeCompare(b.key)).slice(0,RULES.columnPool);
  let beam=[{legs:[],clubs:new Set(),start:0}];
  for(let size=1;size<=4;size++){
   const next=[];
   for(const state of beam)for(let i=state.start;i<pool.length;i++){
    const row=pool[i],teams=[core.keyTeam(row.fixture[5]),core.keyTeam(row.fixture[6])];
    if(teams[0]===teams[1]||teams.some(t=>state.clubs.has(t)))continue;
    for(const pick of row.picks){
     const legs=[...state.legs,{fixture:row.fixture,key:row.key,pick}],p=legs.reduce((v,l)=>v*l.pick.probability,1);
     const rank=legs.reduce((v,l)=>v+l.pick.rank,0)/size,key=legs.map(l=>l.key+'|'+l.pick.id).sort().join('~');
     next.push({legs,clubs:new Set([...state.clubs,...teams]),start:i+1,key,probability:p,rank,score:rank+.05*Math.log(p)});
    }
   }
   next.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
   if(size>=2){
    const available=next.slice(0,2048),selected=[],fixtureSets=new Map(),uses=new Map();
    while(available.length&&selected.length<RULES.columnsPerSize){
     let best=-1,bestScore=-Infinity;
     for(let i=0;i<available.length;i++){
      const candidate=available[i],fixtureKey=candidate.legs.map(l=>l.key).sort().join('~');
      if((fixtureSets.get(fixtureKey)||0)>=2)continue;
      const legKeys=candidate.legs.map(l=>l.key+'|'+l.pick.id);
      if(legKeys.some(k=>(uses.get(k)||0)>=4))continue;
      const shared=Math.max(0,...selected.map(s=>s.legs.filter(l=>legKeys.includes(l.key+'|'+l.pick.id)).length));
      if(shared>=size||size===4&&shared>2)continue;
      const fixtureOverlap=Math.max(0,...selected.map(s=>s.legs.filter(l=>candidate.legs.some(c=>c.key===l.key)).length))/size;
      const score=candidate.score-.045*shared/size-.025*fixtureOverlap-.006*legKeys.reduce((v,k)=>v+(uses.get(k)||0),0);
      if(score>bestScore){best=i;bestScore=score;}
     }
     if(best<0)break;
     const chosen=available.splice(best,1)[0],fixtureKey=chosen.legs.map(l=>l.key).sort().join('~');
     fixtureSets.set(fixtureKey,(fixtureSets.get(fixtureKey)||0)+1);
     for(const l of chosen.legs){const k=l.key+'|'+l.pick.id;uses.set(k,(uses.get(k)||0)+1);}
     selected.push(chosen);
    }
    output.push(...selected.map((c,i)=>({id:date+'|'+size+'|'+(i+1),key:c.key,date,size,variant:i+1,legs:c.legs,
     probability:c.probability,fair:S.fair(c.probability),rank:c.rank,score:c.score,assumption:'independent_matches'})));
   }
   // Keep different end positions represented so a high-ranked late fixture
   // cannot consume every state and prevent valid longer columns.
   const buckets=new Map();for(const state of next){if(!buckets.has(state.start))buckets.set(state.start,[]);buckets.get(state.start).push(state);}
   const quota=Math.max(8,Math.floor(RULES.columnBeam/Math.max(1,buckets.size)));
   beam=[...buckets.values()].flatMap(bucket=>bucket.slice(0,quota)).sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)).slice(0,RULES.columnBeam);
   if(!beam.length)break;
  }
 }
 return output.sort((a,b)=>a.date.localeCompare(b.date)||a.size-b.size||a.variant-b.variant);
}
return {...S,VERSION,RULES,overlap,distinctBuilders,createEngine,columns};
});
