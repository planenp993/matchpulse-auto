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
function tendencies(profile,patterns,keyTeam,asOfDate=sofiaDay(new Date())){
 const cutoff=profile.fixture[3]<asOfDate?profile.fixture[3]:asOfDate;
 const since=new Date(Date.parse(cutoff+'T12:00:00Z')-CURRENT_DAYS*86400000).toISOString().slice(0,10);
 const out=patterns.MARKETS.map(m=>{
  const sides=['home','away'].map(side=>{
   const t=profile[side];
   if(t.proxy||t.pendingLatest)return null;
   const rows=t.all.filter(r=>r[3]>=since&&r[3]<=cutoff);
   const measure=patterns.measures(rows,t.name,side,m.id,keyTeam);
   if(measure.currentStreak<3)return null;
   const run=rows.slice(0,measure.currentStreak),text=eventText(m.id,side);
   const phrase=personalEvent(m.id)?t.name+' '+text:'В мачовете на '+t.name+': '+text;
   const atLeast=run.length===rows.length;
   return {name:t.name,side,measure,rows:run,phrase,atLeast,from:run[run.length-1][3],until:run[0][3],
    sentence:personalEvent(m.id)?t.name+' '+text+' в последните '+measure.currentStreak+' мача':
     'В последните '+measure.currentStreak+' мача на '+t.name+' '+(m.id==='btts'?'се разписват и двата отбора':m.id==='bttsNo'?'поне единият отбор остава без гол':m.id==='12'?'няма равенство':'има '+text)};
  }).filter(Boolean);
  return {market:m.id,family:m.family,group:m.group,sides};
 }).filter(v=>v.sides.length).sort((a,b)=>Math.max(...b.sides.map(s=>s.measure.currentStreak))-Math.max(...a.sides.map(s=>s.measure.currentStreak))||a.market.localeCompare(b.market));
 const first=[],rest=[],seen=new Set();
 for(const v of out){if(!seen.has(v.family)&&first.length<4){first.push(v);seen.add(v.family);}else rest.push(v);}
 return [...first,...rest];
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
function trendsHTML(d){
 const card=v=>'<article class="tendency-item">'+v.sides.map(s=>{
  const rows=[...s.rows].reverse();
  const trail=rows.map(row=>'<span class="active-match-date" title="'+esc(row[3]+' · '+score(row)+' · '+row[2])+'"><b>✓</b>'+esc(row[3].slice(8)+'.'+row[3].slice(5,7))+'</span>').join('');
  return '<div class="tendency-side"><p>'+esc(s.phrase)+' <strong>'+(s.atLeast?'Поне ':'')+s.measure.currentStreak+' поредни мача</strong></p>'+
   '<div class="current-series" aria-label="Само мачовете от продължаващата серия">'+trail+'</div>'+
   '<small class="series-period">'+esc(s.from)+' → '+esc(s.until)+' · последният мач потвърждава серията</small>'+
   '<details class="series-proof"><summary>Виж мачовете</summary>'+rows.map(row=>'<p>'+esc(row[3]+' · '+score(row)+' · '+row[2])+'</p>').join('')+'</details></div>';
 }).join('')+'</article>';
 const main=d.tendencies.slice(0,4).map(card).join(''),more=d.tendencies.slice(4);
 const delayed=['home','away'].filter(side=>d[side].pendingLatest).map(side=>'<p class="series-notice">'+esc(d[side].name)+(d[side].pendingLatest.state==='conflict'?': резултатът от '+esc(d[side].pendingLatest.date)+' се уточнява.':': очаква се резултат от по-нов мач ('+esc(d[side].pendingLatest.date)+').')+' Текущите серии са спрени до потвърждението.</p>').join('');
 return '<section class="card tendencies"><h3>Важни тенденции</h3><p class="current-series-context">Продължаващи серии · последните '+CURRENT_DAYS+' дни · към '+esc(d.asOfDate||'')+'</p>'+delayed+
  (main||'<p class="footnote">Няма потвърдена продължаваща серия от поне 3 мача в актуалния период.</p>')+
  (more.length?'<details class="tendencies-more"><summary>Още актуални серии · '+more.length+'</summary>'+more.map(card).join('')+'</details>':'')+'</section>';
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
function intro(d){
 const h=d.home,a=d.away,paragraphs=[],p=d.model?.distribution?.probs;
 let first='';
 if(p&&valid(p.homeWin)&&valid(p.awayWin)&&valid(p.draw)){
  const difference=p.homeWin-p.awayWin;
  if(Math.abs(difference)<.08)first='По модела двата отбора са близки и няма отчетлив фаворит: '+h.name+' е с '+pct(p.homeWin)+' за победа, а '+a.name+' — с '+pct(p.awayWin)+'. Равенството е '+pct(p.draw)+'.';
  else {const leader=difference>0?h:a,prob=difference>0?p.homeWin:p.awayWin;
   first=leader.name+' има предимство според модела, с '+pct(prob)+' за победа. Това оставя шанс мачът да завърши по друг начин: равенството е '+pct(p.draw)+', а победата на '+(difference>0?a.name:h.name)+' — '+pct(difference>0?p.awayWin:p.homeWin)+'.';}
 }else first=d.international?'За този европейски мач няма моделни проценти. Прочитът се опира на последните налични официални срещи за 90 минути.':'За този мач няма достатъчно история за моделни проценти. Можем да разгледаме наличната форма.';
 if(!h.form.n||!a.form.n){paragraphs.push(first,'Липсва история за единия отбор, затова общ извод за формата би бил прибързан.');return paragraphs;}
 if(Math.min(h.form.n,a.form.n)<5){paragraphs.push(first,'Налични са само '+h.form.n+' срещи за '+h.name+' и '+a.form.n+' за '+a.name+'. Толкова малка извадка не е достатъчна за устойчив прочит.');return paragraphs;}
 const points=t=>t.form.points/t.form.n,better=points(h)-points(a);
 const comparison=Math.abs(better)<.25?'Резултатите напоследък са близки.':(better>0?h.name:a.name)+' събира повече точки средно в разглежданите мачове.';
 first+=' '+comparison+' '+h.name+' има '+balance(h.form).replaceAll(' · ', ', ')+' в '+h.form.n+' срещи, а '+a.name+' — '+balance(a.form).replaceAll(' · ', ', ')+' в '+a.form.n+'.';
 paragraphs.push(first);
 const scoring=t=>t.all.filter(r=>{const g=t.form.games.find(g=>g.row===r);return g&&g.gf>0;}).length;
 let goals=h.name+' вкарва в '+scoring(h)+' от '+h.form.n+' мача и отбелязва средно '+fmt(h.overall.gf,2)+' гола; '+a.name+' вкарва в '+scoring(a)+' от '+a.form.n+' със средно '+fmt(a.overall.gf,2)+'. ';
 goals+='Допуснатите голове са съответно '+fmt(h.overall.ga,2)+' и '+fmt(a.overall.ga,2)+' средно. ';
 const hr=h.overall.o25/h.overall.n,ar=a.overall.o25/a.overall.n;
 if(Math.abs(hr-ar)>=.2-1e-10)goals+='Картината за головете се разминава: поне 3 гола има в '+h.overall.o25+'/'+h.overall.n+' мача на '+h.name+' срещу '+a.overall.o25+'/'+a.overall.n+' на '+a.name+'. ';
 else goals+='Поне 3 гола има в '+h.overall.o25+'/'+h.overall.n+' мача на '+h.name+' и '+a.overall.o25+'/'+a.overall.n+' на '+a.name+'. ';
 if(p&&valid(p.over25))goals+=(Math.abs(p.over25-.5)<=.07?'Моделът не отделя ясно над от под 2,5 гола':p.over25>.5?'Моделът накланя оценката към поне 3 гола':'Моделът накланя оценката към най-много 2 гола')+' — '+pct(p.over25)+' за над 2,5 и '+pct(1-p.over25)+' за под 2,5.';
 paragraphs.push(goals.trim());
 const extra=[];
 for(const t of [h,a])if(t.xg.own.n>=3&&t.xg.against.n>=3){const x=t.xg;
  extra.push(t.name+' създава положения за средно '+fmt(x.own.mean,2)+' xG ('+x.own.n+' мача с данни) и допуска '+fmt(x.against.mean,2)+' xG ('+x.against.n+' мача).');}
 const active=d.tendencies[0]?.sides[0];
 if(active)extra.push(active.sentence+'; последната среща в серията е на '+active.until+'.');
 for(const t of [h,a])if(t.pendingLatest)extra.push(t.pendingLatest.state==='conflict'?'Резултатът на '+t.name+' от '+t.pendingLatest.date+' се уточнява; текуща серия не се заявява.':'За '+t.name+' очакваме резултат от по-нов мач на '+t.pendingLatest.date+'; формата още не го включва.');
 if(h.proxy||a.proxy)extra.push('Има нееднозначна клубна идентичност; различни архиви не се обединяват по предположение.');
 const oldest=[h.all[0]?.[3],a.all[0]?.[3]].filter(Boolean);
 if(oldest.some(date=>Date.parse((d.asOfDate||d.fixture[3])+'T12:00:00Z')-Date.parse(date+'T12:00:00Z')>CURRENT_DAYS*86400000))extra.push('За единия отбор няма скорошен резултат в последните 30 дни; стара поредица не се показва като актуална.');
 if(extra.length)paragraphs.push(extra.join(' '));
 return paragraphs;
}
function introHTML(d){return '<section class="card match-reading"><h3>Прочит на мача</h3>'+intro(d).map(p=>'<p>'+esc(p)+'</p>').join('')+'<small>Прочит на наличните данни'+(d.recentScope?' · първенства + УЕФА':'')+' · моделните проценти използват отделно историята на първенството</small></section>';}
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
 out.push('АКТУАЛНИ ПРОДЪЛЖАВАЩИ СЕРИИ · ПОСЛЕДНИ 30 ДНИ · НЕ МОДЕЛНИ ВЕРОЯТНОСТИ',...(d.tendencies.length?d.tendencies.flatMap(v=>v.sides.map(s=>s.sentence+' · '+s.from+' → '+s.until+' · потвърждаващи мачове: '+s.rows.map(r=>r[3]+' '+score(r)+' ('+r[0]+')').join('; '))):['Няма сравнима серия 3+ в избраната извадка.']),
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
const api={STATISTICS,form,formCurve,graphHTML,statistics,expectedGoals,eventText,tendencies,describe,formHTML,trendsHTML,statsHTML,detailStats,historyHTML,intro,introHTML,brief,standingsBrief};
if(typeof module==='object'&&module.exports)module.exports=api;root.MatchpulseAnalysis=api;
})(typeof window!=='undefined'?window:globalThis);
