/* Scout Pattern Intelligence. Observed streaks and rates, not predictions.
 * Requires both final scores or both relevant supplementary stat fields.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulsePatterns=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MARKETS=[
 {id:'o15',group:'goals',label:'Над 1,5 гола'},
 {id:'o25',group:'goals',label:'Над 2,5 гола'},
 {id:'o35',group:'goals',label:'Над 3,5 гола'},
 {id:'u25',group:'goals',label:'Под 2,5 гола'},
 {id:'u35',group:'goals',label:'Под 3,5 гола'},
 {id:'btts',group:'goals',label:'Гол/гол · Да'},
 {id:'home2',group:'goals',label:'Домакин вкарва 2+ / гост допуска 2+'},
 {id:'away2',group:'goals',label:'Гост вкарва 2+ / домакин допуска 2+'},
 {id:'1X',group:'results',label:'1X · домакин непобеден'},
 {id:'1',group:'results',label:'Победа домакин'},
 {id:'X',group:'results',label:'Равен'},
 {id:'2',group:'results',label:'Победа гост'},
 {id:'12',group:'results',label:'Без равен'},
 {id:'bttsNo',group:'goals',label:'Гол/гол · Не'},
 {id:'X2',group:'results',label:'X2 · гост непобеден'},
 {id:'corners85',group:'corners',label:'Над 8,5 корнера'},
 {id:'corners95',group:'corners',label:'Над 9,5 корнера'},
 {id:'yellow35',group:'cards',label:'Над 3,5 жълти картона'},
 {id:'yellow45',group:'cards',label:'Над 4,5 жълти картона'},
 {id:'red05',group:'cards',label:'Поне 1 червен картон'},
 {id:'shots215',group:'shots',label:'Над 21,5 удара'},
 {id:'shots255',group:'shots',label:'Над 25,5 удара'},
 {id:'target85',group:'shots',label:'Над 8,5 точни удара'},
 {id:'ht05',group:'firsthalf',label:'Поне 1 гол до полувремето'},
 {id:'ht15',group:'firsthalf',label:'Поне 2 гола до полувремето'}
];
const MAP=new Map(MARKETS.map(x=>[x.id,x]));
const FAMILIES={o15:'total-goals',o25:'total-goals',o35:'total-goals',u25:'total-goals',u35:'total-goals',
 btts:'btts',bttsNo:'btts',home2:'home-goals',away2:'away-goals'};
for(const market of MARKETS)market.family=FAMILIES[market.id]||market.group;
const REFERENCE_MINIMUM=50,REFERENCE_YEARS=3,REFERENCE_CACHE=new WeakMap();
const statFields={
 corners85:['HC','AC',8.5],corners95:['HC','AC',9.5],
 yellow35:['HY','AY',3.5],yellow45:['HY','AY',4.5],
 red05:['HR','AR',.5],shots215:['HS','AS',21.5],
 shots255:['HS','AS',25.5],target85:['HST','AST',8.5],
 ht05:['HTHG','HTAG',.5],ht15:['HTHG','HTAG',1.5],
};
const scored=r=>Array.isArray(r)&&Number.isInteger(r[7])&&Number.isInteger(r[8])&&r[7]>=0&&r[8]>=0;
function observation(row,club,side,id,teamKey){
 if(row?.[13]?.AWARDED===true)return null;
 if(!MAP.has(id))return null;
 if(statFields[id]){
  const extra=row[13];
  if(!extra||typeof extra!=='object'||Array.isArray(extra))return null;
  const [a,b,line]=statFields[id];
  const x=extra[a],y=extra[b];
  return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0?x+y>line:null;
 }
 if(!scored(row))return null;
 const isHome=teamKey(row[5])===teamKey(club);
 const gf=isHome?row[7]:row[8],ga=isHome?row[8]:row[7],total=gf+ga;
 switch(id){
  case 'o15':return total>=2;
  case 'o25':return total>=3;
  case 'o35':return total>=4;
  case 'u25':return total<=2;
  case 'u35':return total<=3;
  case 'btts':return gf>0&&ga>0;
  case 'bttsNo':return gf===0||ga===0;
  case '1':return side==='home'?gf>ga:gf<ga;
  case 'X':return gf===ga;
  case '2':return side==='away'?gf>ga:gf<ga;
  case '12':return gf!==ga;
  case 'home2':return side==='home'?gf>=2:ga>=2;
  case 'away2':return side==='away'?gf>=2:ga>=2;
  case '1X':return side==='home'?gf>=ga:gf<=ga;
  case 'X2':return side==='away'?gf>=ga:gf<=ga;
  default:return null;
 }
}
function measures(rows,club,side,market,teamKey){
 const observations=rows.map(r=>observation(r,club,side,market,teamKey));
 const available=observations.filter(v=>v!==null);
 const n=available.length,hits=available.filter(Boolean).length;
 let currentStreak=0,longestStreak=0,run=0;
 // A missing most-recent observation interrupts a consecutive streak.
 for(let i=0;i<observations.length;i++){
  const ok=observations[i]===true;
  run=ok?run+1:0;
  if(run>longestStreak)longestStreak=run;
  if(ok&&i===currentStreak)currentStreak++;
 }
 const knownRows=rows.filter((r,i)=>observations[i]!==null),dates=knownRows.map(r=>r[3]);
 return {n,hits,rate:n?hits/n:null,currentStreak,longestStreak,
  missing:observations.length-n,total:observations.length,
  homeAppearances:knownRows.filter(r=>teamKey(r[5])===teamKey(club)).length,
  dates,trail:observations};
}
function conservativeSupport(hits,n){
 if(!n)return 0;
 const z2=1.96**2,p=hits/n;
 return (p+z2/(2*n)-Math.sqrt(z2*p*(1-p)/n+z2*z2/(4*n*n)))/(1+z2/n);
}
const daysBefore=(date,asOf)=>Math.max(0,(Date.parse(asOf+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000);
// These are observed league frequencies, never forecasts. Each fixture counts
// once. Four role counts allow comparison with the actual home/away mix in each
// club's selected sample, including venue-only and directional result markets.
function leagueReference(index,fixture,core,asOfDate=fixture[3]){
 const cutoff=asOfDate<fixture[3]?asOfDate:fixture[3],key=fixture[0]+'|'+cutoff;
 let cache=REFERENCE_CACHE.get(index);
 if(!cache){cache=new Map();REFERENCE_CACHE.set(index,cache);}
 if(cache.has(key))return cache.get(key);
 const since=String(+cutoff.slice(0,4)-REFERENCE_YEARS)+cutoff.slice(4);
 const reference=new Map(MARKETS.map(m=>[m.id,{n:0,homeAsHome:0,homeAsAway:0,awayAsHome:0,awayAsAway:0,since,until:cutoff}]));
 for(const row of index.history){
  if(row[0]!==fixture[0]||row[3]>=cutoff||row[3]<since||!scored(row)||row[13]?.AWARDED===true)continue;
  for(const market of MARKETS){
   const values=[observation(row,row[5],'home',market.id,core.keyTeam),observation(row,row[6],'home',market.id,core.keyTeam),
    observation(row,row[5],'away',market.id,core.keyTeam),observation(row,row[6],'away',market.id,core.keyTeam)];
   if(values.some(v=>v===null))continue;
   const r=reference.get(market.id);r.n++;
   for(const [i,field] of ['homeAsHome','homeAsAway','awayAsHome','awayAsAway'].entries())r[field]+=+values[i];
  }
 }
 for(const r of reference.values())if(r.n)for(const field of ['homeAsHome','homeAsAway','awayAsHome','awayAsAway'])r[field]/=r.n;
 cache.set(key,reference);return reference;
}
function evidence(home,away,reference,asOfDate,windowSize){
 function side(sample,prefix){
  const coverage=sample.total?sample.n/sample.total:0;
  const ages=sample.dates.map(d=>daysBefore(d,asOfDate));
  // A fixed research rule, not a fitted probability: 21-day grace, then a
  // 180-day half-life. Missing observations reduce coverage, never become zeros.
  const freshness=ages.length?ages.reduce((sum,age)=>sum+2**(-Math.max(0,age-21)/180),0)/ages.length:0;
  const support=conservativeSupport(sample.hits,sample.n)*coverage*freshness;
  const baseline=reference?.n&&sample.n?
   (sample.homeAppearances*reference[prefix+'AsHome']+(sample.n-sample.homeAppearances)*reference[prefix+'AsAway'])/sample.n:null;
  return {coverage,freshness,support,baseline,latestAge:ages.length?Math.min(...ages):null,oldSamples:ages.filter(age=>age>365).length};
 }
 const h=side(home,'home'),a=side(away,'away'),available=!!reference&&reference.n>=REFERENCE_MINIMUM;
 const minimumSupport=Math.min(h.support,a.support),excess=available?Math.min(h.support-h.baseline,a.support-a.baseline):null;
 // Separate comparable league-backed signals from those lacking a reference.
 // Within each tier the weaker side controls rank; streak length and number of
 // overlapping markets add no bonus. Wilson's bound is used only for ranking,
 // not claimed as a confidence interval for these dependent football samples.
 const rank=available?1+excess:minimumSupport-1,notes=[];
 if([h,a].some(v=>v.latestAge>45||v.oldSamples))notes.push('По-стара извадка');
 if(home.missing||away.missing)notes.push('Непълни статистики');
 if(Math.min(home.total,away.total)<windowSize)notes.push('Кратък архив');
 if(!available)notes.push('Малка база за лигата');
 return {rank,minimumSupport,excess,home:h,away:a,notes,
  reference:{available,n:reference?.n||0,homeRate:h.baseline,awayRate:a.baseline,since:reference?.since,until:reference?.until}};
}
function inspect(profile,market,{streak=3,minimum=5,both=false,venue=false,teamKey,reference=null,asOfDate=profile.fixture[3]}={}){
 if(typeof teamKey!=='function')throw Error('canonical team key required');
 const h=measures(venue?profile.home.venue:profile.home.all,profile.home.name,'home',market,teamKey);
 const a=measures(venue?profile.away.venue:profile.away.all,profile.away.name,'away',market,teamKey);
 const reliable=!profile.international&&!profile.home.proxy&&!profile.away.proxy &&
  h.n>=minimum&&a.n>=minimum;
 const one=h.currentStreak>=streak||a.currentStreak>=streak;
 const dual=h.currentStreak>=streak&&a.currentStreak>=streak;
 const supporting=h.rate!==null&&a.rate!==null&&
  h.rate>=.55&&a.rate>=.55;
 const matched=reliable&&supporting&&(both?dual:one);
 const quality=evidence(h,a,reference,asOfDate,profile.windowSize||10),rank=matched?quality.rank:0;
 return {market,venue,label:MAP.get(market)?.label||market,group:MAP.get(market)?.group||'',family:MAP.get(market)?.family||market,
  home:h,away:a,reliable,matched,rank,strength:rank,evidence:quality,streak,minimum,
  reason:!reliable?'Недостатъчно сравними мачове с налични данни':
   !supporting?'Историческите тенденции на отборите не се подкрепят достатъчно':
   !matched?'Липсва исканата поредна серия':'Поредната серия е налична; не доказва вероятност за бъдещ залог'};
}
function compareSignals(a,b){
 return b.rank-a.rank||b.evidence.minimumSupport-a.evidence.minimumSupport||
  Math.min(b.home.n,b.away.n)-Math.min(a.home.n,a.away.n)||a.market.localeCompare(b.market);
}
function compareEntries(a,b){
 // Fixture ordering does not change when redundant signals are added.
 return b.signal.rank-a.signal.rank||b.signal.evidence.minimumSupport-a.signal.evidence.minimumSupport||
  Math.min(b.signal.home.n,b.signal.away.n)-Math.min(a.signal.home.n,a.signal.away.n)||
  a.fixture[3].localeCompare(b.fixture[3])||String(a.fixture[4]||'').localeCompare(String(b.fixture[4]||''))||
  a.fixture[0].localeCompare(b.fixture[0])||a.fixture[5].localeCompare(b.fixture[5])||a.fixture[6].localeCompare(b.fixture[6]);
}
function distinctSignals(matches,limit=3){
 const selected=[],families=new Set(),groups=new Set();
 function add(signal){selected.push(signal);families.add(signal.family);groups.add(signal.group);}
 if(matches.length)add(matches[0]);
 // Prefer a different event group, then fill remaining slots with a different
 // family. Nested totals/corner/card lines never fill several preview slots.
 for(const signal of matches)if(selected.length<limit&&!families.has(signal.family)&&!groups.has(signal.group))add(signal);
 for(const signal of matches)if(selected.length<limit&&!families.has(signal.family))add(signal);
 return selected;
}
function run(index,fixtures,core,{market='o25',days=7,minimum=5,streak=3,both=false,venue=false,
  windowSize=10,opponentFilter='all',eloIndex=null,league='',now=new Date()}={}){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+Math.max(1,days)-1);
 const last=end.toISOString().slice(0,10);
 const out=[],seen=new Set();
 for(const f of core.getUpcoming(fixtures,now)){
  if(f[3]>last||(league&&f[0]!==league))continue;
  const key=core.keyFixture(f);if(seen.has(key))continue;seen.add(key);
  const profile=core.profile(index,f,{windowSize,opponentFilter,eloIndex});
  const reference=leagueReference(index,f,core,date).get(market);
  const signal=inspect(profile,market,{streak,minimum,both,venue,teamKey:core.keyTeam,reference,asOfDate:date});
  if(signal.matched)out.push({fixture:f,profile,signal});
 }
 return out.sort(compareEntries);
}

/* One pass per match, all supported markets, and no duplicated fixture cards.
 * The preview shows up to 3 distinct observed signals with their sample sizes.
 */
