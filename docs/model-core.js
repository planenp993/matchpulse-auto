/* Matchpulse Next · transparent experimental goals engine. No external dependencies. */
(function(root,factory){
  const value=factory();
  if(typeof module==='object'&&module.exports) module.exports=value;
  if(root)root.MatchpulseModel=value;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const ALIAS={
    'man united':'man united','man utd':'man united','manchester united':'man united',
    'man city':'man city','manchester city':'man city',
    'tottenham hotspur':'tottenham','spurs':'tottenham',
    'nottingham forest':'nottm forest','nott m forest':'nottm forest','nottm forest':'nottm forest',
    'brighton hove albion':'brighton','brighton and hove albion':'brighton',
    'newcastle united':'newcastle','leeds united':'leeds',
    'west ham united':'west ham','wolverhampton wanderers':'wolves',
    'wolverhampton':'wolves','sheffield utd':'sheffield united',
    'bayern munich':'bayern munich','bayern munchen':'bayern munich','bayern':'bayern munich',
    'borussia dortmund':'dortmund','b dortmund':'dortmund',
    'inter milan':'inter','internazionale':'inter',
    'ac milan':'milan','atletico madrid':'ath madrid',
    'ath madrid':'ath madrid','athletic club':'ath bilbao','athletic bilbao':'ath bilbao',
    'real betis':'betis','rcd espanyol':'espanol','paris saint germain':'paris sg',
    'psg':'paris sg','olympique lyonnais':'lyon',
    'fc porto':'porto','sporting cp':'sporting','sporting lisbon':'sporting',
    'sl benfica':'benfica','psv eindhoven':'psv','ajax amsterdam':'ajax',
    'az alkmaar':'az','ne c nijmegen':'nijmegen','nec nijmegen':'nijmegen',
    'fc twente':'twente','sc heerenveen':'heerenveen',
    'fc copenhagen':'fc copenhagen','fc kopenhagen':'fc copenhagen',
    'copenhagen':'fc copenhagen','fc midtjylland':'midtjylland',
    'crvena zvezda':'red star belgrade','red star':'red star belgrade'
  };
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const normal=n=>String(n||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLowerCase().replace(/\s+/g,' ');
  function clubKey(name){const n=normal(name);return ALIAS[n]||n}
  function sortRecent(a,b){return b[3].localeCompare(a[3]) || (b[4]||'').localeCompare(a[4]||'')}
  function leagueBases(rows,cutoff){
    const games=rows.filter(r=>r[3]<cutoff&&r[3]>=String(+cutoff.slice(0,4)-3)+cutoff.slice(4));
    const sums=new Map();
    for(const r of games){
      if(!Number.isInteger(r[7])||!Number.isInteger(r[8]))continue;
      const x=sums.get(r[0])||{h:0,a:0,n:0};
      x.h+=r[7];x.a+=r[8];x.n++;sums.set(r[0],x);
    }
    const bases=new Map();
    for(const [d,v] of sums)if(v.n>=12)bases.set(d,{h:clamp(v.h/v.n,.5,2.6),a:clamp(v.a/v.n,.4,2.5),n:v.n});
    return bases;
  }
  function teamMatches(rows,name,cutoff){
    const key=clubKey(name);
    return rows.filter(r=>r[3]<cutoff && Number.isInteger(r[7]) && Number.isInteger(r[8]) &&
      (clubKey(r[5])===key||clubKey(r[6])===key)).sort(sortRecent);
  }
  const params={
    standard:{decay:.94,prior:6,venue:.32,xg:.25,rho:-.06},
    recent:{decay:.86,prior:4,venue:.38,xg:.3,rho:-.06},
    cautious:{decay:.97,prior:10,venue:.20,xg:.15,rho:-.04}
  };
  function shrink(observations,priorGames){
    let sum=priorGames,weight=priorGames;
    for(const e of observations){sum+=e.value*e.w;weight+=e.w}
    return sum/weight;
  }
  function makeProfile(ms,club,bases,settings){
    const key=clubKey(club),rows=[];
    for(const [idx,r] of ms.slice(0,30).entries()){
      const home=clubKey(r[5])===key;
      const base=bases.get(r[0])||{h:1.48,a:1.22,n:0};
      const gf=home?r[7]:r[8],ga=home?r[8]:r[7];
      const xgf=home?r[9]:r[10],xga=home?r[10]:r[9];
      const w=Math.pow(settings.decay,idx);
      rows.push({r,home,gf,ga,xgf,xga,w,bgf:home?base.h:base.a,bga:home?base.a:base.h});
    }
    function parts(venueOnly,isAttack,expected=false){
      const v=rows.filter(r=>venueOnly===null||r.home===venueOnly);
      return v.filter(r=>!expected||(Number.isFinite(r.xgf)&&Number.isFinite(r.xga))).map(r=>({
        w:r.w,value:clamp((isAttack?(expected?r.xgf:r.gf):(expected?r.xga:r.ga))/(isAttack?r.bgf:r.bga),0,5)
      }));
    }
    const calc=(venue,isAtt,xg)=>{
      const all=parts(null,isAtt,xg);
      const local=parts(venue,isAtt,xg);
      const whole=shrink(all,settings.prior);
      const byVenue=shrink(local,settings.prior+2);
      return whole*(1-settings.venue)+byVenue*settings.venue;
    };
    const xgN=rows.filter(r=>Number.isFinite(r.xgf)&&Number.isFinite(r.xga)).length;
    const scored=rows.slice(0,10).reduce((a,r)=>a+r.gf,0)/Math.max(1,Math.min(10,rows.length));
    const allowed=rows.slice(0,10).reduce((a,r)=>a+r.ga,0)/Math.max(1,Math.min(10,rows.length));
    return {rows,count:rows.length,venueCount:0,xgN,scored,allowed,calc};
  }
  function poisson(k,lambda){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p=p*lambda/i;return p}
  function dctau(a,b,lh,la,rho){
    if(a===0&&b===0)return 1-lh*la*rho;
    if(a===0&&b===1)return 1+lh*rho;
    if(a===1&&b===0)return 1+la*rho;
    if(a===1&&b===1)return 1-rho;
    return 1;
  }
  function distribution(lh,la,rho=0,n=11){
    let total=0;const matrix=[];
    for(let h=0;h<=n;h++){
      matrix[h]=[];
      for(let a=0;a<=n;a++){
        const v=Math.max(0,poisson(h,lh)*poisson(a,la)*dctau(h,a,lh,la,rho));
        matrix[h][a]=v;total+=v;
      }
    }
    for(let h=0;h<=n;h++)for(let a=0;a<=n;a++)matrix[h][a]/=total;
    const probs={};
    for(const threshold of [0,1,2,3,4])probs['over'+threshold+'5']=0;
    for(const prefix of ['home','away'])for(const t of [0,1,2])probs[prefix+'Over'+t+'5']=0;
    probs.btts=0;
    probs.homeWin=0;probs.draw=0;probs.awayWin=0;
    const scores=[];
    for(let h=0;h<=n;h++)for(let a=0;a<=n;a++){
      const p=matrix[h][a];
      if(h>0&&a>0)probs.btts+=p;
      if(h>a)probs.homeWin+=p; else if(h===a)probs.draw+=p; else probs.awayWin+=p;
      for(const t of [0,1,2,3,4])if(h+a>t)probs['over'+t+'5']+=p;
      for(const t of [0,1,2]){
        if(h>t)probs['homeOver'+t+'5']+=p;
        if(a>t)probs['awayOver'+t+'5']+=p;
      }
      scores.push({h,a,p});
    }
    probs.double1X=probs.homeWin+probs.draw;
    probs.doubleX2=probs.draw+probs.awayWin;
    probs.double12=probs.homeWin+probs.awayWin;
    scores.sort((a,b)=>b.p-a.p);
    return {matrix,probs,scores:scores.slice(0,8)};
  }
  function evaluate(history,fixture,preset='standard'){
    const s=typeof preset==='string'?(params[preset]||params.standard):{...params.standard,...preset};
    const [div,,league,date,time,home,away]=fixture;
    const bases=leagueBases(history,date);
    const hm=teamMatches(history,home,date),am=teamMatches(history,away,date);
    const h=makeProfile(hm,home,bases,s),a=makeProfile(am,away,bases,s);
    if(h.count<5||a.count<5)return {error:'Недостатъчно изиграни срещи за един от отборите (минимум 5).',home:hm,away:am};
    const own=bases.get(div);
    // An EU fixture without a domestic league base must have a qualified uncertainty label.
    const euro=['UCL','UEL','UECL'].includes(div);
    const hDomestic=bases.get(hm[0][0]),aDomestic=bases.get(am[0][0]);
    const bh=own?.h??((hDomestic?.h??1.48)+(aDomestic?.h??1.48))/2;
    const ba=own?.a??((hDomestic?.a??1.22)+(aDomestic?.a??1.22))/2;
    const coverage=Math.min(h.xgN,a.xgN);
    const xgBlend=coverage>=6?clamp(s.xg,0,.5):0;
    function strengths(p,venue){
      const gf=p.calc(venue,true,false),ga=p.calc(venue,false,false);
      if(!xgBlend)return {gf,ga};
      return {gf:(1-xgBlend)*gf+xgBlend*p.calc(venue,true,true),
              ga:(1-xgBlend)*ga+xgBlend*p.calc(venue,false,true)};
    }
    const hs=strengths(h,true),as=strengths(a,false);
    const lh=clamp(bh*hs.gf*as.ga,.15,4.2),la=clamp(ba*as.gf*hs.ga,.15,4.2);
    const d=distribution(lh,la,s.rho);
    const warning=euro?'Международен мач: оценката е само ориентировъчна, защото използва вътрешните първенства без надеждна поправка за силата на противниците.':
      (!own?'Липсва надеждна базова извадка за състезанието. Използвана е резервна средна.':'');
    const score=Math.min(100,Math.round(Math.min(h.count,a.count)/12*60+Math.min(coverage/8,1)*15+(own?.n>=50?25:10)));
    const grade=euro?'Ограничена (евротурнир)':score>=78?'Добро покритие':score>=52?'Умерено покритие':'Ограничено покритие';
    return {home:hm.slice(0,20),away:am.slice(0,20),homeTotal:hm.length,awayTotal:am.length,
      lambdaHome:lh,lambdaAway:la,total:lh+la,distribution:d,bases:{home:bh,away:ba,count:own?.n??0},
      strengths:{home:hs,away:as},settings:s,quality:{grade,score,coverage,warning,homeN:h.count,awayN:a.count,
        hVenue:hm.slice(0,30).filter(r=>clubKey(r[5])===clubKey(home)).length,
        aVenue:am.slice(0,30).filter(r=>clubKey(r[6])===clubKey(away)).length},
      explanation:'Атакуваща и защитна сила спрямо нормите за лигата; претеглени до 30 мача; изглаждане към 1,0; корекция за терен; xG само при поне 6 мача и за двата отбора; разпределение Поасон с Dixon–Coles за 0:0/1:0/0:1/1:1.',
      euro};
  }
  return {clubKey,teamMatches,leagueBases,distribution,evaluate,params};
});