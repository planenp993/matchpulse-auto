/* Descriptive match dossier. It reads existing results; it never supplies model/scanner inputs. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n).replace('.',','):'—';
const pct=v=>Number.isFinite(v)?Math.round(v*100)+'%':'—';
const mean=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const count=(n,single,many)=>n+' '+(n===1?single:many);
const balance=f=>count(f.wins,'победа','победи')+' · '+count(f.draws,'равенство','равенства')+' · '+count(f.losses,'загуба','загуби');
const played=r=>Array.isArray(r)&&Number.isInteger(r[7])&&r[7]>=0&&Number.isInteger(r[8])&&r[8]>=0&&r[13]?.AWARDED!==true;
const score=r=>r[5]+' '+r[7]+':'+r[8]+' '+r[6];
const STATISTICS=[
 {key:'corners',label:'Корнери',fields:['HC','AC'],lines:[7.5,8.5,9.5,10.5]},
 {key:'yellow',label:'Жълти картони',fields:['HY','AY'],lines:[2.5,3.5,4.5,5.5]},
 {key:'shots',label:'Удари',fields:['HS','AS'],lines:[17.5,21.5,25.5]},
 {key:'target',label:'Точни удари',fields:['HST','AST'],lines:[6.5,8.5,10.5]},
 {key:'red',label:'Червени картони',fields:['HR','AR'],lines:[.5]}
];
function form(rows,team,keyTeam){
 const games=rows.filter(played).map(row=>{
  const home=keyTeam(row[5])===keyTeam(team),gf=row[home?7:8],ga=row[home?8:7];
  return {row,gf,ga,points:gf>ga?3:gf===ga?1:0,result:gf>ga?'П':gf===ga?'Р':'З'};
 });
 const wins=games.filter(g=>g.points===3).length,draws=games.filter(g=>g.points===1).length;
 return {games,n:games.length,wins,draws,losses:games.length-wins-draws,points:wins*3+draws,
  recentFive:games.length>=5?games.slice(0,5).reduce((s,g)=>s+g.points,0):null,
  previousFive:games.length>=10?games.slice(5,10).reduce((s,g)=>s+g.points,0):null};
}
function statistics(rows,team,definition,keyTeam){
 const values=rows.map(row=>{
  if(!played(row))return null;
  const extra=row[13],h=extra?.[definition.fields[0]],a=extra?.[definition.fields[1]];
  if(!valid(h)||!valid(a))return null;
  const home=keyTeam(row[5])===keyTeam(team);
  return {own:home?h:a,opponent:home?a:h,total:h+a};
 });
 const observed=values.filter(Boolean),n=observed.length;
 return {n,possible:rows.length,own:mean(observed.map(v=>v.own)),opponent:mean(observed.map(v=>v.opponent)),
  total:mean(observed.map(v=>v.total)),values,
  lines:definition.lines.map(line=>({line,hits:observed.filter(v=>v.total>line).length,n}))};
}
function expectedGoals(rows,team,keyTeam){
 const part=against=>{
  const observed=rows.filter(played).map(row=>{
   const home=keyTeam(row[5])===keyTeam(team),xg=row[against?(home?10:9):(home?9:10)];
   return valid(xg)?{xg,goals:row[against?(home?8:7):(home?7:8)]}:null;
  }).filter(Boolean);
  return {n:observed.length,mean:mean(observed.map(v=>v.xg)),goals:mean(observed.map(v=>v.goals))};
 };
 return {own:part(false),against:part(true),possible:rows.length};
}
const eventText=(id,side)=>({
 o15:'поне 2 гола общо',o25:'поне 3 гола общо',o35:'поне 4 гола общо',u25:'най-много 2 гола общо',u35:'най-много 3 гола общо',
 btts:'двата отбора вкарват',bttsNo:'поне единият отбор не вкарва',
 home2:side==='home'?'вкарва поне 2 гола':'допуска поне 2 гола',
 away2:side==='away'?'вкарва поне 2 гола':'допуска поне 2 гола',
 '1':side==='home'?'печели':'губи','2':side==='away'?'печели':'губи',X:'завършва наравно',
 '1X':side==='home'?'е без загуба':'е без победа',X2:side==='away'?'е без загуба':'е без победа','12':'мачът завършва без равенство',
 corners85:'поне 9 корнера общо',corners95:'поне 10 корнера общо',
 yellow35:'поне 4 жълти картона общо',yellow45:'поне 5 жълти картона общо',red05:'поне 1 червен картон общо',
 shots215:'поне 22 удара общо',shots255:'поне 26 удара общо',target85:'поне 9 точни удара общо',
 ht05:'поне 1 гол до полувремето',ht15:'поне 2 гола до полувремето'
 })[id]||id;
const personalEvent=id=>['home2','away2','1','2','X','1X','X2'].includes(id);
const CURRENT_DAYS=30;
function sofiaDay(now){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
const TREND_DAYS=90;
const TREND_EVENTS=[
 {id:'win',family:'result',label:'Поредни победи',phrase:'печели',priority:4,test:g=>g.gf>g.ga},
 {id:'loss',family:'result',label:'Поредни загуби',phrase:'губи',priority:4,test:g=>g.gf<g.ga},
 {id:'draw',family:'result',label:'Поредни равенства',phrase:'завършва наравно',priority:3,test:g=>g.gf===g.ga},
 {id:'unbeaten',family:'result',label:'Без загуба',phrase:'няма загуба',priority:2,test:g=>g.gf>=g.ga},
 {id:'winless',family:'result',label:'Без победа',phrase:'няма победа',priority:2,test:g=>g.gf<=g.ga},
 {id:'noDraw',family:'draw',label:'Без равенство',phrase:'няма равенство',priority:0,test:g=>g.gf!==g.ga},
 {id:'scored',family:'attack',label:'Отбелязан гол от отбора',phrase:'отбелязва поне един гол',priority:2,test:g=>g.gf>=1},
 {id:'team2',family:'attack',label:'Отборът вкарва 2+',phrase:'отбелязва поне два гола',priority:4,test:g=>g.gf>=2},
 {id:'conceded',family:'defence',label:'Допуснат гол',phrase:'допуска поне един гол',priority:2,test:g=>g.ga>=1},
 {id:'clean',family:'defence',label:'Без допуснат гол',phrase:'не допуска гол',priority:4,test:g=>g.ga===0},
 ...[['o15','Поне 2 гола общо',2],['o25','Поне 3 гола общо',3],['o35','Поне 4 гола общо',4]].map(([id,label,line])=>({id,family:'total',label,phrase:'има поне '+line+' гола общо в мачовете си',priority:line,test:g=>g.gf+g.ga>=line})),
 ...[['u25','Най-много 2 гола общо',2],['u35','Най-много 3 гола общо',3]].map(([id,label,line])=>({id,family:'total',label,phrase:'има най-много '+line+' гола общо в мачовете си',priority:5-line,test:g=>g.gf+g.ga<=line})),
 {id:'btts',family:'btts',label:'Гол/гол в мачовете',phrase:'играе мачове с гол от двата отбора',priority:3,test:g=>g.gf>0&&g.ga>0},
 {id:'bttsNo',family:'btts',label:'Без гол/гол в мачовете',phrase:'играе мачове, в които поне единият отбор не бележи',priority:2,test:g=>g.gf===0||g.ga===0},
 ...[['corners95','corners','Поне 10 корнера общо',3],['yellow35','cards','Поне 4 жълти картона общо',2],['shots215','shots','Поне 22 удара общо',2],['ht05','firsthalf','Гол до полувремето',2]].map(([id,family,label,priority])=>({id,family,label,phrase:'има '+label.toLocaleLowerCase()+' в мачовете си',priority,stat:true}))
];
function tendencies(profile,patterns,keyTeam,asOfDate=sofiaDay(new Date())){
 const cutoff=profile.fixture[3]<asOfDate?profile.fixture[3]:asOfDate;
 const since=new Date(Date.parse(cutoff+'T12:00:00Z')-TREND_DAYS*86400000).toISOString().slice(0,10);
 const latest=new Date(Date.parse(cutoff+'T12:00:00Z')-CURRENT_DAYS*86400000).toISOString().slice(0,10);
 const samples={};
 for(const side of ['home','away']){
  const t=profile[side];samples[side]=new Map();if(t.proxy||t.pendingLatest)continue;
  const rows=t.all.filter(r=>r[3]>=since&&r[3]<=cutoff&&r[3]<profile.fixture[3]&&played(r));
  if(rows.length<3||rows[0][3]<latest)continue;
  for(const event of TREND_EVENTS){
   const observations=rows.map(row=>{
    if(event.stat)return patterns.observation(row,t.name,'home',event.id,keyTeam);
    const home=keyTeam(row[5])===keyTeam(t.name);return event.test({gf:row[home?7:8],ga:row[home?8:7]});
   });
   let run=0;while(observations[run]===true)run++;
   if(run<3)continue;
   const known=observations.filter(v=>v!==null),hits=known.filter(Boolean).length,proof=rows.slice(0,run),atLeast=run===rows.length;
   const matchFact=event.id==='btts'?'има гол от двата отбора':event.id==='bttsNo'?'поне единият отбор не бележи':event.stat?'има '+event.label.toLocaleLowerCase():['o15','o25','o35','u25','u35'].includes(event.id)?event.phrase.replace(' в мачовете си',''):null;
   const sentence=matchFact?(atLeast?'В поне '+run+' поредни мача на ':'В последните '+run+' мача на ')+t.name+' '+matchFact+'.':t.name+' '+event.phrase+' '+(atLeast?'в поне '+run+' поредни срещи.':'в последните си '+run+' срещи.');
   samples[side].set(event.id,{name:t.name,side,rows:proof,sampleRows:rows,atLeast,from:proof.at(-1)[3],until:proof[0][3],sentence,
    measure:{n:known.length,hits,rate:known.length?hits/known.length:null,currentStreak:run,total:rows.length,missing:rows.length-known.length,trail:observations}});
  }
 }
 const commonIds=new Set([...samples.home.keys()].filter(id=>samples.away.has(id)));
 const candidates=TREND_EVENTS.flatMap(event=>{
  const sides=['home','away'].map(side=>samples[side].get(event.id)).filter(Boolean);if(!sides.length)return [];
  const scope=sides.length===2?'both':sides[0].side;
  const length=Math.min(...sides.map(t=>t.measure.currentStreak));
  return [{market:event.id,title:event.label,family:event.family,group:event.stat?event.family:'goals',scope,kind:'streak',sides,
   score:2*Math.log2(length+1)+1.1*event.priority+.04*Math.max(...sides.map(t=>t.measure.currentStreak))}];
 });
 function choose(list){
  const selected=[],families=new Set();
  for(const v of list.sort((a,b)=>b.score-a.score||a.market.localeCompare(b.market))){
   if(families.has(v.family))continue;
   if(v.market==='noDraw'&&selected.some(k=>k.market==='win'&&k.sides.every((t,i)=>t.measure.currentStreak>=v.sides[i].measure.currentStreak)))continue;
   selected.push(v);families.add(v.family);if(selected.length===6)break;
  }
  return selected;
 }
 // The same semantic fact is common only when true in both clubs' OWN history.
 // An unbeaten home club and a winless away club are never one shared trend.
 return [...choose(candidates.filter(v=>v.scope==='both')),
  ...choose(candidates.filter(v=>v.scope==='home'&&!commonIds.has(v.market))),
  ...choose(candidates.filter(v=>v.scope==='away'&&!commonIds.has(v.market)))];
}
function describe(profile,{keyTeam,patterns,model=null,ratings={},now=new Date()}){
 const sides={};
 for(const side of ['home','away']){
  const team=profile[side];
  sides[side]={...team,form:form(team.all,team.name,keyTeam),venueForm:form(team.venue,team.name,keyTeam),
   stats:Object.fromEntries(STATISTICS.map(def=>[def.key,statistics(team.all,team.name,def,keyTeam)])),
   xg:expectedGoals(team.all,team.name,keyTeam),rating:ratings[side]||null};
 }
 const extent=Math.max(1,...['home','away'].flatMap(side=>formCurve(sides[side].form).map(p=>Math.abs(p.value))));
 for(const side of ['home','away'])sides[side].form.extent=extent;
 return {fixture:profile.fixture,windowSize:profile.windowSize,international:profile.international,recentScope:!!profile.recentScope,
  coverageNote:profile.coverageNote,asOfDate:sofiaDay(now),...sides,
  model:!profile.international&&!profile.home.proxy&&!profile.away.proxy&&!model?.error?model:null,
  tendencies:tendencies(profile,patterns,keyTeam,sofiaDay(now))};
}
function formCurve(form){
 let value=0;
 return [...form.games].reverse().map(g=>({...g,value:value+=(g.result==='П'?1:g.result==='З'?-1:0)}));
}
function graphHTML(form){
 const points=formCurve(form),extent=form.extent||Math.max(1,...points.map(p=>Math.abs(p.value)));
 const x=i=>14+(i+1)*272/points.length,y=value=>60-value/extent*49;
 const path='14,60 '+points.map((p,i)=>x(i).toFixed(2)+','+y(p.value).toFixed(2)).join(' ');
 const markers=points.map((p,i)=>{
  const title=p.row[3]+' · '+score(p.row)+' · '+p.row[2]+' · '+({П:'Победа',Р:'Равенство',З:'Загуба'})[p.result];
  return '<g class="form-dot" role="button" tabindex="0" data-form-index="'+i+'" data-form-message="'+esc(title)+'" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title><circle class="form-dot-target" cx="'+x(i)+'" cy="'+y(p.value)+'" r="10"/><circle class="form-dot-visible" cx="'+x(i)+'" cy="'+y(p.value)+'" r="3.2"/></g>';
 }).join('');
 return '<div class="form-curve"><div class="form-curve-heading"><span>Движение на формата</span><b>'+((points.at(-1)?.value||0)>0?'+':'')+(points.at(-1)?.value||0)+'</b></div>'+
  '<div class="form-plot"><div class="form-axis" aria-hidden="true"><span>+'+extent+'</span><span>0</span><span>−'+extent+'</span></div>'+
  '<svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-label="Графика на формата: победа плюс едно, равенство без промяна, загуба минус едно">'+
  '<line class="form-zero" x1="14" y1="60" x2="286" y2="60"/><polyline class="form-line" points="'+path+'"/>'+markers+'</svg></div>'+
  '<small class="form-curve-legend">Победа +1 · равенство 0 · загуба −1</small></div>';
}
function formHTML(t){
 const f=t.form;
 if(!f.n)return '<p class="footnote">Няма срещи в избраната история.</p>';
 const chips=[...f.games].reverse().map(g=>{
  const text=g.row[3]+' · '+score(g.row)+' · '+({П:'Победа',Р:'Равенство',З:'Загуба'})[g.result];
  return '<button type="button" class="form-chip result-'+g.points+'" data-form-message="'+esc(text)+'" data-result-date="'+esc(g.row[3])+'" title="'+esc(text)+'" aria-label="'+esc(text)+'">'+g.result+'</button>';
 }).join('');
 return '<div class="form-overview"><div class="form-balance">'+balance(f)+'</div>'+
  '<div class="form-strip" style="--form-count:'+Math.min(10,f.n)+'">'+chips+'</div><div class="form-direction">Ред: по-стари → най-нови</div>'+
  '<div class="form-inspection" role="status">Докосни резултат или точка от графиката</div>'+graphHTML(f)+'</div>';
}
function trendExplanation(v){return v.sides.map(side=>side.sentence).join(' ');}
function trendsHTML(d){
 const item=v=>'<article class="trend-signal" data-trend-scope="'+v.scope+'" data-trend-market="'+v.market+'">'+
  (v.scope==='both'?'<h5>'+esc(v.title)+'</h5>':'')+
  '<p class="trend-statement">'+esc(trendExplanation(v))+'</p>'+
  '<details class="series-proof"><summary>Данни зад тенденцията</summary>'+v.sides.map(t=>'<div class="trend-proof-team"><strong>'+esc(t.name)+'</strong><p>Показаната поредица: '+t.measure.currentStreak+' мача. В цялата скорошна извадка: '+t.measure.hits+'/'+t.measure.n+'.'+(t.measure.missing?' Липсват '+t.measure.missing+' по-стари наблюдения.':'')+'</p>'+t.rows.map(row=>'<p>'+esc(row[3]+' · '+score(row)+' · '+row[2])+'</p>').join('')+'</div>').join('')+'</details></article>';
 const groups=[['home',d.home.name,'Домакин'],['away',d.away.name,'Гост'],['both','Общи тенденции','Потвърдени отделно при двата отбора']];
 const body=groups.map(([scope,label,note])=>{
  const list=d.tendencies.filter(v=>v.scope===scope);if(!list.length)return '';
  return '<section class="trend-group" data-trend-group="'+scope+'"><div class="trend-club-heading"><h4>'+esc(label)+'</h4><span>'+note+'</span></div>'+list.slice(0,3).map(item).join('')+
   (list.length>3?'<details class="tendencies-more"><summary>Още тенденции · '+(list.length-3)+'</summary>'+list.slice(3).map(item).join('')+'</details>':'')+'</section>';
 }).join('');
 const delayed=['home','away'].filter(side=>d[side].pendingLatest).map(side=>'<p class="series-notice">'+esc(d[side].name)+(d[side].pendingLatest.state==='unavailable'?': допълнителните данни не са заредени.':d[side].pendingLatest.state==='conflict'?': резултатът от '+esc(d[side].pendingLatest.date)+' се уточнява.':': очаква се резултат от по-нов мач ('+esc(d[side].pendingLatest.date)+').')+' Тенденциите за отбора изчакват потвърждение.</p>').join('');
 return '<section class="card tendencies"><h3>Важни тенденции</h3><p class="current-series-context">Поредни завършили срещи от избраната история</p>'+delayed+
  (body?'<div class="trend-groups'+(new Set(d.tendencies.filter(v=>v.scope!=='both').map(v=>v.scope)).size===1?' single-club':'')+'">'+body+'</div>':'<p class="footnote">Няма потвърдена скорошна поредица от поне 3 мача.</p>')+
  '<p class="footnote trend-caption">Само наличните първенства и УЕФА, преди този мач. Това са факти от историята, не вероятности за следващия резултат.</p></section>';
}
function rateBar(sample,alt=false){return sample.n?'<div class="observed-rate"><span class="bar-track"><i class="bar-fill '+(alt?'alt':'')+'" style="width:'+(sample.hits/sample.n*100)+'%"></i></span><b>'+pct(sample.hits/sample.n)+'</b><small>'+sample.hits+'/'+sample.n+'</small></div>':'<span class="extra-missing">няма данни</span>';}
function statsHTML(d){
 const blocks=STATISTICS.map(def=>{
  const rows=['home','away'].map(side=>{
   const t=d[side],s=t.stats[def.key];
   return '<div class="stat-team"><h4>'+esc(t.name)+'</h4><div class="stat-kpis">'+
    [['На отбора',s.own],['На съперниците',s.opponent],['Общо в мача',s.total]].map(([label,value])=>'<div><b>'+fmt(value)+'</b><span>'+label+'</span></div>').join('')+
    '</div><small class="stat-coverage">Средно на мач · данни за '+s.n+'/'+s.possible+' срещи'+(s.n>0&&s.n<5?' · малка извадка':'')+'</small></div>';
  }).join('');
  const h=d.home.stats[def.key],a=d.away.stats[def.key];
  return '<article class="stat-block"><h3>'+def.label+'</h3><div class="stat-teams">'+rows+'</div>'+
   '<div class="stat-lines"><div class="stat-line-header"><span>Общо в мача</span><strong>'+esc(d.home.name)+'</strong><strong>'+esc(d.away.name)+'</strong></div>'+
   h.lines.map((v,i)=>'<div class="stat-frequency"><span>Над '+fmt(v.line)+'</span>'+rateBar(v)+rateBar(a.lines[i],true)+'</div>').join('')+'</div></article>';
 }).join('');
 const xg=['home','away'].map(side=>{
  const t=d[side],x=t.xg;
  return '<div class="xg-team"><h4>'+esc(t.name)+'</h4><div class="xg-kpis">'+[['Създаден xG',x.own],['Допуснат xG',x.against]].map(([label,s])=>
   '<div><b>'+fmt(s.mean,2)+'</b><span>'+label+'</span><small>'+s.n+'/'+x.possible+' мача'+(s.n>0&&s.n<3?' · малка извадка':'')+'</small></div>').join('')+'</div>'+
   '<p class="xg-comparison">'+(x.own.n?'В същите '+x.own.n+' срещи: '+fmt(x.own.goals,2)+' вкарани срещу '+fmt(x.own.mean,2)+' xG средно.':'Няма наличен xG за създадените положения.')+
   (x.against.n?' Допуснати: '+fmt(x.against.goals,2)+' гола срещу '+fmt(x.against.mean,2)+' xG в същите '+x.against.n+' срещи.':'')+'</p></div>';
 }).join('');
 return '<div class="card extra-analytics"><details><summary><span>Удари, корнери, картони и xG</span><small>Последни '+d.windowSize+' мача</small></summary>'+
  '<p class="footnote stat-explanation">Средните отделят отбора от съперниците му. Честотите отдолу са за общия брой в мача.</p>'+
  '<article class="stat-block xg-block"><h3>xG · качество на положенията</h3><div class="xg-teams">'+xg+'</div></article>'+blocks+'</details></div>';
}
function detailStats(row){
 const extra=row[13],pairs=[['Полувреме',extra?.HTHG,extra?.HTAG],['Удари',extra?.HS,extra?.AS],['Точни удари',extra?.HST,extra?.AST],
  ['Корнери',extra?.HC,extra?.AC],['Жълти картони',extra?.HY,extra?.AY],['Червени картони',extra?.HR,extra?.AR],['xG',row[9],row[10]]];
 return pairs.map(([label,h,a])=>({label,home:valid(h)?h:null,away:valid(a)?a:null}));
}
function historyHTML(rows,team,keyTeam){
 if(!rows.length)return '<p class="footnote">Няма срещи в избраната история.</p>';
 return rows.filter(played).map(row=>{
  const home=keyTeam(row[5])===keyTeam(team),gf=row[home?7:8],ga=row[home?8:7],result=gf>ga?'П':gf===ga?'Р':'З';
  return '<details class="result-detail"><summary class="match-history result-summary" aria-label="'+esc(row[3]+' · '+score(row)+' · подробности')+'">'+
   '<time datetime="'+esc(row[3])+'">'+esc(row[3].slice(8)+'.'+row[3].slice(5,7)+'.'+row[3].slice(2,4))+'<small class="result-competition" title="'+esc(row[2])+'">'+esc(row[0])+'</small></time>'+
   '<span class="result-teams"><span class="'+(home?'studied-team':'')+'">'+esc(row[5])+'</span><b>'+row[7]+':'+row[8]+'</b><span class="'+(!home?'studied-team':'')+'">'+esc(row[6])+'</span></span>'+
   '<span class="result-marker result-'+(gf>ga?3:gf===ga?1:0)+'">'+result+'</span><span class="result-toggle" aria-hidden="true"></span></summary>'+
   '<div class="result-facts"><div class="result-context">'+esc(row[2])+' · '+esc(row[3])+(row[13]?.PHASE==='QUALIFYING'?' · квалификации':'')+' · резултат за 90 минути</div>'+
   '<div class="result-fact-header"><span>Показател</span><strong>'+esc(row[5])+'</strong><strong>'+esc(row[6])+'</strong></div>'+
   detailStats(row).map(s=>'<div class="result-fact"><span>'+s.label+'</span><b>'+fmt(s.home,s.label==='xG'?2:0)+'</b><b>'+fmt(s.away,s.label==='xG'?2:0)+'</b></div>').join('')+
   '<small>— няма данни в архива</small></div></details>';
 }).join('');
}
function reading(d){
 const h=d.home,a=d.away,p=d.model?.distribution?.probs,out=[],minimum=Math.min(h.form.n,a.form.n);
 if(p&&valid(p.homeWin)&&valid(p.awayWin)&&valid(p.draw)){
  const gap=p.homeWin-p.awayWin,leader=gap>=0?h:a,other=gap>=0?a:h,win=gap>=0?p.homeWin:p.awayWin;
  let text=Math.abs(gap)<.08?'Моделът вижда близък мач и няма отчетлив фаворит: '+h.name+' има '+pct(p.homeWin)+' за победа, '+a.name+' — '+pct(p.awayWin)+', а равенството е '+pct(p.draw)+'.':
   leader.name+(win<.5?' има леко предимство според модела':' е фаворит според модела')+' — '+pct(win)+' за победа. Равенството е '+pct(p.draw)+', а успехът на '+other.name+' — '+pct(gap>=0?p.awayWin:p.homeWin)+'.';
  if(Math.abs(gap)>=.08)text+=win<.5?' Победата му остава по-малко вероятна от останалите изходи, взети заедно. Това е мач, в който чистата победа носи съществен риск въпреки преднината.':win<.65?' Преднината е видима, но оставя достатъчно място за равенство или изненада.':' Картината дава по-ясна преднина на този отбор, без да изключва другите изходи.';
  else text+=' При такава малка разлика посоката за краен победител изисква повече предпазливост от самото сравнение на имената.';
  out.push({label:'Как изглежда мачът',text});
 }else out.push({label:'Как изглежда мачът',text:d.international?'За този европейски мач няма моделни проценти. Прочитът използва последните налични официални срещи за 90 минути, за да сравни формата и начина, по който двата отбора вкарват и допускат.':'Няма достатъчно съпоставима история за моделна оценка. Наличните резултати дават контекст, но не стигат за надеждно определяне на фаворит.'});
 if(minimum<5){out.push({label:'Какво показва формата',text:'Налични са '+h.form.n+' срещи за '+h.name+' и '+a.form.n+' за '+a.name+'. Това е малка извадка за общ извод. Един необичаен резултат може силно да промени средните, затова тук прочитът остава ограничен.'});}
 else {
  const pointGap=h.form.points/h.form.n-a.form.points/a.form.n,better=pointGap>0?h:a;
  let text=h.name+' има '+h.form.wins+' победи, '+h.form.draws+' равенства и '+h.form.losses+' загуби в '+h.form.n+' мача. При '+a.name+' балансът е '+a.form.wins+' победи, '+a.form.draws+' равенства и '+a.form.losses+' загуби в '+a.form.n+' срещи. ';
  text+=Math.abs(pointGap)<.25?'Като спечелени точки на мач формата е близка и не отделя ясно единия отбор.':better.name+' събира повече точки средно и идва с по-добра резултатна форма в тази извадка.';
  if(p&&Math.abs(pointGap)>=.25&&Math.abs(p.homeWin-p.awayWin)>=.08&&Math.sign(pointGap)!==Math.sign(p.homeWin-p.awayWin))text+=' Това се разминава с фаворита на модела: текущата форма и по-широката моделна история дават различен акцент.';
  const changed=[h,a].filter(t=>t.form.recentFive!==null&&t.form.previousFive!==null&&Math.abs(t.form.recentFive-t.form.previousFive)>=4);
  if(changed.length){const t=changed.sort((x,y)=>Math.abs(y.form.recentFive-y.form.previousFive)-Math.abs(x.form.recentFive-x.form.previousFive))[0];text+=' При '+t.name+' има и промяна в темпото: '+t.form.recentFive+' точки от последните 5 мача срещу '+t.form.previousFive+' от предишните 5.';}
  out.push({label:'Форма и постоянство',text});
  if(h.local?.n>=4&&a.local?.n>=4){
   const hv=h.local,av=a.local;
   let venue='На свой терен '+h.name+' вкарва средно '+fmt(hv.gf,2)+' и допуска '+fmt(hv.ga,2)+' гола в '+hv.n+' домакинства. Като гост '+a.name+' бележи '+fmt(av.gf,2)+' и допуска '+fmt(av.ga,2)+' в '+av.n+' гостувания. ';
   if(hv.gf>=1.5&&av.ga>=1.5)venue+='Атаката на домакина и допусканите от госта голове насочват вниманието към това дали '+h.name+' ще намери път към гола.';
   else if(av.gf>=1.5&&hv.ga>=1.5)venue+='Гостът има основания да търси гол: атакуващите му числа се срещат с допускаща голове домакинска защита.';
   else if(hv.gf+hv.ga<2.5&&av.gf+av.ga<2.5)venue+='И двата профила по място на игра са по-сдържани откъм общ брой голове.';
   else venue+='Тук мястото на игра добавя контекст към общата форма; извадките са срещу различни съперници и не са пряк сблъсък помежду им.';
   out.push({label:'Домакинство и гостуване',text:venue});
  }
  const scoring=t=>t.form.games.filter(g=>g.gf>0).length,hr=h.overall.o25/h.overall.n,ar=a.overall.o25/a.overall.n;
  let goals=h.name+' бележи в '+scoring(h)+'/'+h.form.n+' мача, а '+a.name+' — в '+scoring(a)+'/'+a.form.n+'. Поне три гола общо има съответно в '+h.overall.o25+'/'+h.overall.n+' и '+a.overall.o25+'/'+a.overall.n+' срещи. ';
  if(p&&valid(p.over25))goals+=Math.abs(p.over25-.5)<=.07?'Границата от 2,5 гола е почти равностойна по модела: '+pct(p.over25)+' за над 2,5 и '+pct(1-p.over25)+' за под 2,5. Малката разлика не дава убедителен аргумент сама по себе си.':p.over25>.5?'Моделът накланя мача към поне три гола ('+pct(p.over25)+').':'Моделът дава предимство на най-много два гола ('+pct(1-p.over25)+').';
  if(Math.abs(hr-ar)>=.25)goals+=' Двата отбора обаче имат различен голов профил напоследък; общият избор трябва да отчете това разминаване.';
  else if(hr>=.7&&ar>=.7)goals+=' Скорошните резултати и на двата отбора подкрепят по-резултатна картина.';
  else if(hr<=.3&&ar<=.3)goals+=' Скорошните резултати и на двата отбора по-често остават под тази граница.';
  out.push({label:'Как може да се развие головият мач',text:goals});
  const observed=[h,a].filter(t=>t.xg.own.n>=5);
  if(observed.length){let text=observed.map(t=>t.name+' създава средно '+fmt(t.xg.own.mean,2)+' наблюдаван xG и вкарва '+fmt(t.xg.own.goals,2)+' гола в същите '+t.xg.own.n+' срещи'+(t.xg.against.n>=5?'; допуска '+fmt(t.xg.against.mean,2)+' xG в '+t.xg.against.n+' мача':'')+'.').join(' ');
   const gap=observed.find(t=>Math.abs(t.xg.own.goals-t.xg.own.mean)>=.4);
   text+=gap?' При '+gap.name+' реалните голове са '+(gap.xg.own.goals>gap.xg.own.mean?'над':'под')+' наблюдавания xG. Това е причина резултатността да се чете внимателно, а не обещание за обрат в следващия мач.':' Няма голямо разминаване между тези голове и наблюдавания xG в сравнените извадки.';
   out.push({label:'Какво добавят положенията',text});
  }
 }
 const risks=[];
 for(const t of [h,a])if(t.pendingLatest)risks.push(t.pendingLatest.state==='unavailable'?'Допълнителните данни за '+t.name+' не са заредени; текуща тенденция не се заявява.':t.pendingLatest.state==='conflict'?'Резултатът на '+t.name+' се уточнява; текуща тенденция не се заявява.':'За '+t.name+' се очаква резултат от по-нов мач; формата още не го включва.');
 if(h.proxy||a.proxy)risks.push('Има нееднозначна клубна идентичност; архивите не се обединяват по предположение.');
 if([h,a].some(t=>t.all[0]&&Date.parse((d.asOfDate||d.fixture[3])+'T12:00:00Z')-Date.parse(t.all[0][3]+'T12:00:00Z')>30*86400000))risks.push('За единия отбор липсва скорошен резултат от последните 30 дни.');
 if(!risks.length&&minimum>=5){const signal=d.tendencies.find(v=>v.sides.some(t=>t.measure.currentStreak>=4));
  if(signal)risks.push(trendExplanation(signal)+' Поредицата описва последните налични мачове и трябва да се чете заедно с целия профил, а не като гаранция за продължение.');
  else risks.push('Най-полезно е предимството в резултата да се прецени отделно от посоката за головете. Основната прогноза и алтернативите отдолу сравняват точно тези различни сценарии с наличната обща подкрепа.');
 }
 if(risks.length)out.push({label:'Какво изисква внимание',text:risks.join(' ')});
 return out;
}
function intro(d){return reading(d).map(p=>p.text);}
function introHTML(d){return '<section class="card match-reading"><h3>Прочит на мача</h3>'+reading(d).map(p=>'<div class="reading-point"><h4>'+esc(p.label)+'</h4><p>'+esc(p.text)+'</p></div>').join('')+'<small>Форма: налични първенства + УЕФА. Модел: отделно историята на първенството.</small></section>';}
function period(rows){return rows.length?rows[rows.length-1][3]+' → '+rows[0][3]:'няма данни';}
function standingsBrief(doc,division,names,keyTeam){
 const table=doc?.tables?.[division];if(!table)return ['Класиране: не е налично при копирането.'];
 const out=['ТЕКУЩО КЛАСИРАНЕ · сезон '+table.season+' · '+table.provider+' · проверено '+table.observed_at_utc,
  'Това е текуща таблица, не историческа предмачова снимка.'];
 let matched=0;
 if(doc.checks?.[division]?.status==='error')out.push('Последната проверка е неуспешна; таблицата е запазена от предишно обновяване.');
 if(table.archive_ahead?.length)out.push('Има предупреждение за изоставане спрямо архива.');
 for(const group of table.groups){
  const rows=group.rows.filter(r=>r.club_key&&names.some(n=>keyTeam(n)===r.club_key));
  matched+=rows.length;
  if(rows.length)out.push('Фаза: '+group.name,...rows.map(r=>r.rank+'. '+r.name+' · '+r.points+' т. · '+r.played+' мача · П/Р/З '+r.won+'/'+r.drawn+'/'+r.lost+' · голове '+fmt(r.gf,0)+':'+fmt(r.ga,0)+' · ГР '+r.gd+(r.points_adjustment?' · корекция '+r.points_adjustment+' т.':'')));
 }
 if(!matched)out.push('Отборите нямат прегледана връзка с редовете на таблицата.');
 if(table.source_url)out.push('Източник: '+table.source_url);
 return out;
}
function brief(d,{status={},standings=null,keyTeam,generatedAt=new Date().toISOString(),direct=[]}={}){
 const f=d.fixture,out=['MATCHPULSE SCOUT · ДОСИЕ ЗА АНАЛИЗ',f[5]+' – '+f[6]+' · '+f[2],
  'Начало: '+f[3]+' '+(f[4]||'часът не е потвърден')+' · '+(typeof f[13]==='string'&&f[13].includes('Sofia')?'Europe/Sofia':'часовата зона не е потвърдена'),
  'Генерирано: '+generatedAt,'Избрана извадка: последни '+d.windowSize+' мача. Само срещи с дата преди '+f[3]+'.',
  d.coverageNote||'Архивът е ограничен до показаното състезание.',
  'Източник на програмата: '+(typeof f[13]==='string'?f[13]:'не е посочен'),'', 'ПРОЧИТ НА МАЧА',...intro(d),''];
 if(d.model){
  const p=d.model.distribution.probs;
  out.push('СЪЩЕСТВУВАЩ МОДЕЛ · Поасон / Dixon–Coles',
   'Моделни голове: '+fmt(d.model.lambdaHome,2)+' / '+fmt(d.model.lambdaAway,2)+' · общо '+fmt(d.model.total,2),
   'Това са моделни оценки, различни от наблюдавания xG. Моделът използва собствена история с до 30 предишни срещи; изборът 5/10/20 променя описателните статистики.',
   ...[['1',p.homeWin],['X',p.draw],['2',p.awayWin],['1X',p.double1X],['X2',p.doubleX2],['12',p.double12],
    ['Над 1,5',p.over15],['Над 2,5',p.over25],['Под 2,5',1-p.over25],['Над 3,5',p.over35],['Под 3,5',1-p.over35],
    ['Гол/гол Да',p.btts],['Гол/гол Не',1-p.btts],['Домакин 2+',p.homeOver15],['Гост 2+',p.awayOver15]].map(([label,value])=>label+': '+pct(value)), '');
 }else out.push('Моделни вероятности: няма приложима оценка за този мач.','');
 for(const side of ['home','away']){
  const t=d[side],v=t.overall,venue=t.local;
  out.push((side==='home'?'ДОМАКИН: ':'ГОСТ: ')+t.name,'История: '+(t.scope==='all_available'?'налични първенства + УЕФА':t.scope)+(t.proxy?' · заместена с вътрешно първенство':'')+' · '+period(t.all),
   'Извадка '+v.n+' мача · '+t.form.wins+' победи / '+t.form.draws+' равенства / '+t.form.losses+' загуби · '+t.form.points+' точки от '+(t.form.n*3),
   'Вкарани '+fmt(v.n?v.gf:null,2)+' · допуснати '+fmt(v.n?v.ga:null,2)+' · общо '+fmt(v.n?v.total:null,2)+' средно на мач',
   'Над 1,5: '+v.o15+'/'+v.n+' · над 2,5: '+v.o25+'/'+v.n+' · над 3,5: '+v.o35+'/'+v.n+' · гол/гол: '+v.btts+'/'+v.n,
   'Elo: '+(t.rating?.games?Math.round(t.rating.rating)+' · '+t.rating.games+' предишни мача · '+t.rating.division:'няма архив'),
   (side==='home'?'Само домакинства':'Само гостувания')+': '+venue.n+' мача · период '+period(t.venue)+' · П/Р/З '+t.venueForm.wins+'/'+t.venueForm.draws+'/'+t.venueForm.losses+
    ' · вкарани '+fmt(venue.n?venue.gf:null,2)+' · допуснати '+fmt(venue.n?venue.ga:null,2)+' · над 2,5 '+venue.o25+'/'+venue.n+' · гол/гол '+venue.btts+'/'+venue.n);
  for(const def of STATISTICS){
   const s=t.stats[def.key];
   out.push(def.label+': на отбора '+fmt(s.own)+' / на съперниците '+fmt(s.opponent)+' / общо в мача '+fmt(s.total)+' средно · налични '+s.n+'/'+s.possible,
    'Общо в мача: '+s.lines.map(v=>'над '+fmt(v.line)+' '+v.hits+'/'+v.n+(v.n?' ('+pct(v.hits/v.n)+')':'')).join(' · '));
  }
  out.push('Наблюдаван xG: '+fmt(t.xg.own.mean,2)+' в '+t.xg.own.n+'/'+t.xg.possible+' мача; вкарани в същите срещи '+fmt(t.xg.own.goals,2)+' средно.',
   'Наблюдаван xGA: '+fmt(t.xg.against.mean,2)+' в '+t.xg.against.n+'/'+t.xg.possible+' мача; допуснати в същите срещи '+fmt(t.xg.against.goals,2)+' средно.',
   'Последни резултати · домакин : гост · най-новите първи:',...t.all.map(row=>row[3]+' · '+score(row)+(row[13]?.PHASE==='QUALIFYING'?' · квалификации':'')+' · '+detailStats(row).map(s=>s.label+' '+fmt(s.home,s.label==='xG'?2:0)+':'+fmt(s.away,s.label==='xG'?2:0)).join('; ')),'');
 }
 out.push('ВАЖНИ ТЕНДЕНЦИИ · ОТДЕЛНО ЗА ОТБОРИТЕ И ОБЩИ ПОСЛЕДОВАТЕЛНОСТИ',...(d.tendencies.length?d.tendencies.flatMap(v=>[v.title+' · '+trendExplanation(v),...v.sides.map(s=>s.sentence+' · '+s.from+' → '+s.until+' · мачове: '+s.rows.map(r=>r[3]+' '+score(r)+' ('+r[0]+')').join('; '))]):['Няма достатъчно ясна скорошна тенденция.']),
  '', 'ДИРЕКТНИ СРЕЩИ · СЪЩОТО СЪСТЕЗАНИЕ · 90 МИНУТИ',...(direct.length?direct.map(r=>r[3]+' · '+score(r)):['Няма налични.']),
  '',...standingsBrief(standings,f[0],[d.home.name,d.away.name],keyTeam),
  '', 'АКТУАЛНОСТ И ОГРАНИЧЕНИЯ',
  'Последен успешен импорт на историята: '+(status.last_history_success_utc||'не е посочен'),
  'Последно допълване на актуални резултати: '+(status.last_results_success_utc||'не е посочено'),
  'Последно обновяване на архива на УЕФА: '+(status.last_europe_success_utc||'не е посочено'),
  'Последно успешно класиране: '+(status.last_standings_success_utc||'не е посочено'),
  '— означава липсващо наблюдение, не нула. Статистическите честоти описват само наличните срещи. Извадката може да обхваща повече от един сезон.',
  'Провери актуални състави, отсъствия, новини, качество на съперниците и реални коефициенти отделно. Те не са проверени в това досие.');
 return out.join('\n');
}
const api={STATISTICS,form,formCurve,graphHTML,statistics,expectedGoals,eventText,tendencies,describe,formHTML,trendsHTML,statsHTML,detailStats,historyHTML,reading,intro,introHTML,brief,standingsBrief};
if(typeof module==='object'&&module.exports)module.exports=api;root.MatchpulseAnalysis=api;
})(typeof window!=='undefined'?window:globalThis);
