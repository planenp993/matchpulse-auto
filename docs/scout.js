/* MATCHPULSE SCOUT v1 · minimal personal football research cockpit */
'use strict';
const Scout=window.MatchpulseScout,Model=window.MatchpulseModel,Markets=window.MatchpulseMarkets,Elo=window.MatchpulseElo;
const el=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
const percent=v=>Number.isFinite(v)?fmt(v*100,0)+'%':'—';
const localISO=(d=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function offsetISO(n){const a=new Date(localISO()+'T12:00:00Z');a.setUTCDate(a.getUTCDate()+n);return a.toISOString().slice(0,10)}
let history=[],fixtures=[],status={},index=null,eloIndex=null,windowSize=10,opponentFilter='all',active='schedule',fixtureRows=[],scannerRows=[],mode='today',customDate='',activeMatch=null;
const PROFILE_CACHE=new Map(),PICK_KEY='matchpulse-scout-picks-v1';
function readPicks(){try{const v=JSON.parse(localStorage.getItem(PICK_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function writePicks(v){try{localStorage.setItem(PICK_KEY,JSON.stringify(v));return true}catch{return false}}
function profile(f){const k=Scout.keyFixture(f)+'|'+windowSize+'|'+opponentFilter;if(!PROFILE_CACHE.has(k))PROFILE_CACHE.set(k,Scout.profile(index,f,{windowSize,opponentFilter,eloIndex}));return PROFILE_CACHE.get(k)}
function setView(next){
  active=next;
  for(const view of ['schedule','scanner','picks'])el('view-'+view).classList.toggle('hidden',view!==next);
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===next));
  const t={schedule:['Футболна програма','Дневни мачове, голови тенденции и подробен анализ на едно място.'],
    scanner:['Trend Scanner','Автоматично открити голови закономерности от реалната история на отборите.'],
    picks:['Моите прогнози','Твоят личен бележник с пазари, коефициенти и резултати.']};
  el('pageTitle').textContent=t[next][0];el('pageSub').textContent=t[next][1];
  if(next==='schedule')renderSchedule();else if(next==='scanner')renderScanner();else renderPicks();
}
function syncResearchControls(){
 el('researchWindow').value=String(windowSize);el('researchOpp').value=opponentFilter;
 el('drawerWindow').value=String(windowSize);el('drawerOpp').value=opponentFilter;
 el('researchInfo').textContent='Трендове: последни '+windowSize+' мача'+
  (opponentFilter==='strong'?' срещу по-силни по Elo':opponentFilter==='weak'?' срещу по-слаби по Elo':' срещу всички противници')+
  '. Головите моделни проценти използват отделен прозорец до 30 мача.';
}
function setResearch(windowValue,qualityValue){
 const v=Number(windowValue);
 windowSize=[5,10,15].includes(v)?v:10;
 opponentFilter=['all','strong','weak'].includes(qualityValue)?qualityValue:'all';
 PROFILE_CACHE.clear();syncResearchControls();
 if(index){
   renderSchedule();
   if(active==='scanner')renderScanner();
   if(activeMatch&&!el('matchOverlay').classList.contains('hidden'))openMatch(activeMatch);
 }
}
function eloReport(f,p){
 if(!eloIndex)return '';
 const m=Elo.matchup(eloIndex,f);
 const left=Elo.breakdown(eloIndex,p.home.all,p.home.name);
 const right=Elo.breakdown(eloIndex,p.away.all,p.away.name);
 const side=(n,r)=>n+' · '+r.strong+' по-силни, '+r.similar+' близки, '+r.weak+' по-слаби'+(r.unknown?', '+r.unknown+' неоценени':'');
 return '<div class="card elo-analysis"><h3>Elo и сила на съперниците</h3>'+
  (m.usable?'<div class="elo-score-grid"><div><b>'+Math.round(m.home.rating)+'</b><small>'+esc(f[5])+'</small></div>'+
   '<div class="elo-divider">срещу</div><div><b>'+Math.round(m.away.rating)+'</b><small>'+esc(f[6])+'</small></div></div>'+
   '<p class="footnote">'+esc(m.label)+' · '+m.home.games+' и '+m.away.games+' изиграни мача в тази дивизия.</p>':
   '<p class="footnote">Elo за тази среща е ограничен: няма достатъчно сравнима история в едно първенство. Не сравняваме автоматично рейтинги от различни държави или турнири.</p>')+
  '<div class="elo-breakdown"><div>'+esc(side('Домакин',left))+'</div><div>'+esc(side('Гост',right))+'</div></div>'+
  '<p class="footnote">По-силен съперник = поне 75 Elo точки над отбора <strong>преди съответния исторически мач</strong>. Отборите започват от 1500; K=24, бонус домакинство 65. Това е инструмент за контекст, не доказана вероятност за залог.</p></div>';
}
function fixtureQualified(f){
 const p=profile(f);
 return p.home.overall.n>=5&&p.away.overall.n>=5&&!p.international&&!p.home.proxy&&!p.away.proxy;
}
function fixtureHint(f){
 const p=profile(f),s=Scout.trend(p,'o25',8),b=Scout.trend(p,'btts',8);
 if(s.signalFound)return {label:'Над 2,5 · '+s.homeCount+'/'+s.homeTotal+' и '+s.awayCount+'/'+s.awayTotal,css:'green'};
 if(b.signalFound)return {label:'Гол/гол · '+b.homeCount+'/'+b.homeTotal+' и '+b.awayCount+'/'+b.awayTotal,css:'green'};
 if(p.international)return {label:'Евротурнир · ограничени данни',css:'amber'};
 if(fixtureQualified(f))return {label:'Статистика налична',css:''};
 return {label:'Непълни данни',css:'amber'};
}
function dateMode(f){
 const date=f[3],t=localISO();
 if(mode==='today')return date===t;
 if(mode==='tomorrow')return date===offsetISO(1);
 if(mode==='custom')return date===customDate;
 return date>=t&&date<=offsetISO(6);
}
function visibleFixtures(){
 const q=el('searchInput').value.trim().toLowerCase(),league=el('leagueSelect').value,quality=el('qualitySelect').value;
 return Scout.getUpcoming(fixtures).filter(f=>dateMode(f)&&(!league||f[0]===league) &&
  (!q||[f[2],f[5],f[6]].some(x=>String(x).toLowerCase().includes(q))) &&
  (quality==='all'||(quality==='qualified'&&fixtureQualified(f))||
     (quality==='trending'&&['o25','btts','home2','away2','u35'].some(m=>Scout.trend(profile(f),m,8).signalFound))));
}
function renderSchedule(){
 if(!index)return;
 fixtureRows=visibleFixtures();
 el('programTitle').textContent=mode==='today'?'Днешната програма':mode==='tomorrow'?'Утрешната програма':mode==='custom'?'Програма · '+customDate:'Програма · 7 дни';
 el('programSummary').textContent=fixtureRows.length+' срещи · '+new Set(fixtureRows.map(x=>x[0])).size+' състезания';
 if(!fixtureRows.length){el('scheduleList').innerHTML='<div class="empty">За избраната дата и филтри няма предстоящи срещи. Опитай „7 дни“ или друго първенство.</div>';return}
 const groups=new Map();
 fixtureRows.forEach((f,i)=>{const k=f[0]+'|'+f[2];if(!groups.has(k))groups.set(k,[]);groups.get(k).push({f,i})});
 el('scheduleList').innerHTML=[...groups.values()].map(rows=>{
   const g=rows[0].f;
   return '<div class="league-group"><div class="league-head"><strong>'+esc(g[1])+' · '+esc(g[2])+'</strong><span>'+rows.length+' мача</span></div>'+
     rows.map(({f,i})=>{
       const hint=fixtureHint(f),at=f[4]||'—';
       return '<button type="button" data-fixture="'+i+'" class="fixture-row"><span class="time">'+esc(at)+'</span>'+
         '<span class="teams">'+esc(f[5])+' <span style="color:#9daeb9;font-weight:500">–</span> '+esc(f[6])+
         (mode==='week'?'<br><small style="color:#8ba2af;font-weight:500">'+esc(f[3])+'</small>':'')+'</span>'+
         '<span class="fixture-tags"><span class="tag '+hint.css+'">'+esc(hint.label)+'</span></span><span class="chevron">›</span></button>'
     }).join('')+'</div>';
 }).join('');
 el('scheduleList').querySelectorAll('[data-fixture]').forEach(b=>b.onclick=()=>openMatch(fixtureRows[+b.dataset.fixture]));
}
function graphBars(rows,team){
 const bars=rows.slice(0,10).reverse().map(r=>{
   const h=Scout.keyTeam(r[5])===Scout.keyTeam(team),gf=h?r[7]:r[8],ga=h?r[8]:r[7];
   return '<div><i style="height:'+Math.max(3,Math.min(100,gf/5*100))+'%"></i><i class="against" style="height:'+Math.max(3,Math.min(100,ga/5*100))+'%"></i></div>';
 }).join('');
 return '<div class="goal-chart">'+bars+'</div><div class="chart-legend"><span></span> Вкарани <span class="against"></span> Допуснати · последните '+Math.min(rows.length,10)+' мача</div>';
}
function matchRows(rows,team){
 if(!rows.length)return '<div class="empty">Няма достатъчно данни.</div>';
 return rows.slice(0,10).map(r=>{
   const home=Scout.keyTeam(r[5])===Scout.keyTeam(team),op=home?r[6]:r[5],gf=home?r[7]:r[8],ga=home?r[8]:r[7];
   return '<div class="match-history"><time>'+esc(r[3].slice(5))+'</time><span title="'+esc(op)+'">'+(home?'Д ':'Г ')+esc(op)+'</span><b>'+gf+':'+ga+'</b></div>'
 }).join('');
}
function signalTiles(p){
 const markets=['o25','btts','home2','away2','u35'];
 return markets.map(m=>{
   const s=Scout.trend(p,m,5);
   return '<div class="trend-tile"><strong>'+esc(s.marketName)+'</strong>'+
     '<div class="mini-bars">'+miniBar(m==='away2'?'Допуска 2+':m==='home2'?'Вкарва 2+':'Домакин',s.homeCount,s.homeTotal,false)+miniBar(m==='away2'?'Вкарва 2+':m==='home2'?'Допуска 2+':'Гост',s.awayCount,s.awayTotal,true)+'</div>'+
     '<div style="font-size:10px;color:#7c919c">'+esc(s.explanation)+'</div></div>';
 }).join('');
}
function venueTiles(p){
 const a=p.home.local,b=p.away.local;
 const rules=[
  ['Над 2,5 · по терен','o25','o25','Домакинства','Гостувания'],
  ['Гол/гол · по терен','btts','btts','Домакинства','Гостувания'],
  ['Домакин 2+ гола','scored2','conceded2','Вкарва 2+ у дома','Допуска 2+ навън'],
  ['Гост 2+ гола','conceded2','scored2','Допуска 2+ у дома','Вкарва 2+ навън']
 ];
 return rules.map(([name,hkey,akey,hlabel,alabel])=>
  '<div class="trend-tile"><strong>'+esc(name)+'</strong>'+
  '<div class="mini-bars">'+miniBar(hlabel,a[hkey],a.n)+miniBar(alabel,b[akey],b.n,true)+'</div>'+
  '<div style="font-size:10px;color:#7c919c">'+
  (Math.min(a.n,b.n)<5?'Ниска извадка: изводът е несигурен.':'Реални последни до 10 домакинства/гостувания.')+
  '</div></div>'
 ).join('');
}
function directMeetings(f){
 const h=Scout.keyTeam(f[5]),a=Scout.keyTeam(f[6]);
 const rows=index.byDivision.get(f[0]+'|'+h)||[];
 const direct=rows.filter(r=>r[3]<f[3]&&
   ((Scout.keyTeam(r[5])===h&&Scout.keyTeam(r[6])===a)||
    (Scout.keyTeam(r[5])===a&&Scout.keyTeam(r[6])===h))).slice(0,6);
 if(!direct.length)return '<p class="footnote">Няма директни срещи в наличния архив за това първенство.</p>';
 return direct.map(r=>'<div class="match-history"><time>'+esc(r[3].slice(2))+'</time>'+
  '<span title="'+esc(r[5]+' – '+r[6])+'">'+esc(r[5])+' – '+esc(r[6])+'</span>'+
  '<b>'+r[7]+':'+r[8]+'</b></div>').join('');
}
function miniBar(name,value,total,alt=false){
 const frac=total?value/total:0;
 return '<div class="bar-row"><span>'+esc(name)+'</span><div class="bar-track"><div class="bar-fill '+(alt?'alt':'')+'" style="width:'+(frac*100)+'%"></div></div><strong>'+(total?value+'/'+total:'—')+'</strong></div>';
}
function extraReport(p){
 const cards=Markets.compare(p,5),xg=Markets.xgReport(p,Scout.keyTeam);
 const blocks=cards.map(x=>{
  if(!x.home.n&&!x.away.n)return '<div class="extra-stat"><strong>'+esc(x.label)+'</strong><div class="extra-missing">Няма данни от CSV за последните срещи.</div></div>';
  const lines=x.home.lines.map((h,i)=>{
   const a=x.away.lines[i];
   const text=(v,side)=>v.n?'<b>'+percent(v.rate)+'</b> <small>('+v.hits+'/'+v.n+')</small>':'<span class="extra-missing">няма данни</span>';
   return '<div class="extra-line"><span>Над '+String(h.line).replace('.',',')+'</span><span>'+text(h,'h')+'</span><span>'+text(a,'a')+'</span></div>';
  }).join('');
  const avr=(y)=>y.n?fmt(y.average,1)+' / мач · '+y.n+' мача':'недостатъчно';
  return '<div class="extra-stat"><strong>'+esc(x.label)+'</strong>'+
   '<div class="extra-avg">Средно: домакин '+avr(x.home)+' · гост '+avr(x.away)+'</div>'+
   '<div class="extra-line extra-heading"><span>Линия</span><span>Домакин</span><span>Гост</span></div>'+lines+
   (x.eligible?'':'<div class="extra-missing">Ограничена извадка. Не използвай това като надеждна вероятност.</div>')+
   '</div>';
 }).join('');
 const xgLabel=z=>z.n>=3?'xG средно '+fmt(z.mean,2)+' ('+z.n+' мача)':'xG: няма достатъчно данни';
 return '<div class="card extra-analytics"><details>'+
  '<summary><span>Удари, корнери, картони и xG</span><small>Наблюдавани проценти · според наличните данни</small></summary>'+
  '<p class="footnote" style="margin-top:12px">Тези проценти са <strong>наблюдавана честота от предишни мачове</strong>, не моделирана вероятност за предстоящия двубой. Показваме „няма данни“, когато съответната CSV колона липсва.</p>'+
  '<div class="extra-grid">'+blocks+'</div>'+
  '<div class="extra-stat"><strong>xG (ако е наличен)</strong><div class="extra-avg">'+
  esc(p.home.name)+': '+xgLabel(xg.home)+' · '+esc(p.away.name)+': '+xgLabel(xg.away)+'</div>'+
  '<div class="footnote">xG не е стандартно гарантирана колона във Football-Data. Стойностите се показват само ако действително съществуват в базата.</div></div>'+
  '</details></div>';
}
function modelReport(f,p){
 if(p.international)return '<div class="warn">За евротурнирите не прилагаме общи вероятности от националните първенства без корекция за силата на противниците. Използвай досието само като контекст.</div>';
 const z=Model.evaluate(history,f,'standard');
 if(z.error)return '<div class="warn">'+esc(z.error)+'</div>';
 const x=z.distribution.probs;
 const markets=[['Над 1,5 гола',x.over15],['Над 2,5 гола',x.over25],['Под 2,5 гола',1-x.over25],['Над 3,5 гола',x.over35],['Гол/гол Да',x.btts],['Гол/гол Не',1-x.btts],['Домакин 2+',x.homeOver15],['Гост 2+',x.awayOver15]];
 return '<div class="card"><h3>1X2 и двоен шанс</h3>'+
   '<p class="footnote">Изчислени от същата матрица на точните резултати като головите пазари. Това са ориентировъчни моделни вероятности, не доказано пазарно предимство.</p>'+
   '<div class="outcome-grid">'+
   [['1',x.homeWin],['X',x.draw],['2',x.awayWin]].map(([label,p])=>'<div class="outcome-cell"><strong>'+label+'</strong><b>'+percent(p)+'</b></div>').join('')+
   '</div><div class="model-markets">'+
   [['1X · домакин или равен',x.double1X],['X2 · гост или равен',x.doubleX2],['12 · без равен',x.double12]].map(([label,p])=>'<div><span>'+label+'</span><strong>'+percent(p)+'</strong></div>').join('')+
   '</div></div>'+
   '<div class="card"><h3>Ориентировъчен голов модел</h3>'+
   '<div class="model-kpis"><div><b>'+fmt(z.lambdaHome,2)+'</b><span>Очаквани домакин</span></div><div><b>'+fmt(z.lambdaAway,2)+'</b><span>Очаквани гост</span></div><div><b>'+fmt(z.total,2)+'</b><span>Общо голове</span></div></div>'+
   '<p class="footnote">Прозрачен модел на атака/защита и Поасон с Dixon–Coles корекция. Използва до 30 предишни срещи независимо от избора 5/10/15 за трендовете. Това са <strong>експериментални вероятности, не сигурни прогнози</strong> и не потвърдени пазарни коефициенти.</p>'+
   '<div class="model-markets">'+markets.map(([n,v])=>'<div><span>'+esc(n)+'</span><strong>'+percent(v)+'</strong></div>').join('')+'</div></div>';
}
function openMatch(f){
 if(!f)return;
 activeMatch=f;const p=profile(f);
 el('matchOverlay').classList.remove('hidden');document.body.style.overflow='hidden';
 const date=f[3]+' · '+(f[4]||'—')+' · '+f[2];
 const recent=p.home.overall.n+' / '+p.away.overall.n;
 const sections=[['Домакин',p.home],['Гост',p.away]];
 const m=sections.map(([role,data])=>{
   const v=data.overall;
   return '<section class="team-panel"><div class="role">'+role+'</div><h3>'+esc(data.name)+'</h3>'+
     '<div class="team-metrics"><div class="metric"><b>'+(v.n?fmt(v.gf,2):'—')+'</b><small>Вкарани</small></div>'+
     '<div class="metric"><b>'+(v.n?fmt(v.ga,2):'—')+'</b><small>Допуснати</small></div>'+
     '<div class="metric"><b>'+(v.n?fmt(v.total,2):'—')+'</b><small>Голове/мач</small></div></div>'+
     (v.n?graphBars(data.all,data.name):'<p class="footnote">Няма срещи в тази извадка. Промени Elo филтъра.</p>')+'</section>';
 }).join('');
 el('matchContent').innerHTML='<div class="match-header"><div class="match-date">'+esc(date)+'</div>'+
   '<div class="match-heading" id="matchHeading">'+esc(f[5])+' <span style="color:#8de8c1">vs</span> '+esc(f[6])+'</div>'+
   '<div class="match-head-tags"><span class="tag">Последни мачове: '+recent+'</span><span class="tag">'+esc((f[13]||'Football-Data').split('/')[0])+'</span></div></div>'+
   '<div class="match-inner"><div class="duel">'+m+'</div>'+
   '<div class="card"><h3>Голови тенденции · последните '+windowSize+' мача</h3><div class="trend-grid">'+signalTiles(p)+'</div></div>'+
   '<div class="card"><h3>Домакинска и гостуваща форма</h3>'+
   '<p class="footnote">Отделна проверка: последните до '+windowSize+' домакински срещи на '+esc(f[5])+
   ' срещу последните до '+windowSize+' гостувания на '+esc(f[6])+'.</p>'+
   '<div class="trend-grid">'+venueTiles(p)+'</div></div>'+
   '<div class="card"><h3>Последни резултати</h3><div class="history-grid">'+
     '<div><strong>'+esc(f[5])+'</strong>'+matchRows(p.home.all,p.home.name)+'</div>'+
     '<div><strong>'+esc(f[6])+'</strong>'+matchRows(p.away.all,p.away.name)+'</div></div>'+
     (p.international?'<div class="warn">При евротурнир може да се използва само история от вътрешно първенство или да липсва достатъчно история. Тези резултати не са директно съпоставими между различни лиги.</div>':'')+'</div>'+
   '<div class="card"><h3>Директни срещи · наличен архив</h3>'+directMeetings(f)+'</div>'+ 
   eloReport(f,p)+
   modelReport(f,p)+
   extraReport(p)+
   '<div class="card"><h3>Запази моя прогноза</h3>'+
      '<div class="pick-form"><label>Голов пазар<select id="pickMarket">'+
      [['1','Победа домакин (1)'],['X','Равен (X)'],['2','Победа гост (2)'],['1X','Двоен шанс 1X'],['X2','Двоен шанс X2'],['12','Двоен шанс 12'],['o15','Над 1,5'],['o25','Над 2,5'],['o35','Над 3,5'],['u35','Под 3,5'],['btts','Гол/гол Да'],['home2','Домакин 2+'],['away2','Гост 2+'],['corners85','Корнери над 8,5'],['corners95','Корнери над 9,5'],['yellow35','Жълти картони над 3,5'],['shots215','Удари над 21,5'],['target85','Точни удари над 8,5']].map(([k,n])=>'<option value="'+k+'">'+n+'</option>').join('')+'</select></label>'+
      '<label>Коефициент (по избор)<input id="pickOdds" inputmode="decimal" type="text" placeholder="Напр. 1.80"></label>'+
      '<button id="savePick" type="button" class="button">+ Запази в моя бележник</button></div>'+
      '<p class="form-notice">Коефициентът се въвежда от теб. Сайтът не извлича live котировки и няма да го измисля.</p><button class="button secondary" id="copyMatch" type="button">Копирай данните за ChatGPT анализ</button>'+
      '<span id="copyStatus" class="copy-status"></span></div></div>';
 el('savePick').onclick=savePick;el('copyMatch').onclick=copyMatch;
}
function closeMatch(){el('matchOverlay').classList.add('hidden');document.body.style.overflow=''}
function savePick(){
 if(!activeMatch)return;
 const oddsString=el('pickOdds').value.trim().replace(',','.'),odds=oddsString?Number(oddsString):null;
 if(oddsString&&(!Number.isFinite(odds)||odds<1.01||odds>1000)){alert('Въведи реален десетичен коефициент, например 1.80, или остави празно.');return}
 const picks=readPicks(),m=el('pickMarket').value;
 if(picks.some(x=>x.fixtureKey===Scout.keyFixture(activeMatch)&&x.market===m)){
  alert('Вече имаш запазена прогноза за този мач и пазар.');return
 }
 picks.push({id:String(Date.now())+'-'+picks.length,fixtureKey:Scout.keyFixture(activeMatch),
  div:activeMatch[0],date:activeMatch[3],time:activeMatch[4],home:activeMatch[5],away:activeMatch[6],
  market:m,odds,createdAt:new Date().toISOString()});
 if(writePicks(picks)){el('copyStatus').textContent='Записано ✓';setView('picks');closeMatch()}
 else alert('Браузърът не разреши локално запазване. Може да ползваш копирането на анализа.');
}
function copyMatch(){
 if(!activeMatch)return;
 const p=profile(activeMatch);
 const text=['MATCHPULSE SCOUT · FOOTBALL ANALYSIS BRIEF',activeMatch[3]+' '+activeMatch[4],
 activeMatch[5]+' – '+activeMatch[6]+' ('+activeMatch[2]+')',
 'SOURCE: '+(activeMatch[13]||'Football-Data')].concat(
  [['HOME',p.home],['AWAY',p.away]].flatMap(([side,t])=>[
   side+' '+t.name+': last '+t.overall.n+' matches, goals for '+fmt(t.overall.gf,2)+', against '+fmt(t.overall.ga,2),
   'Over2.5: '+t.overall.o25+'/'+t.overall.n+'; BTTS: '+t.overall.btts+'/'+t.overall.n,
   'Recent results: '+t.all.map(r=>r[3]+' '+r[5]+' '+r[7]+':'+r[8]+' '+r[6]).join('; ')
  ])).concat(['Check current news, lineup, opponent quality and real bookmaker quotes. History is NOT a guarantee.']).join('\n');
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>el('copyStatus').textContent='Копирано ✓').catch(()=>el('copyStatus').textContent='Копирането не е разрешено.');
 else el('copyStatus').textContent='Браузърът не разрешава копиране.';
}
function renderScanner(){
 if(!index)return;
 const market=el('scanMarket').value,days=+el('scanWindow').value,minSample=+el('minSample').value,league=el('scanLeague').value;
 scannerRows=Scout.scan(index,fixtures,{market,days,minSample:Math.min(minSample,windowSize),league,windowSize,opponentFilter,eloIndex}).slice(0,60);
 if(!scannerRows.length){el('scannerList').innerHTML='<div class="empty">Няма срещи, които покриват тези условия. Опитай по-широк период или друг пазар. Това не е грешка.</div>';return}
 el('scannerList').innerHTML=scannerRows.map((entry,i)=>{
  const {fixture:f,trend:s}=entry;
  return '<article class="scan-card"><div class="scan-head"><span class="scan-league">'+esc(f[2])+'</span><span class="signal">'+esc(s.marketName)+'</span></div>'+
    '<div class="scan-date">'+esc(f[3])+' · '+esc(f[4]||'—')+'</div><h3>'+esc(f[5])+' – '+esc(f[6])+'</h3>'+
    '<div class="mini-bars">'+miniBar('Домакин',s.homeCount,s.homeTotal)+miniBar('Гост',s.awayCount,s.awayTotal,true)+'</div>'+
    '<p>И двата отбора подкрепят тенденцията. Отчитаме последната форма и домакинско/гостуващия контекст. Не е прогноза с доказан пазарен ръб.</p>'+
    '<div class="scan-actions"><span style="font-size:11px;color:#8aa0ac">Статистически сигнал · не вероятност</span><button data-scan="'+i+'" class="button secondary" type="button">Анализирай →</button></div></article>'
 }).join('');
 el('scannerList').querySelectorAll('[data-scan]').forEach(x=>x.onclick=()=>openMatch(scannerRows[+x.dataset.scan].fixture));
}
const marketNames={'1':'Победа домакин','X':'Равен','2':'Победа гост','1X':'Двоен шанс 1X','X2':'Двоен шанс X2','12':'Двоен шанс 12',o15:'Над 1,5',o25:'Над 2,5',o35:'Над 3,5',u35:'Под 3,5',btts:'Гол/гол Да',home2:'Домакин 2+',away2:'Гост 2+',corners85:'Корнери над 8,5',corners95:'Корнери над 9,5',yellow35:'Жълти картони над 3,5',shots215:'Удари над 21,5',target85:'Точни удари над 8,5'};
function renderPicks(){
 const list=readPicks(),resolved=list.map(p=>{
  const done=index.lookup.get(p.fixtureKey),settled=done?Scout.marketSettled(p,done):null;
  return {...p,settled,score:done?done[7]+':'+done[8]:null}
 });
 const done=resolved.filter(x=>x.settled!==null);
 el('picksSummary').textContent=list.length+' записани · '+done.filter(x=>x.settled).length+' успешни / '+done.length+' приключили';
 if(!list.length){el('picksList').innerHTML='<div class="empty">Нямаш запазени прогнози. Отвори мач от програмата и натисни „Запази“.</div>';return}
 el('picksList').innerHTML=resolved.slice().reverse().map(p=>'<div class="pick-card"><div><strong>'+esc(p.home)+' – '+esc(p.away)+'</strong>'+
  '<small>'+esc(p.date)+' · '+esc(marketNames[p.market]||p.market)+(p.odds?' · коеф. '+p.odds.toFixed(2):'')+
  ' · '+(p.settled===null?'Очаква резултат':p.settled?'Успешна ✓':'Неуспешна ✕')+
  (p.score?' ('+esc(p.score)+')':'')+'</small></div>'+
  '<button type="button" data-del="'+esc(p.id)+'" class="button secondary">Премахни</button></div>').join('');
 el('picksList').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
   if(confirm('Да премахна тази лична бележка?')){writePicks(readPicks().filter(p=>p.id!==b.dataset.del));renderPicks()}
 });
}
function exportPicks(){
 const picks=readPicks();if(!picks.length){alert('Няма прогнози за експорт.');return}
 const cols=['date','home','away','market','odds','createdAt','result'];
 const csv=[cols.join(',')].concat(picks.map(p=>cols.map(k=>{
  const v=k==='result'?(index.lookup.get(p.fixtureKey)?'final available':'pending'):(p[k]??'');
  return '"'+String(v).replace(/"/g,'""')+'"';
 }).join(','))).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));a.download='matchpulse_my_picks.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function load(){
 try{
  const [h,f,s]=window.SCOUT_EMBEDDED_DATA ?
    [window.SCOUT_EMBEDDED_DATA.history,window.SCOUT_EMBEDDED_DATA.fixtures,window.SCOUT_EMBEDDED_DATA.status] :
    await Promise.all(['history.json','fixtures.json','status.json'].map(name=>
      fetch('data/'+name+'?scout=1',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(name+' HTTP '+r.status);return r.json()})));
  if(!Array.isArray(h)||!Array.isArray(f))throw Error('Невалиден формат на базата');
  history=h;fixtures=f;status=s;index=Scout.build(h);eloIndex=Elo.build(h,Scout.keyTeam);eloIndex.opponentClass=Elo.opponentClass;syncResearchControls();
  const lg=new Map();f.forEach(row=>lg.set(row[0],row[2]));
  const options='<option value="">Всички първенства</option>'+[...lg.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('');
  el('leagueSelect').innerHTML=options;el('scanLeague').innerHTML=options;
  const last=s.last_build_utc?new Date(s.last_build_utc).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'неизвестно';
  el('lastSync').textContent='Обновено: '+last;
  el('sourceStatus').textContent=history.length.toLocaleString('bg-BG')+' изиграни мача · '+fixtures.length+' в календара';
  el('notice').textContent='Автоматично обновени файлове · последно '+last+
   '. Календарът не е live. Часовете с „UTC→Europe-Sofia“ са български, а при другите източници потвърди часовата зона. Данните могат да изостават.';
  setView('schedule');
 }catch(e){
  el('lastSync').textContent='Няма данни';
  el('notice').textContent='Не успях да заредя футболната база: '+e.message+'. За локална проба пусни сайта през уеб сървър, не като file://.';
  el('scheduleList').innerHTML='<div class="empty">'+esc(e.message)+'</div>';
 }
}
for(const id of ['researchWindow','drawerWindow'])el(id).onchange=e=>setResearch(e.target.value,opponentFilter);
for(const id of ['researchOpp','drawerOpp'])el(id).onchange=e=>setResearch(windowSize,e.target.value);
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{
 mode=b.dataset.day==='7'?'week':b.dataset.day==='1'?'tomorrow':'today';
 document.querySelectorAll('[data-day]').forEach(x=>x.classList.toggle('active',x===b));
 renderSchedule();
});
el('dateInput').onchange=e=>{if(e.target.value){mode='custom';customDate=e.target.value;document.querySelectorAll('[data-day]').forEach(x=>x.classList.remove('active'));renderSchedule()}};
for(const id of ['leagueSelect','qualitySelect','searchInput'])el(id).addEventListener(id==='searchInput'?'input':'change',renderSchedule);
for(const id of ['scanMarket','scanWindow','minSample','scanLeague'])el(id).addEventListener('change',renderScanner);
el('exportPicks').onclick=exportPicks;el('closeMatch').onclick=closeMatch;
el('matchOverlay').onclick=e=>{if(e.target===el('matchOverlay'))closeMatch()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('matchOverlay').classList.contains('hidden'))closeMatch()});
load();