function runAll(index,fixtures,core,{days=7,minimum=5,streak=3,both=false,venue=false,
 windowSize=10,opponentFilter='all',eloIndex=null,league='',now=new Date()}={}){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+Math.max(1,days)-1);
 const last=end.toISOString().slice(0,10),result=[],seen=new Set();
 for(const fixture of core.getUpcoming(fixtures,now)){
  if(fixture[3]>last||(league&&fixture[0]!==league))continue;
  const key=core.keyFixture(fixture);if(seen.has(key))continue;seen.add(key);
  const profile=core.profile(index,fixture,{windowSize,opponentFilter,eloIndex});
  const matches=[],reference=leagueReference(index,fixture,core,date);
  for(const market of MARKETS){
   const signal=inspect(profile,market.id,{streak,minimum,both,venue,teamKey:core.keyTeam,reference:reference.get(market.id),asOfDate:date});
   if(!signal.matched)continue;
   matches.push(signal);
  }
  if(!matches.length)continue;
  matches.sort(compareSignals);
  result.push({fixture,profile,signal:matches[0],signals:distinctSignals(matches),
   totalSignals:matches.length,strength:matches[0].strength});
 }
 return result.sort(compareEntries);
}
return {MARKETS,observation,measures,inspect,run,runAll,conservativeSupport,leagueReference,compareSignals,compareEntries,distinctSignals};
});
