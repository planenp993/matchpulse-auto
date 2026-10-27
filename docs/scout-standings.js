/* Descriptive provider tables only. This module never supplies model inputs. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateISO=now=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function season(div,now){const day=dateISO(now),year=+day.slice(0,4),start=+day.slice(5,7)>=7?year:year-1;return ['NOR','SWE'].includes(div)?String(year):start+'/'+String(start+1).slice(-2);}
function phase(name,single){
 const text=String(name).toLowerCase();
 if(/league phase/.test(text))return 'Лигова фаза';
 if(/relegation|abstiegs/.test(text))return 'Група за оставане';
 if(/championship|meister/.test(text))return 'Шампионска група';
 if(/europe|europa/.test(text)&&/playoff/.test(text))return 'Европейски плейофи';
 if(/regular|reguläre/.test(text))return 'Редовен сезон';
 return single?'Общо':String(name);
}
function safeSource(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.espn.com','espn.com','sfl.ch','ekstraklasa.org'].includes(u.hostname)?u.href:null;}catch{return null;}}
function render(doc,div,{home=null,away=null,keyTeam=x=>x,now=new Date()}={}){
 const table=doc?.tables?.[div],check=doc?.checks?.[div];
 if(!table)return '<p class="footnote">Класирането още не е налично за това състезание.</p>';
 const oldSeason=table.season!==season(div,now),age=now.getTime()-Date.parse(table.observed_at_utc);
 const stamp=Number.isFinite(Date.parse(table.observed_at_utc))?new Date(table.observed_at_utc).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',dateStyle:'short',timeStyle:'short'}):'неизвестно';
 const warning=oldSeason?'Таблицата е за предишен сезон. Новата още не е налична.':check?.status==='error'?'Последната проверка не успя. Показана е запазената таблица.':!Number.isFinite(age)||age>36*3600000?'Таблицата не е проверявана скоро.':table.archive_ahead?.length?'Възможно изоставане спрямо последните резултати.':'';
 const selected=[home&&keyTeam(home),away&&keyTeam(away)],source=safeSource(table.source_url);
 let adjustment=false;
 const groups=table.groups.map(group=>'<div class="standings-group"><h4>'+esc(phase(group.name,table.groups.length===1))+'</h4><div class="standings-scroll"><table class="standings-table"><thead><tr>'+
  [['#','Място',''],['Отбор','Отбор','standings-team'],['М','Изиграни мачове',''],['П','Победи','standings-detail'],['Р','Равенства','standings-detail'],['З','Загуби','standings-detail'],['Голове','Вкарани : допуснати','standings-detail'],['ГР','Голова разлика',''],['Т','Точки','']].map(([text,title,cls])=>'<th class="'+cls+'" scope="col" title="'+title+'">'+text+'</th>').join('')+'</tr></thead><tbody>'+
  group.rows.map(row=>{
   const side=row.club_key&&selected.indexOf(row.club_key),chosen=typeof side==='number'&&side>=0;
   if(row.points_adjustment)adjustment=true;
   return '<tr'+(chosen?' class="standing-selected"':'')+'><td>'+esc(row.rank)+'</td><th scope="row" class="standings-team">'+(chosen?'<span class="standing-role" title="'+(side===0?'Домакин':'Гост')+'">'+(side===0?'Д':'Г')+'</span>':'')+esc(row.name)+'</th><td>'+esc(row.played)+'</td><td class="standings-detail">'+esc(row.won)+'</td><td class="standings-detail">'+esc(row.drawn)+'</td><td class="standings-detail">'+esc(row.lost)+'</td><td class="standings-detail">'+(Number.isFinite(row.gf)&&Number.isFinite(row.ga)?row.gf+':'+row.ga:'—')+'</td><td>'+((row.gd>0?'+':'')+esc(row.gd))+'</td><td class="standing-points">'+esc(row.points)+(row.points_adjustment?'<abbr title="Корекция спрямо 3П + Р: '+esc(row.points_adjustment)+' точки">*</abbr>':'')+'</td></tr>';
  }).join('')+'</tbody></table></div></div>').join('');
 return '<div class="standings-meta"><strong>Сезон '+esc(table.season)+'</strong><span>Проверено '+esc(stamp)+' · '+(source?'<a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">'+esc(table.provider)+'</a>':esc(table.provider))+'</span></div>'+(warning?'<p class="standings-warning" role="status">'+esc(warning)+'</p>':'')+groups+(adjustment?'<p class="footnote">* Точките включват корекция от източника спрямо 3П + Р.</p>':'');
}
const api={render,season,phase};if(typeof module==='object'&&module.exports)module.exports=api;root.MatchpulseStandings=api;
})(typeof window!=='undefined'?window:globalThis);
