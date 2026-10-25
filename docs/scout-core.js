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
const isDone = r=>Array.isArray(r)&&Number.isInteger(r[7])&&Number.isInteger(r[8])&&r[7]>=0&&r[8]>=0;
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
  if(regular?.length)return {list:regular.filter(r=>r[3]<date).slice(0,50),proxy:false,scope:div};
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
  return {list:eligible[0][1].slice(0,50),proxy:true,scope:eligible[0][0]};
}
function profile(index,f){
  const hm=historyFor(index,f[5],f[0],f[3]);
  const am=historyFor(index,f[6],f[0],f[3]);
  const homeAll=hm.list.slice(0,10),awayAll=am.list.slice(0,10);
  const homeVenue=hm.list.filter(r=>keyTeam(r[5])===keyTeam(f[5])).slice(0,10);
  const awayVenue=am.list.filter(r=>keyTeam(r[6])===keyTeam(f[6])).slice(0,10);
  return {
    fixture:f,
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
function scan(index,fixtures,{market='o25',days=3,minSample=8,league='',now=new Date()}={}){
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(date+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+Math.max(1,days)-1);
 const last=end.toISOString().slice(0,10);
 const evaluated=[];
 for(const f of getUpcoming(fixtures,now)){
  if(f[3]>last||(league&&f[0]!==league))continue;
  const p=profile(index,f),s=trend(p,market,minSample);
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
  o15:total>=2,o25:total>=3,o35:total>=4,u35:total<=3,
  btts:h>=1&&a>=1,home2:h>=2,away2:a>=2};
 const extra=result[13];
 if(extra&&typeof extra==='object'&&!Array.isArray(extra)){
  const stat=(left,right,threshold)=>{
   const x=extra[left],y=extra[right];
   return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0?x+y>threshold:null;
  };
  answers.corners85=stat('HC','AC',8.5);
  answers.corners95=stat('HC','AC',9.5);
  answers.yellow35=stat('HY','AY',3.5);
  answers.shots215=stat('HS','AS',21.5);
  answers.target85=stat('HST','AST',8.5);
 }
 return Object.prototype.hasOwnProperty.call(answers,pick.market)?answers[pick.market]:null;
}
return {build,profile,trend,scan,aggregate,keyTeam,keyFixture,getUpcoming,marketSettled,SIGNALS};
});