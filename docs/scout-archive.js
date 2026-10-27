/* Archive wiring only: domestic algorithms and model inputs stay isolated. */
(function(root){
'use strict';
const european=f=>['UCL','UEL','UECL'].includes(f[0]);
function build(Scout,domestic,europe,links={},names={}){
 const main=Scout.build(domestic),international=Scout.build([...domestic,...europe]);
 const pending=new Map(),seen=new Set();
 for(const [key,link] of Object.entries(links.matches||{})){
  if(!['awaiting_result','conflict'].includes(link.state)||seen.has(link.id||key))continue;
  seen.add(link.id||key);
  const [div,date,home,away]=(link.current_key||key).split('|');
  for(const club of [home,away]){
   if(!pending.has(club))pending.set(club,[]);
   pending.get(club).push({div,date,kickoff:link.kickoff_utc,state:link.state});
  }
 }
 function targetFixture(f){const mapped=names[Scout.keyFixture(f)],target=mapped?[...f]:f;
  if(mapped){target[5]=mapped.home;target[6]=mapped.away;}return target;}
 function recentProfile(f,{windowSize=10,now=new Date()}={}){
  const target=targetFixture(f),n=[5,10,20].includes(+windowSize)?+windowSize:10;
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  function team(name,home){
   const key=Scout.keyTeam(name),byDiv=international.global.get(key)||new Map();
   const domesticRows=[...byDiv.entries()].filter(([div])=>!european([div])).flatMap(([,rows])=>rows);
   const countries=new Set(domesticRows.map(r=>r[1]));
   const country=!european(f)?f[1]:countries.size===1?[...countries][0]:null;
   const ambiguous=countries.size>1;
   const allowed=new Set(domesticRows.filter(r=>country&&r[1]===country).map(r=>r[0]));
   const rows=[...byDiv.values()].flat().filter(r=>r[3]<f[3]&&
    (ambiguous?r[0]===f[0]:european(r)||allowed.has(r[0])));
   const unique=[...new Map(rows.map(r=>[Scout.keyFixture(r),r])).values()]
    .sort((a,b)=>b[3].localeCompare(a[3])||String(b[4]||'').localeCompare(String(a[4]||''))||a[0].localeCompare(b[0]));
   const all=unique.slice(0,n),venue=unique.filter(r=>Scout.keyTeam(r[home?5:6])===key).slice(0,n);
   const latest=all[0]?.[3]||'';
   const unresolved=(pending.get(key)||[]).filter(p=>p.date>=latest&&p.date<f[3]&&
    (european([p.div])||allowed.has(p.div))&&
    (p.date<today||(p.state==='conflict'&&p.date===today)||Number.isFinite(Date.parse(p.kickoff))&&now.getTime()-Date.parse(p.kickoff)>=3*3600000))
    .sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
   return {name,all,venue,overall:Scout.aggregate(all,name),local:Scout.aggregate(venue,name),proxy:ambiguous,scope:'all_available',
    totalAvailable:unique.length,pendingLatest:unresolved,competitions:[...new Set(all.map(r=>r[0]))]};
  }
  return {fixture:target,windowSize:n,opponentFilter:'all',international:european(f),recentScope:true,
   home:team(target[5],true),away:team(target[6],false),
   coverageNote:'Първенства + УЕФА от наличния архив. Националните купи не са включени.'};
 }
 return {main,international,
  recentProfile,
  profile(f,options){
   const target=targetFixture(f);
   const p=Scout.profile(european(f)?international:main,target,options);
   return p;
  },
  direct(f){const mapped=names[Scout.keyFixture(f)];return {index:european(f)?international:main,home:mapped?.home||f[5],away:mapped?.away||f[6]};},
  result(p){const key=Scout.keyPick(p),link=links.matches?.[key];
   if(link&&['conflict','awarded','cancelled'].includes(link.state))return null;
   return main.lookup.get(link?.result_key||key)||international.lookup.get(link?.result_key||key)||null;
  }
 };
}
const api={build,european};if(typeof module==='object'&&module.exports)module.exports=api;root.MatchpulseArchive=api;
})(typeof window!=='undefined'?window:globalThis);
