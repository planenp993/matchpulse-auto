/* MATCHPULSE SCOUT - reusable, unit-testable data and trend logic. No API dependency. */
(function(root,factory){
  const out=factory(root?.MatchpulseModel);
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./model-core.js'));
  else root.MatchpulseScout=out;
})(typeof globalThis!=='undefined'?globalThis:this,function(model){
'use strict';
const clean = x=>String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLowerCase();
const keyTeam = x=>model?.clubKey?.(x)||clean(x);
const keyFixture = f=>[f[0],f[3],keyTeam(f[5]),keyTeam(f[6])].join('|');
const isDone = r=>Array.isArray(r)&&Number.isInteger(r[7])&&Number.isInteger(r[8])&&r[7]>=0&&r[8]>=0&&r[13]?.AWARDED!==true;
const blank = ()=>({n:0,gf:0,ga:0,total:0,o15:0,o25:0,o35:0,btts:0,scored:0,scored2:0,conceded2:0,u35:0});
function aggregate(rows,team){
  const k=keyTeam(team),out=blank();
  for(const r of rows){
    if(!isDone(r))continue;
    const h=keyTeam(r[5])===k;
    const gf=h?r[7]:r[8],ga=h?r[8]:r[7],total=gf+ga;
    out.n++;out.gf+=gf;out.ga+=ga;out.total+=total;
    out.o15+=+(total>=2);out.o25+=+(total>=3);out.o35+=+(total>=4);
    out.btts+=+(gf>=1&&ga>=1);out.scored+=+(gf>=1);out.scored2+=+(gf>=2);
    out.conceded2+=+(ga>=2);out.u35+=+(total<=3);
  }
  if(!out.n)return out;
  for(const f of ['gf','ga','total'])out[f]/=out.n;
  return out;
}
function build(history){
  const byDivision=new Map(),global=new Map(),lookup=new Map();
  for(const r of history){
    if(!isDone(r)||!r[3]||!r[0])continue;
    for(const team of [r[5],r[6]]){
      const c=keyTeam(team),d=r[0]+'|'+c;
      if(!byDivision.has(d))byDivision.set(d,[]);
      byDivision.get(d).push(r);
      if(!global.has(c))global.set(c,new Map());
      const per=global.get(c);if(!per.has(r[0]))per.set(r[0],[]);
      per.get(r[0]).push(r);
    }
    const id=keyFixture(r);
    if(!lookup.has(id))lookup.set(id,r);
  }
  const sorted=x=>x.sort((a,b)=>String(b[3]).localeCompare(String(a[3]))||
    String(b[4]||'').localeCompare(String(a[4]||'')));
  for(const a of byDivision.values())sorted(a);
  for(const d of global.values())for(const a of d.values())sorted(a);
  return {history,byDivision,global,lookup};
}
function historyFor(index,team,div,date){
  const c=keyTeam(team);
  const regular=index.byDivision.get(div+'|'+c);
  if(regular?.length)return {list:regular.filter(r=>r[3]<date),proxy:false,scope:div};
  if(!['UCL','UEL','UECL'].includes(div))return {list:[],proxy:false,scope:div};
  const others=index.global.get(c);
  if(!others)return {list:[],proxy:true,scope:'unmatched'};
  const eligible=[...others.entries()].filter(([d])=>!['UCL','UEL','UECL'].includes(d))
    .map(([d,rows])=>[d,rows.filter(r=>r[3]<date)]).filter(([d,rows])=>rows.length>=5)
    .sort((a,b)=>b[1][0][3].localeCompare(a[1][0][3])||b[1].length-a[1].length);
  // Multiple independent eligible divisions can share a club name: refuse guessing.
  if(eligible.length>1&&eligible[0][0]!==eligible[1][0]&&eligible[0][1][0][3]===eligible[1][1][0][3])
    return {list:[],proxy:true,scope:'ambiguous'};
  if(!eligible.length)return {list:[],proxy:true,scope:'unmatched'};
  return {list:eligible[0][1],proxy:true,scope:eligible[0][0]};
}
function profile(index,f,{windowSize=10,opponentFilter='all',eloIndex=null}={}){
  const n=[5,10,20].includes(Number(windowSize))?Number(windowSize):10;
  const condition=['strong','weak'].includes(opponentFilter)?opponentFilter:'all';
  const hm=historyFor(index,f[5],f[0],f[3]),am=historyFor(index,f[6],f[0],f[3]);
  // Select the last N games FIRST, then classify the opponents within that sample.
  // Never reach farther back to fill a selective filter: that hides how small the sample is.
  const filt=(rows,name)=>{
    const last=rows.slice(0,n);
    if(condition==='all')return last;
    if(!eloIndex)return [];
    const elo=typeof globalThis!=='undefined'?globalThis.MatchpulseElo:null;
    // Node/browser callers can supply Elo through index. Keep the module testable in Node.
    const classify=eloIndex.opponentClass||elo?.opponentClass;
    return typeof classify==='function'?last.filter(r=>classify(eloIndex,r,name)===condition):[];
  };
  const homeAll=filt(hm.list,f[5]),awayAll=filt(am.list,f[6]);
  const homeVenue=filt(hm.list.filter(r=>keyTeam(r[5])===keyTeam(f[5])),f[5]);
  const awayVenue=filt(am.list.filter(r=>keyTeam(r[6])===keyTeam(f[6])),f[6]);
  return {
    fixture:f,windowSize:n,opponentFilter:condition,
    home:{name:f[5],all:homeAll,venue:homeVenue,overall:aggregate(homeAll,f[5]),local:aggregate(homeVenue,f[5]),proxy:hm.proxy,scope:hm.scope,totalAvailable:hm.list.length},
    away:{name:f[6],all:awayAll,venue:awayVenue,overall:aggregate(awayAll,f[6]),local:aggregate(awayVenue,f[6]),proxy:am.proxy,scope:am.scope,totalAvailable:am.list.length},
    international:['UCL','UEL','UECL'].includes(f[0])
  };
}
const SIGNALS={
 o25:{name:'Над 2,5',home:'o25',away:'o25'},
 btts:{name:'Гол/гол – Да',home:'btts',away:'btts'},
 home2:{name:'Домакин 2+',home:'scored2',away:'conceded2'},
 away2:{name:'Гост 2+',home:'conceded2',away:'scored2'},
 u35:{name:'Под 3,5',home:'u35',away:'u35'}
};
function trend(profile,market='o25',minSample=8){
 const signal=SIGNALS[market];if(!signal)throw new Error('Unknown market');
 const home=profile.home,away=profile.away;
 const eligible=home.overall.n>=minSample&&away.overall.n>=minSample;
 // International clubs have no comparable tournament opponents in our domestic archive.
 const qualified=eligible&&!profile.international&&!home.proxy&&!away.proxy;
 const h0=home.overall.n?home.overall[signal.home]/home.overall.n:0;
 const a0=away.overall.n?away.overall[signal.away]/away.overall.n:0;
 const hLocal=home.local.n>=4?home.local[signal.home]/home.local.n:null;
 const aLocal=away.local.n>=4?away.local[signal.away]/away.local.n:null;
 const hRate=hLocal===null?h0:(.7*h0+.3*hLocal);
 const aRate=aLocal===null?a0:(.7*a0+.3*aLocal);
 const strength=(hRate+aRate)/2;
 const aligned=hRate>=.6&&aRate>=.6;
 const signalFound=qualified&&aligned&&strength>=.67;
 return {
  market,marketName:signal.name,homeRate:hRate,awayRate:aRate,homeRecent:h0,awayRecent:a0,
  strength,qualified,signalFound,aligned,
  homeCount:home.overall[signal.home],homeTotal:home.overall.n,
  awayCount:away.overall[signal.away],awayTotal:away.overall.n,
  homeVenueCount:home.local[signal.home],homeVenueTotal:home.local.n,
  awayVenueCount:away.local[signal.away],awayVenueTotal:away.local.n,
  explanation:!eligible?'Недостатъчна извадка за единия отбор':
    profile.international?'Този мач изисква отделна оценка на международните съперници':
    aligned?'Двата отбора подкрепят една и съща голова тенденция':'Тенденциите на двата отбора се разминават'
 };
}
function getUpcoming(fixtures,now=new Date()){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 return fixtures.filter(f=>Array.isArray(f)&&f[3]>=date&&
   // Secondary fixtures explicitly have Sofia time; all other sources' timezones may vary.
   (f[3]!==date || !(f[13]||'').includes('Sofia') || (f[4]||'')>=clock) &&
   f[5]&&f[6]&&!isDone(f)).sort((a,b)=>(a[3]+' '+(a[4]||'')).localeCompare(b[3]+' '+(b[4]||'')));
}
function scan(index,fixtures,{market='o25',days=3,minSample=8,league='',now=new Date(),windowSize=10,opponentFilter='all',eloIndex=null}={}){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+Math.max(1,days)-1);
 const last=end.toISOString().slice(0,10);
 const evaluated=[];
 for(const f of getUpcoming(fixtures,now)){
  if(f[3]>last||(league&&f[0]!==league))continue;
  const p=profile(index,f,{windowSize,opponentFilter,eloIndex}),s=trend(p,market,Math.min(minSample,p.windowSize));
  if(!s.qualified||!s.signalFound)continue;
  evaluated.push({fixture:f,profile:p,trend:s});
 }
 return evaluated.sort((a,b)=>b.trend.strength-a.trend.strength||
  a.fixture[3].localeCompare(b.fixture[3])||a.fixture[4].localeCompare(b.fixture[4]));
}
function marketSettled(pick,result){
 if(!isDone(result))return null;
 const [h,a]=[result[7],result[8]],total=h+a;
 const answers={'1':h>a,'X':h===a,'2':h<a,'1X':h>=a,'X2':h<=a,'12':h!==a,
  o15:total>=2,o25:total>=3,o35:total>=4,u25:total<=2,u35:total<=3,
  btts:h>=1&&a>=1,bttsNo:h===0||a===0,home2:h>=2,away2:a>=2};
 const extra=result[13];
 if(extra&&typeof extra==='object'&&!Array.isArray(extra)){
  const stat=(left,right,threshold)=>{
   const x=extra[left],y=extra[right];
   return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0?x+y>threshold:null;
  };
  answers.corners85=stat('HC','AC',8.5);
  answers.corners95=stat('HC','AC',9.5);
  answers.yellow35=stat('HY','AY',3.5);
  answers.yellow45=stat('HY','AY',4.5);
  answers.red05=stat('HR','AR',.5);
  answers.shots215=stat('HS','AS',21.5);
  answers.shots255=stat('HS','AS',25.5);
  answers.target85=stat('HST','AST',8.5);
  answers.ht05=stat('HTHG','HTAG',.5);
  answers.ht15=stat('HTHG','HTAG',1.5);
 }
 return Object.prototype.hasOwnProperty.call(answers,pick.market)?answers[pick.market]:null;
}
function probability(probs,market){
 if(!probs)return null;
 const fields={'1':'homeWin','X':'draw','2':'awayWin','1X':'double1X','X2':'doubleX2','12':'double12',
  o15:'over15',o25:'over25',o35:'over35',btts:'btts',home2:'homeOver15',away2:'awayOver15'};
 const direct=fields[market],opposite={u25:'over25',u35:'over35',bttsNo:'btts'}[market];
 const value=probs[direct||opposite];
 return Number.isFinite(value)&&value>=0&&value<=1?(direct?value:1-value):null;
}
return {build,profile,trend,scan,aggregate,keyTeam,keyFixture,getUpcoming,marketSettled,probability,SIGNALS};
});
