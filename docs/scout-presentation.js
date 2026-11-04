/* Presentation only. All probabilities and historical observations are supplied
 * by the existing, unchanged model and dossier modules. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d).replace('.',','):'—';
const percent=n=>Number.isFinite(n)?Math.round(n*100)+'%':'—';
const paths={
 pulse:'M3 12h4l3-8 4 16 3-8h4',
 matches:'M4 5h16v15H4z M8 3v4m8-4v4M4 10h16',
 bookmark:'M6 4h12v17l-6-4-6 4z',
 chart:'M4 3v17h17M7 14l4-4 4 3 5-7',
 overview:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
 goal:'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11l8-8M16 3h5v5',
 form:'M5 19v-5m5 5V8m5 11v-8m5 8V4',
 shots:'M12 2v3m0 14v3M2 12h3m14 0h3M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
 corners:'M5 21V4m0 1c5-4 8 4 14 0v9c-6 4-9-4-14 0',
 cards:'M7 3h10v18H7z',
 arrow:'M4 12h15m-6-6 6 6-6 6',
 back:'M20 12H5m6-6-6 6 6 6',
 close:'M5 5l14 14M19 5 5 19',
 trophy:'M8 3h8v7a4 4 0 0 1-8 0zm0 3H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 1h8',
 search:'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M16 16l5 5',
 info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6m0-10v1',
 star:'m12 3 3 6 6 1-4.5 4.5 1 6.5-5.5-3-5.5 3 1-6.5L3 10l6-1z',
 save:'M12 5v14M5 12h14',
 check:'m5 12 4 4L19 6'
};
function icon(name){return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.info)+'"/></svg>';}
let marks=new Map(),marksPromise=null;
const markKey=(division,name)=>division+'|'+root.MatchpulseScout.keyTeam(name);
function clubMark(division,name,size=''){
 const initials=String(name).split(/[\s-]+/).filter(Boolean).map(w=>w[0]).slice(0,3).join('').toLocaleUpperCase();
 const entry=marks.get(markKey(division,name));
 return '<span class="club-mark '+size+'" data-club-division="'+esc(division)+'" data-club-name="'+esc(name)+'"><span aria-hidden="true">'+esc(initials)+'</span>'+(entry?'<img src="'+esc(entry.url)+'" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+'</span>';
}
function hydrateMarks(){
 if(typeof document==='undefined')return;
 document.querySelectorAll('[data-club-division][data-club-name]').forEach(el=>{
  if(el.querySelector('img'))return;
  const e=marks.get(markKey(el.dataset.clubDivision,el.dataset.clubName));if(!e)return;
  const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.src=e.url;el.append(image);
 });
}
function loadMarks(){
 if(marksPromise)return marksPromise;
 marksPromise=(root.SCOUT_EMBEDDED_DATA?Promise.resolve(root.SCOUT_EMBEDDED_DATA.clubMarks):
  fetch('assets/club-marks.json?v=20261104',{cache:'force-cache',signal:AbortSignal.timeout(6000)}).then(r=>r.ok?r.json():null))
  .then(doc=>{for(const e of doc?.entries||[])if(e.division&&e.team&&/^https:\/\/a\.espncdn\.com\//.test(e.url))marks.set(markKey(e.division,e.team),e);hydrateMarks();})
  .catch(()=>{});
 return marksPromise;
}
function hero(f,d,ratings){
 const team=(side,role)=>{
  const t=d[side],r=ratings[side],forms=t.form.games.slice(0,5).reverse();
  return '<div class="match-club">'+clubMark(f[0],t.name,'club-mark-large')+'<h2>'+esc(t.name)+'</h2><span class="club-role">'+role+'</span>'+
   '<div class="hero-form" aria-label="Последни '+forms.length+' резултата, най-новият вдясно">'+forms.map(g=>'<span class="hero-result result-'+g.points+'" title="'+esc(g.row[3]+' · '+g.row[5]+' '+g.row[7]+':'+g.row[8]+' '+g.row[6])+'">'+g.result+'</span>').join('')+'</div>'+
   '<div class="hero-elo">Elo <strong>'+(r.games?Math.round(r.rating):'—')+'</strong></div></div>';
 };
 const clock=(f[4]||'—')+(String(f[13]||'').includes('Sofia')?'':'*');
 return '<div class="match-header"><div class="match-date">'+icon('trophy')+'<span>'+esc(root.MatchpulseHealth.leagueLabel(f))+'</span><time>'+esc(f[3])+' · София</time></div>'+
  '<h2 id="matchHeading" class="sr-only">'+esc(f[5])+' – '+esc(f[6])+'</h2><div class="match-duel-head">'+team('home','Домакин')+'<div class="match-kickoff"><strong>'+esc(clock)+'</strong><span>'+esc(f[3].slice(8)+'.'+f[3].slice(5,7))+'</span><small>НАЧАЛО</small></div>'+team('away','Гост')+'</div></div>';
}
const TABS=[['overview','Обзор'],['goals','Голове'],['form','Форма'],['shots','Удари'],['corners','Корнери'],['cards','Картони']];
function tabs(selected='overview'){
 return '<div class="match-tabs" role="tablist" aria-label="Раздели на анализа">'+TABS.map(([key,label])=>'<button type="button" id="match-tab-'+key+'" role="tab" data-match-tab="'+key+'" aria-selected="'+(key===selected)+'" aria-controls="match-panel-'+(['shots','corners','cards'].includes(key)?'stats':key)+'">'+icon(key)+'<span>'+label+'</span></button>').join('')+'</div>';
}
function overview(f,d,z){
 if(!z||z.error||!z.distribution)return '<div class="overview-unavailable">'+icon('info')+'<p>'+esc(d.international?'За този евротурнир няма моделни проценти. Формата, тенденциите и наличната статистика остават достъпни.':z?.error||'Няма запазена предмачова моделна оценка.')+'</p></div>';
 const p=z.distribution.probs,base=z.bases&&root.MatchpulseModel.distribution(z.bases.home,z.bases.away,z.settings?.rho??-.06).probs;
 const hp=Math.round(p.homeWin*100),dp=Math.round(p.draw*100),ap=100-hp-dp;
 const metrics=[['Над 1,5 гола',p.over15,base?.over15],['Над 2,5 гола',p.over25,base?.over25],['Гол/гол · Да',p.btts,base?.btts],['Очаквани голове',z.total,z.bases?z.bases.home+z.bases.away:null,true]];
 return '<section class="overview-outcome"><div class="view-section-head"><h3>Кой има предимство?</h3><span class="model-label">'+(d.archived?'Предмачов запис':'Модел 1')+'</span></div><div class="win-labels"><span>1 · Домакин <b>'+hp+'%</b></span><span>Х <b>'+dp+'%</b></span><span>2 · Гост <b>'+ap+'%</b></span></div><div class="win-bar" role="img" aria-label="'+esc(f[5])+' '+hp+'%, равенство '+dp+'%, '+esc(f[6])+' '+ap+'%"><span style="width:'+hp+'%"></span><span style="width:'+dp+'%"></span><span style="width:'+ap+'%"></span></div></section>'+
  '<div class="overview-metrics">'+metrics.map(([label,value,reference,total])=>'<article class="overview-metric"><span>'+esc(label)+'</span><b>'+(total?fmt(value):percent(value))+'</b><div class="metric-track" aria-hidden="true"><i style="width:'+Math.min(100,total?value/5*100:value*100)+'%"></i></div><small>'+(Number.isFinite(reference)?(total?'Лигова основа: '+fmt(reference):'Лигова основа: '+percent(reference)):'Няма съпоставима лигова основа')+'</small></article>').join('')+'</div>';
}
function goals(f,z){
 if(!z||z.error||!Array.isArray(z.distribution?.matrix))return '';
 const matrix=z.distribution.matrix;
 const probability=(line,side)=>{
  let sum=0;matrix.forEach((row,h)=>row.forEach((value,a)=>{if((side==='home'?h:side==='away'?a:h+a)>line)sum+=value;}));return sum;
 };
 return '<section class="goal-probability-card"><div class="view-section-head"><h3>Вероятности за голове</h3><span class="model-label">От резултатната матрица</span></div>'+
  '<table class="goal-probability-table"><thead><tr><th>Граница</th><th>'+esc(f[5])+'</th><th>'+esc(f[6])+'</th><th>Общо</th></tr></thead><tbody>'+[.5,1.5,2.5,3.5,4.5].map(line=>'<tr><th scope="row">Над '+fmt(line,1)+'</th>'+['home','away','total'].map(side=>{const p=probability(line,side);return '<td><b class="probability-value '+(p>=.7?'probability-high':p>=.45?'probability-mid':'')+'">'+percent(p)+'</b></td>';}).join('')+'</tr>').join('')+'</tbody></table><p class="footnote">Моделни оценки за голове. Подробните пазари и двойният шанс са отдолу.</p></section>';
}
function splitStatistics(html){
 const box=document.createElement('div');box.innerHTML=html;
 const xg=box.querySelector('.xg-block');const xgHTML=xg?.outerHTML||'';xg?.remove();
 const groups={shots:['Удари','Точни удари'],corners:['Корнери'],cards:['Жълти картони','Червени картони']};
 const blocks=[...box.querySelectorAll('.stat-block')];
 for(const block of blocks)block.dataset.statCategory=Object.entries(groups).find(([,names])=>names.includes(block.querySelector('h3')?.textContent))?.[0]||'';
 const detail=box.querySelector('details');if(detail)detail.open=true;
 return {html:box.innerHTML,xg:xgHTML};
}
function mountTabs(selected,onSelect){
 const buttons=[...document.querySelectorAll('[data-match-tab]')];
 const activate=key=>{
  const stats=['shots','corners','cards'].includes(key),panel=stats?'stats':key;
  buttons.forEach(b=>{const chosen=b.dataset.matchTab===key;b.setAttribute('aria-selected',String(chosen));b.tabIndex=chosen?0:-1;});
  document.querySelectorAll('[data-match-panel]').forEach(el=>el.classList.toggle('hidden',el.dataset.matchPanel!==panel));
  document.querySelectorAll('[data-stat-category]').forEach(el=>el.classList.toggle('hidden',el.dataset.statCategory!==key));
  const statsPanel=document.getElementById('match-panel-stats');
  if(statsPanel){statsPanel.setAttribute('aria-labelledby','match-tab-'+key);const summary=statsPanel.querySelector('.extra-analytics summary span');if(summary)summary.textContent=TABS.find(t=>t[0]===key)?.[1]||'Статистика';}
  onSelect?.(key);
 };
 buttons.forEach((button,index)=>{button.onclick=()=>activate(button.dataset.matchTab);button.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();activate(buttons[next].dataset.matchTab);buttons[next].focus();};});
 activate(selected);hydrateMarks();
}
function decoratePlan(target,save){
 const primary=target.querySelector('.selection-primary'),market=primary?.dataset.selectionMarket;
 if(typeof save==='function'&&market){
  const button=document.createElement('button');button.type='button';button.className='button save-main-pick';button.dataset.planSave=market;button.innerHTML=icon('bookmark')+'Запази в моя подбор';button.onclick=()=>save(market);primary.append(button);
 }
 const method=target.querySelector('.plan-method'),why=target.querySelector('.selection-why');
 if(method){
  if(why)why.append(method);
  else{const fold=document.createElement('details');fold.className='selection-why';const summary=document.createElement('summary');summary.textContent='Основа на подбора';fold.append(summary);method.replaceWith(fold);fold.append(method);}
 }
}
if(typeof document!=='undefined')document.addEventListener('error',event=>{
 if(event.target.matches?.('.club-mark img'))event.target.remove();
},true);
root.MatchpulsePresentation={icon,clubMark,hydrateMarks,loadMarks,hero,tabs,overview,goals,splitStatistics,mountTabs,decoratePlan};
})(typeof globalThis!=='undefined'?globalThis:this);
