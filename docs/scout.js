/* MATCHPULSE SCOUT v1 · minimal personal football research cockpit */
'use strict';
const Scout=window.MatchpulseScout,Model=window.MatchpulseModel,Markets=window.MatchpulseMarkets,Elo=window.MatchpulseElo,Patterns=window.MatchpulsePatterns,Analysis=window.MatchpulseAnalysis;
const el=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
const percent=v=>Number.isFinite(v)?fmt(v*100,0)+'%':'—';
const localISO=(d=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function offsetISO(n){const a=new Date(localISO()+'T12:00:00Z');a.setUTCDate(a.getUTCDate()+n);return a.toISOString().slice(0,10)}
let history=[],fixtures=[],status={},index=null,eloIndex=null,windowSize=10,active='schedule',fixtureRows=[],scannerRows=[],mode='today',customDate='',activeMatch=null;
let diaryLoaded=false,diaryLoading=false,archive=null,standingsPromise=null,matchTrigger=null;
let availability={europe:false,links:false,europeNames:false};
let dataSnapshot=null,initialPromise=null,corePromise=null,extrasPromise=null,fixturesReady=false,extrasReady=false,coverageLoaded=false,matchOpenToken=0,matchTriggerKind=null;
const dataFailures=new Map();
async function loadStandings(){
 if(!standingsPromise)standingsPromise=(async()=>{await initialPromise;return dataSnapshot.get('standings.json');})();
 try{return await standingsPromise;}catch(error){standingsPromise=null;throw error;}
}
async function showStandings(target,division,fixture=null){
 target.innerHTML='<p class="footnote">Зареждане на класирането…</p>';
 try{
  const doc=await loadStandings();
  if(!target.isConnected)return;
  const mapped=fixture?archive.direct(fixture):{};
  target.innerHTML=window.MatchpulseStandings.render(doc,division,{home:mapped.home,away:mapped.away,keyTeam:Scout.keyTeam});
 }catch{
  if(target.isConnected)target.innerHTML='<p class="footnote">Класирането не можа да се зареди. Опитай отново.</p>';
 }
}
function programStandings(){if(el('scheduleStandings').open)showStandings(el('standingsContent'),el('standingsLeague').value);}

const PROFILE_CACHE=new Map(),PICK_KEY='matchpulse-scout-picks-v1';
function readPicks(){try{const v=JSON.parse(localStorage.getItem(PICK_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
function writePicks(v){try{localStorage.setItem(PICK_KEY,JSON.stringify(v));return true}catch{return false}}
function profile(f){const k=Scout.keyFixture(f)+'|'+windowSize;if(!PROFILE_CACHE.has(k))PROFILE_CACHE.set(k,archive?archive.profile(f,{windowSize}):Scout.profile(index,f,{windowSize}));return PROFILE_CACHE.get(k)}
function setView(next){
 active=next;
 for(const view of ['schedule','scanner','picks','diary','selections'])el('view-'+view).classList.toggle('hidden',view!==next);
 document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===next));
 el('pageTitle').textContent={schedule:'Програма',scanner:'Trend Scanner',picks:'Моите прогнози',diary:'Автоматичен дневник',selections:'Селекции'}[next];
 if(next==='schedule')renderSchedule();
 else if(next==='diary')loadDiary();
 else if(next==='scanner'){
  if(index)renderScanner();else{
   el('scannerList').innerHTML='<div class="empty">Зареждам историята за скенера…</div>';
   ensureCore().then(()=>{if(active==='scanner')renderScanner();}).catch(()=>{if(active==='scanner')el('scannerList').innerHTML='<div class="empty">Историята временно не е достъпна. Презареди страницата.</div>';});
  }
 }else if(next==='selections'){
  if(extrasReady)window.MatchpulseSelectionUI.render();else{
   el('selectionList').setAttribute('aria-busy','true');el('selectionSummary').textContent='Зареждам данните за селекциите…';
   ensureExtras().then(()=>{if(active==='selections')window.MatchpulseSelectionUI.render();}).catch(()=>{
    if(active==='selections'){el('selectionSummary').textContent='Историята временно не е достъпна.';el('selectionList').setAttribute('aria-busy','false');}
   });
  }
 }else{
  renderPicks();
  if(!extrasReady)ensureExtras().then(()=>{if(active==='picks')renderPicks();}).catch(()=>{});
 }
}
function syncResearchControls(){
 for(const id of ['researchWindow','drawerWindow'])el(id).value=String(windowSize);
}
function setResearch(value){
 windowSize=[5,10,20].includes(Number(value))?Number(value):10;
 PROFILE_CACHE.clear();syncResearchControls();
 if(index){
  renderSchedule();
  if(active==='scanner')renderScanner();
  if(activeMatch&&!el('matchOverlay').classList.contains('hidden'))openMatch(activeMatch);
 }
}
function eloReference(f,name){
 if(!eloIndex)eloIndex=Elo.build(history,Scout.keyTeam);
 const r=Elo.reference(eloIndex,f[0],name,f[3]);
 const league=history.find(x=>x[0]===r.division)?.[2]||r.division||'';
 return '<div class="team-elo"><span>Elo</span><b>'+(r.games?Math.round(r.rating):'—')+'</b></div>'+
  '<div class="rating-context">'+(r.games?r.games+' мача · '+esc(league):'Няма архив за Elo')+'</div>';
}
function fixtureQualified(f){
 if(!index||window.MatchpulseArchive.european(f))return false;
 const p=profile(f);
 return p.home.overall.n>=5&&p.away.overall.n>=5&&!p.international&&!p.home.proxy&&!p.away.proxy;
}
function fixtureHint(f){
 if(!index)return {label:dataFailures.has('history.json')?'Анализът временно не е достъпен':'Анализът се зарежда…',css:''};
 if(!extrasReady&&window.MatchpulseArchive.european(f))return {label:'Евротурнир · история при отваряне',css:''};
 const p=profile(f),s=Scout.trend(p,'o25',8),b=Scout.trend(p,'btts',8);
 if(s.signalFound)return {label:'Над 2,5 · '+s.homeCount+'/'+s.homeTotal+' и '+s.awayCount+'/'+s.awayTotal,css:'green'};
 if(b.signalFound)return {label:'Гол/гол · '+b.homeCount+'/'+b.homeTotal+' и '+b.awayCount+'/'+b.awayTotal,css:'green'};
 if(p.international)return {label:p.home.proxy||p.away.proxy?'Евротурнир · ограничени данни':'Евротурнир · история за 90 мин.',css:p.home.proxy||p.away.proxy?'amber':''};
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
  (quality==='all'||(index&&quality==='qualified'&&fixtureQualified(f))||
     (index&&quality==='trending'&&!window.MatchpulseArchive.european(f)&&['o25','btts','home2','away2','u35'].some(m=>Scout.trend(profile(f),m,8).signalFound))));
}
function renderSchedule(){
 if(!fixturesReady)return;
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
       const hint=fixtureHint(f),at=(f[4]||'—')+((f[13]||'').includes('Sofia')?'':'*');
       return '<button type="button" data-fixture="'+i+'" class="fixture-row"><span class="time">'+esc(at)+'</span>'+
         '<span class="teams">'+esc(f[5])+' <span style="color:#9daeb9;font-weight:500">–</span> '+esc(f[6])+
         (mode==='week'?'<br><small style="color:#8ba2af;font-weight:500">'+esc(f[3])+'</small>':'')+'</span>'+
         '<span class="fixture-tags"><span class="tag '+hint.css+'">'+esc(hint.label)+'</span></span><span class="chevron">›</span></button>'
     }).join('')+'</div>';
 }).join('');
 el('scheduleList').querySelectorAll('[data-fixture]').forEach(b=>b.onclick=()=>openMatch(fixtureRows[+b.dataset.fixture]));
}
const MODEL_RESULTS=new WeakMap(),DOSSIERS=new WeakMap();
function modelFor(f,p){
 if(p.international)return null;
 if(!MODEL_RESULTS.has(p))MODEL_RESULTS.set(p,Model.evaluate(history,f,'standard'));
 return MODEL_RESULTS.get(p);
}
function dossier(f,p=profile(f)){
 if(!eloIndex)eloIndex=Elo.build(history,Scout.keyTeam);
 if(!DOSSIERS.has(p)){
 const recent=archive.recentProfile(f,{windowSize});
 if(!availability.links||!availability.europe||!availability.europeNames){
  recent.home.pendingLatest=recent.home.pendingLatest||{state:'unavailable'};
  recent.away.pendingLatest=recent.away.pendingLatest||{state:'unavailable'};
  recent.coverageNote+=' Част от допълнителните данни не е заредена; актуалните серии не са потвърдени.';
 }
 DOSSIERS.set(p,Analysis.describe(recent,{keyTeam:Scout.keyTeam,patterns:Patterns,model:modelFor(f,p),ratings:{
  home:Elo.reference(eloIndex,f[0],p.home.name,f[3]),away:Elo.reference(eloIndex,f[0],p.away.name,f[3])}}));
 }
 return DOSSIERS.get(p);
}
function signalTiles(p){
 const markets=['o25','btts','home2','away2','u35'];
 return markets.map(m=>{
   const s=Scout.trend(p,m,5);
   return '<div class="trend-tile"><strong>'+esc(s.marketName)+'</strong>'+
     '<div class="mini-bars">'+miniBar(m==='away2'?'Допуска 2+':m==='home2'?'Вкарва 2+':'Домакин',s.homeCount,s.homeTotal,false)+miniBar(m==='away2'?'Вкарва 2+':m==='home2'?'Допуска 2+':'Гост',s.awayCount,s.awayTotal,true)+'</div>'+
     '</div>';
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
  (Math.min(a.n,b.n)<5?'Малка извадка':'')+
  '</div></div>'
 ).join('');
}
function directMeetings(f){
 const mapped=archive.direct(f),h=Scout.keyTeam(mapped.home),a=Scout.keyTeam(mapped.away);
 const rows=mapped.index.byDivision.get(f[0]+'|'+h)||[];
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
function extraReport(d){return Analysis.statsHTML(d);}
function modelReport(f,p){
 if(p.international)return '<div class="warn">За този евротурнир няма моделни проценти. Показана е наличната клубна история.</div>';
 const z=modelFor(f,p);
 if(z.error)return '<div class="warn">Недостатъчно история за моделна оценка.</div>';
 const x=z.distribution.probs;
 const markets=[['Над 1,5',x.over15],['Над 2,5',x.over25],['Под 2,5',1-x.over25],['Над 3,5',x.over35],['Под 3,5',1-x.over35],['Гол/гол Да',x.btts],['Гол/гол Не',1-x.btts],['Домакин 2+',x.homeOver15],['Гост 2+',x.awayOver15]];
 return '<section class="card model-analysis"><h3>Моделни вероятности</h3>'+
  '<div class="model-kpis"><div><b>'+fmt(z.lambdaHome,2)+'</b><span>Голове домакин</span></div><div><b>'+fmt(z.lambdaAway,2)+'</b><span>Голове гост</span></div><div><b>'+fmt(z.total,2)+'</b><span>Общо</span></div></div>'+
  '<h4>1X2 и двоен шанс</h4><div class="outcome-grid">'+
  [['1',x.homeWin],['X',x.draw],['2',x.awayWin]].map(([label,value])=>'<div class="outcome-cell"><strong>'+label+'</strong><b>'+percent(value)+'</b></div>').join('')+
  '</div><div class="model-markets">'+
  [['Двоен шанс 1X',x.double1X],['Двоен шанс X2',x.doubleX2],['Без равен · 12',x.double12]].map(([label,value])=>'<div><span>'+label+'</span><strong>'+percent(value)+'</strong></div>').join('')+
  '</div><h4>Голове</h4><div class="model-markets">'+markets.map(([name,value])=>'<div><span>'+esc(name)+'</span><strong>'+percent(value)+'</strong></div>').join('')+'</div></section>';
}
function openMatch(f){
 if(!f)return;
 const request=++matchOpenToken;
 if(!extrasReady){
  const opening=el('matchOverlay').classList.contains('hidden');
  if(opening){matchTrigger=document.activeElement;matchTriggerKind=matchTrigger?.dataset.fixture!==undefined?'schedule':matchTrigger?.dataset.scan!==undefined?'scanner':null;document.querySelector('.shell').inert=true;}
  activeMatch=f;el('matchOverlay').classList.remove('hidden');document.body.style.overflow='hidden';
  el('matchContent').innerHTML='<div class="match-header"><h2 class="match-heading" id="matchHeading">'+esc(f[5])+' <span>–</span> '+esc(f[6])+'</h2></div><div class="match-inner"><div class="empty">Зареждам историята за пълния анализ…</div></div>';
  if(opening)el('closeMatch').focus();
  return ensureExtras().then(()=>{if(request===matchOpenToken&&!el('matchOverlay').classList.contains('hidden'))openMatch(f);}).catch(()=>{
   if(request!==matchOpenToken)return;
   el('matchContent').innerHTML='<div class="match-header"><h2 id="matchHeading">'+esc(f[5])+' – '+esc(f[6])+'</h2></div><div class="match-inner"><p class="footnote">Историята временно не е достъпна. Презареди страницата или опитай отново.</p><button type="button" class="button secondary" id="retryMatch">Опитай отново</button></div>';
   el('retryMatch').onclick=()=>openMatch(f);
  });
 }
 const opening=el('matchOverlay').classList.contains('hidden');
 if(opening){matchTrigger=document.activeElement;matchTriggerKind=matchTrigger?.dataset.fixture!==undefined?'schedule':matchTrigger?.dataset.scan!==undefined?'scanner':null;document.querySelector('.shell').inert=true;}
 activeMatch=f;const p=profile(f),d=dossier(f,p);
 el('matchOverlay').classList.remove('hidden');document.body.style.overflow='hidden';
 const time=(f[4]||'—')+((f[13]||'').includes('Sofia')?'':'*');
 const date=f[3]+' · '+time+' · '+f[2];
 const m=[['Домакин',d.home],['Гост',d.away]].map(([role,data])=>{
  const v=data.overall;
  return '<section class="team-panel"><div class="role">'+role+'</div><h3>'+esc(data.name)+'</h3>'+eloReference(f,data.name)+
   '<div class="team-metrics"><div class="metric"><b>'+(v.n?fmt(v.gf,2):'—')+'</b><small>Вкарани</small></div>'+
   '<div class="metric"><b>'+(v.n?fmt(v.ga,2):'—')+'</b><small>Допуснати</small></div>'+
   '<div class="metric"><b>'+(v.n?fmt(v.total,2):'—')+'</b><small>Голове/мач</small></div></div>'+
   Analysis.formHTML(role==='Домакин'?d.home:d.away)+'</section>';
 }).join('');
 el('matchContent').innerHTML='<div class="match-header"><div class="match-date">'+esc(date)+'</div>'+
  '<h2 class="match-heading" id="matchHeading">'+esc(f[5])+' <span>–</span> '+esc(f[6])+'</h2>'+
  '<div class="match-sample">Извадка: '+d.home.overall.n+' / '+d.away.overall.n+' мача · налични първенства + УЕФА</div></div>'+
  '<div class="match-inner"><div class="duel">'+m+'</div>'+modelReport(f,p)+Analysis.introHTML(d)+streakReport(d)+
  '<details class="card detail-card"><summary>Форма и голове · последните '+windowSize+' мача</summary>'+
   '<h4>Всички срещи</h4><div class="trend-grid">'+signalTiles(d)+'</div>'+
   '<h4>Домакинства / гостувания</h4><div class="trend-grid">'+venueTiles(d)+'</div></details>'+
  extraReport(d)+
  '<details class="card detail-card history-section"><summary>Последни резултати · '+windowSize+'</summary><p class="footnote history-scope">'+esc(d.coverageNote)+'</p><div class="history-grid">'+
   '<div><h4>'+esc(f[5])+'</h4>'+Analysis.historyHTML(d.home.all,d.home.name,Scout.keyTeam)+'</div>'+
   '<div><h4>'+esc(f[6])+'</h4>'+Analysis.historyHTML(d.away.all,d.away.name,Scout.keyTeam)+'</div></div></details>'+
  '<details class="card detail-card"><summary>Директни срещи</summary>'+directMeetings(f)+'</details>'+
  '<details class="card detail-card" id="matchStandingsDetails"><summary>Класиране</summary><div id="matchStandingsContent"></div></details>'+
  '<div class="card"><h3>Запази прогноза</h3><div class="pick-form"><label>Пазар<select id="pickMarket">'+
   Object.entries(marketNames).map(([key,name])=>'<option value="'+key+'">'+esc(name)+'</option>').join('')+'</select></label>'+
   '<label>Коефициент (по избор)<input id="pickOdds" inputmode="decimal" type="text" placeholder="Напр. 1.80"></label>'+
   '<button id="savePick" type="button" class="button">Запази</button></div>'+
   '<button class="button secondary copy-button" id="copyMatch" type="button">Копирай анализа</button><span id="copyStatus" class="copy-status" role="status"></span></div>'+
  '<details class="card detail-card"><summary>Как се изчислява анализът</summary>'+
   '<p class="footnote">Elo е ориентир от архива на показаното първенство. Начална стойност 1500; рейтинги от различни първенства не са пряко сравними.</p>'+
   '<p class="footnote">Моделните вероятности за резултат и голове идват от една резултатна матрица (Поасон с Dixon–Coles корекция), с до 30 предишни срещи. Изборът 5/10/20 променя статистиките и сериите.</p>'+
   '<p class="footnote">Честотите и сериите описват историята. Липсващите данни остават празни. Досието включва наличните първенства и евротурнири за 90 минути, включително квалификациите. Националните купи не са в този архив. Моделът и Elo използват отделно историята на първенството. Актуалните серии са само от последните 30 дни; липсващ последен показател прекъсва серията.</p></details></div>';
 el('matchStandingsDetails').addEventListener('toggle',()=>{if(el('matchStandingsDetails').open)showStandings(el('matchStandingsContent'),f[0],f)});
 el('matchContent').querySelectorAll('.form-chip,.form-dot').forEach(button=>{
  const inspect=()=>{
   const box=button.closest('.form-overview');
   box.querySelector('.form-inspection').textContent=button.dataset.formMessage;
   box.querySelectorAll('.form-chip,.form-dot').forEach(point=>point.setAttribute('aria-pressed',String(point===button)));
  };
  button.onclick=inspect;button.onpointerenter=()=>{if(button.matches('.form-dot'))inspect();};
  if(button.matches('.form-dot'))button.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();inspect();}};
 });
 el('savePick').onclick=savePick;el('copyMatch').onclick=copyMatch;
 if(opening)el('closeMatch').focus();
}
function closeMatch(){
 matchOpenToken++;
 el('matchOverlay').classList.add('hidden');document.body.style.overflow='';document.querySelector('.shell').inert=false;
 if(active==='schedule'&&index)renderSchedule();
 let target=matchTrigger?.isConnected?matchTrigger:null;
 if(!target&&activeMatch&&matchTriggerKind){
  const rows=matchTriggerKind==='schedule'?fixtureRows:scannerRows.map(r=>r.fixture),i=rows.findIndex(f=>Scout.keyFixture(f)===Scout.keyFixture(activeMatch));
  if(i>=0)target=document.querySelector(matchTriggerKind==='schedule'?'[data-fixture="'+i+'"]':'[data-scan="'+i+'"]');
 }
 (target||document.querySelector('.nav.active'))?.focus();matchTrigger=null;matchTriggerKind=null;
}
function savePick(){
 if(!activeMatch)return;
 const oddsString=el('pickOdds').value.trim().replace(',','.'),odds=oddsString?Number(oddsString):null;
 if(oddsString&&(!Number.isFinite(odds)||odds<1.01||odds>1000)){alert('Въведи реален десетичен коефициент, например 1.80, или остави празно.');return}
 if(!Scout.getUpcoming([activeMatch]).length){alert('Мачът вече е започнал. Презареди програмата.');return}
 const picks=readPicks(),m=el('pickMarket').value;
 if(picks.some(x=>Scout.keyPick(x)===Scout.keyFixture(activeMatch)&&x.market===m)){
  alert('Вече имаш запазена прогноза за този мач и пазар.');return
 }
 const evaluation=profile(activeMatch).international?null:Model.evaluate(history,activeMatch,'standard');
 const modelProbability=Scout.probability(evaluation?.distribution?.probs,m);
 picks.push({id:String(Date.now())+'-'+picks.length,fixtureKey:Scout.keyFixture(activeMatch),
  div:activeMatch[0],date:activeMatch[3],time:activeMatch[4],home:activeMatch[5],away:activeMatch[6],
  market:m,odds,modelProbability,analysisWindow:windowSize,model:'standard',createdAt:new Date().toISOString()});
 if(writePicks(picks)){el('copyStatus').textContent='Записано ✓';setView('picks');closeMatch()}
 else alert('Браузърът не разреши локално запазване. Може да ползваш копирането на анализа.');
}
async function copyMatch(){
 if(!activeMatch)return;
 const f=activeMatch,p=profile(f),d=dossier(f,p),button=el('copyMatch'),feedback=el('copyStatus');
 const mapped=archive.direct(f),h=Scout.keyTeam(mapped.home),a=Scout.keyTeam(mapped.away);
 const direct=(mapped.index.byDivision.get(f[0]+'|'+h)||[]).filter(r=>r[3]<f[3]&&
  ((Scout.keyTeam(r[5])===h&&Scout.keyTeam(r[6])===a)||(Scout.keyTeam(r[5])===a&&Scout.keyTeam(r[6])===h))).slice(0,6);
 button.disabled=true;feedback.textContent='Подготвям пълното досие…';
 // Clipboard permission starts during the click; the Blob may await the table.
 const textPromise=loadStandings().catch(()=>null).then(standings=>Analysis.brief(d,{status,standings,keyTeam:Scout.keyTeam,direct}));
 try{
  if(navigator.clipboard?.write&&window.ClipboardItem){
   await navigator.clipboard.write([new ClipboardItem({'text/plain':textPromise.then(text=>new Blob([text],{type:'text/plain'}))})]);
  }else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(await textPromise);
  else throw Error('Clipboard unavailable');
  if(feedback.isConnected)feedback.textContent='Пълното досие е копирано ✓';
 }catch{if(feedback.isConnected)feedback.textContent='Копирането не е разрешено от браузъра.';}
 finally{if(button.isConnected)button.disabled=false;}
}
function renderScanner(){
 if(!index)return;
 const market=el('scanMarket').value,days=+el('scanWindow').value,
  league=el('scanLeague').value,streak=+el('scanStreak').value,
  both=el('scanBoth').value==='yes',venue=el('scanVenue').value==='venue';
 const found=(market==='all'?Patterns.runAll:Patterns.run)(index,fixtures,Scout,{market,days,minimum:5,league,streak,both,venue,windowSize});
 scannerRows=found.slice(0,70);
 el('scannerSummary').textContent=(found.length>70?scannerRows.length+' от '+found.length:scannerRows.length)+' мача със серия '+streak+'+'+(venue?' · домакинства / гостувания':'');
 if(!scannerRows.length){el('scannerList').innerHTML='<div class="empty">Няма серии при тези филтри. Опитай друг пазар, по-дълъг период или повече мачове.</div>';return}
 el('scannerList').innerHTML=scannerRows.map((entry,i)=>{
  const {fixture:f,signal:q}=entry,h=q.home,a=q.away;
  const signals=entry.signals||[q];
  const reference=q.evidence.reference,homeBase=percent(reference.homeRate),awayBase=percent(reference.awayRate);
  const baseline=reference.available?'Лига: '+(homeBase===awayBase?homeBase:homeBase+' / '+awayBase)+' · '+reference.n.toLocaleString('bg-BG')+' мача':'Малка база за лигата';
  const notes=q.evidence.notes.filter(note=>reference.available||note!=='Малка база за лигата');
  return '<article class="scan-card" data-evidence-rank="'+q.rank+'"><div class="scan-head"><span class="scan-league">'+esc(f[2])+'</span><span class="scan-date">'+esc(f[3])+' · '+esc(f[4]||'—')+'</span></div>'+
   '<h3>'+esc(f[5])+' – '+esc(f[6])+'</h3><div class="signal">'+esc(q.label)+'</div>'+
   '<div class="mini-bars">'+miniBar(scannerLabel(q.market||q.id,f,true),h.hits,h.n)+miniBar(scannerLabel(q.market||q.id,f,false),a.hits,a.n,true)+'</div>'+
   '<div class="scan-context"><span title="Наблюдавана честота за предходните 3 години, съобразена с домакинствата и гостуванията в извадката. Това е лигова база за сравнение.">'+esc(baseline)+'</span>'+
   (notes.length?'<span class="scan-quality" title="'+esc(notes.join(' · '))+'">'+esc(notes[0])+'</span>':'')+'</div>'+
   '<table class="streak-table"><thead><tr><th>Поредни мачове с това събитие</th><th title="'+esc(f[5])+'">Дом.</th><th title="'+esc(f[6])+'">Гост</th></tr></thead><tbody>'+
   signals.map(v=>'<tr><td>'+esc(v.label)+'</td>'+[v.home,v.away].map(t=>'<td title="Наблюдавано '+t.hits+' / '+t.n+' мача'+(t.missing?' · '+t.missing+' без данни':'')+'">'+t.currentStreak+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+
   '<div class="scan-actions"><span class="footnote">'+(venue?'Домакинства / гостувания':'Последни '+windowSize+' мача')+'</span><button data-scan="'+i+'" class="button secondary" type="button">Анализ →</button></div></article>';
 }).join('');
 el('scannerList').querySelectorAll('[data-scan]').forEach(x=>x.onclick=()=>openMatch(scannerRows[+x.dataset.scan].fixture));
}
function scannerLabel(m,f,home){
 const action=m==='home2'?(home?'вкарва 2+':'допуска 2+'):m==='away2'?(home?'допуска 2+':'вкарва 2+'):
  m==='1'?(home?'побеждава':'губи'):m==='2'?(home?'губи':'побеждава'):
  m==='1X'?(home?'не губи':'не печели'):m==='X2'?(home?'не печели':'не губи'):'';
 return f[home?5:6]+(action?' · '+action:'');
}
function streakReport(d){return Analysis.trendsHTML(d);}
const marketNames=Object.fromEntries(Patterns.MARKETS.map(v=>[v.id,v.label]));
Object.assign(marketNames,{'1':'Победа домакин','2':'Победа гост','1X':'Двоен шанс 1X','X2':'Двоен шанс X2',home2:'Домакин 2+',away2:'Гост 2+'});
function renderPicks(){
 const list=readPicks(),resolved=list.map(p=>{
  const done=archive?.result(p),settled=done?Scout.marketSettled(p,done):null;
  return {...p,settled,score:done?done[7]+':'+done[8]:null}
 });
 const done=resolved.filter(x=>x.settled!==null);
 el('picksSummary').textContent=list.length+' записани · '+done.filter(x=>x.settled).length+' успешни / '+done.length+' приключили'+(done.length?' · '+percent(done.filter(x=>x.settled).length/done.length):'');
 if(!list.length){el('picksList').innerHTML='<div class="empty">Нямаш запазени прогнози. Отвори мач от програмата и натисни „Запази“.</div>';return}
 el('picksList').innerHTML=resolved.slice().reverse().map(p=>'<div class="pick-card"><div><strong>'+esc(p.home)+' – '+esc(p.away)+'</strong>'+
  '<small>'+esc(p.date)+' · '+esc(marketNames[p.market]||p.market)+(p.odds?' · коеф. '+p.odds.toFixed(2):'')+
  (Number.isFinite(p.modelProbability)?' · модел '+percent(p.modelProbability):'')+
  ' · '+(p.settled===null?'Очаква резултат':p.settled?'Успешна ✓':'Неуспешна ✕')+
  (p.score?' ('+esc(p.score)+')':'')+'</small></div>'+
  '<button type="button" data-del="'+esc(p.id)+'" class="button secondary">Премахни</button></div>').join('');
 el('picksList').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
   if(confirm('Да премахна тази лична бележка?')){writePicks(readPicks().filter(p=>String(p.id)!==b.dataset.del));renderPicks()}
 });
}
function exportPicks(){
 const picks=readPicks();if(!picks.length){alert('Няма прогнози за експорт.');return}
 const cols=['date','home','away','market','odds','modelProbability','analysisWindow','createdAt','score','result'];
 const csv=[cols.join(',')].concat(picks.map(p=>cols.map(k=>{
  const done=archive?.result(p),settled=done?Scout.marketSettled(p,done):null;
  const v=k==='result'?(settled===null?'pending':settled?'win':'loss'):k==='score'?(done?done[7]+':'+done[8]:''):(p[k]??'');
  return '"'+String(v).replace(/"/g,'""')+'"';
 }).join(','))).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));a.download='matchpulse_my_picks.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function loadDiary(){
 if(diaryLoaded||diaryLoading)return;
 diaryLoading=true;
 try{
  await initialPromise;const doc=await dataSnapshot.get('diary_report.json');
  if(doc?.schema_version!==1||!Array.isArray(doc.recent))throw Error('Дневникът още няма публикуван отчет.');
  const t=doc.totals,stamp=value=>value?new Date(value).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'—';
  el('diarySummary').textContent='Начало: '+stamp(doc.started_at_utc)+(t.excluded||t.unmatched?' · '+(t.excluded+t.unmatched)+' изключени / за проверка':'');
  el('diaryUpdated').textContent='Обновен: '+stamp(doc.checked_at_utc);
  el('diaryTotals').innerHTML=[['Записани',t.recorded],['Приключили',t.settled],['Чакат',t.pending]].map(([label,n])=>'<div><b>'+esc(n)+'</b><span>'+label+'</span></div>').join('');
  const s=doc.scanner;
  el('diaryScanner').textContent='Водещи сигнали на скенера: '+s.tracked+' записани · '+s.settled+' оценени'+
   (s.settled?' · '+s.hits+'/'+s.settled+' успешни ('+percent(s.hit_rate)+')':'')+
   (s.pending_stats?' · '+s.pending_stats+' чакат статистика':'');
  const selected=['1x2','double1X','doubleX2','double12','over15','over25','over35','btts','homeOver15','awayOver15'];
  const paired=doc.paired_model_test;
  el('diaryQuality').innerHTML=paired?.schema_version===1&&paired.current?.markets&&paired.candidate?.markets?
   '<p class="footnote">Паралелна проверка: '+esc(paired.totals.recorded)+' двойни записа · '+esc(paired.totals.settled)+' с резултат. Начало: '+esc(stamp(paired.started_at_utc))+'. Двата модела използват едни и същи данни и час на запис.</p>'+
   '<p class="footnote">Грешка Brier: по-ниска стойност е по-добра. Общият 1X2 е по отделна скала.</p>'+
   '<table><thead><tr><th>Пазар</th><th>Мачове</th><th>Сегашен</th><th>Кандидат</th></tr></thead><tbody>'+
   selected.map(id=>{const a=paired.current.markets[id],b=paired.candidate.markets[id];return '<tr><td>'+esc(doc.market_labels[id])+'</td><td>'+esc(a.n)+'</td><td>'+fmt(a.brier,4)+'</td><td>'+fmt(b.brier,4)+'</td></tr>'}).join('')+'</tbody></table>'+
   '<p class="footnote">'+(paired.capture_paused?'Записването на нови двойки е спряно за проверка.':paired.decision.status==='ready_for_review'?'Има достатъчно данни за преглед на новия модел.':paired.decision.status==='insufficient_evidence'?'Няма достатъчно доказателства за смяна на модела.':'Събират се нови резултати.')+' Живият анализ използва сегашния модел.</p>':
   t.settled?'<p class="footnote">Грешка Brier: по-ниска стойност е по-добра. Общият 1X2 е по отделна скала.</p>'+
   '<table><thead><tr><th>Пазар</th><th>Мачове</th><th>Модел</th><th>Лигова база</th></tr></thead><tbody>'+
   selected.map(id=>{const m=doc.markets[id];return '<tr><td>'+esc(doc.market_labels[id])+'</td><td>'+m.n+'</td><td>'+fmt(m.brier,4)+'</td><td>'+fmt(m.baselines.league_frequencies.brier,4)+'</td></tr>'}).join('')+'</tbody></table>'+
   (Object.keys(doc.versions).length>1?'<p class="footnote">Общо за '+Object.keys(doc.versions).length+' версии на модела; отделните резултати се пазят в отчета.</p>':''):
   '<p class="footnote">Оценката ще се появи след първите приключили мачове. Историческите тестове не са включени тук.</p>';
  const statuses={pending:'Чака резултат',settled:'Приключил',excluded:'Изключен',unmatched:'За проверка'};
  el('diaryList').innerHTML=doc.recent.length?doc.recent.map(entry=>{
   const p=entry.probabilities,f=entry.fixture,closed=['excluded','unmatched'].includes(entry.status);
   const result=entry.score?entry.score.join(':'):statuses[entry.status];
   const scanner=entry.scanner,scanState=closed?statuses[entry.status]:scanner?.result===true?'Успешен ✓':scanner?.result===false?'Неуспешен':scanner?.pending_stats?'Чака статистика':'Чака резултат';
   return '<article class="diary-entry" data-forecast-id="'+esc(entry.id)+'"><div class="diary-entry-head"><strong>'+esc(f.home)+' – '+esc(f.away)+'</strong>'+
    '<span class="tag '+(closed?'amber':'')+'">'+esc(result)+'</span></div>'+
    '<div class="footnote">'+esc(f.league)+' · Начало '+esc(stamp(entry.kickoff_utc))+'</div>'+
    '<div class="diary-probabilities">1 '+percent(p.homeWin)+' · X '+percent(p.draw)+' · 2 '+percent(p.awayWin)+'<span>Над 2,5 '+percent(p.over25)+' · Гол/гол '+percent(p.btts)+'</span></div>'+
    (scanner?'<div class="footnote">Скенер: '+esc(scanner.label)+' · '+esc(scanState)+'</div>':'')+
    '<div class="footnote">Запис: '+esc(stamp(entry.captured_at_utc))+'</div></article>';
  }).join(''):'<div class="empty">Дневникът очаква предстоящи мачове с потвърден час и достатъчна история.</div>';
  diaryLoaded=true;
 }catch(e){el('diarySummary').textContent=e.message;el('diaryList').innerHTML='<div class="empty">Отчетът ще се появи след автоматичното обновяване.</div>';}
 finally{diaryLoading=false;}
}
async function loadSelectionDiary(){
 const target=el('selectionDiaryContent');
 try{
  await initialPromise;const doc=await dataSnapshot.get('selection_diary_report.json');
  if(doc?.schema!==1||!doc.groups||!doc.totals)throw Error('diary format');
  const labels={main:'Основни',alternatives:'Алтернативи',builders:'Бет билдъри',columns:'Колонки'};
  target.innerHTML='<p>'+doc.totals.recorded+' предмачови записа · '+doc.totals.abstained+' без основен избор. Първият автоматичен избор остава замразен; личните цени и филтри не участват.</p>'+
   '<div class="coverage-scroll"><table><thead><tr><th>Вид</th><th>Записани</th><th>Приключили</th><th>Успешни</th><th>Чакащи</th></tr></thead><tbody>'+
   Object.entries(labels).map(([key,label])=>'<tr><td>'+label+'</td>'+['recorded','settled','hits','pending'].map(k=>'<td>'+doc.groups[key][k]+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
   '<p>Само бъдещи записи от регистрацията на '+new Date(doc.registered_at_utc).toLocaleDateString('bg-BG',{timeZone:'Europe/Sofia'})+'. Старите дневници са отделни. Честотата на успех още не доказва доходност.</p>'+
   (doc.last_run.capture_paused?'<p>Новите записи са спрени: кодът се различава от регистрираната версия. Съществуващите записи продължават да получават резултати.</p>':'');
 }catch{target.textContent='Отчетът на „Селекции“ временно не е достъпен. Основният дневник остава отделен.';}
}
async function loadCoverage(){
 if(coverageLoaded)return;
 const target=el('coverageContent');
 if(!target)return;
 try{
   await initialPromise;const doc=await dataSnapshot.get('coverage_audit.json');
   if(!doc||!doc.leagues)throw Error('Липсва отчет за покритието');
   const leagues=structuredClone(doc.leagues);
   let europeDivisions=dataSnapshot.manifest?.files['europe_history.json'].divisions;
   if(!europeDivisions){europeDivisions={};for(const r of await dataSnapshot.get('europe_history.json'))europeDivisions[r[0]]=(europeDivisions[r[0]]||0)+1;}
   const europeCount=Object.values(europeDivisions).reduce((a,b)=>a+b,0);
   for(const [code,n] of Object.entries(europeDivisions)){if(!leagues[code])leagues[code]={matches:0,future_fixtures:0};leagues[code].matches=(leagues[code].matches||0)+n;}
   const rows=Object.entries(leagues).sort((a,b)=>(b[1].future_fixtures||0)-(a[1].future_fixtures||0)||b[1].matches-a[1].matches);
   const coverage=(v,k)=>v.coverage?.[k]?.percentage===undefined?'—':v.coverage[k].percentage+'%';
   target.innerHTML='<p><b>'+(doc.historical_matches+europeCount).toLocaleString('bg-BG')+' мача</b> · '+doc.historical_leagues+
    ' първенства'+(europeCount?' + 3 евротурнира':'')+' · одит '+esc(doc.checked_utc?.slice(0,10)||'—')+'</p>'+
    '<p>Покритието на статистиките е показано по първенство.</p>'+
    '<div class="coverage-scroll"><table><thead><tr><th>Лига</th><th>Мачове</th><th>Бъдещи</th><th>Удари</th><th>Корнери</th><th>Жълти</th><th>xG</th></tr></thead><tbody>'+
    rows.map(([code,v])=>'<tr><td>'+esc(code)+'</td><td>'+v.matches+'</td><td>'+v.future_fixtures+
      '</td><td>'+coverage(v,'shots')+'</td><td>'+coverage(v,'corners')+'</td><td>'+coverage(v,'yellow_cards')+
      '</td><td>'+coverage(v,'xg')+'</td></tr>').join('')+'</tbody></table></div>'+
    '<p>Сезони с липсващи или твърде малко мачове: <b>'+ (doc.thin_or_missing_finished_seasons?.length||0) +
    '</b> · структурни проблеми: <b>'+doc.issues_total+'</b>.</p>';coverageLoaded=true;
 }catch(e){target.textContent='Няма актуален отчет за покритието. '+e.message;}
}
function setupLeagues(europe=[]){
 const current=el('standingsLeague').value,lg=new Map();fixtures.forEach(r=>lg.set(r[0],window.MatchpulseHealth.leagueLabel(r)));
 const options='<option value="">Всички първенства</option>'+[...lg].sort((a,b)=>a[1].localeCompare(b[1])).map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('');
 if(!el('leagueSelect').dataset.loaded){el('leagueSelect').innerHTML=options;el('scanLeague').innerHTML=options;el('leagueSelect').dataset.loaded='true';}
 const tables=new Map();[...history,...europe,...fixtures].forEach(r=>tables.set(r[0],window.MatchpulseHealth.leagueLabel(r)));
 el('standingsLeague').innerHTML=[...tables].sort((a,b)=>a[1].localeCompare(b[1],'bg')).map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('');
 if(tables.has(current))el('standingsLeague').value=current;else if(tables.has('E0'))el('standingsLeague').value='E0';
}
function refreshSync(){
 if(!fixturesReady)return;
 const s=status,calendarStamp=s.fixtures_updated_utc,showStamp=value=>value?new Date(value).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'неизвестно';
 const sources=window.MatchpulseHealth.sources(s),partial=dataFailures.size>0||sources.some(r=>r.warning);
 const labels={'history.json':'история за анализ','europe_history.json':'архив УЕФА','match_links.json':'връзки между срещите','europe_fixture_names.json':'имена в УЕФА'};
 const failures=[...dataFailures.keys()].map(name=>labels[name]||'допълнителни данни');
 el('lastSync').textContent='Програма: '+showStamp(calendarStamp);
 el('syncBadge').classList.toggle('sync-warning',partial);
 el('syncBadge').title=partial?'Има непълни данни. Виж „Данни и обновяване“.':'Последните проверки на източниците са успешни.';
 const files=dataSnapshot?.manifest?.files,embedded=window.SCOUT_EMBEDDED_DATA;
 const count=(files?.['history.json'].rows??(index?history.length:s.history_count||0))+(files?.['europe_history.json'].rows??embedded?.europe?.length??(archive?archive.international.history.length-history.length:0));
 el('sourceStatus').textContent=count?count.toLocaleString('bg-BG')+' мача в архива':'Архивът се зарежда…';
 el('notice').classList.toggle('hidden',!partial);
 el('notice').textContent=partial?'Непълни данни: '+[...sources.filter(r=>r.warning).map(r=>r.label),...failures].join(', ')+'. Виж „Данни и обновяване“.':'';
 el('syncContent').innerHTML='<div class="sync-grid">'+sources.map(r=>'<div><strong>'+esc(r.label)+'</strong><span>'+esc(showStamp(r.stamp))+'</span><span class="sync-state '+(r.warning?'sync-state-warning':'')+'">'+esc(r.text)+'</span></div>').join('')+'</div>'+
  '<p>Публикуване: '+esc(showStamp(s.last_build_utc))+'. То е отделно от проверките на източниците.</p>'+
  (failures.length?'<p>Не се заредиха: '+failures.map(esc).join(', ')+'. Зависещите от тях серии, селекции или отчитане на резултати са ограничени.</p>':'')+
  sources.filter(r=>r.errors.length).map(r=>'<p>'+esc(r.label)+': '+r.errors.map(esc).join(' · ')+'</p>').join('');
}
function ensureCore(){
 if(index)return Promise.resolve();
 if(!corePromise)corePromise=(async()=>{
  if(!fixturesReady)await initialPromise;
  const h=await dataSnapshot.get('history.json');if(!Array.isArray(h))throw Error('Невалиден формат на историята');
  history=h;index=Scout.build(h);PROFILE_CACHE.clear();dataFailures.delete('history.json');
  el('qualitySelect').disabled=false;setupLeagues();refreshSync();
  document.documentElement.dataset.scoutCore='ready';window.performance?.mark('scout-core-ready');
  if(active==='schedule'&&el('matchOverlay').classList.contains('hidden'))renderSchedule();
 })().catch(error=>{
  corePromise=null;dataFailures.set('history.json',error.message);refreshSync();
  if(active==='schedule'&&el('matchOverlay').classList.contains('hidden'))renderSchedule();throw error;
 });
 return corePromise;
}
function ensureExtras(){
 if(extrasReady)return Promise.resolve();
 if(!extrasPromise)extrasPromise=(async()=>{
  if(!fixturesReady)await initialPromise;
  const resources=[['europe','europe_history.json',v=>Array.isArray(v)],['links','match_links.json',v=>v&&typeof v.matches==='object'&&!Array.isArray(v.matches)],['europeNames','europe_fixture_names.json',v=>v&&typeof v==='object'&&!Array.isArray(v)]];
  const extra={};
  await Promise.all([ensureCore(),Promise.all(resources.map(async([key,name,valid])=>{
   try{const value=await dataSnapshot.get(name);if(!valid(value))throw Error('Невалиден '+name);extra[key]=value;availability[key]=true;dataFailures.delete(name);}
   catch(error){availability[key]=false;dataFailures.set(name,error.message);}
  }))]);
  if(!availability.europe||!availability.europeNames){extra.europe=[];extra.europeNames={};}
  archive=window.MatchpulseArchive.build(Scout,history,extra.europe||[],extra.links||{},extra.europeNames||{});
  if(!availability.links)archive.result=()=>null;
  index=archive.main;PROFILE_CACHE.clear();setupLeagues(extra.europe||[]);
  window.MatchpulseSelectionUI.mount({history,fixtures,status,archive,openMatch,availability});
  extrasReady=true;refreshSync();document.documentElement.dataset.scoutArchive='ready';window.performance?.mark('scout-archive-ready');
  if(active==='schedule'&&el('matchOverlay').classList.contains('hidden'))renderSchedule();
 })().catch(error=>{extrasPromise=null;throw error;});
 return extrasPromise;
}
async function load(){
 try{
  for(let attempt=0;attempt<2;attempt++){
   dataSnapshot=await window.MatchpulseData.create({freshManifest:attempt>0});
   try{
    const [f,s]=await Promise.all([dataSnapshot.get('fixtures.json'),dataSnapshot.get('status.json')]);
    if(!Array.isArray(f)||!s||typeof s!=='object')throw Error('Невалиден формат на програмата');
    fixtures=f;status=s;break;
   }catch(error){if(attempt===1||error.code!=='SNAPSHOT_CHANGED')throw error;}
  }
  fixturesReady=true;syncResearchControls();setupLeagues();refreshSync();setView(active);
  document.documentElement.dataset.scoutCalendar='ready';window.performance?.mark('scout-calendar-ready');
  if(fixtures.length)requestAnimationFrame(()=>requestAnimationFrame(()=>{ensureCore().catch(()=>{});}));
 }catch(e){
  el('lastSync').textContent='Няма данни';
  el('notice').classList.remove('hidden');el('notice').textContent='Не успях да заредя програмата. Презареди страницата.';
  console.error('Scout data load failed',e);
  el('scheduleList').innerHTML='<div class="empty">'+esc(e.message)+'</div>';
 }
}
window.MatchpulseLoading={ensureCore,ensureExtras};
for(const id of ['researchWindow','drawerWindow'])el(id).onchange=e=>setResearch(e.target.value);
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{
 mode=b.dataset.day==='7'?'week':b.dataset.day==='1'?'tomorrow':'today';
 document.querySelectorAll('[data-day]').forEach(x=>x.classList.toggle('active',x===b));
 renderSchedule();
});
el('dateInput').onchange=e=>{if(e.target.value){mode='custom';customDate=e.target.value;document.querySelectorAll('[data-day]').forEach(x=>x.classList.remove('active'));renderSchedule()}};
el('scheduleStandings').addEventListener('toggle',programStandings);
el('dataDetails').addEventListener('toggle',()=>{if(el('dataDetails').open)loadCoverage();});
el('selectionDiary').addEventListener('toggle',()=>{if(el('selectionDiary').open)loadSelectionDiary();});
el('standingsLeague').addEventListener('change',programStandings);
el('leagueSelect').addEventListener('change',()=>{if(el('leagueSelect').value){el('standingsLeague').value=el('leagueSelect').value;programStandings()}});
for(const id of ['leagueSelect','qualitySelect','searchInput'])el(id).addEventListener(id==='searchInput'?'input':'change',renderSchedule);
for(const id of ['scanMarket','scanWindow','scanLeague','scanStreak','scanBoth','scanVenue'])el(id).addEventListener('change',renderScanner);
el('exportPicks').onclick=exportPicks;el('closeMatch').onclick=closeMatch;
el('matchOverlay').onclick=e=>{if(e.target===el('matchOverlay'))closeMatch()};
document.addEventListener('keydown',e=>{
 if(el('matchOverlay').classList.contains('hidden'))return;
 if(e.key==='Escape'){e.preventDefault();closeMatch();return;}
 if(e.key==='Tab'){
  const controls=[...el('matchOverlay').querySelectorAll('button,select,input,[tabindex="0"],summary,a[href]')].filter(v=>!v.disabled&&v.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(e.shiftKey&&(document.activeElement===first||!el('matchOverlay').contains(document.activeElement))){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&(document.activeElement===last||!el('matchOverlay').contains(document.activeElement))){e.preventDefault();first?.focus();}
 }
});
try{window.MatchpulseBackup.mount({storage:localStorage,onChanged:()=>{renderPicks();window.MatchpulseSelectionUI.reloadManualPrices();},onRecovered:()=>window.MatchpulseSelectionUI.reloadManualPrices()});}
catch{el('backupStatus').textContent='Локалното запазване не е достъпно в този браузър.';}
el('qualitySelect').disabled=true;
initialPromise=load();
