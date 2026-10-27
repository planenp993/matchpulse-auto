/* Small view controller for the separate, versioned selection rules. */
(function(root){
'use strict';
const S=root.MatchpulseSelections,C=root.MatchpulseScout;
const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=p=>Number.isFinite(p)?(100*p).toFixed(1)+'%':'—',price=p=>Number.isFinite(p)?p.toFixed(2):'—';
const stamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'неизвестен час';
const day=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const KEY='matchpulse-selection-quotes-v1';
let app=null,engine=null,tab='matches',period=1,limit=24,token=0,quotePromise=null,quoteDoc=null,quoteError=false,entries=[],items=[];
function readManual(){try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}}
let manual=readManual();
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
  (q.book||'CSV')+(q.column?' · '+q.column:'')+' · CSV прочит '+stamp(q.observed_at_utc);
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
function matchCard(entry,index){
 const f=entry.fixture;
 return '<article class="card selection-card '+(!entry.main?'selection-unavailable':'')+'" data-selection-fixture="'+esc(C.keyFixture(f))+'">'+fixtureHeader(f)+
  (entry.main?'<div class="selection-status">'+(entry.main.quote.aboveModel?'Налична цена над моделната':'Основен избор по данни')+'</div>'+pickHTML(f,entry.main,'Основна')+
   '<div class="selection-alternatives">'+entry.alternatives.map((p,i)=>pickHTML(f,p,'Алтернатива '+(i+1))).join('')+'</div>'+
   (entry.alternatives.length<2?'<p class="footnote">'+(entry.alternatives.length?'Втора алтернатива':'Алтернативи')+' без достатъчна различна подкрепа.</p>':'')+
   whyHTML(entry,entry.main):'<div class="selection-abstain"><strong>Без основна селекция</strong><p>'+esc(entry.reason)+'</p></div>')+
  actions(index)+'</article>';
}
function builderCard(item,index){
 return '<article class="card selection-card selection-builder">'+fixtureHeader(item.entry.fixture)+'<div class="selection-status">Бет билдър · 2 условия в един мач</div>'+
  pickHTML(item.entry.fixture,item.pick,'Комбинация')+'<p class="footnote">Вероятността отчита връзката между условията чрез общите точни резултати.</p>'+
  whyHTML(item.entry,item.pick)+actions(index)+'</article>';
}
function columnCard(item,index){
 return '<article class="card selection-card selection-column"><div class="selection-meta"><span>Права колонка</span><time>'+item.date+'</time></div>'+
  '<h3>'+item.size+' мача</h3><ol class="selection-legs">'+item.legs.map(l=>'<li><strong>'+esc(l.fixture[5])+' – '+esc(l.fixture[6])+'</strong><span>'+esc(l.pick.label)+' <b>'+pct(l.pick.probability)+'</b></span></li>').join('')+'</ol>'+
  '<div class="selection-metrics"><div><b>'+pct(item.probability)+'</b><span>Приблизителна вероятност</span></div><div><b>'+price(item.fair)+'</b><span>Честен коефициент</span></div></div>'+
  '<p class="footnote">Допускане за независимост между мачовете. Няма потвърдена обща букмейкърска цена.</p>'+
  '<div class="selection-actions"><button type="button" class="button secondary" data-selection-copy="'+index+'">Копирай колонката</button></div></article>';
}
function brief(item){
 const now=new Date().toISOString();
 if(tab==='columns')return ['MATCHPULSE · ПРАВА КОЛОНКА · '+item.date,...item.legs.map(l=>l.fixture[5]+' – '+l.fixture[6]+' | '+l.pick.label+' | '+pct(l.pick.probability)),
  'Приблизителна обща вероятност: '+pct(item.probability),'Честен коефициент: '+price(item.fair),'Допускане: независимост между мачовете. Обща букмейкърска цена не е проверена.',S.VERSION+' · '+now].join('\n');
 const entry=tab==='builders'?item.entry:item,chosen=tab==='builders'?[item.pick]:[entry.main,...entry.alternatives].filter(Boolean),f=entry.fixture;
 return ['MATCHPULSE · '+(tab==='builders'?'БЕТ БИЛДЪР':'СЕЛЕКЦИИ'),f[5]+' – '+f[6],f[2]+' · '+f[3]+' '+f[4],
  ...chosen.flatMap((p,i)=>[(tab==='builders'?'Комбинация':i?'Алтернатива '+i:'Основна')+': '+p.label,
   'Моделна вероятност: '+pct(p.probability)+' · честен коефициент '+price(p.fair),
   p.quote.status==='available'?'Цена '+price(p.quote.odds)+' · '+sourceText(p.quote)+' · моделна разлика '+(100*p.quote.edge).toFixed(1)+'%':'Няма актуална пазарна цена.',
   'Подкрепа в последните 10: '+p.evidence.home.hits+'/'+p.evidence.home.n+' и '+p.evidence.away.hits+'/'+p.evidence.away.n+'; лига '+pct(p.evidence.baseline)+' от '+p.evidence.leagueN+'.']),
  entry.reason,'Подбор по 10 вътрешни срещи; моделът използва до 30. Моделните цени са оценки; ценовата разлика не е доказана доходност.',
  tab==='builders'?'Съвместна вероятност от резултатната матрица.':'Алтернативите са отделни идеи за същия мач.',S.VERSION+' · '+entry.generatedAt].filter(Boolean).join('\n');
}
function paint(){
 const kind=el('selectionQuality').value;
 const visible=entries.filter(e=>kind==='all'||kind==='main'&&e.main||kind==='price'&&e.main?.quote.aboveModel);
 items=tab==='matches'?visible:tab==='builders'?visible.flatMap(entry=>entry.builders.map(pick=>({entry,pick}))):S.columns(visible,C);
 const main=entries.filter(e=>e.main).length;
 el('selectionSummary').textContent=entries.length+' мача · '+main+' с основна селекция · '+(entries.length-main)+' без ясен избор';
 el('selectionQuoteStatus').textContent=quoteError?'CSV цените не се заредиха. Можеш да въведеш собствена цена.':
  (quoteDoc?.checked_at_utc?'Последна CSV проверка: '+stamp(quoteDoc.checked_at_utc)+'. Часът на букмейкърската оферта е неизвестен.':'Няма запазена CSV проверка.');
 el('selectionTabNote').textContent=tab==='matches'?'Избор по данни · основна прогноза и до две различни алтернативи.':
  tab==='builders'?'До два съвместими варианта за мач. Показани: '+items.length+'.':'Колонки с 2, 3 или 4 мача за една дата. Различните колонки могат да споделят селекции.';
 el('selectionList').innerHTML=items.length?items.slice(0,limit).map((item,i)=>tab==='matches'?matchCard(item,i):tab==='builders'?builderCard(item,i):columnCard(item,i)).join(''):
  '<div class="empty">'+(tab==='matches'?'Няма мачове за избраните дата и филтри.':tab==='builders'?'Няма бет билдъри с достатъчна обща подкрепа.':'Няма достатъчно различни мачове с подходящи основни селекции за колонка.')+'</div>';
 el('selectionMore').classList.toggle('hidden',items.length<=limit);
 el('selectionMore').textContent='Покажи още · '+Math.min(limit,items.length)+' от '+items.length;
 el('selectionList').setAttribute('aria-busy','false');
}
async function render(){
 if(!app)return;
 const request=++token,now=new Date();
 el('selectionList').setAttribute('aria-busy','true');el('selectionSummary').textContent='Преглеждам наличните срещи…';
 try{
  await loadQuotes();if(request!==token)return;
  const start=day(now),end=new Date(start+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+period-1);
  const last=end.toISOString().slice(0,10),league=el('selectionLeague').value,search=el('selectionSearch').value.trim().toLocaleLowerCase();
  const rows=C.getUpcoming(app.fixtures,now).filter(f=>f[3]>=start&&f[3]<=last&&(!league||f[0]===league)&&
   (!search||[f[5],f[6],f[2]].some(v=>String(v).toLocaleLowerCase().includes(search))));
  const next=[];
  for(let i=0;i<rows.length;i++){
   if(i%6===0){el('selectionSummary').textContent='Преглеждам срещите: '+i+' / '+rows.length+'…';await new Promise(resolve=>setTimeout(resolve,0));if(request!==token)return;}
   const f=rows[i],profile=app.archive.profile(f,{windowSize:10}),recent=app.archive.recentProfile(f,{windowSize:10,now});
   next.push(engine.evaluate(f,{profile,quotes:quotesFor(f),now,pending:!!(recent.home.pendingLatest||recent.away.pendingLatest)}));
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
 app=context;engine=S.createEngine(app.history,root.MatchpulseModel,C);
 const leagues=new Map(app.fixtures.map(f=>[f[0],f[2]]));
 el('selectionLeague').innerHTML='<option value="">Всички състезания</option>'+[...leagues].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');
 document.querySelectorAll('[data-selection-tab]').forEach(button=>button.onclick=()=>{
  tab=button.dataset.selectionTab;limit=24;document.querySelectorAll('[data-selection-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===button)));
  if(entries.length||el('selectionList').getAttribute('aria-busy')!=='true')paint();
 });
 document.querySelectorAll('[data-selection-period]').forEach(button=>button.onclick=()=>{
  period=+button.dataset.selectionPeriod;limit=24;
  document.querySelectorAll('[data-selection-period]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();
 });
 for(const id of ['selectionLeague','selectionSearch'])el(id).addEventListener(id==='selectionSearch'?'input':'change',()=>{limit=24;render();});
 el('selectionQuality').onchange=()=>{limit=24;paint();};
 el('selectionMore').onclick=()=>{limit+=24;paint();};
 el('selectionRetryQuotes').onclick=()=>{quoteDoc=null;render();};
 el('selectionList').addEventListener('click',async event=>{
  const analysis=event.target.closest('[data-selection-analysis]'),copy=event.target.closest('[data-selection-copy]');
  if(analysis){const item=items[+analysis.dataset.selectionAnalysis];app.openMatch(tab==='builders'?item.entry.fixture:item.fixture);}
  if(copy){
   try{await navigator.clipboard.writeText(brief(items[+copy.dataset.selectionCopy]));el('selectionFeedback').textContent='Копирано ✓';}
   catch{el('selectionFeedback').textContent='Браузърът не разреши копиране.';}
  }
 });
 el('selectionList').addEventListener('change',event=>{
  const input=event.target.closest('[data-selection-input]');if(!input)return;
  const text=input.value.trim().replace(',','.'),odds=Number(text),key=input.dataset.selectionInput;
  if(text&&(!Number.isFinite(odds)||odds<=1||odds>1000)){input.setCustomValidity('Въведи коефициент над 1 и до 1000, например 1.85.');input.reportValidity();return;}
  input.setCustomValidity('');
  if(text)manual[key]={odds,kind:'manual',book:'Въведена от теб',observed_at_utc:new Date().toISOString()};else delete manual[key];
  try{localStorage.setItem(KEY,JSON.stringify(manual));el('selectionFeedback').textContent='Цената е запазена на това устройство.';}
  catch{el('selectionFeedback').textContent='Сравнението е приложено само за тази сесия.';}
  render();
 });
 el('selectionList').addEventListener('input',event=>{if(event.target.matches('[data-selection-input]'))event.target.setCustomValidity('');});
}
root.MatchpulseSelectionUI={mount,render};
})(window);
