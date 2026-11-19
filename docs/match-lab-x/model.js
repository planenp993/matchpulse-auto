/* MATCH LAB X public analytical baseline. Distinct from private four-model research. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.MLXModel=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";
const aliases={
"manchester united":"man united","manchester utd":"man united","man utd":"man united",
"manchester city":"man city","man city":"man city",
"nottingham forest":"nott m forest","nott m forest":"nott m forest",
"tottenham hotspur":"tottenham","spurs":"tottenham",
"inter milan":"inter","internazionale":"inter","fc internazionale":"inter",
"ac milan":"milan","milan":"milan","atletico madrid":"ath madrid",
"atletico de madrid":"ath madrid","atletico":"ath madrid",
"real sociedad":"sociedad","real sociedad de futbol":"sociedad",
"athletic club":"ath bilbao","athletic bilbao":"ath bilbao",
"bayern munchen":"bayern munich","fc bayern munchen":"bayern munich",
"borussia monchengladbach":"m gladbach","paris saint germain":"paris sg",
"rcd espanyol":"espanol","espanyol barcelona":"espanol","deportivo alaves":"alaves",
"real betis":"betis","villarreal cf":"villarreal","getafe cf":"getafe",
"sevilla fc":"sevilla","valencia cf":"valencia",
"bayer 04 leverkusen":"leverkusen","borussia dortmund":"dortmund",
"fc augsburg":"augsburg","vfb stuttgart":"stuttgart","rb leipzig":"rb leipzig"};
const norm=v=>{
  const s=String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();
  return aliases[s]||s;
};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const clamp=(v,l,h)=>Math.max(l,Math.min(h,v));
const valid=r=>Array.isArray(r)&&r.length>=5&&Number.isInteger(r[3])&&Number.isInteger(r[4])&&r[3]>=0&&r[4]>=0;
const poisson=(lambda,max=11)=>{
  const p=[Math.exp(-lambda)];
  for(let n=1;n<=max;n++)p.push(p[n-1]*lambda/n);
  return p;
};
const fairOdds=p=>typeof p==="number"&&Number.isFinite(p)&&p>0&&p<=1?1/p:null;
const pct=x=>typeof x==="number"&&Number.isFinite(x)?(100*x).toFixed(1)+"%":"—";
function stats(rows,team,date){
  const key=norm(team);
  const before=rows.filter(r=>valid(r)&&r[0]<date&&(norm(r[1])===key||norm(r[2])===key))
    .sort((a,b)=>b[0].localeCompare(a[0]));
  const all=before.slice(0,10),venue=before.filter(r=>norm(r[1])===key).slice(0,20);
  const away=before.filter(r=>norm(r[2])===key).slice(0,20);
  const map=(items)=>{
    let gf=0,ga=0,w=0,d=0,shots=0,sot=0,nshots=0;
    for(const r of items){
      const h=norm(r[1])===key;
      const f=h?r[3]:r[4],a=h?r[4]:r[3];
      gf+=f;ga+=a;w+=f>a;d+=f===a;
      const so=r[h?7:8],st=r[h?9:10];
      if(Number.isInteger(so)&&Number.isInteger(st)){shots+=so;sot+=st;nshots++;}
    }
    return {n:items.length,for:items.length?gf/items.length:null,
      against:items.length?ga/items.length:null,w,d,l:items.length-w-d,
      shots:nshots?shots/nshots:null,sot:nshots?sot/nshots:null,shotN:nshots,
      form:items.slice(0,6).map(r=>{const h=norm(r[1])===key;
        const f=h?r[3]:r[4],a=h?r[4]:r[3];return f>a?"W":f===a?"D":"L";}),
      rows:items};
  };
  return {all:map(all),home:map(venue),away:map(away),seen:before.length};
}
function estimate(rows,fixture){
  const date=fixture.date,home=fixture.home,away=fixture.away;
  const historic=rows.filter(r=>valid(r)&&r[0]<date);
  if(historic.length<180)return {ready:false,reason:"Няма достатъчно исторически данни за лигата."};
  const teamH=stats(historic,home,date),teamA=stats(historic,away,date);
  if(teamH.seen<4||teamA.seen<4)return {ready:false,reason:"Няма надеждно съвпадение за единия отбор в архива.",home:teamH,away:teamA};
  const recent=historic.slice(-1200);
  const avgH=mean(recent.map(r=>r[3])),avgA=mean(recent.map(r=>r[4]));
  const prior=7;
  const adjusted=(actual,n,baseline)=>(Math.max(0,actual??baseline)*n+baseline*prior)/(n+prior);
  const hg=adjusted(teamH.home.for,teamH.home.n,avgH);
  const hc=adjusted(teamH.home.against,teamH.home.n,avgA);
  const ag=adjusted(teamA.away.for,teamA.away.n,avgA);
  const ac=adjusted(teamA.away.against,teamA.away.n,avgH);
  const lh=clamp(avgH*(hg/avgH)*(ac/avgH),.15,3.75);
  const la=clamp(avgA*(ag/avgA)*(hc/avgA),.15,3.75);
  const htrows=recent.filter(r=>Number.isInteger(r[5])&&Number.isInteger(r[6]));
  const halfShare=htrows.length>=100?clamp(
    mean(htrows.map(r=>r[5]+r[6]))/
    Math.max(.1,mean(htrows.map(r=>r[3]+r[4]))),.36,.53):.45;
  const matrix=scoreMatrix(lh,la);
  const h2h=historic.filter(r=>
    (norm(r[1])===norm(home)&&norm(r[2])===norm(away))||
    (norm(r[2])===norm(home)&&norm(r[1])===norm(away)))
    .slice(-6).reverse();
  return {ready:true,home:teamH,away:teamA,lh,la,avgH,avgA,
    halfShare,n:historic.length,matrix,h2h,markets:markets(matrix),
    version:"Public empirical Poisson v1 • not the private Dixon–Coles/RDE engine"};
}
function scoreMatrix(lh,la,max=11){
  const h=poisson(lh,max),a=poisson(la,max);const p=[];
  let total=0;
  for(let x=0;x<=max;x++)for(let y=0;y<=max;y++){
    const v=h[x]*a[y];p.push([x,y,v]);total+=v;
  }
  if(total<=0)throw Error("Invalid Poisson distribution");
  return p.map(([x,y,z])=>[x,y,z/total]);
}
function markets(matrix){
  let h=0,d=0,a=0,o15=0,o25=0,o35=0,btts=0;
  for(const [x,y,p] of matrix){
    if(x>y)h+=p;else if(x===y)d+=p;else a+=p;
    if(x+y>=2)o15+=p;if(x+y>=3)o25+=p;if(x+y>=4)o35+=p;
    if(x>0&&y>0)btts+=p;
  }
  return {home:h,draw:d,away:a,over15:o15,over25:o25,over35:o35,btts};
}
function afterHalf(model,h,a){
  if(!model?.ready||!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h>4||a>4)return null;
  const second=scoreMatrix(model.lh*(1-model.halfShare),model.la*(1-model.halfShare));
  const finish=second.map(([x,y,p])=>[x+h,y+a,p]);
  return {matrix:finish,markets:markets(finish)};
}
function sample(matrix,n=10000,random=Math.random){
  const cdf=[];let total=0;
  for(const [x,y,p] of matrix){total+=p;cdf.push(total);}
  const result={home:0,draw:0,away:0,over25:0,btts:0,n};
  for(let i=0;i<n;i++){
    const r=random()*total;
    let lo=0,hi=cdf.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(cdf[mid]<r)lo=mid+1;else hi=mid;}
    const [x,y]=matrix[lo];
    if(x>y)result.home++;else if(x===y)result.draw++;else result.away++;
    if(x+y>=3)result.over25++;
    if(x&&y)result.btts++;
  }
  for(const k of ["home","draw","away","over25","btts"])result[k]/=n;
  return result;
}
return {norm,valid,stats,estimate,poisson,scoreMatrix,markets,afterHalf,sample,pct,fairOdds};
});
