/* Scout Pattern Intelligence v3. Observed streaks and rates, not predictions.
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
const statFields={
 corners85:['HC','AC',8.5],corners95:['HC','AC',9.5],
 yellow35:['HY','AY',3.5],yellow45:['HY','AY',4.5],
 red05:['HR','AR',.5],shots215:['HS','AS',21.5],
 shots255:['HS','AS',25.5],target85:['HST','AST',8.5],
 ht05:['HTHG','HTAG',.5],ht15:['HTHG','HTAG',1.5],
};
const scored=r=>Array.isArray(r)&&Number.isInteger(r[7])&&Number.isInteger(r[8])&&r[7]>=0&&r[8]>=0;
function observation(row,club,side,id,teamKey){
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
 return {n,hits,rate:n?hits/n:null,currentStreak,longestStreak,
  missing:observations.length-n,total:observations.length,
  trail:observations.slice(0,15)};
}
function inspect(profile,market,{streak=3,minimum=5,both=false,teamKey}={}){
 if(typeof teamKey!=='function')throw Error('canonical team key required');
 const h=measures(profile.home.all,profile.home.name,'home',market,teamKey);
 const a=measures(profile.away.all,profile.away.name,'away',market,teamKey);
 const reliable=!profile.international&&!profile.home.proxy&&!profile.away.proxy &&
  h.n>=minimum&&a.n>=minimum;
 const one=h.currentStreak>=streak||a.currentStreak>=streak;
 const dual=h.currentStreak>=streak&&a.currentStreak>=streak;
 const supporting=h.rate!==null&&a.rate!==null&&
  h.rate>=.55&&a.rate>=.55;
 const matched=reliable&&supporting&&(both?dual:one);
 const rank=matched?(h.rate+a.rate)/2 + .05*Math.min(6,h.currentStreak+a.currentStreak):0;
 return {market,label:MAP.get(market)?.label||market,group:MAP.get(market)?.group||'',
  home:h,away:a,reliable,matched,rank,streak,minimum,
  reason:!reliable?'Недостатъчно сравними мачове с налични данни':
   !supporting?'Историческите тенденции на отборите не се подкрепят достатъчно':
   !matched?'Липсва исканата поредна серия':'Поредната серия е налична; не доказва вероятност за бъдещ залог'};
}
function run(index,fixtures,core,{market='o25',days=7,minimum=5,streak=3,both=false,
  windowSize=10,opponentFilter='all',eloIndex=null,league='',now=new Date()}={}){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+Math.max(1,days)-1);
 const last=end.toISOString().slice(0,10);
 const out=[];
 for(const f of core.getUpcoming(fixtures,now)){
  if(f[3]>last||(league&&f[0]!==league))continue;
  const profile=core.profile(index,f,{windowSize,opponentFilter,eloIndex});
  const signal=inspect(profile,market,{streak,minimum,both,teamKey:core.keyTeam});
  if(signal.matched)out.push({fixture:f,profile,signal});
 }
 return out.sort((a,b)=>b.signal.rank-a.signal.rank||
  a.fixture[3].localeCompare(b.fixture[3])||a.fixture[4].localeCompare(b.fixture[4]));
}

/* One pass per match, all supported markets, and no duplicated fixture cards.
 * The preview shows up to 3 distinct observed signals with their sample sizes.
 */
function runAll(index,fixtures,core,{days=7,minimum=5,streak=3,both=false,
 windowSize=10,opponentFilter='all',eloIndex=null,league='',now=new Date()}={}){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+Math.max(1,days)-1);
 const last=end.toISOString().slice(0,10),result=[];
 for(const fixture of core.getUpcoming(fixtures,now)){
  if(fixture[3]>last||(league&&fixture[0]!==league))continue;
  const profile=core.profile(index,fixture,{windowSize,opponentFilter,eloIndex});
  const matches=[];
  for(const market of MARKETS){
   const signal=inspect(profile,market.id,{streak,minimum,both,teamKey:core.keyTeam});
   if(!signal.matched)continue;
   // Ranking is a research heuristic, not a probability.
   const n=Math.min(signal.home.n,signal.away.n);
   const strength=.45*Math.min(1,Math.max(signal.home.currentStreak,signal.away.currentStreak)/6)+
                  .3*Math.min(signal.home.rate,signal.away.rate)+.25*Math.min(1,n/10);
   matches.push({...signal,strength});
  }
  if(!matches.length)continue;
  matches.sort((a,b)=>b.strength-a.strength||
   Math.min(b.home.n,b.away.n)-Math.min(a.home.n,a.away.n)||a.market.localeCompare(b.market));
  result.push({fixture,profile,signal:matches[0],signals:matches.slice(0,3),
   totalSignals:matches.length,strength:matches[0].strength});
 }
 return result.sort((a,b)=>b.strength-a.strength||b.totalSignals-a.totalSignals||
  a.fixture[3].localeCompare(b.fixture[3])||a.fixture[4].localeCompare(b.fixture[4]));
}
return {MARKETS,observation,measures,inspect,run,runAll};
});