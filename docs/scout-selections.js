/* Selection rules v1. An explicit ranking layer; model probabilities stay unchanged. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseSelections=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='selections-v1';
const RULES=Object.freeze({minimum:5,leagueMinimum:50,window:10,prior:6,maxAgeDays:45,
 minProbability:.45,maxProbability:.88,minModelLift:.015,minFormLift:-.05,
 quoteMaxHours:72,priceBuffer:.05});
const MARKETS=[
 ['1','Победа на домакина','result',(h,a)=>h>a],
 ['X','Равенство','result',(h,a)=>h===a],
 ['2','Победа на госта','result',(h,a)=>h<a],
 ['1X','Двоен шанс 1X','result',(h,a)=>h>=a],
 ['X2','Двоен шанс X2','result',(h,a)=>h<=a],
 ['12','Без равенство · 12','result',(h,a)=>h!==a],
 ['o15','Над 1,5 гола','total',(h,a)=>h+a>=2],
 ['o25','Над 2,5 гола','total',(h,a)=>h+a>=3],
 ['o35','Над 3,5 гола','total',(h,a)=>h+a>=4],
 ['u25','Под 2,5 гола','total',(h,a)=>h+a<=2],
 ['u35','Под 3,5 гола','total',(h,a)=>h+a<=3],
 ['btts','Гол/гол · Да','btts',(h,a)=>h>=1&&a>=1],
 ['bttsNo','Гол/гол · Не','btts',(h,a)=>h===0||a===0],
 ['home1','Домакинът вкарва 1+','home',(h)=>h>=1],
 ['home2','Домакинът вкарва 2+','home',(h)=>h>=2],
 ['away1','Гостът вкарва 1+','away',(_,a)=>a>=1],
 ['away2','Гостът вкарва 2+','away',(_,a)=>a>=2]
].map(([id,label,family,test])=>Object.freeze({id,label,family,test}));
const MAP=new Map(MARKETS.map(m=>[m.id,m]));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const day=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const ageDays=(a,b)=>(Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000;
function fair(probability){return Number.isFinite(probability)&&probability>0&&probability<=1?1/probability:null;}
function probability(matrix,ids){
 if(!Array.isArray(matrix)||!Array.isArray(ids)||!ids.length||ids.some(id=>!MAP.has(id)))return null;
 const tests=ids.map(id=>MAP.get(id).test);let total=0,mass=0;
 for(let h=0;h<matrix.length;h++){
  if(!Array.isArray(matrix[h]))return null;
  for(let a=0;a<matrix[h].length;a++){
   const p=matrix[h][a];if(!Number.isFinite(p)||p<0)return null;
   mass+=p;if(tests.every(test=>test(h,a)))total+=p;
  }
 }
 return Math.abs(mass-1)<1e-8?clamp(total,0,1):null;
}
function quoteAssessment(quote,p,now=new Date()){
 if(!quote||!Number.isFinite(quote.odds)||quote.odds<=1||quote.odds>1000)return {status:'missing',odds:null,edge:null,aboveModel:false};
 const hours=(now.getTime()-Date.parse(quote.observed_at_utc))/3600000;
 const usable=Number.isFinite(hours)&&hours>=0&&hours<=RULES.quoteMaxHours&&['fixture_csv','manual'].includes(quote.kind);
 const edge=usable&&fair(p)!==null?p*quote.odds-1:null;
 return {...quote,status:usable?'available':'stale',edge,aboveModel:edge!==null&&edge>=RULES.priceBuffer};
}
function measure(rows,name,side,test,baseline,core,cutoff){
 const key=core.keyTeam(name),valid=rows.filter(r=>Array.isArray(r)&&Number.isInteger(r[7])&&Number.isInteger(r[8])&&
  r[7]>=0&&r[8]>=0&&r[13]?.AWARDED!==true)
  .filter(r=>r[3]<cutoff&&(core.keyTeam(r[5])===key||core.keyTeam(r[6])===key));
 let hits=0,expected=0;
 for(const r of valid){
  const ownHome=core.keyTeam(r[5])===key,normal=ownHome===side;
  hits+=+test(normal?r[7]:r[8],normal?r[8]:r[7]);
  expected+=normal?baseline.normal:baseline.reverse;
 }
 const n=valid.length,base=n?expected/n:baseline.normal;
 return {hits,n,rate:n?hits/n:null,baseline:base,shrunk:n?(hits+RULES.prior*base)/(n+RULES.prior):base,
  start:valid.at(-1)?.[3]||null,end:valid[0]?.[3]||null};
}
function support(f,profile,test,baseline,p,core){
 const home=measure(profile.home.all,f[5],true,test,baseline,core,f[3]);
 const away=measure(profile.away.all,f[6],false,test,baseline,core,f[3]);
 const homeVenue=measure(profile.home.venue,f[5],true,test,baseline,core,f[3]);
 const awayVenue=measure(profile.away.venue,f[6],false,test,baseline,core,f[3]);
 const formLift=Math.min(home.shrunk-home.baseline,away.shrunk-away.baseline);
 const venueLift=homeVenue.n>=4&&awayVenue.n>=4?Math.min(homeVenue.shrunk-homeVenue.baseline,awayVenue.shrunk-awayVenue.baseline):0;
 const modelLift=p-baseline.normal;
 const disagreement=Math.max(0,Math.abs(p-home.shrunk)-.20,Math.abs(p-away.shrunk)-.20);
 // Ranking units, NOT a probability, confidence percentage or validated expected return.
 const rank=.55*modelLift+.35*formLift+.10*venueLift-.25*disagreement;
 return {home,away,homeVenue,awayVenue,baseline:baseline.normal,leagueN:baseline.n,modelLift,formLift,venueLift,rank};
}
function compare(a,b){
 return Number(b.quote?.aboveModel||false)-Number(a.quote?.aboveModel||false)||b.rank-a.rank||a.id.localeCompare(b.id);
}
function select(candidates,matrix){
 const ordered=candidates.filter(c=>c.eligible).sort(compare),main=ordered[0]||null;
 if(!main)return {main:null,alternatives:[]};
 const families=new Set([main.family]),alternatives=[];
 for(const c of ordered.slice(1)){
  if(families.has(c.family))continue;
  const joint=probability(matrix,[main.id,c.id]);
  if(joint===null||joint/Math.min(main.probability,c.probability)<.5)continue;
  alternatives.push(c);families.add(c.family);if(alternatives.length===2)break;
 }
 return {main,alternatives};
}
function createEngine(history,model,core){
 const bases=new Map(),teams=new Map(),leagueRows=new Map(),references=new Map();
 function context(f){
  if(!bases.has(f[3]))bases.set(f[3],model.leagueBases(history,f[3]));
  const get=name=>{const key=core.keyTeam(name)+'|'+f[3];if(!teams.has(key))teams.set(key,model.teamMatches(history,name,f[3]));return teams.get(key);};
  return {bases:bases.get(f[3]),homeMatches:get(f[5]),awayMatches:get(f[6])};
 }
 function reference(f,test,eventId){
  const key=f[0]+'|'+f[3];
  const eventKey=key+'|'+eventId;if(references.has(eventKey))return references.get(eventKey);
  if(!leagueRows.has(key)){
   const start=String(+f[3].slice(0,4)-3)+f[3].slice(4);
   leagueRows.set(key,history.filter(r=>r[0]===f[0]&&r[3]<f[3]&&r[3]>=start&&model.isPlayed(r)));
  }
  const rows=leagueRows.get(key),n=rows.length;
  const result={n,normal:n?rows.reduce((v,r)=>v+test(r[7],r[8]),0)/n:0,
   reverse:n?rows.reduce((v,r)=>v+test(r[8],r[7]),0)/n:0};
  references.set(eventKey,result);return result;
 }
 function evaluate(f,{profile,quotes={},now=new Date(),pending=false}={}){
  const out={version:VERSION,fixture:f,generatedAt:now.toISOString(),main:null,alternatives:[],builders:[],candidates:[],reason:'',model:null};
  if(!core.getUpcoming([f],now).length){out.reason='Мачът вече е започнал или не е в бъдещата програма.';return out;}
  if(['UCL','UEL','UECL'].includes(f[0])){out.reason='Евротурнир: налична е клубна история, но няма съпоставим модел за тази среща.';return out;}
  if(f[3]===day(now)&&(!(String(f[13]||'').includes('Sofia'))||!/^\d\d:\d\d$/.test(f[4]||''))){out.reason='Непотвърден начален час за днешния мач.';return out;}
  if(!profile||profile.international||profile.home.proxy||profile.away.proxy){out.reason='Отборите нямат еднозначна история в това първенство.';return out;}
  if(pending){out.reason='Има по-нов неполучен или спорен резултат. Изчаква се обновяване.';return out;}
  if(Math.min(profile.home.all.length,profile.away.all.length)<RULES.minimum){out.reason='Нужни са поне 5 предишни срещи за всеки отбор.';return out;}
  if([profile.home,profile.away].some(t=>ageDays(day(now),t.all[0]?.[3])>RULES.maxAgeDays)){
   out.reason='Последната налична среща на отбор е отпреди повече от 45 дни.';return out;
  }
  const ctx=context(f),league=ctx.bases.get(f[0]);
  if(!league||league.n<RULES.leagueMinimum){out.reason='Лиговата база е под 50 предишни срещи.';return out;}
  const evaluation=model.evaluateContext(f,ctx,'standard');
  if(evaluation.error){out.reason=evaluation.error;return out;}
  out.model=evaluation;const matrix=evaluation.distribution.matrix;
  for(const m of MARKETS){
   const p=probability(matrix,[m.id]);if(p===null)continue;
   const e=support(f,profile,m.test,reference(f,m.test,m.id),p,core);
   const quote=quoteAssessment(quotes[m.id],p,now);
   const eligible=p>=RULES.minProbability&&p<=RULES.maxProbability&&e.modelLift>=RULES.minModelLift&&
    e.formLift>=RULES.minFormLift&&e.rank>0;
   out.candidates.push({id:m.id,label:m.label,family:m.family,probability:p,fair:fair(p),evidence:e,rank:e.rank,quote,eligible});
  }
  Object.assign(out,select(out.candidates,matrix));
  if(!out.main){out.reason='Няма ясен избор: моделът и последните резултати не дават достатъчна обща подкрепа.';return out;}
  const eligible=out.candidates.filter(c=>c.eligible).sort(compare).slice(0,10);
  for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++){
   const a=eligible[i],b=eligible[j];if(a.family===b.family)continue;
   const p=probability(matrix,[a.id,b.id]);
   if(p===null||p<.30||p>.78||p>=Math.min(a.probability,b.probability)-1e-9)continue;
   const ids=[a.id,b.id].sort(),test=(h,v)=>MAP.get(a.id).test(h,v)&&MAP.get(b.id).test(h,v);
   const e=support(f,profile,test,reference(f,test,ids.join('+')),p,core);
   if(e.modelLift<RULES.minModelLift||e.formLift<RULES.minFormLift||e.rank<=0)continue;
   const id=ids.join('+');
   out.builders.push({id,label:ids.map(x=>MAP.get(x).label).join(' + '),legs:ids,familyPair:[a.family,b.family].sort().join('+'),probability:p,fair:fair(p),
    evidence:e,rank:e.rank,quote:quoteAssessment(quotes[id],p,now),eligible:true});
  }
  const builderFamilies=new Set();out.builders.sort(compare);
  out.builders=out.builders.filter(b=>{if(builderFamilies.has(b.familyPair))return false;builderFamilies.add(b.familyPair);return true;}).slice(0,2);
  return out;
 }
 return {evaluate};
}
function columns(entries,core){
 const dated=new Map();
 for(const entry of entries){
  const pick=entry.main;if(!pick?.eligible||pick.probability<.55)continue;
  const date=entry.fixture[3];if(!dated.has(date))dated.set(date,[]);
  dated.get(date).push({fixture:entry.fixture,pick,key:core.keyFixture(entry.fixture)});
 }
 const out=[];
 for(const [date,rows] of dated){
  const pool=rows.sort((a,b)=>compare(a.pick,b.pick)||a.key.localeCompare(b.key)).slice(0,12);
  for(const size of [2,3,4]){
   let best=null;
   function visit(start,legs,clubs,keys){
    if(legs.length===size){
     const p=legs.reduce((v,l)=>v*l.pick.probability,1),rank=legs.reduce((v,l)=>v+l.pick.rank,0)/size;
     const score=rank+.05*Math.log(p),key=legs.map(l=>l.key+'|'+l.pick.id).sort().join('~');
     if(!best||score>best.score||score===best.score&&key<best.key){
      best={id:date+'|'+size,key,date,size,legs:[...legs],probability:p,fair:fair(p),rank,score,assumption:'independent_matches'};
     }
     return;
    }
    for(let i=start;i<pool.length;i++){
     const l=pool[i],teams=[core.keyTeam(l.fixture[5]),core.keyTeam(l.fixture[6])];
     if(keys.has(l.key)||teams.some(t=>clubs.has(t)))continue;
     visit(i+1,[...legs,l],new Set([...clubs,...teams]),new Set([...keys,l.key]));
    }
   }
   visit(0,[],new Set(),new Set());if(best)out.push(best);
  }
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.size-b.size);
}
return {VERSION,RULES,MARKETS,fair,probability,quoteAssessment,measure,support,select,createEngine,columns};
});
