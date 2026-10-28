/* Small view controller for the separate, versioned selection rules. */
(function(root){
'use strict';
const S=root.MatchpulseCurated,C=root.MatchpulseScout;
const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=p=>Number.isFinite(p)?(100*p).toFixed(1)+'%':'—',price=p=>Number.isFinite(p)?p.toFixed(2):'—';
const stamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'неизвестен час';
const day=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const KEY='matchpulse-selection-quotes-v1';
let app=null,engine=null,tab='builders',period=1,limit=24,token=0,quotePromise=null,quoteDoc=null,quoteError=false,entries=[],items=[];
function readManual(){try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}}
let manual=readManual();
let band='3-6',columnEntries=null;const columnCache=new Map();
async function loadQuotes(){
 if(quoteDoc)return quoteDoc;
 if(!quotePromise)quotePromise=(root.SCOUT_EMBEDDED_DATA?Promise.resolve(root.SCOUT_EMBEDDED_DATA.selectionQuotes):
  fetch('data/selection_quotes.json?scout=1',{cache:'no-store',signal:AbortSignal.timeout(7000)}).then(r=>{if(!r.ok)throw Error('quotes');return r.json();}))
  .then(doc=>{if(doc?.schema!==1||!doc.fixtures||typeof doc.fixtures!=='object')throw Error('quotes schema');quoteDoc=doc;quoteError=false;return doc;})
  .catch(()=>{quoteError=true;return {schema:1,fixtures:{}};}).finally(()=>{quotePromise=null;});
 return quotePromise;
}
function quotesFor(f){
 const key=C.keyFixture(f),quotes={...(quoteDoc?.fixtures?.[key]||{})};
 for(const [id,q] of Object.entries(manual))if(id.startsWith(key+'::')&&q?.kind==='manual')quotes[id.slice(key.length+2)]=q;
 return quotes;
}
function fixtureHeader(f){
 return '<div class="selection-meta"><span>'+esc(f[2])+'</span><time>'+esc(f[3])+' · '+esc(f[4]||'—')+(String(f[13]||'').includes('Sofia')?'':'*')+'</time></div>'+
  '<h3 class="selection-teams">'+esc(f[5])+' <span>–</span> '+esc(f[6])+'</h3>';
}
function sourceText(q){
 return q.kind==='manual'?'Въведена от теб · '+stamp(q.observed_at_utc):
  (q.book||'CSV')+(q.column?' · '+q.column:'')+' · CSV прочит '+stamp(q.observed_at_utc)+
  (q.last_confirmed_at_utc&&q.last_confirmed_at_utc!==q.observed_at_utc?' · потвърдена '+stamp(q.last_confirmed_at_utc):'');
}
function quoteHTML(f,p){
 const q=p.quote,id=C.keyFixture(f)+'::'+p.id,stored=manual[id];
 const edge=q?.edge!==null&&q?.edge!==undefined?(q.edge>=0?'+':'')+(100*q.edge).toFixed(1)+'%':null;
 const text=q.status==='available'?'<span class="selection-price '+(q.aboveModel?'price-positive':q.edge<0?'price-negative':'')+'">Цена '+price(q.odds)+' · моделна разлика '+edge+'</span><small>'+esc(sourceText(q))+'</small>':
  q.status==='stale'?'<span class="selection-price">Стара / непотвърдена цена '+price(q.odds)+'</span><small>'+esc(sourceText(q))+' · без ценово предимство</small>':'<span class="selection-no-price">Няма налична пазарна цена</span>';
 return '<div class="selection-quote">'+text+'</div><details class="selection-compare"><summary>Сравни твоя цена</summary>'+
  '<label>Коефициент от букмейкъра<input type="text" inputmode="decimal" autocomplete="off" data-selection-input="'+esc(id)+'" aria-label="Коефициент за '+esc(p.label)+'" value="'+esc(stored?.odds??'')+'" placeholder="Напр. 1.85"></label>'+
  '<small>Запазва се на това устройство. Празно поле връща CSV цената.</small></details>';
}
function pickHTML(f,p,role){
 return '<div class="selection-pick '+(role==='Основна'?'selection-primary':'')+'" data-selection-market="'+esc(p.id)+'">'+
  '<div class="selection-pick-title"><span class="selection-role">'+role+'</span><strong>'+esc(p.label)+'</strong></div>'+
  '<div class="selection-metrics"><div><b>'+pct(p.probability)+'</b><span>Моделна вероятност</span></div><div><b>'+price(p.fair)+'</b><span>Честен коефициент</span></div></div>'+quoteHTML(f,p)+'</div>';
}
function whyHTML(entry,p){
 const e=p.evidence,f=entry.fixture,pp=(100*e.modelLift).toFixed(1);
 return '<details class="selection-why"><summary>Защо този избор</summary><p>Моделът дава '+pct(p.probability)+' спрямо '+pct(e.baseline)+' в лигата ('+e.leagueN+' предишни мача): '+(e.modelLift>=0?'+':'')+pp+' п.п.</p>'+
  '<p>В последните 10 налични срещи съответното събитие е подкрепено от '+esc(f[5])+': <b>'+e.home.hits+'/'+e.home.n+'</b>; '+esc(f[6])+': <b>'+e.away.hits+'/'+e.away.n+'</b>. Отборните голове и резултатите са ориентирани спрямо ролята на клуба в предстоящия мач.</p>'+
  '<p class="footnote">'+esc(f[5])+': '+e.home.start+' → '+e.home.end+' · '+esc(f[6])+': '+e.away.start+' → '+e.away.end+'. Само първенства.</p>'+
  (e.homeVenue.n>=4&&e.awayVenue.n>=4?'<p>Отделно домакинства / гостувания: '+e.homeVenue.hits+'/'+e.homeVenue.n+' и '+e.awayVenue.hits+'/'+e.awayVenue.n+'.</p>':'<p>Малка извадка от домакинства / гостувания; тя не добавя тежест.</p>')+
  '<p>Подредбата отчита по-слабата подкрепа от двата отбора и разминаването с модела. Това не е допълнителен процент увереност.</p></details>';
}
function actions(index){return '<div class="selection-actions"><button type="button" class="button secondary" data-selection-analysis="'+index+'">Анализ на мача</button><button type="button" class="button secondary" data-selection-copy="'+index+'">Копирай</button></div>';}
function planReason(entry,p){
 const e=p.evidence,f=entry.fixture;
 const personal=['1','2','X','1X','X2','home1','home2','away1','away2'].includes(p.id);
 const phrase=side=>p.id==='home1'?(side==='home'?'вкарва поне 1 гол':'допуска поне 1 гол'):p.id==='away1'?(side==='away'?'вкарва поне 1 гол':'допуска поне 1 гол'):root.MatchpulseAnalysis.eventText(p.id,side);
 const evidence=personal?f[5]+' '+phrase('home')+' в '+e.home.hits+'/'+e.home.n+' срещи; '+f[6]+' '+phrase('away')+' в '+e.away.hits+'/'+e.away.n+'.':
  'Събитието се среща в '+e.home.hits+'/'+e.home.n+' мача на '+f[5]+' и '+e.away.hits+'/'+e.away.n+' на '+f[6]+'.';
 return evidence+' Моделната оценка е над обичайната честота в лигата ('+pct(e.baseline)+').';
}
function planRisk(p){
 const risks={'1':'Равенството също проваля този избор.','2':'Равенството също проваля този избор.',X:'Нужен е точно равен резултат.',
  '1X':'Победа на госта проваля избора.',X2:'Победа на домакина проваля избора.','12':'Равенството проваля избора.',
  o15:'Мач с 0 или 1 гол проваля избора.',o25:'Нужни са поне 3 гола; 2 не стигат.',o35:'Нужни са поне 4 гола.',
  u25:'Третият гол проваля избора.',u35:'Четвъртият гол проваля избора.',btts:'Нужен е гол от всеки отбор.',bttsNo:'Гол от всеки отбор проваля избора.',
  home1:'Домакинът трябва да отбележи.',home2:'Един гол от домакина не стига.',away1:'Гостът трябва да отбележи.',away2:'Един гол от госта не стига.'};
 return (risks[p.id]||'Условията трябва да се изпълнят заедно.')+' Моделът оставя '+pct(1-p.probability)+' за неуспех.';
}
function planHTML(entry){
 const f=entry.fixture;
 return '<h3>Прогноза за мача</h3>'+(entry.main?
  (entry.main.quote.status==='available'&&entry.main.quote.edge<0?'<p class="selection-status selection-status-below">Наличната цена е под моделната · основна посока по данни</p>':'')+
  pickHTML(f,entry.main,'Основна')+'<p class="plan-explanation">'+esc(planReason(entry,entry.main))+'</p>'+
  '<p class="plan-risk"><strong>Къде е рискът:</strong> '+esc(planRisk(entry.main))+'</p>'+
  (entry.alternatives.length?'<details class="plan-alternatives"><summary>Алтернативи · '+entry.alternatives.length+'</summary><p class="footnote">Отделни варианти за този мач. Избираш един; не се събират автоматично в залог.</p><div class="selection-alternatives">'+entry.alternatives.map((p,i)=>'<div class="plan-alternative">'+pickHTML(f,p,'Алтернатива '+(i+1))+'<p class="plan-alternative-risk">'+esc(planRisk(p))+'</p></div>').join('')+'</div></details>':'<p class="footnote">Няма достатъчно различна подкрепа за алтернатива.</p>')+
  whyHTML(entry,entry.main):'<div class="selection-abstain"><strong>Без достатъчна основа за прогноза</strong><p>'+esc(entry.reason)+'</p></div>')+
  '<p class="footnote plan-method">Подбор по фиксирани 10 мача от първенствата; моделът използва до 30. Изборът 5/10/20 променя прочита и тенденциите. '+(quoteError?'CSV цените временно не са достъпни. ':'')+'Без проверена цена това е избор по данни.</p>'+
  '<button type="button" class="button secondary" data-plan-copy>Копирай прогнозата</button><span class="plan-feedback" role="status"></span>';
}
function evaluateFixture(f,now=new Date()){
 if(!engine)engine=S.createEngine(app.history,root.MatchpulseModel,C);
 const profile=app.archive.profile(f,{windowSize:10}),recent=app.archive.recentProfile(f,{windowSize:10,now});
 const unavailable=app.availability&&Object.values(app.availability).some(v=>!v);
 return engine.evaluate(f,{profile,quotes:quotesFor(f),now,pending:!!(unavailable||recent.home.pendingLatest||recent.away.pendingLatest)});
}
async function planFor(f){await loadQuotes();return evaluateFixture(f);}
async function renderMatchPlan(target,f){
 target.setAttribute('aria-busy','true');
 try{
  const entry=await planFor(f);if(!target.isConnected)return;
  target.innerHTML=planHTML(entry);target.setAttribute('aria-busy','false');
  target.querySelector('[data-plan-copy]').onclick=async()=>{
   const feedback=target.querySelector('.plan-feedback');
   try{await navigator.clipboard.writeText(planBrief(entry));feedback.textContent='Копирано';}catch{feedback.textContent='Браузърът не разреши копиране.';}
  };
  target.onchange=event=>changePrice(event,()=>renderMatchPlan(target,f),target.querySelector('.plan-feedback'));
  target.oninput=event=>{if(event.target.matches('[data-selection-input]'))event.target.setCustomValidity('');};
 }catch{
  if(target.isConnected){target.innerHTML='<h3>Прогноза за мача</h3><p>Прогнозата временно не може да се изчисли. Отвори мача отново.</p>';target.setAttribute('aria-busy','false');}
 }
}
function planBrief(entry){
 const f=entry.fixture;
 return ['ПРОГНОЗА ЗА МАЧА',f[5]+' – '+f[6],entry.main?'Основна: '+entry.main.label:'Без достатъчна основа за прогноза: '+entry.reason,
  ...[entry.main,...entry.alternatives].filter(Boolean).flatMap((p,i)=>[(i?'Алтернатива '+i+': '+p.label:planReason(entry,p)),
   'Моделна вероятност '+pct(p.probability)+' · честен коефициент '+price(p.fair),planRisk(p),
   p.quote.status==='available'?'Цена '+price(p.quote.odds)+' · моделна разлика '+(100*p.quote.edge).toFixed(1)+'% · '+sourceText(p.quote)+(p.quote.edge<0?' · цената е под моделната.':''):'Няма актуална пазарна цена.']),
  'Фиксирани последни 10 вътрешни срещи за подбора. Алтернативите са отделни идеи. '+S.VERSION+' · '+entry.generatedAt].join('\n');
}
function builderCard(item,index){
 return '<article class="card selection-card selection-builder" data-selection-fixture="'+esc(C.keyFixture(item.entry.fixture))+'">'+fixtureHeader(item.entry.fixture)+
  '<div class="selection-status">'+item.picks.length+(item.picks.length===1?' бет билдър':' бет билдъра')+' за този мач</div>'+
  '<div class="builder-variants">'+item.picks.map((p,i)=>'<section class="builder-variant">'+pickHTML(item.entry.fixture,p,'Вариант '+(i+1))+whyHTML(item.entry,p)+'</section>').join('')+'</div>'+
  '<p class="footnote">Всеки вариант е отделен билдър с две условия. Вероятността е за съвместното им изпълнение в този мач.</p>'+actions(index)+'</article>';
}
function columnCard(item,index){
 return '<article class="card selection-card selection-column" data-column-band="'+item.band+'"><div class="selection-meta"><span>Ниво '+item.bandLabel+'</span><time>'+item.date+'</time></div>'+
  '<h3>'+item.size+' мача <small>Вариант '+item.variant+'</small></h3><ol class="selection-legs">'+item.legs.map((l,i)=>'<li><button type="button" class="column-match" data-selection-leg="'+index+':'+i+'">'+esc(l.fixture[5])+' – '+esc(l.fixture[6])+'</button><span>'+esc(l.pick.label)+' <b>'+pct(l.pick.probability)+'</b></span></li>').join('')+'</ol>'+
  '<div class="selection-metrics"><div><b>'+pct(item.probability)+'</b><span>Приблизителна вероятност</span></div><div><b>'+price(item.fair)+'</b><span>Моделен общ коефициент</span></div></div>'+
  '<p class="footnote">Моделен ориентир при допускане за независимост. Общ букмейкърски коефициент за тази колонка не е проверен.</p>'+
  '<div class="selection-actions"><button type="button" class="button secondary" data-selection-copy="'+index+'">Копирай колонката</button></div></article>';
}
function brief(item){
 const now=new Date().toISOString();
 if(tab==='columns')return ['MATCHPULSE · ПРАВА КОЛОНКА · '+item.date+' · Ниво '+item.bandLabel,...item.legs.map(l=>l.fixture[5]+' – '+l.fixture[6]+' | '+l.pick.label+' | '+pct(l.pick.probability)),
  'Приблизителна обща вероятност: '+pct(item.probability),'Моделен общ коефициент: '+price(item.fair),'Допускане: независимост между мачовете. Общ букмейкърски коефициент не е проверен.',S.VERSION+' · '+now].join('\n');
 const entry=item.entry,chosen=item.picks,f=entry.fixture;
 return ['MATCHPULSE · БЕТ БИЛДЪРИ',f[5]+' – '+f[6],f[2]+' · '+f[3]+' '+f[4],
  ...chosen.flatMap((p,i)=>['Вариант '+(i+1)+': '+p.label,'Моделна вероятност: '+pct(p.probability)+' · честен коефициент '+price(p.fair),
   p.quote.status==='available'?'Цена '+price(p.quote.odds)+' · '+sourceText(p.quote)+' · моделна разлика '+(100*p.quote.edge).toFixed(1)+'%':'Няма актуална пазарна цена.',
   'Подкрепа в последните 10: '+p.evidence.home.hits+'/'+p.evidence.home.n+' и '+p.evidence.away.hits+'/'+p.evidence.away.n+'; лига '+pct(p.evidence.baseline)+' от '+p.evidence.leagueN+'.']),
  'Всеки вариант е отделен билдър. Съвместна вероятност от резултатната матрица.',S.VERSION+' · '+entry.generatedAt].join('\n');
}
function paint(){
 const kind=el('selectionQuality').value;
 const builderKeys=new Set();
 const builders=entries.map(entry=>({entry,picks:entry.builders.filter(p=>kind!=='price'||p.quote.aboveModel)})).filter(item=>{
  const key=C.keyFixture(item.entry.fixture);if(!item.picks.length||builderKeys.has(key))return false;builderKeys.add(key);return true;
 });
 let columns=[];
 if(tab==='columns'){
  if(columnEntries!==entries){columnEntries=entries;columnCache.clear();}
  if(!columnCache.has(kind))columnCache.set(kind,S.columns(entries,C,{priceOnly:kind==='price'}));
  columns=columnCache.get(kind);
 }
 items=tab==='builders'?builders:columns.filter(c=>c.band===band);
 el('columnBands').classList.toggle('hidden',tab!=='columns');
 document.querySelectorAll('[data-selection-band]').forEach(button=>{
  const selected=button.dataset.selectionBand===band;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('active',selected);
  button.querySelector('.band-count').textContent=String(columns.filter(c=>c.band===button.dataset.selectionBand).length);
 });
 const main=entries.filter(e=>e.main).length;
 el('selectionSummary').textContent=entries.length+' мача прегледани · '+(tab==='builders'?builders.length+' мача с '+builders.reduce((n,b)=>n+b.picks.length,0)+' билдъра':items.length+' колонки · ниво '+S.BANDS.find(b=>b.id===band).label);
 el('selectionQuoteStatus').textContent=quoteError?'CSV цените не се заредиха. Можеш да въведеш собствена цена.':
  (quoteDoc?.checked_at_utc?'Последна CSV проверка: '+stamp(quoteDoc.checked_at_utc)+'. Часът на букмейкърската оферта е неизвестен.':'Няма запазена CSV проверка.');
 el('selectionTabNote').textContent=tab==='builders'?'До два различни бет билдъра в една карта за мача. Основната прогноза и алтернативите са в неговия анализ.':
  'Три нива по моделен общ коефициент. До 6 варианта на ниво и дата, с 2–8 различни мача. По-високият коефициент означава по-малка моделна вероятност.'+
  (kind==='price'?' Всяка отделна селекция има цена над моделната; обща цена за колонката не е потвърдена.':'');
 el('selectionList').innerHTML=items.length?items.slice(0,limit).map((item,i)=>tab==='builders'?builderCard(item,i):columnCard(item,i)).join(''):
  '<div class="empty">'+(tab==='builders'?'Няма бет билдъри с достатъчна обща подкрепа.':'Няма достатъчно различни мачове с подходящи селекции за това ниво.')+(entries.length&&!main?' Прогнозите и причините за въздържане са в анализите на отделните мачове.':'')+'</div>';
 el('selectionMore').classList.toggle('hidden',items.length<=limit);el('selectionMore').textContent='Покажи още · '+Math.min(limit,items.length)+' от '+items.length;
 el('selectionList').setAttribute('aria-busy','false');
}
async function render(){
 if(!app)return;
 if(app.availability&&Object.values(app.availability).some(v=>!v)){
  el('selectionSummary').textContent='Селекциите изчакват допълнителните данни.';
  el('selectionList').innerHTML='<div class="empty">Програмата и анализът са достъпни. За надежден подбор е нужна и проверката за по-нови неприключили срещи. Презареди страницата, за да опиташ отново.</div>';
  el('selectionList').setAttribute('aria-busy','false');return;
 }
 const request=++token,now=new Date();
 el('selectionList').setAttribute('aria-busy','true');el('selectionSummary').textContent='Преглеждам наличните срещи…';
 try{
  await loadQuotes();if(request!==token)return;
  if(!engine)engine=S.createEngine(app.history,root.MatchpulseModel,C);
  const start=day(now),end=new Date(start+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+period-1);
  const last=end.toISOString().slice(0,10),league=el('selectionLeague').value,search=el('selectionSearch').value.trim().toLocaleLowerCase();
  const rows=C.getUpcoming(app.fixtures,now).filter(f=>f[3]>=start&&f[3]<=last&&(!league||f[0]===league)&&
   (!search||[f[5],f[6],f[2]].some(v=>String(v).toLocaleLowerCase().includes(search))));
  const next=[];
  for(let i=0;i<rows.length;i++){
   if(i%6===0){el('selectionSummary').textContent='Преглеждам срещите: '+i+' / '+rows.length+'…';await new Promise(resolve=>setTimeout(resolve,0));if(request!==token)return;}
   next.push(evaluateFixture(rows[i],now));
  }
  if(request!==token)return;entries=next;paint();
 }catch(error){
  if(request!==token)return;
  el('selectionSummary').textContent='Подборът не можа да се изчисли.';
  el('selectionList').innerHTML='<div class="empty">Презареди страницата, за да опиташ отново.</div>';
  el('selectionList').setAttribute('aria-busy','false');console.error('Selection view',error);
 }
}
function mount(context){
 app=context;engine=null;
 const mobileFilters=root.matchMedia('(max-width:550px)');
 el('selectionFilters').open=!mobileFilters.matches;
 mobileFilters.addEventListener('change',event=>{el('selectionFilters').open=!event.matches;});
 const leagues=new Map(app.fixtures.map(f=>[f[0],root.MatchpulseHealth.leagueLabel(f)]));
 el('selectionLeague').innerHTML='<option value="">Всички състезания</option>'+[...leagues].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');
 const tabs=[...document.querySelectorAll('[data-selection-tab]')];
 tabs.forEach((button,i)=>{
  button.id='selectionTab-'+button.dataset.selectionTab;button.tabIndex=i===0?0:-1;
  button.onclick=()=>{
   tab=button.dataset.selectionTab;limit=24;tabs.forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});
   el('selectionList').setAttribute('aria-labelledby',button.id);
   if(entries.length||el('selectionList').getAttribute('aria-busy')!=='true')paint();
  };
  button.onkeydown=event=>{
   const move={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
   if(move===undefined)return;event.preventDefault();tabs[move].focus();tabs[move].click();
  };
 });
 el('selectionList').setAttribute('aria-labelledby',tabs[0].id);
 document.querySelectorAll('[data-selection-band]').forEach(button=>button.onclick=()=>{band=button.dataset.selectionBand;limit=24;paint();});
 document.querySelectorAll('[data-selection-period]').forEach(button=>button.onclick=()=>{
  period=+button.dataset.selectionPeriod;limit=24;
  document.querySelectorAll('[data-selection-period]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();
 });
 const filterSummary=()=>{
  const count=Number(!!el('selectionLeague').value)+Number(!!el('selectionSearch').value.trim())+Number(el('selectionQuality').value!=='all');
  el('selectionFilterSummary').textContent='Филтри'+(count?' · '+count+' активни':'');
 };
 for(const id of ['selectionLeague','selectionSearch'])el(id).addEventListener(id==='selectionSearch'?'input':'change',()=>{limit=24;filterSummary();render();});
 el('selectionQuality').onchange=()=>{limit=24;filterSummary();paint();};
 el('selectionMore').onclick=()=>{limit+=24;paint();};
 el('selectionRetryQuotes').onclick=()=>{quoteDoc=null;render();};
 el('selectionList').addEventListener('click',async event=>{
  const analysis=event.target.closest('[data-selection-analysis]'),copy=event.target.closest('[data-selection-copy]');
  if(analysis){const item=items[+analysis.dataset.selectionAnalysis];app.openMatch(tab==='builders'?item.entry.fixture:item.fixture);}
  const leg=event.target.closest('[data-selection-leg]');if(leg){const [i,j]=leg.dataset.selectionLeg.split(':').map(Number);app.openMatch(items[i].legs[j].fixture);}
  if(copy){
   try{await navigator.clipboard.writeText(brief(items[+copy.dataset.selectionCopy]));el('selectionFeedback').textContent='Копирано ✓';}
   catch{el('selectionFeedback').textContent='Браузърът не разреши копиране.';}
  }
 });
 el('selectionList').addEventListener('change',event=>changePrice(event,render,el('selectionFeedback')));
 el('selectionList').addEventListener('input',event=>{if(event.target.matches('[data-selection-input]'))event.target.setCustomValidity('');});
}
function changePrice(event,changed,feedback){
  const input=event.target.closest('[data-selection-input]');if(!input)return;
  const text=input.value.trim().replace(',','.'),odds=Number(text),key=input.dataset.selectionInput;
  if(text&&(!Number.isFinite(odds)||odds<=1||odds>1000)){input.setCustomValidity('Въведи коефициент над 1 и до 1000, например 1.85.');input.reportValidity();return;}
  input.setCustomValidity('');
  if(text)manual[key]={odds,kind:'manual',book:'Въведена от теб',observed_at_utc:new Date().toISOString()};else delete manual[key];
  try{localStorage.setItem(KEY,JSON.stringify(manual));feedback.textContent='Цената е запазена на това устройство.';}
  catch{feedback.textContent='Сравнението е приложено само за тази сесия.';}
  changed();
}
root.MatchpulseSelectionUI={mount,render,planFor,renderMatchPlan,planBrief,reloadManualPrices(){manual=readManual();}};
})(window);
