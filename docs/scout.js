/* MATCHPULSE SCOUT v1 · minimal personal football research cockpit */
'use strict';
const Scout=window.MatchpulseScout,Model=window.MatchpulseModel,Markets=window.MatchpulseMarkets,Elo=window.MatchpulseElo,Patterns=window.MatchpulsePatterns,Analysis=window.MatchpulseAnalysis;
const el=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const fmt=(v,n=1)=>Number.isFinite(v)?v.toFixed(n):'—';
const percent=v=>Number.isFinite(v)?fmt(v*100,0)+'%':'—';
const localISO=(d=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function offsetISO(n){const a=new Date(localISO()+'T12:00:00Z');a.setUTCDate(a.getUTCDate()+n);return a.toISOString().slice(0,10)}
let history=[],fixtures=[],status={},index=null,eloIndex=null,windowSize=10,active='schedule',fixtureRows=[],scannerRows=[],mode='today',customDate='',activeMatch=null;
let diaryLoaded=false,diaryLoading=false,archive=null,standingsPromise=null;
async function loadStandings(){
 if(!standingsPromise)standingsPromise=window.SCOUT_EMBEDDED_DATA?Promise.resolve(window.SCOUT_EMBEDDED_DATA.standings):
  fetch('data/standings.json?scout=1',{cache:'no-store',signal:AbortSignal.timeout(7000)}).then(r=>{if(!r.ok)throw Error('standings HTTP '+r.status);return r.json()});
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
function profile(f){const k=Scout.keyFixture(f)+'|'+windowSize;if(!PROFILE_CACHE.has(k))PROFILE_CACHE.set(k,archive.profile(f,{windowSize}));return PROFILE_CACHE.get(k)}
function setView(next){
 active=next;
 for(const view of ['schedule','scanner','picks','diary'])el('view-'+view).classList.toggle('hidden',view!==next);
 document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===next));
 el('pageTitle').textContent={schedule:'Програма',scanner:'Trend Scanner',picks:'Моите прогнози',diary:'Автоматичен дневник'}[next];
 if(next==='schedule')renderSchedule();else if(next==='scanner')renderScanner();else if(next==='diary')loadDiary();else renderPicks();
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
 const r=Elo.reference(eloIndex,f[0],name,f[3]);
 const league=history.find(x=>x[0]===r.division)?.[2]||r.division||'';
 return '<div class="team-elo"><span>Elo</span><b>'+(r.games?Math.round(r.rating):'—')+'</b></div>'+
  '<div class="rating-context">'+(r.games?r.games+' мача · '+esc(league):'Няма архив за Elo')+'</div>';
}
function fixtureQualified(f){
 const p=profile(f);
 return p.home.overall.n>=5&&p.away.overall.n>=5&&!p.international&&!p.home.proxy&&!p.away.proxy;
}
function fixtureHint(f){
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
 if(!DOSSIERS.has(p))DOSSIERS.set(p,Analysis.describe(p,{keyTeam:Scout.keyTeam,patterns:Patterns,model:modelFor(f,p),ratings:{
  home:Elo.reference(eloIndex,f[0],p.home.name,f[3]),away:Elo.reference(eloIndex,f[0],p.away.name,f[3])}}));
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
function extraReport(p){return Analysis.statsHTML(dossier(p.fixture,p));}
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
 activeMatch=f;const p=profile(f),d=dossier(f,p);
 el('matchOverlay').classList.remove('hidden');document.body.style.overflow='hidden';
 const time=(f[4]||'—')+((f[13]||'').includes('Sofia')?'':'*');
 const date=f[3]+' · '+time+' · '+f[2];
 const m=[['Домакин',p.home],['Гост',p.away]].map(([role,data])=>{
  const v=data.overall;
  return '<section class="team-panel"><div class="role">'+role+'</div><h3>'+esc(data.name)+'</h3>'+eloReference(f,data.name)+
   '<div class="team-metrics"><div class="metric"><b>'+(v.n?fmt(v.gf,2):'—')+'</b><small>Вкарани</small></div>'+
   '<div class="metric"><b>'+(v.n?fmt(v.ga,2):'—')+'</b><small>Допуснати</small></div>'+
   '<div class="metric"><b>'+(v.n?fmt(v.total,2):'—')+'</b><small>Голове/мач</small></div></div>'+
   Analysis.formHTML(role==='Домакин'?d.home:d.away)+'</section>';
 }).join('');
 el('matchContent').innerHTML='<div class="match-header"><div class="match-date">'+esc(date)+'</div>'+
  '<h2 class="match-heading" id="matchHeading">'+esc(f[5])+' <span>–</span> '+esc(f[6])+'</h2>'+
  '<div class="match-sample">Извадка: '+p.home.overall.n+' / '+p.away.overall.n+' мача</div></div>'+
  '<div class="match-inner"><div class="duel">'+m+'</div>'+modelReport(f,p)+Analysis.introHTML(d)+streakReport(p)+
  '<details class="card detail-card"><summary>Форма и голове · последните '+windowSize+' мача</summary>'+
   '<h4>Всички срещи</h4><div class="trend-grid">'+signalTiles(p)+'</div>'+
   '<h4>Домакинства / гостувания</h4><div class="trend-grid">'+venueTiles(p)+'</div></details>'+
  extraReport(p)+
  '<details class="card detail-card history-section"><summary>Последни резултати · '+windowSize+'</summary><div class="history-grid">'+
   '<div><h4>'+esc(f[5])+'</h4>'+Analysis.historyHTML(p.home.all,p.home.name,Scout.keyTeam)+'</div>'+
   '<div><h4>'+esc(f[6])+'</h4>'+Analysis.historyHTML(p.away.all,p.away.name,Scout.keyTeam)+'</div></div></details>'+
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
   '<p class="footnote">Честотите и сериите описват историята. Липсващите данни остават празни. Евротурнирите използват резултатите след 90 минути от същия турнир, включително квалификациите. При липса се показва вътрешното първенство.</p></details></div>';
 el('matchStandingsDetails').addEventListener('toggle',()=>{if(el('matchStandingsDetails').open)showStandings(el('matchStandingsContent'),f[0],f)});
 el('matchContent').querySelectorAll('.form-chip').forEach(button=>button.onclick=()=>{
  const box=button.closest('.form-overview');
  box.querySelector('.form-inspection').textContent=button.title;
  box.querySelectorAll('.form-chip').forEach(chip=>chip.setAttribute('aria-pressed',String(chip===button)));
 });
 el('savePick').onclick=savePick;el('copyMatch').onclick=copyMatch;
}
function closeMatch(){el('matchOverlay').classList.add('hidden');document.body.style.overflow=''}
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
   '<div class="mini-bars">'+miniBar('Домакин',h.hits,h.n)+miniBar('Гост',a.hits,a.n,true)+'</div>'+
   '<div class="scan-context"><span title="Наблюдавана честота за предходните 3 години, съобразена с домакинствата и гостуванията в извадката. Това е лигова база за сравнение.">'+esc(baseline)+'</span>'+
   (notes.length?'<span class="scan-quality" title="'+esc(notes.join(' · '))+'">'+esc(notes[0])+'</span>':'')+'</div>'+
   '<table class="streak-table"><thead><tr><th>Поредни серии</th><th>Дом.</th><th>Гост</th></tr></thead><tbody>'+
   signals.map(v=>'<tr><td>'+esc(v.label)+'</td>'+[v.home,v.away].map(t=>'<td title="Наблюдавано '+t.hits+' / '+t.n+' мача'+(t.missing?' · '+t.missing+' без данни':'')+'">'+t.currentStreak+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+
   '<div class="scan-actions"><span class="footnote">'+(venue?'Домакинства / гостувания':'Последни '+windowSize+' мача')+'</span><button data-scan="'+i+'" class="button secondary" type="button">Анализ →</button></div></article>';
 }).join('');
 el('scannerList').querySelectorAll('[data-scan]').forEach(x=>x.onclick=()=>openMatch(scannerRows[+x.dataset.scan].fixture));
}
function streakReport(p){return Analysis.trendsHTML(dossier(p.fixture,p));}
const marketNames=Object.fromEntries(Patterns.MARKETS.map(v=>[v.id,v.label]));
Object.assign(marketNames,{'1':'Победа домакин','2':'Победа гост','1X':'Двоен шанс 1X','X2':'Двоен шанс X2',home2:'Домакин 2+',away2:'Гост 2+'});
function renderPicks(){
 const list=readPicks(),resolved=list.map(p=>{
  const done=archive.result(p),settled=done?Scout.marketSettled(p,done):null;
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
   if(confirm('Да премахна тази лична бележка?')){writePicks(readPicks().filter(p=>p.id!==b.dataset.del));renderPicks()}
 });
}
function exportPicks(){
 const picks=readPicks();if(!picks.length){alert('Няма прогнози за експорт.');return}
 const cols=['date','home','away','market','odds','modelProbability','analysisWindow','createdAt','score','result'];
 const csv=[cols.join(',')].concat(picks.map(p=>cols.map(k=>{
  const done=archive.result(p),settled=done?Scout.marketSettled(p,done):null;
  const v=k==='result'?(settled===null?'pending':settled?'win':'loss'):k==='score'?(done?done[7]+':'+done[8]:''):(p[k]??'');
  return '"'+String(v).replace(/"/g,'""')+'"';
 }).join(','))).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));a.download='matchpulse_my_picks.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function loadDiary(){
 if(diaryLoaded||diaryLoading)return;
 diaryLoading=true;
 try{
  const doc=window.SCOUT_EMBEDDED_DATA?window.SCOUT_EMBEDDED_DATA.diary:
   await fetch('data/diary_report.json?scout=1',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Дневникът още няма публикуван отчет.');return r.json()});
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
async function loadCoverage(){
 const target=el('coverageContent');
 if(!target)return;
 try{
   const doc=window.SCOUT_EMBEDDED_DATA?.coverage||
      await fetch('data/coverage_audit.json?scout=3',{cache:'no-store'}).then(r=>{
        if(!r.ok)throw Error('Няма публикуван актуален одит');
        return r.json();
      });
   if(!doc||!doc.leagues)throw Error('Липсва отчет за покритието');
   const leagues=structuredClone(doc.leagues);
   const europeRows=archive.international.history.filter(r=>window.MatchpulseArchive.european(r));
   for(const r of europeRows){if(!leagues[r[0]])leagues[r[0]]={matches:0,future_fixtures:0};leagues[r[0]].matches=(leagues[r[0]].matches||0)+1;}
   const rows=Object.entries(leagues).sort((a,b)=>(b[1].future_fixtures||0)-(a[1].future_fixtures||0)||b[1].matches-a[1].matches);
   const coverage=(v,k)=>v.coverage?.[k]?.percentage===undefined?'—':v.coverage[k].percentage+'%';
   target.innerHTML='<p><b>'+(doc.historical_matches+europeRows.length).toLocaleString('bg-BG')+' мача</b> · '+doc.historical_leagues+
    ' първенства'+(europeRows.length?' + 3 евротурнира':'')+' · одит '+esc(doc.checked_utc?.slice(0,10)||'—')+'</p>'+
    '<p>Покритието на статистиките е показано по първенство.</p>'+
    '<div class="coverage-scroll"><table><thead><tr><th>Лига</th><th>Мачове</th><th>Бъдещи</th><th>Удари</th><th>Корнери</th><th>Жълти</th><th>xG</th></tr></thead><tbody>'+
    rows.map(([code,v])=>'<tr><td>'+esc(code)+'</td><td>'+v.matches+'</td><td>'+v.future_fixtures+
      '</td><td>'+coverage(v,'shots')+'</td><td>'+coverage(v,'corners')+'</td><td>'+coverage(v,'yellow_cards')+
      '</td><td>'+coverage(v,'xg')+'</td></tr>').join('')+'</tbody></table></div>'+
    '<p>Сезони с липсващи или твърде малко мачове: <b>'+ (doc.thin_or_missing_finished_seasons?.length||0) +
    '</b> · структурни проблеми: <b>'+doc.issues_total+'</b>.</p>';
 }catch(e){target.textContent='Няма актуален отчет за покритието. '+e.message;}
}
async function load(){
 try{
  const [h,f,s]=window.SCOUT_EMBEDDED_DATA ?
    [window.SCOUT_EMBEDDED_DATA.history,window.SCOUT_EMBEDDED_DATA.fixtures,window.SCOUT_EMBEDDED_DATA.status] :
    await Promise.all(['history.json','fixtures.json','status.json'].map(name=>
      fetch('data/'+name+'?scout=1',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(name+' HTTP '+r.status);return r.json()})));
  if(!Array.isArray(h)||!Array.isArray(f))throw Error('Невалиден формат на базата');
  const extra=window.SCOUT_EMBEDDED_DATA || await Promise.all(['europe_history.json','match_links.json','europe_fixture_names.json'].map(name=>
    fetch('data/'+name+'?scout=1',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(name+' HTTP '+r.status);return r.json()}))).then(([europe,links,europeNames])=>({europe,links,europeNames}));
  archive=window.MatchpulseArchive.build(Scout,h,extra.europe||[],extra.links||{},extra.europeNames||{});
  history=h;fixtures=f;status=s;index=archive.main;eloIndex=Elo.build(h,Scout.keyTeam);syncResearchControls();
  const lg=new Map();f.forEach(row=>lg.set(row[0],row[2]));
  const options='<option value="">Всички първенства</option>'+[...lg.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('');
  el('leagueSelect').innerHTML=options;el('scanLeague').innerHTML=options;
  const countryBG={England:'Англия',Scotland:'Шотландия',Germany:'Германия',Italy:'Италия',Spain:'Испания',France:'Франция',Netherlands:'Нидерландия',Belgium:'Белгия',Portugal:'Португалия',Turkey:'Турция',Greece:'Гърция',Norway:'Норвегия',Sweden:'Швеция',Denmark:'Дания',Austria:'Австрия',Poland:'Полша',Switzerland:'Швейцария'};
  const tableLeagues=new Map();[...h,...(extra.europe||[]),...f].forEach(r=>tableLeagues.set(r[0],(r[1]==='Europe'?'':(countryBG[r[1]]||r[1])+' · ')+r[2]));
  el('standingsLeague').innerHTML=[...tableLeagues.entries()].sort((a,b)=>a[1].localeCompare(b[1],'bg')).map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('');
  if(tableLeagues.has('E0'))el('standingsLeague').value='E0';
  const calendarStamp=s.fixtures_updated_utc||s.last_build_utc;
  const showStamp=value=>value?new Date(value).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'неизвестно';
  const historyStamp=[s.last_history_success_utc,s.last_results_success_utc,s.csv_archive_backfill?.checked_utc,s.openfootball_backfill?.checked_utc,s.openfootball_txt_backfill?.checked_utc].filter(v=>Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
  const age=Date.now()-new Date(calendarStamp||0).getTime();
  const stale=!Number.isFinite(age)||age>36*3600000;
  const errors=[...(s.secondary_fixture_errors||[]),...(s.result_bridge_errors||[]),...(s.europe_errors||[])];
  const partial=errors.length>0||['partial_secondary','stale_secondary'].includes(s.fixtures_feed_status)||['partial','error'].includes(s.result_bridge_status)||['partial','error'].includes(s.europe_refresh_status);
  el('lastSync').textContent='Програма: '+showStamp(calendarStamp);
  el('syncBadge').classList.toggle('sync-warning',stale||partial);
  el('sourceStatus').textContent=(history.length+(extra.europe||[]).length).toLocaleString('bg-BG')+' мача в архива';
  el('notice').classList.toggle('hidden',!stale&&!partial);
  el('notice').textContent=stale?'Календарът не е обновяван скоро. Провери „Данни и обновяване“.':partial?'Част от източниците не са обновени. Виж „Данни и обновяване“.':'';
  el('syncContent').innerHTML='<div class="sync-grid"><div><strong>Програма</strong><span>'+esc(showStamp(calendarStamp))+'</span></div>'+
   '<div><strong>Основен архив</strong><span>'+esc(showStamp(s.last_history_success_utc||historyStamp))+'</span></div>'+
   '<div><strong>Допълнителни лиги</strong><span>'+esc(showStamp(s.last_results_success_utc))+'</span></div>'+
   '<div><strong>Евротурнири</strong><span>'+esc(showStamp(s.last_europe_success_utc))+'</span></div>'+
   '<div><strong>Класиране</strong><span>'+(s.standings_sources_ok??'—')+' / '+(s.standings_sources_total??'—')+' · '+esc(showStamp(s.last_standings_success_utc))+'</span></div>'+
   '<div><strong>Календарни източници</strong><span>'+(s.secondary_fixture_sources_ok??'—')+' / '+(s.secondary_fixture_sources_total??'—')+'</span></div></div>'+
   (errors.length?'<p>'+errors.map(esc).join(' · ')+'</p>':'');
  setView('schedule');
  loadCoverage();
 }catch(e){
  el('lastSync').textContent='Няма данни';
  el('notice').classList.remove('hidden');el('notice').textContent='Не успях да заредя данните. Презареди страницата.';
  console.error('Scout data load failed',e);
  el('scheduleList').innerHTML='<div class="empty">'+esc(e.message)+'</div>';
 }
}
for(const id of ['researchWindow','drawerWindow'])el(id).onchange=e=>setResearch(e.target.value);
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{
 mode=b.dataset.day==='7'?'week':b.dataset.day==='1'?'tomorrow':'today';
 document.querySelectorAll('[data-day]').forEach(x=>x.classList.toggle('active',x===b));
 renderSchedule();
});
el('dateInput').onchange=e=>{if(e.target.value){mode='custom';customDate=e.target.value;document.querySelectorAll('[data-day]').forEach(x=>x.classList.remove('active'));renderSchedule()}};
el('scheduleStandings').addEventListener('toggle',programStandings);
el('standingsLeague').addEventListener('change',programStandings);
el('leagueSelect').addEventListener('change',()=>{if(el('leagueSelect').value){el('standingsLeague').value=el('leagueSelect').value;programStandings()}});
for(const id of ['leagueSelect','qualitySelect','searchInput'])el(id).addEventListener(id==='searchInput'?'input':'change',renderSchedule);
for(const id of ['scanMarket','scanWindow','scanLeague','scanStreak','scanBoth','scanVenue'])el(id).addEventListener('change',renderScanner);
el('exportPicks').onclick=exportPicks;el('closeMatch').onclick=closeMatch;
el('matchOverlay').onclick=e=>{if(e.target===el('matchOverlay'))closeMatch()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('matchOverlay').classList.contains('hidden'))closeMatch()});
load();
