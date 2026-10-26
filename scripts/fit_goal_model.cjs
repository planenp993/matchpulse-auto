/* Offline opponent-adjusted goals model. Node built-ins only; no provider calls.
 * The browser evaluator is unchanged; its score distribution and aliases are shared.
 */
'use strict';
const M=require('../docs/model-core.js');
const DAY=86400000;
const DEFAULTS=Object.freeze({lookbackYears:3,halfLifeDays:180,penalty:6,
 interceptPriorMatches:2,minimumLeagueMatches:50,minimumTeamMatches:5,
 maxIterations:240,tolerance:1e-6,rho:-.06});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function dateNumber(date){
 const n=Date.parse(date+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==date)
  throw new RangeError('Expected a valid ISO date');
 return n/DAY;
}
function weekStart(date){
 dateNumber(date);const d=new Date(date+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);
}
function options(settings){
 const s={...DEFAULTS,...settings};
 if(!(s.halfLifeDays===null||Number.isFinite(s.halfLifeDays)&&s.halfLifeDays>0)||
  !Number.isFinite(s.penalty)||s.penalty<=0||!Number.isFinite(s.interceptPriorMatches)||s.interceptPriorMatches<=0||
  !Number.isInteger(s.lookbackYears)||s.lookbackYears<1||
  !Number.isInteger(s.minimumLeagueMatches)||s.minimumLeagueMatches<1||
  !Number.isInteger(s.minimumTeamMatches)||s.minimumTeamMatches<1||
  !Number.isInteger(s.maxIterations)||s.maxIterations<1||s.maxIterations>2000||
  !Number.isFinite(s.tolerance)||s.tolerance<=0||!Number.isFinite(s.rho)||Math.abs(s.rho)>.2)
  throw new RangeError('Invalid fitted model settings');
 return s;
}
function fit(history,division,cutoff,settings={}){
 const s=options(settings),origin=dateNumber(cutoff),since=String(+cutoff.slice(0,4)-s.lookbackYears)+cutoff.slice(4);
 const rows=history.filter(r=>r[0]===division&&r[3]>=since&&r[3]<cutoff&&M.isPlayed(r))
  .slice().sort((a,b)=>a[3].localeCompare(b[3])||M.clubKey(a[5]).localeCompare(M.clubKey(b[5]))||M.clubKey(a[6]).localeCompare(M.clubKey(b[6])));
 if(rows.length<s.minimumLeagueMatches)return {error:'insufficient_league_history',division,cutoff,n:rows.length};
 const keys=[...new Set(rows.flatMap(r=>[M.clubKey(r[5]),M.clubKey(r[6])]))].sort(),ids=new Map(keys.map((k,i)=>[k,i])),n=keys.length;
 const games=[],counts=new Int32Array(n),observedAttack=new Float64Array(n),observedDefence=new Float64Array(n);
 let weightSum=0,observedHome=0,observedAway=0;
 for(const r of rows){
  const h=ids.get(M.clubKey(r[5])),a=ids.get(M.clubKey(r[6]));
  if(h===a)throw Error('A club cannot play itself');
  const w=s.halfLifeDays===null?1:2**(-(origin-dateNumber(r[3]))/s.halfLifeDays),hg=w*r[7],ag=w*r[8];
  games.push({h,a,w});counts[h]++;counts[a]++;
  observedAttack[h]+=hg;observedAttack[a]+=ag;observedDefence[a]+=hg;observedDefence[h]+=ag;
  observedHome+=hg;observedAway+=ag;weightSum+=w;
 }
 const baseHome=clamp(observedHome/weightSum,.5,2.6),baseAway=clamp(observedAway/weightSum,.4,2.5);
 let homeIntercept=Math.log(baseHome),awayIntercept=Math.log(baseAway);
 const attack=new Float64Array(n),defence=new Float64Array(n),expectedHome=Float64Array.from(games,g=>g.w*baseHome),expectedAway=Float64Array.from(games,g=>g.w*baseAway);
 const expected=new Float64Array(n),factors=new Float64Array(n),prior=s.interceptPriorMatches,penalty=s.penalty;
 function objective(){
  let value=0;
  for(let i=0;i<games.length;i++)value+=expectedHome[i]+expectedAway[i];
  value-=observedHome*homeIntercept+observedAway*awayIntercept;
  value+=prior*(Math.exp(homeIntercept)-baseHome*homeIntercept+Math.exp(awayIntercept)-baseAway*awayIntercept);
  for(let i=0;i<n;i++)value+=penalty/2*(attack[i]**2+defence[i]**2)-observedAttack[i]*attack[i]-observedDefence[i]*defence[i];
  return value;
 }
 // Independent scalar Newton steps within each block; exact objective decrease
 // is checked analytically before a step is accepted. Expected counts are rescaled.
 function block(values,observed,isAttack){
  expected.fill(0);
  for(let i=0;i<games.length;i++){
   const g=games[i];expected[isAttack?g.h:g.a]+=expectedHome[i];expected[isAttack?g.a:g.h]+=expectedAway[i];
  }
  let change=0;
  for(let i=0;i<n;i++){
   const x=values[i],e=expected[i],o=observed[i];
   let delta=clamp((o-e-penalty*x)/(e+penalty),-.75,.75);
   while(e*Math.expm1(delta)-o*delta+penalty*x*delta+penalty/2*delta**2>1e-12&&Math.abs(delta)>1e-10)delta/=2;
   values[i]+=delta;factors[i]=Math.exp(delta);change=Math.max(change,Math.abs(delta));
  }
  for(let i=0;i<games.length;i++){
   const g=games[i];expectedHome[i]*=factors[isAttack?g.h:g.a];expectedAway[i]*=factors[isAttack?g.a:g.h];
  }
  return change;
 }
 const trace=[objective()];let converged=false,iterations=0;
 for(;iterations<s.maxIterations;){
  let change=Math.max(block(attack,observedAttack,true),block(defence,observedDefence,false));
  let sumH=0,sumA=0;for(let i=0;i<games.length;i++){sumH+=expectedHome[i];sumA+=expectedAway[i];}
  const factorH=(observedHome+prior*baseHome)/(sumH+prior*Math.exp(homeIntercept));
  const factorA=(observedAway+prior*baseAway)/(sumA+prior*Math.exp(awayIntercept));
  const dh=Math.log(factorH),da=Math.log(factorA);homeIntercept+=dh;awayIntercept+=da;
  for(let i=0;i<games.length;i++){expectedHome[i]*=factorH;expectedAway[i]*=factorA;}
  change=Math.max(change,Math.abs(dh),Math.abs(da));iterations++;
  const loss=objective();
  if(!Number.isFinite(loss)||loss>trace.at(-1)+1e-7*Math.max(1,Math.abs(trace.at(-1))))throw Error('Fitted objective increased or is not finite');
  trace.push(loss);
  if(change<s.tolerance){converged=true;break;}
 }
 // A normalized first-order residual independently checks the optimizer.
 const gradA=Float64Array.from(observedAttack,(v,i)=>v-penalty*attack[i]);
 const gradD=Float64Array.from(observedDefence,(v,i)=>v-penalty*defence[i]);let sumH=0,sumA=0;
 for(let i=0;i<games.length;i++){
  const g=games[i],h=expectedHome[i],a=expectedAway[i];sumH+=h;sumA+=a;gradA[g.h]-=h;gradA[g.a]-=a;gradD[g.a]-=h;gradD[g.h]-=a;
 }
 let residual=Math.max(Math.abs(observedHome+prior*baseHome-sumH-prior*Math.exp(homeIntercept))/(1+observedHome),
  Math.abs(observedAway+prior*baseAway-sumA-prior*Math.exp(awayIntercept))/(1+observedAway));
 for(let i=0;i<n;i++)residual=Math.max(residual,Math.abs(gradA[i])/(1+observedAttack[i]),Math.abs(gradD[i])/(1+observedDefence[i]));
 return {division,cutoff,since,n:rows.length,trainingMaxDate:rows.at(-1)[3],settings:s,
  homeIntercept,awayIntercept,baseHome,baseAway,weightSum,
  teams:Object.fromEntries(keys.map((key,i)=>[key,{attack:attack[i],defence:defence[i],n:counts[i]}])),
  converged:converged&&residual<1e-5,iterations,residual,objective:trace.at(-1),objectiveTrace:trace};
}
function predict(model,fixture){
 if(model.error)return {error:model.error};
 dateNumber(fixture[3]);
 if(fixture[0]!==model.division)throw Error('Fitted model cannot cross leagues');
 if(fixture[3]<model.cutoff)throw Error('Fitted model contains future training data');
 if(!model.converged)return {error:'not_converged'};
 const h=model.teams[M.clubKey(fixture[5])],a=model.teams[M.clubKey(fixture[6])];
 if(!h||!a)return {error:'unknown_team'};
 if(Math.min(h.n,a.n)<model.settings.minimumTeamMatches)return {error:'insufficient_team_history'};
 const rawHome=Math.exp(model.homeIntercept+h.attack+a.defence),rawAway=Math.exp(model.awayIntercept+a.attack+h.defence);
 const lambdaHome=clamp(rawHome,.15,4.2),lambdaAway=clamp(rawAway,.15,4.2);
 return {lambdaHome,lambdaAway,clipped:lambdaHome!==rawHome||lambdaAway!==rawAway,
  distribution:M.distribution(lambdaHome,lambdaAway,model.settings.rho),cutoff:model.cutoff,homeN:h.n,awayN:a.n};
}
function blendVector(prediction,reference,weight){
 if(!Number.isFinite(weight)||weight<0||weight>1||prediction.length!==reference.length)throw new RangeError('Invalid coherent blend');
 return prediction.map((p,i)=>{
  const q=reference[i];if(!Number.isFinite(p)||!Number.isFinite(q)||p<0||p>1+1e-12||q<0||q>1+1e-12)throw new RangeError('Invalid probability');
  return (1-weight)*p+weight*q;
 });
}
module.exports={DEFAULTS,dateNumber,weekStart,fit,predict,blendVector};
