/* Exact chronological scanner replay; no browser or provider dependencies. */
'use strict';
const Core=require('../docs/scout-core.js'),P=require('../docs/scout-patterns.js'),M=require('../docs/model-core.js');
const F=require('./fit_goal_model.cjs');
const VARIANTS=Object.freeze(['current','league_frequency','shrunken_excess']);
const ROLES=['homeAsHome','homeAsAway','awayAsHome','awayAsAway'];
const lower=(rows,date)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][3]<date)lo=mid+1;else hi=mid;}return lo;};
// Integer prefix sums reproduce the original four-role leagueReference exactly.
// Only the last query per league is cached; thousands of dates do not accumulate.
function referenceIndex(history){
 const leagues=new Map(),cache=new Map();
 for(const row of history)if(M.isPlayed(row)){
  if(!leagues.has(row[0]))leagues.set(row[0],[]);leagues.get(row[0]).push(row);
 }
 for(const [division,rows] of leagues){
  rows.sort((a,b)=>a[3].localeCompare(b[3]));
  const sums=new Map(P.MARKETS.map(m=>[m.id,Object.fromEntries(['n',...ROLES].map(k=>[k,new Int32Array(rows.length+1)]))]));
  for(let i=0;i<rows.length;i++)for(const market of P.MARKETS){
   const row=rows[i],v=[P.observation(row,row[5],'home',market.id,Core.keyTeam),P.observation(row,row[6],'home',market.id,Core.keyTeam),
    P.observation(row,row[5],'away',market.id,Core.keyTeam),P.observation(row,row[6],'away',market.id,Core.keyTeam)],sum=sums.get(market.id);
   const valid=v.every(x=>x!==null);sum.n[i+1]=sum.n[i]+Number(valid);
   for(let j=0;j<ROLES.length;j++)sum[ROLES[j]][i+1]=sum[ROLES[j]][i]+(valid?Number(v[j]):0);
  }
  leagues.set(division,{rows,sums});
 }
 function forFixture(fixture,asOfDate=fixture[3]){
  F.dateNumber(fixture[3]);F.dateNumber(asOfDate);
  const cutoff=asOfDate<fixture[3]?asOfDate:fixture[3],division=fixture[0],old=cache.get(division);
  if(old?.cutoff===cutoff)return old.value;
  const since=String(+cutoff.slice(0,4)-3)+cutoff.slice(4),league=leagues.get(division),value=new Map();
  const end=league?lower(league.rows,cutoff):0,start=league?lower(league.rows,since):0;
  for(const m of P.MARKETS){
   const sums=league?.sums.get(m.id),n=sums?sums.n[end]-sums.n[start]:0,r={n,since,until:cutoff};
   for(const k of ROLES)r[k]=n?(sums[k][end]-sums[k][start])/n:0;value.set(m.id,r);
  }
  cache.set(division,{cutoff,value});return value;
 }
 return {forFixture};
}
function rerank(signal,reference,variant){
 if(!VARIANTS.includes(variant))throw new RangeError('Unknown scanner variant');
 if(variant==='current')return signal;
 if(!signal.evidence.reference.available)throw Error('A comparable league reference is required');
 let rank,minimumSupport,home=signal.evidence.home,away=signal.evidence.away;
 if(variant==='league_frequency'){
  const p=reference.homeAsHome;rank=1+p;minimumSupport=p;
 }else{
  const shrink=(sample,e)=>({...e,support:((sample.hits+6*e.baseline)/(sample.n+6))*e.coverage*e.freshness});
  home=shrink(signal.home,home);away=shrink(signal.away,away);
  minimumSupport=Math.min(home.support,away.support);rank=1+Math.min(home.support-home.baseline,away.support-away.baseline);
 }
 return {...signal,rank,strength:rank,evidence:{...signal.evidence,minimumSupport,excess:variant==='shrunken_excess'?rank-1:null,home,away}};
}
function inspectFixtures(index,references,fixtures,windowSize=10){
 if(![5,10,20].includes(windowSize))throw new RangeError('Expected a 5/10/20 scanner window');
 const entries=[],counts={fixtures:fixtures.length,matched_signals:0,without_league_reference:0,comparable_signals:0};
 for(const fixture of fixtures){
  const profile=Core.profile(index,fixture,{windowSize}),refs=references.forFixture(fixture),signals=[];
  for(const market of P.MARKETS){
   const reference=refs.get(market.id),signal=P.inspect(profile,market.id,{streak:3,minimum:5,both:false,venue:false,
    teamKey:Core.keyTeam,reference,asOfDate:fixture[3]});
   if(!signal.matched)continue;counts.matched_signals++;
   if(!signal.evidence.reference.available){counts.without_league_reference++;continue;}
   signals.push({signal,reference});counts.comparable_signals++;
  }
  if(signals.length)entries.push({fixture,signals});
 }
 return {entries,counts};
}
function withStreak(entries,streak){
 if(![3,4,5].includes(streak))throw new RangeError('Expected a 3/4/5 streak');
 return entries.map(entry=>({...entry,signals:entry.signals.filter(({signal:s})=>Math.max(s.home.currentStreak,s.away.currentStreak)>=streak)
  .map(x=>({...x,signal:streak===3?x.signal:{...x.signal,streak}}))})).filter(e=>e.signals.length);
}
function rankDay(entries,variant){
 const all=[],markets=new Map();
 for(const entry of entries){
  const signals=entry.signals.map(({signal,reference})=>({signal:rerank(signal,reference,variant),reference}));
  signals.sort((a,b)=>P.compareSignals(a.signal,b.signal));
  if(signals.length)all.push({fixture:entry.fixture,...signals[0]});
  for(const x of signals){
   if(!markets.has(x.signal.market))markets.set(x.signal.market,[]);
   markets.get(x.signal.market).push({fixture:entry.fixture,...x});
  }
 }
 all.sort(P.compareEntries);for(const rows of markets.values())rows.sort(P.compareEntries);
 return {all,markets};
}
const metric=()=>({selected:0,settled:0,hits:0,baselineSum:0,liftSum:0,missingBaseSum:0});
function addMetric(target,source){for(const key of Object.keys(metric()))target[key]+=source[key];return target;}
// Resolve only the already-selected leader. Missing outcomes never pull in a
// replacement from below the cutoff or from another signal on the same card.
function selectedMetric(ranked,k,resolve){
 const out=metric();
 for(const entry of ranked.slice(0,k)){
  const base=entry.reference.homeAsHome,actual=resolve(entry);
  if(!Number.isFinite(base)||base<0||base>1||![true,false,null].includes(actual))throw Error('Invalid scanner outcome or baseline');
  out.selected++;
  if(actual===null)out.missingBaseSum+=base;
  else{out.settled++;out.hits+=Number(actual);out.baselineSum+=base;out.liftSum+=Number(actual)-base;}
 }
 return out;
}
module.exports={VARIANTS,referenceIndex,rerank,inspectFixtures,withStreak,rankDay,metric,addMetric,selectedMetric};
