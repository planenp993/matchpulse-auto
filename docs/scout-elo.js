/* Scout Elo: transparent division-specific retrospective opponent strength, no future leakage.
 * Baseline 1500, K=24, home advantage=65 Elo points; no cross-league comparisons.
 * All matches on the same day use ratings from BEFORE that day.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseElo=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const INITIAL=1500,K=24,HOME_ADVANTAGE=65,DIFFERENCE=75,MIN_GAMES=5,REGRESSION=.82;
const seasonAt=(div,date)=>{
 const yr=Number(date.slice(0,4)),mo=Number(date.slice(5,7));
 return (div==='NOR'||div==='SWE')?yr:(mo>=7?yr:yr-1);
};
function adjusted(row,season){
 if(!row)return {rating:INITIAL,games:0,season};
 const elapsed=Math.max(0,season-row.season);
 return {...row,rating:INITIAL+(row.rating-INITIAL)*Math.pow(REGRESSION,elapsed),season};
}
const valid=r=>Array.isArray(r)&&typeof r[0]==='string'&&typeof r[3]==='string'&&
 typeof r[5]==='string'&&typeof r[6]==='string'&&
 Number.isInteger(r[7])&&Number.isInteger(r[8])&&r[7]>=0&&r[8]>=0&&r[13]?.AWARDED!==true;
const expected=(home,away)=>1/(1+Math.pow(10,(away-home-HOME_ADVANTAGE)/400));
function build(history,keyTeam){
 if(typeof keyTeam!=='function')throw Error('Elo requires canonical team key function');
 const rows=history.filter(valid).slice().sort((a,b)=>a[3].localeCompare(b[3])||a[0].localeCompare(b[0])||
  a[5].localeCompare(b[5])||a[6].localeCompare(b[6]));
 const states=new Map(),timeline=new Map(),before=new WeakMap();
 const key=(division,team)=>division+'|'+keyTeam(team);
 const read=(k,div,date)=>adjusted(states.get(k),seasonAt(div,date));
 for(let at=0;at<rows.length;){
  let end=at+1;while(end<rows.length&&rows[end][3]===rows[at][3])end++;
  const adjustments=new Map(),increments=new Map(),day=rows[at][3],divisionFor=new Map();
  for(let i=at;i<end;i++){
   const r=rows[i],hk=key(r[0],r[5]),ak=key(r[0],r[6]);
   if(hk===ak)continue;
   const h=read(hk,r[0],day),a=read(ak,r[0],day),p=expected(h.rating,a.rating);
   before.set(r,{home:h.rating,away:a.rating,homeN:h.games,awayN:a.games,date:day,div:r[0]});
   const outcome=r[7]>r[8]?1:r[7]===r[8]?.5:0;
   const goalMargin=Math.min(1.5,1+0.22*Math.log1p(Math.abs(r[7]-r[8])));
   const delta=K*goalMargin*(outcome-p);
   divisionFor.set(hk,r[0]);divisionFor.set(ak,r[0]);
   adjustments.set(hk,(adjustments.get(hk)||0)+delta);
   adjustments.set(ak,(adjustments.get(ak)||0)-delta);
   increments.set(hk,(increments.get(hk)||0)+1);
   increments.set(ak,(increments.get(ak)||0)+1);
  }
  for(const [k,change] of adjustments){
   const div=divisionFor.get(k),prior=read(k,div,day),next={rating:prior.rating+change,games:prior.games+(increments.get(k)||0),season:seasonAt(div,day)};
   states.set(k,next);
   if(!timeline.has(k))timeline.set(k,[]);
   timeline.get(k).push({date:day,...next});
  }
  at=end;
 }
 return {before,states,timeline,keyTeam,allGames:rows.length};
}
function teamAt(index,division,team,cutoff){
 const list=index.timeline.get(division+'|'+index.keyTeam(team))||[];
 let low=0,high=list.length;
 while(low<high){
  const mid=(low+high)>>1;
  if(list[mid].date<cutoff)low=mid+1;else high=mid;
 }
 return adjusted(low?list[low-1]:null,seasonAt(division,cutoff));
}
function matchup(index,fixture){
 const h=teamAt(index,fixture[0],fixture[5],fixture[3]);
 const a=teamAt(index,fixture[0],fixture[6],fixture[3]);
 const usable=h.games>=MIN_GAMES&&a.games>=MIN_GAMES&&!['UCL','UEL','UECL'].includes(fixture[0]);
 return {home:h,away:a,usable,gap:h.rating-a.rating,
  homeExpected:usable?expected(h.rating,a.rating):null,
  label:!usable?'Нужна е повече история от едно първенство':
   Math.abs(h.rating-a.rating)<DIFFERENCE?'Близка рейтингова сила':
   h.rating>a.rating?'Домакинът има по-висок Elo':'Гостът има по-висок Elo'};
}
function opponentClass(index,row,team){
 const data=index.before.get(row);
 if(!data||Math.min(data.homeN,data.awayN)<MIN_GAMES)return 'unknown';
 const ownHome=index.keyTeam(row[5])===index.keyTeam(team);
 const own=index.keyTeam(ownHome?row[5]:row[6]);
 if(own!==index.keyTeam(team))return 'unknown';
 const difference=ownHome?data.away-data.home:data.home-data.away;
 return difference>=DIFFERENCE?'strong':difference<=-DIFFERENCE?'weak':'similar';
}
function breakdown(index,rows,team){
 let strong=0,weak=0,similar=0,unknown=0;
 for(const r of rows){
  const quality=opponentClass(index,r,team);
  if(quality==='strong')strong++;else if(quality==='weak')weak++;
  else if(quality==='similar')similar++;else unknown++;
 }
 return {strong,weak,similar,unknown,total:rows.length};
}
return {build,expected,teamAt,matchup,opponentClass,breakdown,seasonAt,INITIAL,K,HOME_ADVANTAGE,DIFFERENCE,MIN_GAMES,REGRESSION};
});
