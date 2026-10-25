/* Scout additional match statistics. Empirical events, NOT calibrated predictive probabilities. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseMarkets=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DEF=[
 {key:'corners',label:'Корнери',fields:['HC','AC'],thresholds:[7.5,8.5,9.5,10.5]},
 {key:'yellow',label:'Жълти картони',fields:['HY','AY'],thresholds:[2.5,3.5,4.5,5.5]},
 {key:'shots',label:'Удари',fields:['HS','AS'],thresholds:[17.5,21.5,25.5]},
 {key:'target',label:'Точни удари',fields:['HST','AST'],thresholds:[6.5,8.5,10.5]},
 {key:'red',label:'Червен картон',fields:['HR','AR'],thresholds:[0.5]},
];
function valid(x){return typeof x==='number'&&Number.isFinite(x)&&x>=0}
function fields(row,stat){
 if(!Array.isArray(row)||!Array.isArray(stat.fields))return null;
 const src=row[13];
 if(!src||typeof src!=='object'||Array.isArray(src))return null;
 const [h,a]=stat.fields.map(x=>src[x]);
 return valid(h)&&valid(a)?[h,a]:null;
}
function sample(rows,stat){
 const observed=[];
 for(const r of rows.slice(0,15)){
  const got=fields(r,stat);
  if(got)observed.push(got[0]+got[1]);
 }
 const n=observed.length;
 const stats=stat.thresholds.map(level=>{
  const hits=observed.filter(v=>v>level).length;
  return {line:level,hits,n,rate:n?hits/n:null};
 });
 return {n,possible:Math.min(rows.length,15),average:n?observed.reduce((a,b)=>a+b,0)/n:null,lines:stats};
}
function compare(profile,minSamples=5){
 return DEF.map(type=>{
  const home=sample(profile.home.all,type),away=sample(profile.away.all,type);
  return {key:type.key,label:type.label,home,away,eligible:home.n>=minSamples&&away.n>=minSamples,
    isHistoricalOnly:true,caption:'Наблюдавана честота в наличните завършени мачове, не прогноза за следващия двубой.'};
 });
}
function xgReport(profile,teamKey){
 const read=t=>{
  const team=t.name;
  const v=t.all.map(r=>{
   const isHome=teamKey(r[5])===teamKey(team);
   return isHome?r[9]:r[10];
  }).filter(valid);
  return {n:v.length,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
 };
 return {home:read(profile.home),away:read(profile.away)};
}
return {DEFINITIONS:DEF,fields,sample,compare,xgReport};
});