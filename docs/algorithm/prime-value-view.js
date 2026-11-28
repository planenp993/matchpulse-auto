import { RULE, FAMILIES, valueFixtures, normalizePair, assessPair, rankValue, sealValuePick, valueSettlement, valueStats } from './prime-value-v1.js?v=efe32f5efcfb';
import { parseOdds } from './value-check.js?v=0eece3b97e02';
import { LEAGUE_BY_ID, sofiaDate } from './catalog.js?v=9880ec988a17';

const STORE='prime-value-personal-v1';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,n=1)=>v==null?'—':new Intl.NumberFormat('bg-BG',{minimumFractionDigits:n,maximumFractionDigits:n}).format(v);
const pct=v=>v==null?'—':number(v*100)+'%';
const signed=(v,n=1)=>v==null?'—':(v>0?'+':'')+number(v,n);
const price=v=>number(v,2);
const dt=(t,opts)=>new Intl.DateTimeFormat('bg-BG',{timeZone:'Europe/Sofia',...opts}).format(new Date(t));
const clock=t=>dt(t,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dayText=d=>dt(d+'T12:00:00Z',{day:'numeric',month:'short',year:'numeric'});
const when=t=>dt(t,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const labels={over_2_5:'Над 2,5',under_2_5:'Под 2,5',btts_yes:'Гол/Гол Да',btts_no:'Гол/Гол Не'};
const reason={
  pass:'Покрива тестовия филтър',price:'Извън 1,70–2,00',margin:'Нетипичен марж / провери двойката',
  models:'Липсва модел',agreement:'Моделите се разминават',market_gap:'Голяма разлика с пазара',
  direction:'Липсва подкрепа от двата модела',edge:'Под тестовия праг +2%'
};
const statusText={
  no_quotes:'Няма свежи потвърдени двойки коефициенти.',no_models:'Няма допустими мачове с две моделни оценки.',
  no_pass:'Проверените цени не покриват тестовите условия.',selected:'Има запечатани предмачови избори.',
  full:'Дневният лимит е достигнат.',already_recorded:'Всички подходящи мачове вече са записани.',
  stale:'Прогнозите са остарели; нови избори са спрени.',release:'Версията на модела е променена; тестът е спрян.',
  fingerprint:'Формулите са променени; тестът е спрян до нова версия.'
};
const league=f=>LEAGUE_BY_ID[f.league]?.name??f.league;
const team=f=>f.home+' – '+f.away;
const metric=(v,name)=>'<article class="metric"><strong>'+esc(v)+'</strong><small>'+esc(name)+'</small></article>';
const origin={csv:'CSV засечка',published:'Публикувана засечка',owner:'Ръчна публична засечка',manual:'Твоя локална засечка'};

function pickCard(p){
  const result=p.result;
  const state=result?.state;
  const outcome=state==='hit'?'✓ Позната':state==='miss'?'× Пропуск':state==='review'?'За сверка':'Чака резултат';
  const score=result?.score?' · '+result.score.join(':'):'';
  return '<article class="pv-card"><div class="pv-card-top"><small>'+esc(league(p.fixture))+' · '+esc(clock(p.fixture.kickoff))+
    '</small><span class="market-chip">'+labels[p.key]+'</span></div><h3>'+esc(team(p.fixture))+'</h3>'+
    '<div class="pv-main-values"><div><strong>'+price(p.price)+'</strong><small>реална цена</small></div><div><strong>'+pct(p.p)+
    '</strong><small>Prime Value</small></div><div><strong>'+signed(p.edge*100)+'%</strong><small>моделна стойност</small></div></div>'+
    '<div class="pv-estimates"><span>Пазар <b>'+pct(p.market)+'</b></span><span>Prime <b>'+pct(p.prime)+
    '</b></span><span>Положения <b>'+pct(p.chances)+'</b></span></div>'+
    '<small class="muted">'+esc(p.pair.source)+' · '+esc(origin[p.pair.kind]??'Засечка')+' · '+esc(when(p.pair.seen))+
    ' · срещуположен '+price(p.opposite)+'</small><small class="muted">Запис: '+esc(when(p.at))+' ч.</small>'+
    '<div class="pv-outcome '+(state==='hit'?'result-hit':state==='miss'?'result-miss':'')+'">'+outcome+esc(score)+
    (state==='review'?' · Промяна на час или разминаване':'')+'</div></article>';
}
function statsHtml(s){
  return metric(s.recorded,'Записани')+metric(s.settled,'Приключили')+metric(pct(s.hitRate),'Успеваемост · '+s.hits+'/'+s.settled)+
    metric(s.roi===null?'—':signed(s.roi*100)+'%','Тестова доходност')+metric(s.profit===null?'—':signed(s.profit,2),'Резултат · единици')+
    metric(price(s.averageOdds),'Средна цена');
}
function brierText(s){
  if(!s.brier)return 'Сравнението с пазара ще се появи при потвърдени крайни резултати.';
  return 'Грешка Brier (по-ниска е по-добре) · Prime Value '+number(s.brier.p,4)+' · пазар '+number(s.brier.market,4)+
    ' · Prime '+number(s.brier.prime,4)+' · положения '+number(s.brier.chances,4)+'. Еднаква извадка от '+s.settled+' избора.';
}
function readLocal(){
  try{
    const raw=localStorage.getItem(STORE);
    if(!raw)return {available:true,picks:[]};
    const saved=JSON.parse(raw);
    if(saved.schema!==1||!Array.isArray(saved.picks))throw Error('local schema');
    const seen=[],ids=new Set();
    for(const p of saved.picks){
      const t=Date.parse(p.at);
      if(!Number.isFinite(t)||p.mode!=='personal'||p.day!==sofiaDate(t)||ids.has(p.id)||
          p.id!==p.day+'/'+p.fixture.id||p.pair.kind!=='manual'||!(Date.parse(p.snapshotAt)<=t&&t-Date.parse(p.snapshotAt)<=RULE.forecastAgeMs&&Date.parse(p.fixture.issued)<=Date.parse(p.snapshotAt)))
        throw Error('local record');
      const row=assessPair(p.fixture,p.family,p.pair,t).find(r=>r.key===p.key&&r.reason==='pass');
      const expected=row&&rankValue([row],seen,p.day)[0];
      if(!expected||JSON.stringify(sealValuePick(expected,p.at,p.snapshotAt,'personal'))!==JSON.stringify(p))throw Error('local rule');
      seen.push(p);ids.add(p.id);
    }
    return {available:true,picks:seen};
  }catch{return {available:false,picks:[]};}
}
const dayCards=(picks,limit=30)=>{
  const groups=new Map();
  for(const p of picks.slice().reverse().sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit)){
    const rows=groups.get(p.day)??[];rows.push(p);groups.set(p.day,rows);
  }
  return [...groups].map(([day,rows])=>'<section class="pv-day"><h3>'+esc(dayText(day))+' · '+rows.length+'</h3><div class="pv-grid">'+rows.map(pickCard).join('')+'</div></section>').join('');
};

// No manual data is transmitted. The public log is fetched independently.
export function createPrimeValueView({getContext,loadPublic,loadDay}){
  let publicState=null, publicError=false, latestRequest=0, refreshing=false, publicLimit=30;
  let personal=readLocal(), localResults=new Map(), localRefresh=0;
  const drafts=new Map();
  let pool=null;

  function currentPool(now=Date.now()){
    const context=getContext();
    if(!context?.snapshot||!context.fitted||!context.euroFitted)return null;
    return valueFixtures(context.snapshot,context.fitted,context.euroFitted,now);
  }
  function isPaused(){
    return !publicState||publicError||['fingerprint','release'].includes(publicState.latest?.status)||
      !(Date.parse(publicState.createdAt)<=Date.now())||
      publicState.rule?.version!==RULE.version||publicState.rule?.release!==RULE.release;
  }
  function renderPublic(){
    const s=publicState;
    if(!s){
      $('pv-status').textContent=publicError?'Публичният дневник временно не е достъпен. Натисни „Обнови“.':'Зареждане на публичния тест…';
      return;
    }
    const day=sofiaDate(Date.now()), today=s.picks.filter(p=>p.day===day);
    $('pv-status').textContent=publicError?'Показваме последния достъпен дневник.':
      s.latest?.day!==day?'Изчакваме първата автоматична проверка за днес.':statusText[s.latest.status]??'Проверка';
    $('pv-asof').textContent=s.latest?'Проверено на '+when(s.latest.at)+' ч. · автоматично':'Регистриран тест от '+when(s.createdAt)+' ч.';
    $('pv-today-count').textContent=today.length+' / '+RULE.cap;
    const c=s.latest?.day===day?s.latest.counts:null;
    $('pv-coverage').textContent=c?c.scheduled+' предстоящи · '+c.twoModels+' с две оценки · '+c.quotedPairs+
      ' свежи двойки · '+c.qualified+' подходящи мача':'Очакваме текущата проверка.';
    $('pv-today').innerHTML=today.length?today.map(pickCard).join(''):'<div class="empty">Няма записан публичен избор за днес. Не допълваме насила.</div>';
    $('pv-public-stats').innerHTML=statsHtml(s.stats);
    $('pv-public-brier').textContent=brierText(s.stats);
    $('pv-days-summary').textContent=s.days.length+' наблюдавани дни · '+s.days.filter(d=>!d.selected).length+
      ' дни без избор · '+s.stats.pending+' чакат резултат · '+s.stats.review+' за сверка';
    $('pv-day-log').innerHTML=s.days.slice(0,30).map(d=>'<div class="pv-day-line"><b>'+esc(dayText(d.day))+
      '</b><span>'+d.quotedPairs+' свежи двойки · '+d.selected+' избора</span></div>').join('')||
      '<p class="muted">Още няма автоматична проверка.</p>';
    $('pv-public-diary').innerHTML=dayCards(s.picks,publicLimit)||'<div class="empty">Дневникът започва от старта на теста. Няма ретроспективно добавени прогнози.</div>';
    $('pv-more').hidden=s.picks.length<=publicLimit;
  }
  function updateMarketInputs(){
    const fixture=pool?.fixtures.find(f=>f.id===$('pv-fixture').value);
    const prior=$('pv-family').value;
    $('pv-family').innerHTML=(fixture?.families??[]).map(f=>'<option value="'+f+'">'+(f==='over_2_5'?'Над / Под 2,5':'Гол/Гол Да / Не')+'</option>').join('');
    if(fixture?.families.includes(prior))$('pv-family').value=prior;
    const family=$('pv-family').value||'over_2_5', keys=FAMILIES[family];
    $('pv-first-label').textContent=labels[keys[0]];
    $('pv-other-label').textContent=labels[keys[1]];
    $('pv-model-preview').textContent=fixture?labels[keys[0]]+' · Prime '+pct(fixture.prime[keys[0]])+' · положения '+pct(fixture.chances[keys[0]]):'Няма допустима среща.';
  }
  function renderForm(){
    pool=currentPool();
    const previous=$('pv-fixture').value;
    const disabled=!pool||pool.status!=='ready'||isPaused()||!personal.available;
    const fixtures=disabled?[]:pool.fixtures.slice().sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||team(a).localeCompare(team(b)));
    $('pv-fixture').innerHTML=fixtures.length?fixtures.map(f=>'<option value="'+esc(f.id)+'">'+esc(clock(f.kickoff)+' · '+team(f))+'</option>').join(''):
      '<option value="">Няма налични мачове</option>';
    if(fixtures.some(f=>f.id===previous))$('pv-fixture').value=previous;
    $('pv-form').querySelectorAll('input,select,button').forEach(el=>el.disabled=disabled||!fixtures.length);
    updateMarketInputs();
    $('pv-local-note').textContent=!personal.available?'Локалното хранилище е недостъпно или записът не може да се провери. Не записваме нови данни.':
      isPaused()?'Изчакваме проверена версия на публичния тест.':
      !pool||pool.status!=='ready'?'Изчакваме актуални предмачови прогнози.':
      fixtures.length+' допустими мача с двете оценки и минимум 90 минути до началото.';
  }
  function draftRows(now=Date.now()){
    const active=currentPool(now);
    if(!active||active.status!=='ready'||isPaused())return [];
    return [...drafts.values()].flatMap(pair=>{
      const fixture=active.fixtures.find(f=>f.id===pair.matchId&&f.kickoff===pair.kickoff);
      const rows=fixture?assessPair(fixture,pair.family,pair,now):[];
      return [{pair,fixture,rows}];
    });
  }
  function chosenDrafts(now=Date.now()){
    const today=sofiaDate(now);
    return rankValue(draftRows(now).flatMap(d=>d.rows),personal.picks,today);
  }
  function renderDrafts(){
    const rows=draftRows(), chosen=chosenDrafts(), today=sofiaDate(Date.now());
    $('pv-draft-count').textContent=chosen.length+' от максимум '+Math.max(0,RULE.cap-personal.picks.filter(p=>p.day===today).length)+
      ' свободни места покриват тестовия филтър.';
    $('pv-commit').disabled=!chosen.length||!personal.available||isPaused();
    $('pv-drafts').innerHTML=rows.length?rows.map(({pair,fixture,rows})=>{
      return '<article class="pv-draft"><div class="pv-card-top"><b>'+esc(fixture?team(fixture):pair.matchId)+'</b>'+
        '<button type="button" class="button small" data-remove-quote="'+esc(pair.matchId+'|'+pair.family)+'">Премахни</button></div>'+
        '<small class="muted">'+esc(pair.source)+' · '+esc(when(pair.seen))+'</small>'+
        (rows.length?rows.map(r=>'<div class="pv-side"><span><b>'+labels[r.key]+' · '+price(r.price)+'</b><small>Prime '+pct(r.prime)+' · положения '+pct(r.chances)+
          ' · пазар '+pct(r.market)+'</small><small>Prime Value '+pct(r.p)+' · моделно '+signed(r.edge*100)+'%</small></span>'+
          '<span class="'+(r.reason==='pass'?'result-hit':'muted')+'">'+esc(reason[r.reason])+'</span></div>').join(''):'<p class="muted">Цената или прогнозата вече не е актуална.</p>')+
        '</article>';
    }).join(''):'<p class="muted">Добави котировка за двете страни, за да видиш оценката.</p>';
  }
  function renderPersonal(){
    const entries=personal.picks.map(p=>({...p,result:localResults.get(p.id)??null}));
    const s=valueStats(entries);
    $('pv-local-stats').innerHTML=statsHtml(s);
    $('pv-local-brier').textContent=brierText(s);
    $('pv-local-diary').innerHTML=dayCards(entries,60)||'<div class="empty">Все още няма лични предмачови записи.</div>';
  }
  async function settleLocal(){
    const req=++localRefresh;
    const groups=new Map();
    for(const p of personal.picks){const rows=groups.get(p.day)??[];rows.push(p);groups.set(p.day,rows);}
    const next=new Map(localResults);
    await Promise.all([...groups].map(async([day,picks])=>{
      try{
        const bucket=await loadDay(day);
        if(!bucket)return;
        for(const p of picks){const result=valueSettlement(p,bucket,Date.now());if(result)next.set(p.id,result);}
      }catch{}
    }));
    if(req===localRefresh){localResults=next;renderPersonal();}
  }
  async function refresh({force=false}={}){
    if(refreshing)return;
    if(!force&&Date.now()-latestRequest<45_000&&publicState){renderForm();renderDrafts();renderPersonal();return;}
    refreshing=true;
    try{
      const state=await loadPublic();
      if(state?.schema!==1||state.rule?.version!==RULE.version||!Array.isArray(state.picks)||!Array.isArray(state.days)||!state.stats||
          publicState&&Date.parse(state.updatedAt)<Date.parse(publicState.updatedAt))throw Error('Invalid value state');
      publicState=state;publicError=false;latestRequest=Date.now();
    }catch{publicError=true;}
    finally{
      refreshing=false;renderPublic();renderForm();renderDrafts();renderPersonal();void settleLocal();
    }
  }
  $('pv-fixture').addEventListener('change',updateMarketInputs);
  $('pv-family').addEventListener('change',()=>{
    const keys=FAMILIES[$('pv-family').value||'over_2_5'];
    $('pv-first-label').textContent=labels[keys[0]];$('pv-other-label').textContent=labels[keys[1]];
    const f=pool?.fixtures.find(x=>x.id===$('pv-fixture').value);
    $('pv-model-preview').textContent=f?labels[keys[0]]+' · Prime '+pct(f.prime[keys[0]])+' · положения '+pct(f.chances[keys[0]]):'';
  });
  $('pv-form').addEventListener('submit',e=>{
    e.preventDefault();
    const active=currentPool(), now=Date.now();
    const fixture=active?.fixtures.find(f=>f.id===$('pv-fixture').value),family=$('pv-family').value;
    const source=$('pv-book').value.trim(),first=parseOdds($('pv-first').value),other=parseOdds($('pv-other').value);
    if(!fixture||isPaused()||active.status!=='ready'||!personal.available){
      $('pv-manual-message').textContent='Няма актуална допустима прогноза.';return;
    }
    if(first===null||other===null||!source){$('pv-manual-message').textContent='Въведи валидни две цени от един конкретен букмейкър.';return;}
    const pair=normalizePair(fixture,family,{matchId:fixture.id,kickoff:fixture.kickoff,family,selected:first,opposite:other,
      source,kind:'manual',seen:new Date(now).toISOString()},now);
    if(!pair){$('pv-manual-message').textContent='Двойката не е валидна за този мач и пазар.';return;}
    drafts.set(fixture.id+'|'+family,pair);
    $('pv-manual-message').textContent='Добавена е лична засечка. Оценката е предварителна до запис в дневника.';
    $('pv-first').value='';$('pv-other').value='';
    renderDrafts();
  });
  $('pv-drafts').addEventListener('click',e=>{
    const b=e.target.closest('[data-remove-quote]');if(!b)return;
    drafts.delete(b.dataset.removeQuote);renderDrafts();
  });
  $('pv-commit').addEventListener('click',()=>{
    if(!personal.available||isPaused())return;
    // Respect records made in another tab before reserving today's slots.
    personal=readLocal();
    if(!personal.available){$('pv-manual-message').textContent='Не можем да потвърдим предишните лични записи.';return;}
    const now=Date.now(),rows=chosenDrafts(now),ctx=getContext(),at=new Date(now).toISOString();
    if(!rows.length){$('pv-manual-message').textContent='Няма подходящи актуални цени за запис.';renderDrafts();return;}
    const next=personal.picks.concat(rows.map(r=>sealValuePick(r,at,ctx.snapshot.asOf,'personal')));
    try{
      localStorage.setItem(STORE,JSON.stringify({schema:1,picks:next}));
      personal={available:true,picks:next};
      $('pv-manual-message').textContent='Записани '+rows.length+' лични тестови избора. Цените и вероятностите са замразени.';
      renderDrafts();renderPersonal();void settleLocal();
    }catch{$('pv-manual-message').textContent='Браузърът не позволи запис. Няма добавени избори.';}
  });
  $('pv-more').addEventListener('click',()=>{publicLimit+=30;renderPublic();});
  window.addEventListener('storage',event=>{
    if(event.key===STORE){personal=readLocal();renderForm();renderDrafts();renderPersonal();void settleLocal();}
  });
  return {refresh};
}
