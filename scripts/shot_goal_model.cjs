/* Fixed, deliberately simple shot-volume component. Not event-level xG. */
'use strict';
const M=require('../docs/model-core.js'),F=require('./fit_goal_model.cjs');
const DEFAULTS=Object.freeze({lookbackYears:3,halfLifeDays:180,priorMatches:6,minimumLeagueMatches:50,minimumTeamMatches:5,rho:-.06});
const METRICS=Object.freeze({shots:['HS','AS'],sot:['HST','AST']});
function observed(row){
 const s=row[13];
 return !!(M.isPlayed(row)&&s&&typeof s==='object'&&['HS','AS','HST','AST'].every(k=>Number.isInteger(s[k])&&s[k]>=0)&&s.HST<=s.HS&&s.AST<=s.AS);
}
function fit(history,division,cutoff,settings={}){
 F.dateNumber(cutoff);const opts={...DEFAULTS,...settings};
 if(!Number.isInteger(opts.lookbackYears)||opts.lookbackYears<1||!Number.isFinite(opts.halfLifeDays)||opts.halfLifeDays<=0||
  !Number.isFinite(opts.priorMatches)||opts.priorMatches<=0||!Number.isInteger(opts.minimumLeagueMatches)||opts.minimumLeagueMatches<1||
  !Number.isInteger(opts.minimumTeamMatches)||opts.minimumTeamMatches<1||!Number.isFinite(opts.rho)||Math.abs(opts.rho)>.2)throw new RangeError('Invalid shot settings');
 const since=String(+cutoff.slice(0,4)-opts.lookbackYears)+cutoff.slice(4),origin=F.dateNumber(cutoff);
 const rows=history.filter(r=>r[0]===division&&r[3]>=since&&r[3]<cutoff&&observed(r)).slice()
  .sort((a,b)=>a[3].localeCompare(b[3])||M.clubKey(a[5]).localeCompare(M.clubKey(b[5]))||M.clubKey(a[6]).localeCompare(M.clubKey(b[6])));
 if(rows.length<opts.minimumLeagueMatches)return {error:'insufficient_shot_league_history',division,cutoff,n:rows.length};
 const weights=rows.map(r=>2**(-(origin-F.dateNumber(r[3]))/opts.halfLifeDays)),weightSum=weights.reduce((a,b)=>a+b,0),metrics={};
 for(const [id,[hkey,akey]] of Object.entries(METRICS)){
  const baseHome=rows.reduce((sum,r,i)=>sum+weights[i]*r[13][hkey],0)/weightSum;
  const baseAway=rows.reduce((sum,r,i)=>sum+weights[i]*r[13][akey],0)/weightSum;
  if(!(baseHome>0&&baseAway>0))return {error:'zero_shot_base',division,cutoff,n:rows.length};
  const clubs=new Map();
  function add(key,attack,defence,w){
   const c=clubs.get(key)||{attack:0,defence:0,weight:0,n:0};c.attack+=w*attack;c.defence+=w*defence;c.weight+=w;c.n++;clubs.set(key,c);
  }
  for(let i=0;i<rows.length;i++){
   const r=rows[i],h=M.clubKey(r[5]),a=M.clubKey(r[6]),s=r[13],w=weights[i];
   if(h===a)throw Error('A club cannot play itself');
   add(h,s[hkey]/baseHome,s[akey]/baseAway,w);add(a,s[akey]/baseAway,s[hkey]/baseHome,w);
  }
  const p=opts.priorMatches;
  metrics[id]={baseHome,baseAway,teams:Object.fromEntries([...clubs].sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>
   [k,{attack:(p+c.attack)/(p+c.weight),defence:(p+c.defence)/(p+c.weight),n:c.n,weight:c.weight}]))};
 }
 return {division,cutoff,since,n:rows.length,trainingMaxDate:rows.at(-1)[3],weightSum,settings:opts,metrics};
}
function predict(model,goals,fixture){
 F.dateNumber(fixture[3]);
 if(model.error)return {error:model.error};
 if(goals.error)return {error:goals.error};
 if(model.division!==fixture[0]||goals.division!==fixture[0])throw Error('Shot component cannot cross leagues');
 if(model.cutoff!==goals.cutoff||fixture[3]<model.cutoff)throw Error('Shot and goal training cutoffs differ or contain future data');
 if(!goals.converged)return {error:'not_converged'};
 const h=M.clubKey(fixture[5]),a=M.clubKey(fixture[6]),predictions={};
 for(const [id,metric] of Object.entries(model.metrics)){
  if(!Object.hasOwn(metric.teams,h)||!Object.hasOwn(metric.teams,a))return {error:'unknown_shot_team'};
  const home=metric.teams[h],away=metric.teams[a];
  if(Math.min(home.n,away.n)<model.settings.minimumTeamMatches)return {error:'insufficient_shot_team_history'};
  const rawHome=goals.baseHome*home.attack*away.defence,rawAway=goals.baseAway*away.attack*home.defence;
  const clamp=v=>Math.max(.15,Math.min(4.2,v)),lambdaHome=clamp(rawHome),lambdaAway=clamp(rawAway);
  predictions[id]={lambdaHome,lambdaAway,clipped:lambdaHome!==rawHome||lambdaAway!==rawAway,
   distribution:M.distribution(lambdaHome,lambdaAway,model.settings.rho),homeN:home.n,awayN:away.n};
 }
 return {cutoff:model.cutoff,predictions};
}
function mixVectors(vectors,weights){
 if(!vectors.length||vectors.length!==weights.length||!weights.every(w=>Number.isFinite(w)&&w>=0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-10||
  vectors.some(p=>p.length!==vectors[0].length||p.some(v=>!Number.isFinite(v)||v<0||v>1+1e-12)))throw new RangeError('Invalid matrix mixture');
 return vectors[0].map((_,i)=>vectors.reduce((sum,p,j)=>sum+weights[j]*p[i],0));
}
module.exports={DEFAULTS,METRICS,observed,fit,predict,mixVectors};
