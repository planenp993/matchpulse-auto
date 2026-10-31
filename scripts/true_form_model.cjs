/* Isolated, fixed TRUE FORM hypothesis. Never imported by production. */
'use strict';
const M=require('../docs/model-core.js'),F=require('./fit_goal_model.cjs');
const DEFAULTS=Object.freeze({lastMatches:10,minimumMatches:5,halfLifeDays:60,priorMatches:6,
 minimumRatio:.8,maximumRatio:1.25,rho:-.06});
const INTERNATIONAL=new Set(['UCL','UEL','UECL']);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const key=r=>[r[0],r[3],M.clubKey(r[5]),M.clubKey(r[6])].join('|');
function createState(){return new Map();}
function add(state,row,expected){
 if(!M.isPlayed(row)||INTERNATIONAL.has(row[0])||expected.error)return false;
 if(expected.cutoff!==F.weekStart(row[3]))throw Error('Expected goals must come from the historical match week');
 if(![expected.lambdaHome,expected.lambdaAway].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid pre-match expectation');
 if(!state.has(row[0]))state.set(row[0],new Map());
 const league=state.get(row[0]),id=key(row);
 for(const [team,gf,ga,ef,ea] of [[row[5],row[7],row[8],expected.lambdaHome,expected.lambdaAway],
  [row[6],row[8],row[7],expected.lambdaAway,expected.lambdaHome]]){
  const k=M.clubKey(team);if(!league.has(k))league.set(k,[]);
  league.get(k).push({date:row[3],key:id,gf,ga,ef,ea,expectedCutoff:expected.cutoff});
 }
 return true;
}
function teamForm(state,division,team,date){
 const origin=F.dateNumber(date),s=DEFAULTS;
 const rows=(state.get(division)?.get(M.clubKey(team))||[]).filter(r=>r.date<date)
  .slice().sort((a,b)=>b.date.localeCompare(a.date)||b.key.localeCompare(a.key)).slice(0,s.lastMatches);
 if(rows.length<s.minimumMatches)return {error:'insufficient_true_form_history',n:rows.length};
 let weight=0,gf=0,ga=0,ef=0,ea=0;
 for(const r of rows){
  const w=2**(-(origin-F.dateNumber(r.date))/s.halfLifeDays);
  weight+=w;gf+=w*r.gf;ga+=w*r.ga;ef+=w*r.ef;ea+=w*r.ea;
 }
 if(!(weight>0&&ef>0&&ea>0))return {error:'invalid_true_form_expectations',n:rows.length};
 const ratio=(g,e)=>(s.priorMatches*e/weight+g)/(s.priorMatches*e/weight+e);
 const rawAttack=ratio(gf,ef),rawVulnerability=ratio(ga,ea);
 return {n:rows.length,weight,attack:clamp(rawAttack,s.minimumRatio,s.maximumRatio),
  vulnerability:clamp(rawVulnerability,s.minimumRatio,s.maximumRatio),rawAttack,rawVulnerability,
  minDate:rows.at(-1).date,maxDate:rows[0].date,expectedMaxCutoff:rows.reduce((d,r)=>d>r.expectedCutoff?d:r.expectedCutoff,''),
  observationKeys:rows.map(r=>r.key)};
}
function predict(state,fixture,base){
 F.dateNumber(fixture[3]);
 if(base.error)return {error:base.error};
 if(INTERNATIONAL.has(fixture[0]))return {error:'international_excluded'};
 if(base.cutoff!==F.weekStart(fixture[3]))throw Error('Base prediction must use the fixture week');
 if(![base.lambdaHome,base.lambdaAway].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid base prediction');
 const home=teamForm(state,fixture[0],fixture[5],fixture[3]),away=teamForm(state,fixture[0],fixture[6],fixture[3]);
 if(home.error||away.error)return {error:home.error||away.error,homeN:home.n,awayN:away.n};
 const factorHome=Math.sqrt(home.attack*away.vulnerability),factorAway=Math.sqrt(away.attack*home.vulnerability);
 const rawHome=base.lambdaHome*factorHome,rawAway=base.lambdaAway*factorAway;
 const lambdaHome=clamp(rawHome,.15,4.2),lambdaAway=clamp(rawAway,.15,4.2);
 return {lambdaHome,lambdaAway,factorHome,factorAway,home,away,cutoff:base.cutoff,
  clipped:lambdaHome!==rawHome||lambdaAway!==rawAway,distribution:M.distribution(lambdaHome,lambdaAway,DEFAULTS.rho)};
}
module.exports={DEFAULTS,INTERNATIONAL,key,createState,add,teamForm,predict};
