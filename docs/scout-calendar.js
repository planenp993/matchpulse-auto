/* Historical calendar presentation. It never creates a retrospective forecast. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.MatchpulseCalendar=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=p=>Number.isFinite(p)?(100*p).toFixed(1)+'%':'—',price=p=>Number.isFinite(p)?p.toFixed(2):'—';
const stamp=s=>new Date(s).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'});
function valid(doc){return doc?.schema===1&&Array.isArray(doc.entries)&&doc.entries.every(e=>Array.isArray(e.fixture)&&typeof e.key==='string');}
function merge(fixtures,doc,core){
 const rows=new Map(fixtures.map(f=>[core.keyFixture(f),f]));
 for(const e of doc?.entries||[])if(!rows.has(e.key))rows.set(e.key,e.fixture);
 return [...rows.values()].sort((a,b)=>a[3].localeCompare(b[3])||String(a[4]||'99:99').localeCompare(String(b[4]||'99:99'))||core.keyFixture(a).localeCompare(core.keyFixture(b)));
}
function model(entry){const m=entry?.forecast?.model;return m?{lambdaHome:m.lambda_home,lambdaAway:m.lambda_away,total:m.lambda_home+m.lambda_away,distribution:{probs:m.probabilities}}:null;}
function status(entry){
 if(entry?.score)return 'Краен резултат '+entry.score.join(':');
 if(['cancelled','canceled'].includes(entry?.state))return 'Отменен';
 if(['postponed','rescheduled'].includes(entry?.state))return 'Променен график';
 if(entry?.state==='conflict')return 'Спорен резултат';
 if(['excluded','unmatched'].includes(entry?.state))return 'Записът не е уреден';
 return 'Чака резултат';
}
function pickHTML(p,label){
 return '<section class="selection-pick archived-pick" data-archived-market="'+esc(p.id)+'"><div class="selection-pick-title"><span class="selection-role">'+esc(label)+'</span><strong>'+esc(p.label)+'</strong></div>'+
  '<div class="selection-metrics"><div><b>'+pct(p.probability)+'</b><span>Записана вероятност</span></div><div><b>'+price(p.fair)+'</b><span>Честен коефициент при записа</span></div></div>'+
  (p.evidence?'<p class="plan-explanation">Подкрепа при записа: '+p.evidence.home.hits+'/'+p.evidence.home.n+' срещи за домакина и '+p.evidence.away.hits+'/'+p.evidence.away.n+' за госта. Лигова честота '+pct(p.evidence.baseline)+'.</p>':'')+
  (p.quote?.status==='available'?'<p class="footnote">Цена при записа: '+price(p.quote.odds)+(p.quote.edge<0?' · под моделния коефициент':'')+'. CSV прочит: '+esc(stamp(p.quote.observed_at_utc))+'.</p>':'')+'</section>';
}
function planHTML(entry){
 const f=entry?.forecast,s=f?.selection;
 return '<h3>Записана прогноза за мача</h3>'+(f?'<p class="footnote archive-capture">Предмачов запис: '+esc(stamp(f.captured_at_utc))+' · '+esc(f.version)+'. Изборите и процентите са запазени от този момент.</p>':'')+
  (!f?'<p class="selection-abstain">За този мач няма запазена автоматична предмачова прогноза. Не се създава нов избор след началото.</p>':
   !s?'<p>Запазени са моделните проценти. Тогава още няма запис от системата за основен избор и алтернативи.</p>':
   (s.main?pickHTML(s.main,'Основна'):'<div class="selection-abstain"><strong>Без основен избор при записа</strong><p>'+esc(s.reason)+'</p></div>')+
   (s.alternatives.length?'<details class="plan-alternatives"><summary>Записани алтернативи · '+s.alternatives.length+'</summary>'+s.alternatives.map((p,i)=>pickHTML(p,'Алтернатива '+(i+1))).join('')+'</details>':'')+
   (s.builders.length?'<details class="plan-alternatives"><summary>Записани бет билдъри · '+s.builders.length+'</summary>'+s.builders.map((p,i)=>pickHTML(p,'Билдър '+(i+1))).join('')+'</details>':''))+
  (entry?.current_kickoff_utc?'<p class="footnote">Променен начален час: '+esc(stamp(entry.current_kickoff_utc))+'.</p>':'')+'<p class="footnote">'+esc(status(entry))+'. Липсата на резултат не означава отменен мач.</p>';
}
function brief(entry){
 const f=entry?.forecast,s=f?.selection;
 return ['ЗАПИСАНА ПРОГНОЗА',...(f?['Предмачов запис: '+f.captured_at_utc+' · '+f.version]:['Няма запазена предмачова прогноза.']),
  ...(s?[s.main?'Основна: '+s.main.label:'Без основен избор: '+s.reason,...[s.main,...s.alternatives,...s.builders].filter(Boolean).map(p=>p.label+' · записана вероятност '+pct(p.probability)+' · честен коефициент '+price(p.fair))]:[]),status(entry)].join('\n');
}
return {valid,merge,model,status,planHTML,brief};
});
