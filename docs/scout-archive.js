/* Archive wiring only: domestic algorithms and model inputs stay isolated. */
(function(root){
'use strict';
const european=f=>['UCL','UEL','UECL'].includes(f[0]);
function build(Scout,domestic,europe,links={},names={}){
 const main=Scout.build(domestic),international=Scout.build([...domestic,...europe]);
 return {main,international,
  profile(f,options){
   const mapped=names[Scout.keyFixture(f)],target=mapped?[...f]:f;
   if(mapped){target[5]=mapped.home;target[6]=mapped.away;}
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
