(function(root){'use strict';
 const markets=new Set(['over25','under25','btts_yes','btts_no','home_over15','away_over15']);
 function validateReview(review,fixture,snapshot,{demo=false,now=new Date()}={}){
  const errors=[];const r=review||{};
  if(!fixture) return ['Няма избран двубой.'];
  if(r.fixture_id!==fixture.id) errors.push('Прегледът е за друг двубой.');
  if(r.snapshot_id!==snapshot.fetched_utc) errors.push('Прегледът е за друга версия на данните.');
  if(!markets.has(r.market)) errors.push('Избери поддържан голов пазар.');
  if(!r.thesis||String(r.thesis).trim().length<25) errors.push('Липсва ясна футболна теза.');
  if(!r.risk||String(r.risk).trim().length<15) errors.push('Липсва основен риск.');
  if(!Array.isArray(r.sources)||!r.sources.length||r.sources.some(s=>!s||typeof s.url!=='string'||!s.url.startsWith('https://')||!s.claim||!Number.isFinite(Date.parse(s.checked_at)))) errors.push('Трябват източник, проверен факт и час за новините.');
  if(!['checked','not_material'].includes(r.team_news_status)) errors.push('Съставите и отсъствията още не са проверени.');
  const q=r.quote;
  if(!q||!Number.isFinite(q.decimal)||q.decimal<=1||typeof q.source_url!=='string'||!q.source_url.startsWith('https://')||!q.market||q.market!==r.market) errors.push('Няма проверена цена за точния пазар.');
  const at=Date.parse(q?.observed_at); const moment=+new Date(now);
  if(!Number.isFinite(at)||at>moment||moment-at>60*60*1000) errors.push('Цената трябва да е проверена през последния час.');
  if(!Number.isFinite(Date.parse(r.checked_at))||Date.parse(r.checked_at)>moment||moment-Date.parse(r.checked_at)>24*60*60*1000) errors.push('Футболният преглед трябва да е от последните 24 часа.');
  if(!Number.isFinite(Date.parse(fixture.kickoff_utc))||Date.parse(fixture.kickoff_utc)<=moment) errors.push('Мачът вече е започнал или часът е невалиден.');
  if(!['free','club'].includes(r.audience)) errors.push('Липсва аудитория.');
  if(!demo && (r.simulated || (Array.isArray(r.sources)&&r.sources.some(s=>String(s?.url).includes('.invalid'))) || String(q?.source_url).includes('.invalid'))) errors.push('Демонстрационни данни не могат да се публикуват.');
  return errors;
 }
 function settle(market,score){
  if(!Array.isArray(score)||score.length!==2||score.some(x=>!Number.isInteger(x)||x<0)) return 'pending';
  const [h,a]=score;const won={over25:h+a>=3,under25:h+a<=2,btts_yes:h>0&&a>0,btts_no:h===0||a===0,home_over15:h>=2,away_over15:a>=2};
  return market in won?(won[market]?'win':'loss'):'pending';
 }
 function recordStats(rows){const settled=rows.filter(r=>['win','loss'].includes(r.result));const profit=settled.reduce((n,r)=>n+(r.result==='win'?r.odds-1:-1),0);return {n:rows.length,settled:settled.length,voids:rows.filter(r=>r.result==='void').length,profit,yield:settled.length?profit/settled.length:null};}
 function publicProjection(rows){return rows.filter(r=>r.status==='published'&&(r.audience==='free'||r.settled===true)).map(r=>({id:r.id,fixture_id:r.fixture_id,market:r.market,thesis:r.thesis,audience:r.audience,published_at:r.published_at,result:r.result??null}));}
 const api={validateReview,settle,recordStats,publicProjection};if(typeof module!=='undefined')module.exports=api;root.PrimeEditorial=api;
})(typeof globalThis!=='undefined'?globalThis:this);
