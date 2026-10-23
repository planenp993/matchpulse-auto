/* PRIME product prototype. No external writes, sign-in, payments or background AI. */
(() => {
  'use strict';
  const D=window.PRIME_DATA;
  const Core=window.PrimeCore;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('bg-BG',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const icon=(name,size=17)=>{
    const p={arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',up:'<path d="M6 18 18 6M6 6h12v12"/>',
      selection:'<path d="M5 6h14M5 12h9M5 18h6"/><path d="m16 16 2 2 4-5"/>',
      calendar:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 10h16M8 14h1M14 14h1M8 18h1"/>',
      archive:'<rect x="4" y="8" width="16" height="13" rx="2"/><path d="M3 3h18v5H3zM9 12h6"/>',
      club:'<path d="m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7z"/><path d="m8 12 3 3 5-6"/>',
      check:'<path d="m5 12 4 4 10-10"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
      source:'<path d="M9 4H4v16h16v-5M14 3h7v7M10 14 21 3"/>',
      lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
      info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
      copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
      back:'<path d="M19 12H5m6-6-6 6 6 6"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
      file:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h6"/>',
      eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'};
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[name]||p.arrow}</svg>`;
  };
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  const label={over25:'Над 2,5 гола',under25:'Под 2,5 гола',bttsYes:'Гол/гол — Да',bttsNo:'Гол/гол — Не',homeOver15:'Домакин над 1,5 гола',awayOver15:'Гост над 1,5 гола'};
  const samplePicks=[
    {fixture:'oldb:83212',market:'bttsYes',access:'free',floor:1.75,headline:'Две атаки. Един общ сценарий.',
     thesis:'Двустранният гол е сценарий за проучване. Проверяваме дали головата форма на двата отбора се подкрепя от актуалните състави и начина им на игра.',
     risk:'Десет мача са ограничен контекст. Без проверени отсъствия, състави и цена тази теза остава демонстрационна и не е готова за публикуване.'},
    {fixture:'oldb:83648',market:'under25',access:'vip',floor:1.90,headline:'Когато линията и сценарият се срещнат.',
     thesis:'Пример за теза на по-ниска голова линия: търсим контролирано темпо и ограничени качествени положения. Историческата форма сама по себе си не доказва този сценарий.',
     risk:'Ранен гол може да промени темпото. Тактическата теза тук е примерен текст, без потвърдена актуална информация.'},
    {fixture:'oldb:83655',market:'homeOver15',access:'vip',floor:2.05,headline:'Фокус върху едната атака.',
     thesis:'Пример за индивидуален голов пазар. Проучваме домакинската атака и защитата на госта, вместо автоматично да избираме общ брой голове.',
     risk:'Нужни са доказателства за атакуващия състав и реална пазарна цена. Не приемаме, че високата средна голова стойност е достатъчен аргумент.'}
  ];
  let member=false, archiveSample=false, archiveAccess='all', scheduleDay='today',scheduleLeague='all',scheduleQuery='',detailTab='analysis';
  let reviewText='',reviewApproved=false,validation=[],validationChecked=false;
  let toastTimer;
  const todayFixtures=D.fixtures.filter(f=>f.date===D.date);
  const fById=id=>D.fixtures.find(f=>f.id===id);
  const pById=id=>samplePicks.find(p=>p.fixture===id);
  const shortName=t=>t.id==='oldb:87'?"М'гладбах":t.name;
  const marker=(t,light=true)=>`<span class="club-marker${light?' marker-light':''}" style="--team-color:${esc(t.color)}" aria-hidden="true">${esc(t.short)}</span>`;
  const markers=f=>`<span class="tiny-markers">${marker(f.home)}${marker(f.away)}</span>`;
  const dayLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('bg-BG',{day:'numeric',month:'long'});
  const demoNotice=(text='Селекциите и ценовите прагове са примери за дизайна. Няма публикувани прогнози.')=>`<div class="demo-notice">${icon('info',14)}<div><b>Демонстрационен режим.</b> ${text}</div></div>`;
  const hrefMatch=id=>'#match/'+encodeURIComponent(id);
  function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3400);}
  function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
  function notifyLocal(){toast('Одобрено само в този браузър. Нищо не е изпратено.');}
  function route(){
    const raw=location.hash.slice(1)||'today';
    if(raw==='main'){ $('#main').focus(); return; }
    const [name,id]=raw.split('/');
    document.querySelectorAll('[data-nav]').forEach(a=>{const active=a.dataset.nav===name||(name==='match'&&a.dataset.nav==='schedule');a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('#editor-toggle').textContent=name==='desk'?'Към селекцията ↗':'Редакция ↗';
    if(name==='schedule')renderSchedule();
    else if(name==='match')renderMatch(decodeURIComponent(id||''));
    else if(name==='archive')renderArchive();
    else if(name==='club')renderClub();
    else if(name==='desk')renderDesk();
    else renderToday();
    if(name!=='match')detailTab='analysis';
    window.scrollTo({top:0,behavior:'instant'});
    $('#viewport').scrollTop=0;
  }
  function heading(eye,title,description,aside=''){
    return `<div class="page-heading"><div><div class="eyebrow"><span class="dot"></span>${eye}</div><h1>${title}</h1><p>${description}</p></div>${aside}</div>`;
  }
  function compactPick(p){
    const f=fById(p.fixture);if(!f)return '';
    const hidden=p.access==='vip'&&!member;
    return `<article class="pick-card"><div class="pick-top"><span>${esc(f.league)} · ${esc(f.time)}</span><span class="chip ${p.access==='vip'?'vip':''}">${p.access==='vip'?icon('lock',10)+' КЛУБ':'FREE'}</span></div>
      <div class="pick-match">${markers(f)}<h3>${esc(shortName(f.home))} — ${esc(shortName(f.away))}</h3></div>
      <div class="pick-market"><strong>${hidden?'Пълният сценарий е в Клуба':esc(label[p.market])}</strong><a class="text-link" href="${hidden?'#club':hrefMatch(f.id)}" aria-label="${hidden?'Разгледай PRIME Клуб':'Анализ '+esc(f.home.name)+' '+esc(f.away.name)}">${icon(hidden?'lock':'arrow',18)}</a></div>
      <p>${hidden?'Допълнителен анализ със същия критерий за качество. Без задължителна дневна квота.':'Демонстрационна селекция · примерен праг '+num(p.floor)+' · непотвърдена цена.'}</p></article>`;
  }
  function renderToday(){
    const p=samplePicks[0], f=fById(p.fixture);
    if(!f){$('#main').innerHTML=heading('PRIME / ДНЕВНО ИЗДАНИЕ','Днес без селекция.','Няма достатъчно проверени данни за това издание.');return;}
    $('#main').innerHTML=heading('ПЕТЪК, 23 ОКТОМВРИ 2026','Селекция с аргумент.','Подбрани голови пазари. Ясни причини. Пълен отчет.',`<div class="edition-number"><strong>ДНЕВНО ИЗДАНИЕ / 001</strong>PRIME SYNDICATE<br>Време: Europe/Sofia</div>`)+
      (member?'<div class="member-banner"><p><b>Преглед като член.</b> Виждаш демонстрационните VIP селекции.</p><button class="text-link" id="exit-member">Изход от VIP демо '+icon('arrow',14)+'</button></div>':'')+
      demoNotice()+`<div class="feature-grid"><article class="feature-card"><div class="card-top"><span class="tag"><b></b>FREE / ПРИМЕРНА СЕЛЕКЦИЯ</span><time datetime="${f.kickoff_utc}">${esc(f.time)} ч.</time></div>
      <div class="league-line">Германия · ${esc(f.league)} · ${dayLabel(f.date)}</div>
      <div class="match-teams"><div class="feature-team">${marker(f.home,false)}<strong>${esc(shortName(f.home))}</strong></div><span class="versus">срещу</span><div class="feature-team">${marker(f.away,false)}<strong>${esc(shortName(f.away))}</strong></div></div>
      <div class="market-box"><div><small>ГОЛОВ СЦЕНАРИЙ</small><strong>${esc(label[p.market])}</strong></div><div class="market-price"><small>ПРИМЕРЕН ПРАГ</small><strong>${num(p.floor)}</strong></div></div>
      <p class="feature-explainer">Исторически контекст, футболна теза и ясна причина да се откажем от нея. Виж как е структуриран анализът.</p>
      <div class="feature-bottom"><a class="btn btn-white" href="${hrefMatch(f.id)}">Прочети анализа ${icon('up',17)}</a><span>Пазарна цена: непотвърдена<br>Не е реална препоръка</span></div></article>
      <aside class="editor-note"><div class="eyebrow">БЕЛЕЖКА ОТ РЕДАКЦИЯТА</div><h2>По-малко шум.<br>По-ясна футболна теза.</h2><p>Не всеки мач заслужава прогноза. Публикуваме само когато данните, актуалната информация и цената подкрепят един сценарий.</p><div class="note-rule"></div>
      <div class="note-item">${icon('check',15)}Аргументите са преди процента.</div><div class="note-item">${icon('check',15)}Рискът е част от анализа.</div><div class="note-item">${icon('archive',15)}И загубите остават в архива.</div>
      <a class="text-link" href="#archive">Как отчитаме резултатите ${icon('arrow',15)}</a></aside></div>
      <div class="section-head"><h2>Още от изданието</h2><small>VIP изглед · демонстрация</small></div><div class="picks-grid">${samplePicks.slice(1).map(compactPick).join('')}</div>
      <div class="trust-strip"><h2>Всяка прогноза<br>остава.</h2><p>Час на публикуване, избран пазар, проверена цена и краен резултат. Един регистър за FREE и VIP — включително пропуснатите селекции.</p><a class="text-link" href="#archive">Публичният архив ${icon('arrow',16)}</a></div>`;
    $('#exit-member')?.addEventListener('click',()=>{member=false;renderToday();});
  }
  function renderSchedule(){
    $('#main').innerHTML=heading('КАЛЕНДАР / 2 ПЪРВЕНСТВА','Преди първия сигнал.','Срещите, които можем да проучим с наличните данни.',`<div class="edition-number"><strong>SNAPSHOT / 23.10.2026</strong>${D.fixtures.length} мача в 30 дни<br>Часовете са за България</div>`)+
      `<div class="demo-notice">${icon('clock',14)}<div><b>Проверена връзка към OpenLigaDB.</b> Това е датирана програма от 23.10.2026, с автоматично преобразувани часове. Не е live календар. Статусът на отделен отложен мач изисква допълнителна проверка.</div></div>
      <div class="filter-row"><div class="segmented" aria-label="Период"><button data-day="today" class="${scheduleDay==='today'?'active':''}">Днес</button><button data-day="tomorrow" class="${scheduleDay==='tomorrow'?'active':''}">Утре</button><button data-day="week" class="${scheduleDay==='week'?'active':''}">7 дни</button></div>
      <select id="league-filter" aria-label="Първенство"><option value="all">Всички лиги</option value="bl1">Бундеслига</option><option value="bl2">Бундеслига 2</option></select>
      <input id="fixture-search" type="search" placeholder="Намери отбор…" aria-label="Търсене на отбор" value="${esc(scheduleQuery)}"></div><div id="calendar-results"></div>
      <p class="loading-note">Показателите са от завършени мачове преди срещата, само в същото първенство. Няма автоматично приравняване на силата между дивизии. Типографските маркери не са официални емблеми.</p>`;
    $('#league-filter').value=scheduleLeague;
    document.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>{scheduleDay=b.dataset.day;renderSchedule();}));
    $('#league-filter').addEventListener('change',e=>{scheduleLeague=e.target.value;renderScheduleResults();});
    $('#fixture-search').addEventListener('input',e=>{scheduleQuery=e.target.value;renderScheduleResults();});
    renderScheduleResults();
  }
  function renderScheduleResults(){
    const tomorrow=new Date(D.date+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const next=tomorrow.toISOString().slice(0,10);
    const week=new Date(D.date+'T12:00:00Z');week.setUTCDate(week.getUTCDate()+6);
    const end=week.toISOString().slice(0,10);
    const q=scheduleQuery.toLocaleLowerCase('bg').trim();
    const matches=D.fixtures.filter(f=>(scheduleDay==='today'?f.date===D.date:scheduleDay==='tomorrow'?f.date===next:f.date>=D.date&&f.date<=end)&&(scheduleLeague==='all'||f.league_id===scheduleLeague)&&(!q||[f.home.name,f.away.name,f.home.source_name,f.away.source_name].some(n=>n.toLocaleLowerCase('bg').includes(q))));
    let day='';let html='';
    for(const f of matches){
      if(f.date!==day){day=f.date;html+=`<div class="fixture-group-label">${esc(dayLabel(day))} · ${f.date===D.date?'днес':f.date===next?'утре':'2026'}</div>`;}
      const n=Math.min(f.home_stats.n,f.away_stats.n);
      html+=`<a href="${hrefMatch(f.id)}" class="fixture-row"><div class="fixture-time">${esc(f.time)}<small>София</small></div><div class="fixture-identity">${markers(f)}<div class="fixture-names">${esc(shortName(f.home))} — ${esc(shortName(f.away))}<span>${esc(f.league)}</span></div></div><div class="fixture-status">${n>=10?'Архивът е наличен':'Ограничена извадка'}<br>${f.home_stats.n} + ${f.away_stats.n} мача · без xG</div><span class="fixture-arrow">${icon('arrow',16)}</span></a>`;
    }
    $('#calendar-results').innerHTML=matches.length?`<div class="mini-toast">${matches.length} ${matches.length===1?'среща':'срещи'} в избрания обхват</div><div class="calendar-list">${html}</div>`:`<div class="empty-state">${icon('calendar',30)}<h2>Няма съвпадения.</h2><p>Промени отбора, първенството или периода.</p><button class="btn btn-outline" id="clear-filters">Изчисти филтрите</button></div>`;
    $('#clear-filters')?.addEventListener('click',()=>{scheduleQuery='';scheduleLeague='all';scheduleDay='today';renderSchedule();});
  }
  function historicalFact(f,side){
    const t=f[side],s=f[side+'_stats'];
    return `<div class="evidence-line"><span>${side==='home'?'01':'02'}</span><div><h3>${esc(t.name)}: голов контекст от ${s.n} мача</h3><p>Средно ${num(s.gf)} отбелязани и ${num(s.ga)} допуснати гола. Гол/гол: ${s.btts} от ${s.n}; над 2,5: ${s.over25} от ${s.n}.</p><small>Изчислено от OpenLigaDB · мачове преди ${esc(f.date)}</small></div></div>`;
  }
  function statsPanel(f){
    return `<div class="stat-duel">${['home','away'].map(side=>{
      const s=f[side+'_stats'];return `<div><h3>${esc(shortName(f[side]))}</h3><p>Мачове в извадката <b>${s.n}</b></p><p>Вкарани / мач <b>${num(s.gf)}</b></p><p>Допуснати / мач <b>${num(s.ga)}</b></p><p>Гол/гол <b>${s.btts}/${s.n}</b></p><div class="sample-bars" aria-label="Гол/гол в ${s.btts} от ${s.n} мача">${Array.from({length:s.n},(_,i)=>`<i class="${i<s.btts?'on':''}"></i>`).join('')}</div><p>xG <b>Няма данни</b></p></div>`;
    }).join('')}</div>`;
  }
  function formPanel(f){
    return ['home','away'].map(side=>`<section class="analysis-card"><h2>${esc(f[side].name)} · последни ${f[side+'_stats'].n}</h2><p>Само същото първенство. Данните не включват изхода от предстоящата среща.</p><div class="recent-list">${f[side+'_stats'].matches.map(r=>`<div class="recent-row"><span>${esc(r.date.slice(5).split('-').reverse().join('.'))}</span><div>${esc(r.home)} — ${esc(r.away)}</div><b>${r.score[0]} : ${r.score[1]}</b></div>`).join('')||'<p>Няма достатъчно история в тази дивизия.</p>'}</div></section>`).join('');
  }
  function renderMatch(id){
    const f=fById(id);if(!f){$('#main').innerHTML=`<div class="empty-state"><h2>Срещата не е в този snapshot.</h2><a class="btn btn-primary" href="#schedule">Към програмата</a></div>`;return;}
    const p=pById(id);const locked=p?.access==='vip'&&!member;
    const showPick=p&&!locked;
    $('#main').innerHTML=`<a href="#schedule" class="back-link">${icon('back',14)}Всички срещи</a><div class="detail-heading"><div class="eyebrow">ГЕРМАНИЯ / ${esc(f.league)}</div><h1>${esc(f.home.name)} — ${esc(f.away.name)}</h1><div class="fixture-meta">${dayLabel(f.date)} 2026 · ${esc(f.time)} ч. (Europe/Sofia) · OpenLigaDB ID ${esc(f.id.split(':')[1])}</div></div>`+
      (p?demoNotice('Тезата и ценовият праг са примерни. Показателите за форма са изчислени от реалния snapshot.'):demoNotice('Това е изследователска карта. За срещата няма одобрена селекция.'))+
      `<div class="detail-layout"><div class="detail-content"><div class="detail-tabs"><button id="analysis-tab" class="${detailTab==='analysis'?'active':''}">Погледът</button><button id="form-tab" class="${detailTab==='form'?'active':''}">Последни мачове</button></div><div id="detail-panel">${detailTab==='form'?formPanel(f):`
      <section class="analysis-card"><div class="eyebrow">01 / ФУТБОЛНАТА ТЕЗА</div><blockquote>${locked?'Пълният примерен анализ е в PRIME Клуб.':showPick?esc(p.thesis):'Първо проверяваме как се създават положенията. След това избираме головия пазар.'}</blockquote>${locked?'<p class="top-margin">Можеш да разгледаш примерния VIP изглед без регистрация или плащане.</p><a class="btn btn-primary" href="#club">Разгледай Клуба ↗</a>':''}</section>
      <section class="analysis-card"><h2>Какво знаем от данните</h2>${historicalFact(f,'home')}${historicalFact(f,'away')}<div class="evidence-line"><span>03</span><div><h3>Какво предстои да проверим</h3><p>Контузии, вероятни състави, тактически промени и пазарна цена. Тук няма потвърдени новини за тях.</p><small>Непроверено · автоматична селекция не се публикува</small></div></div>${statsPanel(f)}</section>
      <section class="analysis-card risk-card"><h2>Какво може да обърка сценария</h2><p>${esc(showPick?p.risk:'Липсата на актуална информация е основание да отложим прогнозата. Головите средни и кратките серии не описват сами по себе си предстоящия мач.')}</p></section>
      <section class="analysis-card"><h2>Какво променя решението</h2><p>Съществена промяна в атакуващия състав, различен тактически подход или цена под предварително записания праг изискват нова проверка.</p><a class="source-link" href="${esc(f.source_url)}" target="_blank" rel="noopener">Входните данни за ${esc(f.league)} ${f.season}/${String(f.season+1).slice(-2)} ${icon('source',12)}</a><p class="small top-margin">Изчислено от 10 последни завършени мача, когато са налични. Показаните честоти не са прогнозни вероятности.</p></section>`}</div></div>
      <aside class="detail-aside"><section class="selection-summary"><div class="eyebrow">${locked?'PRIME КЛУБ':showPick?'ПРИМЕРНА СЕЛЕКЦИЯ':'ИЗСЛЕДОВАТЕЛСКА КАРТА'}</div><h2>${locked?'Допълнителен поглед.':showPick?esc(label[p.market]):'Очаква анализ.'}</h2><div class="summary-row"><span>Достъп</span><strong>${p?.access==='vip'?'VIP / демо':'FREE'}</strong></div><div class="summary-row"><span>Примерен праг</span><strong>${showPick?num(p.floor):'—'}</strong></div><div class="summary-row"><span>Потвърдена цена</span><strong>Няма</strong></div><div class="summary-row"><span>Актуални новини</span><strong>Предстои проверка</strong></div><div class="summary-row"><span>Статус</span><strong>${showPick?'Демонстрация':'Непубликувано'}</strong></div><button class="btn btn-white" id="match-packet">Пакет за проучване ${icon('file',15)}</button><p class="summary-small">Прагът е пример за интерфейса, а не измерено ценово предимство. Копирането на пакет не стартира AI.</p></section>
      <section class="analysis-card top-margin"><h2>Следата на анализа</h2><div class="timeline"><div><b>23 окт. / Данни</b>Програма и исторически резултати от OpenLigaDB.</div><div><b>Следва / Футболна проверка</b>Състави, новини и съответствие на сценария.</div><div><b>Следва / Пазарна проверка</b>Цената се записва с източник и час.</div><div><b>Следва / Решение</b>Одобрение, изчакване или пропуск.</div></div></section></aside></div>`;
    $('#analysis-tab').addEventListener('click',()=>{detailTab='analysis';renderMatch(id);});
    $('#form-tab').addEventListener('click',()=>{detailTab='form';renderMatch(id);});
    $('#match-packet').addEventListener('click',()=>openPacket([f]));
  }
  const sampleLedger=[
    {id:'DEMO-001',date:'22.10',name:'Примерен мач А',market:'Над 2,5',odds:1.80,stake:1,status:'won',score:'2 : 1',access:'free'},
    {id:'DEMO-002',date:'22.10',name:'Примерен мач Б',market:'Гол/гол — Да',odds:1.75,stake:1,status:'lost',score:'1 : 0',access:'vip'},
    {id:'DEMO-003',date:'21.10',name:'Примерен мач В',market:'Под 2,5',odds:1.90,stake:1,status:'void',score:'Отложен',access:'vip'},
    {id:'DEMO-004',date:'21.10',name:'Примерен мач Г',market:'Домакин над 1,5',odds:1.85,stake:1,status:'lost',score:'1 : 1',access:'free'}
  ];
  function renderArchive(){
    const rows=archiveSample?sampleLedger.filter(r=>archiveAccess==='all'||r.access===archiveAccess):[];
    const totals=Core.summarizeLedger(rows);
    $('#main').innerHTML=heading('ПУБЛИЧЕН РЕГИСТЪР','Цялата картина.','Успешни и неуспешни селекции. Един и същ стандарт за FREE и VIP.',`<span class="pill-outline">${archiveSample?'Примерен регистър':'От началото'}</span>`)+
      (archiveSample?demoNotice('Всички записи, цени и финансови показатели тук са измислени примери, за да видиш как работи отчетността.'):`<div class="demo-notice">${icon('info',14)}<div><b>Все още няма реални публикации.</b> Не представяме исторически тестове като публичен типстърски резултат.</div></div>`)+
      `<div class="archive-metrics"><div><small>Приключили ${archiveSample?'примери':'селекции'}</small><strong>${totals.n}</strong></div><div><small>Успешни / неуспешни</small><strong>${totals.won} / ${totals.lost}</strong></div><div><small>Нетен резултат</small><strong>${archiveSample?num(totals.profit):'—'}</strong> <span>${archiveSample?'ед. / демо':''}</span></div><div><small>Доходност върху риска</small><strong>${totals.yield===null?'—':num(totals.yield*100,1)+'%'}</strong></div></div>
      <div class="section-head"><div class="segmented" aria-label="Филтър на архива"><button data-access="all" class="${archiveAccess==='all'?'active':''}">Всички</button><button data-access="free" class="${archiveAccess==='free'?'active':''}">FREE</button><button data-access="vip" class="${archiveAccess==='vip'?'active':''}">VIP</button></div><button class="text-link" id="sample-archive">${archiveSample?'Скрий примерите':'Примерен регистър'} ${icon('eye',14)}</button></div>
      ${!rows.length?`<div class="empty-state">${icon('archive',32)}<h2>Архивът започва от първата публикация.</h2><p>След края на всеки мач тук ще остават оригиналният избор, часът, цената, резултатът и всички корекции.</p><button class="btn btn-primary" id="show-sample-ledger">Виж примерен отчет ${icon('arrow',15)}</button></div>`:
      `<div class="ledger"><div class="ledger-row head"><span>Дата</span><span>Селекция / ID</span><span>Пазар</span><span>Цена</span><span>Статус</span><span>Нетно</span></div>${rows.map(r=>`<div class="ledger-row"><span class="ledger-date">${r.date}</span><div class="ledger-name"><strong>${r.name}</strong><span class="muted" style="font-size:9px">${r.id} · ${r.access.toUpperCase()} · ${r.score}</span></div><div class="ledger-pick">${r.market}</div><div class="ledger-odds">${num(r.odds)}</div><div class="ledger-outcome"><span class="chip ${r.status}">${{won:'Успешна',lost:'Загуба',void:'Анулирана'}[r.status]}</span></div><div class="ledger-result ${r.status}">${r.status==='void'?'0,00':r.status==='won'?'+'+num(r.odds-1):'−1,00'}</div></div>`).join('')}</div>`}
      <div class="section-head"><h2>Правилата са видими.</h2>${archiveSample?'<button class="text-link" id="export-ledger">Изтегли демо CSV '+icon('download',14)+'</button>':''}</div><div class="picks-grid"><section class="analysis-card"><h2>Изборът се записва преди мача</h2><p>Публикуваната селекция има постоянен ID, време и история на редакциите. Оттеглянето се отбелязва; оригиналът остава. Нашият регистър е собствен отчет, а не независима заверка.</p></section><section class="analysis-card"><h2>Сметките имат ясна основа</h2><p>Нетният резултат е в условни единици при 1 ед. на селекция. Доходността използва сумата на реално рискуваните единици; анулираните не участват. Комбинациите се отчитат отделно.</p></section></div>`;
    document.querySelectorAll('[data-access]').forEach(b=>b.addEventListener('click',()=>{archiveAccess=b.dataset.access;renderArchive();}));
    const toggle=()=>{archiveSample=!archiveSample;renderArchive();};
    $('#sample-archive').addEventListener('click',toggle);
    $('#show-sample-ledger')?.addEventListener('click',()=>{archiveSample=true;renderArchive();});
    $('#export-ledger')?.addEventListener('click',()=>download('PRIME_DEMO_LEDGER.csv','\ufeff'+['DEMO ONLY;not a real track record','id;date;selection;market;odds;stake;status;access',...sampleLedger.map(r=>[r.id,r.date,r.name,r.market,r.odds,r.stake,r.status,r.access].join(';'))].join('\n'),'text/csv;charset=utf-8'));
  }
  function renderClub(){
    $('#main').innerHTML=`<div class="club-hero"><div><div class="eyebrow"><span class="dot"></span>PRIME КЛУБ</div><h1>Повече поглед.<br>Същият стандарт.</h1><p>Допълнителни селекции и по-задълбочено футболно проучване за хората, които искат да следят целия ни процес.</p><p>FREE показва качеството. Клубът дава достъп до повече от работата ни — със същите критерии за публикуване.</p><div class="note-item">${icon('archive',16)}Всички приключили VIP селекции в публичния отчет.</div><div class="note-item">${icon('clock',16)}Без задължителен брой прогнози на ден.</div><div class="note-item">${icon('check',16)}Без обещания за печалба.</div></div>
      <aside class="membership-card"><div class="eyebrow">ЕДИН ПЛАН / МЕСЕЧЕН ДОСТЪП</div><h2>PRIME Клуб</h2><div class="membership-price">9 € <small>/ месец · ценова хипотеза</small></div><p>Предложение за бъдещия пилот. В прототипа няма активен абонамент или плащане.</p><div class="note-item">${icon('check',15)}Допълнителни одобрени голови селекции</div><div class="note-item">${icon('check',15)}Пълни аргументи и условия за оттегляне</div><div class="note-item">${icon('check',15)}Отделен частен Telegram канал</div><div class="note-item">${icon('check',15)}Внимателно подбрана двойка, когато е обоснована</div><button class="btn btn-white" id="preview-member">Виж примерния VIP изглед ${icon('arrow',16)}</button><p class="summary-small">Демонстрация без регистрация. Не се събират плащания. Този бутон не е система за защита на платено съдържание.</p></aside></div>
      <div class="section-head"><h2>Какво получаваш</h2><small>Качество преди количество</small></div><div class="comparison"><div><span class="chip">FREE</span><h3 class="top-margin">Завършен анализ.</h3><p>0–1 одобрени селекции за деня, когато има подходяща възможност. Основна теза, данни, риск, записана цена и отчет.</p></div><div><span class="chip vip">PRIME КЛУБ</span><h3 class="top-margin">Цялото издание.</h3><p>Обикновено до 1–3 допълнителни селекции, когато издържат същата проверка. Понякога нито една. Подробен контекст и актуализации в частния канал.</p></div></div>
      <div class="trust-strip"><h2>Доверието<br>се натрупва.</h2><p>Платеният пилот има смисъл след реален публичен архив и установен ежедневен процес. Цената и обемът са продуктови хипотези.</p><a href="#archive" class="text-link">Виж отчетността ${icon('arrow',16)}</a></div>`;
    $('#preview-member').addEventListener('click',()=>{member=true;location.hash='today';toast('VIP демонстрация. Няма активиран абонамент.');});
  }
  function packetText(fixtures){
    return `PRIME / RESEARCH PACKET\nДата на snapshot: ${D.date}\nЧасова зона: Europe/Sofia\nИзточник: OpenLigaDB, ODbL\nТип: проучване, без одобрени прогнози\n\nМИСИЯ\nПроучи тези срещи на български. Провери официални новини, отсъствия, вероятни състави, тактически промени и достъпна пазарна цена. Не превръщай историческите честоти в прогнозна вероятност. Не измисляй xG, контузии или котировки. За всеки актуален факт запиши URL, дата на източника и час на проверката. Разграничи факт, извод и неизвестно. Предложи голов пазар само ако футболният сценарий го подкрепя. Дай контрааргумент и условие за оттегляне. Ако информацията е недостатъчна: ИЗЧАКАЙ или ПРОПУСНИ.\n\nДАННИ\n${JSON.stringify(fixtures.map(f=>({fixture_id:f.id,kickoff_utc:f.kickoff_utc,competition:f.league,home:f.home.name,away:f.away.name,source_url:f.source_url,home_last10:f.home_stats,away_last10:f.away_stats,home_venue:f.home_venue,away_venue:f.away_venue,injuries:null,lineups:null,odds:null,xg:null})),null,2)}\n\nПакетът се отваря ръчно в ChatGPT. Няма автоматичен AI анализ или публикация.\n`;
  }
  function openPacket(fixtures){$('#packet-output').value=packetText(fixtures);$('#packet-dialog').showModal();}
  async function copyText(text){
    try{await navigator.clipboard.writeText(text);toast('Текстът е копиран.');}
    catch{const field=$('#packet-output');field.focus();field.select();toast('Автоматичното копиране е недостъпно. Избери текста и го копирай.');}
  }
  function download(name,text,type='application/json;charset=utf-8'){
    const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exampleReview(){
    const p=samplePicks[0],f=fById(p.fixture);
    return {kind:'demo_review',selections:[{fixture_id:f.id,market:p.market,access:'free',thesis:p.thesis,counterargument:p.risk,news_status:'not_checked',evidence:[{url:f.source_url,checked_at:D.fetched_utc}],quote:null}]};
  }
  function renderDesk(){
    $('#main').innerHTML=heading('ВЪТРЕШНА РЕДАКЦИЯ / ДЕМОНСТРАЦИЯ','От програма до издание.','Един пакет за проучване. Една проверка. Едно редакторско решение.',`<a href="#today" class="text-link">Читателски изглед ${icon('up',15)}</a>`)+demoNotice('Тук симулираш вътрешния процес. Няма връзка с Telegram, GitHub запис или истинско публикуване. Промените остават в този браузър.')+
      `<div class="desk-status"><div><b>${D.history_count.toLocaleString('bg-BG')}</b><span>Реални завършени мачове<br>2 лиги · 3 сезона</span></div><div><b>${todayFixtures.length} срещи</b><span>Програма за 23 октомври<br>OpenLigaDB snapshot</span></div><div><b>${reviewApproved?'Локално готово':'Чака проверка'}</b><span>Публикуване: изключено<br>AI: ръчно стартиране</span></div></div>
      <section class="analysis-card"><div class="desk-step"><span class="step-num">01</span><div><h2>Подготви футболното проучване</h2><p>Историята и програмата са заредени. Експортът включва фактите за срещите, първоизточниците и какво липсва. Създаването на пакет не е AI анализ.</p><div class="desk-actions"><button class="btn btn-primary" id="daily-packet">Пакет за ${todayFixtures.length} срещи ${icon('copy',14)}</button><button class="btn btn-outline" id="download-packet">Изтегли TXT ${icon('download',14)}</button></div></div></div></section>
      <section class="analysis-card"><div class="desk-step"><span class="step-num">02</span><div><h2>Прегледай върнатия анализ</h2><p>В реалната версия връщаш структурирания резултат от ChatGPT. Валидираме ID на мача, головия пазар, тезата, контрааргумента, източниците и цената. Тук се приема само демонстрационен JSON.</p><div class="desk-actions"><button class="btn btn-subtle" id="load-review">Зареди непълен пример</button><button class="btn btn-outline" id="load-complete">Зареди завършен демо пример</button></div><label class="code-label" for="review-json">Структуриран анализ / demo_review</label><textarea class="review-input" id="review-json" spellcheck="false" placeholder="Постави JSON анализа тук…">${esc(reviewText)}</textarea><div class="desk-actions"><button class="btn btn-primary" id="validate-review">Провери изданието ${icon('check',15)}</button></div><div id="validation-output" aria-live="polite">${validationMarkup()}</div></div></div></section>
      <section class="analysis-card"><div class="desk-step"><span class="step-num">03</span><div><h2>Одобри локалната демонстрация</h2><p>Одобрението създава един демонстрационен файл с дата и статус. Не добавя истински резултат в архива и не изпраща публикации.</p><div class="review-options"><label><input type="checkbox" id="review-check">Прегледах примерните аргументи, източници и цени. Разбирам, че са демонстрационни.</label></div><button class="btn btn-primary" id="approve-demo">Одобри и изтегли демо JSON ${icon('download',14)}</button><div id="approval-result" aria-live="polite">${reviewApproved?'<div class="validation good">Демонстрацията е одобрена локално. Публикуването остава изключено.</div>':''}</div></div></div></section>
      <section class="analysis-card"><h2>С какво започваме</h2><div class="audit-table"><div><span>Проверена наследена база</span><b>26 558 мача / 19 лиги</b></div><div><span>xG в наследената база</span><b>1 032 мача / 3,9%</b></div><div><span>Пълен точен join в стария календар</span><b>93 от 298 записа</b></div><div><span>Текущ свободен източник в прототипа</span><b>OpenLigaDB / ODbL</b></div><div><span>AI, новини и пазарни цени</span><b>Предстои ръчна проверка</b></div></div><p class="small top-margin">Предложената продукционна редакция е частна. VIP текстове и токени не се включват в публични HTML или JSON файлове. В този прототип всички примерни текстове са видими в изходния код.</p></section>`;
    $('#daily-packet').addEventListener('click',()=>openPacket(todayFixtures));
    $('#download-packet').addEventListener('click',()=>download('PRIME_RESEARCH_PACKET_2026-10-23.txt',packetText(todayFixtures),'text/plain;charset=utf-8'));
    $('#review-json').addEventListener('input',e=>{reviewText=e.target.value;validation=[];validationChecked=false;reviewApproved=false;$('#validation-output').innerHTML='';$('#approval-result').innerHTML='';});
    $('#load-review').addEventListener('click',()=>{reviewText=JSON.stringify(exampleReview(),null,2);validation=[];validationChecked=false;reviewApproved=false;renderDesk();});
    $('#load-complete').addEventListener('click',()=>{
      const obj=exampleReview();const s=obj.selections[0];s.news_status='reviewed';
      // example.com explicitly marks invented price evidence. Never a verified real quote.
      s.evidence.push({url:'https://example.com/DEMO-NOT-REAL-TEAM-NEWS',checked_at:D.fetched_utc});
      s.quote={decimal:1.85,url:'https://example.com/DEMO-NOT-REAL-ODDS',checked_at:D.fetched_utc};
      reviewText=JSON.stringify(obj,null,2);validation=[];validationChecked=false;reviewApproved=false;renderDesk();toast('Всички новини и цени в този пример са измислени.');
    });
    $('#validate-review').addEventListener('click',()=>{validateCurrent();$('#validation-output').innerHTML=validationMarkup();});
    $('#approve-demo').addEventListener('click',()=>{
      validateCurrent();$('#validation-output').innerHTML=validationMarkup();
      if(validation.length||!$('#review-check').checked){$('#approval-result').innerHTML='<div class="validation">Първо попълни анализа и отбележи редакторския преглед.</div>';return;}
      const payload={...JSON.parse(reviewText),approved_at:new Date().toISOString(),state:'approved_locally',publication_allowed:false,demo:true};
      saveLocal('prime-demo-edition',payload);reviewApproved=true;$('#approval-result').innerHTML='<div class="validation good">Демонстрацията е одобрена локално. Няма изпратени публикации.</div>';download('PRIME_DEMO_EDITION.json',JSON.stringify(payload,null,2));notifyLocal();
    });
  }
  function validateCurrent(){
    validationChecked=true;
    try{validation=Core.validateReview(JSON.parse(reviewText),D.fixtures.map(f=>f.id));}
    catch{validation=['Невалиден JSON. Зареди пример или коригирай синтаксиса.'];}
  }
  function validationMarkup(){return validation.length?`<div class="validation"><b>Изданието още не е готово.</b><br>${validation.map(esc).join('<br>')}</div>`:reviewText?`<div class="validation good">${validationChecked?'Структурата на демо анализа е валидна.':'Провери JSON с бутона „Провери изданието“.'} Техническата проверка не потвърждава верността на източниците.</div>`:'';}
  $('#device-toggle').addEventListener('click',()=>{const enabled=document.body.classList.toggle('phone-mode');$('#device-toggle').setAttribute('aria-pressed',String(enabled));$('#device-toggle').textContent=enabled?'Голям екран':'Телефон';});
  $('#editor-toggle').addEventListener('click',()=>{location.hash=location.hash==='#desk'?'today':'desk';});
  $('#close-dialog').addEventListener('click',()=>$('#packet-dialog').close());
  $('#copy-dialog').addEventListener('click',()=>copyText($('#packet-output').value));
  $('#packet-dialog').addEventListener('click',e=>{if(e.target===$('#packet-dialog')){const b=e.target.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)e.target.close();}});
  window.addEventListener('hashchange',route);
  route();
})();
