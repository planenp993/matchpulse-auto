/* Presentation of independent source receipts; no model inputs. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseHealth=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const COUNTRY={England:'Англия',Scotland:'Шотландия',Germany:'Германия',Italy:'Италия',Spain:'Испания',France:'Франция',Netherlands:'Нидерландия',Belgium:'Белгия',Portugal:'Португалия',Turkey:'Турция',Greece:'Гърция',Norway:'Норвегия',Sweden:'Швеция',Denmark:'Дания',Austria:'Австрия',Poland:'Полша',Switzerland:'Швейцария'};
const failed=v=>['error','partial','partial_secondary','stale_secondary'].includes(v);
function leagueLabel(row){return (row[1]==='Europe'?'':(COUNTRY[row[1]]||row[1])+' · ')+row[2];}
function sources(s={},now=new Date()){
 const soccerway=s.calendar_provider==='Soccerway'||s.soccerway_enabled===true;
 const rows=[
  ['Програма',s.fixtures_updated_utc,s.fixtures_feed_status,s.secondary_fixture_errors],
  ['Основен архив',s.last_history_success_utc,s.history_refresh_status,s.errors],
  soccerway?['Скорошни резултати · Soccerway',s.last_soccerway_data_success_utc||s.last_soccerway_success_utc,s.soccerway_refresh_status,[...(s.soccerway_errors||[]),...(s.soccerway_quarantined?.length?[`${s.soccerway_quarantined.length} наблюдения чакат проверка на самоличност/статус`]:[])]]:
  s.last_statarea_attempt_utc?['Скорошни резултати · Statarea',s.last_statarea_success_utc,s.statarea_refresh_status,[...(s.statarea_errors||[]),...(s.statarea_quarantined?.length?[`${s.statarea_quarantined.length} наблюдения чакат проверка на самоличност/статус`]:[])]]:
   ['Допълнителни лиги',s.last_results_success_utc,s.result_bridge_status,s.result_bridge_errors],
  ...(soccerway&&s.last_statarea_attempt_utc?[['Statarea · неактивен',s.last_statarea_attempt_utc,'paused',[]]]:[]),
  ...(s.last_forebet_attempt_utc?[s.forebet_enabled===false?["Forebet · неактивен",s.last_forebet_attempt_utc,"paused",[]]:["Допълване · Forebet",s.last_forebet_data_success_utc||s.last_forebet_success_utc,s.forebet_refresh_status,[...(s.forebet_errors||[]),...(s.forebet_quarantined?.length?["Наблюдения за проверка: "+s.forebet_quarantined.length]:[])]]]:[]),
  ['Евротурнири',s.last_europe_success_utc,s.europe_refresh_status,s.europe_errors],
  ['Класиране',s.last_standings_success_utc,s.standings_refresh_status,s.standings_errors],
  ['CSV цени',s.last_quote_success_utc,s.quote_error?'error':s.quote_check_status,s.quote_error?[s.quote_error]:[]]
 ];
 return rows.map(([label,stamp,state,errors])=>{
  const valid=Number.isFinite(Date.parse(stamp)),age=(now.getTime()-Date.parse(stamp))/3600000;
  if(state==='paused')return {label,stamp:valid?stamp:null,warning:false,errors:[],text:'Изключен от автоматичните проверки'};
  const messages=Array.isArray(errors)?errors.filter(Boolean).map(String):[];
  const warning=failed(state)||messages.length>0||state==='empty_for_upcoming';
  const frequent=(soccerway||!!s.last_statarea_attempt_utc)&&(label==='Програма'||label.startsWith('Скорошни резултати · ')||label==='Допълване · Forebet');
  const stale=valid&&(age<0||age>(label==='Допълване · Forebet'?4:frequent?2:label==='Основен архив'?48:label==='CSV цени'?96:36));
  return {label,stamp:valid?stamp:null,warning:warning||stale||!valid,errors:messages,
   text:state==='empty_for_upcoming'?'Няма цени за предстоящите мачове':warning?'Непълно / неуспешно обновяване':!valid?'Няма потвърдено обновяване':stale?'Нужда от нова проверка':'Последната проверка е успешна'};
 });
}
return {leagueLabel,sources};
});
