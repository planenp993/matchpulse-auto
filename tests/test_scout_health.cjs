'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../docs/scout-health.js');
const now=new Date('2026-10-28T08:00:00Z'),stamp='2026-10-28T06:00:00Z';
const healthy={fixtures_updated_utc:stamp,last_history_success_utc:stamp,last_results_success_utc:stamp,last_europe_success_utc:stamp,last_standings_success_utc:stamp,last_quote_success_utc:stamp};
test('Each source exposes its own failed receipt even with a healthy calendar',()=>{
 assert.ok(H.sources(healthy,now).every(r=>!r.warning));
 for(const [field,label] of [['history_refresh_status','Основен архив'],['standings_refresh_status','Класиране'],['europe_refresh_status','Евротурнири']]){
  const rows=H.sources({...healthy,[field]:'error'},now);
  assert.ok(rows.find(r=>r.label===label).warning);assert.equal(rows[0].warning,false);
 }
 const quote=H.sources({...healthy,quote_check_status:'ok',quote_error:'HTTP 503'},now).at(-1);
 assert.equal(quote.warning,true);assert.deepEqual(quote.errors,['HTTP 503']);
});
test('Publication time never substitutes for a missing source receipt',()=>{
 const rows=H.sources({last_build_utc:stamp},now);
 assert.ok(rows.every(r=>r.warning&&r.stamp===null));
 assert.ok(H.sources({...healthy,fixtures_updated_utc:'2026-10-25T06:00:00Z'},now)[0].warning);
});
test('Duplicate league names include their distinct country',()=>{
 assert.equal(H.leagueLabel(['D1','Germany','Bundesliga']),'Германия · Bundesliga');
 assert.equal(H.leagueLabel(['AUT','Austria','Bundesliga']),'Австрия · Bundesliga');
 assert.equal(H.leagueLabel(['UCL','Europe','Champions League']),'Champions League');
});
test('Statarea clocks are independent, frequent and expose quarantined observations',()=>{
 const s={...healthy,last_statarea_attempt_utc:stamp,last_statarea_success_utc:stamp,statarea_refresh_status:'ok'};
 const fresh=new Date('2026-10-28T06:30:00Z');
 assert.equal(H.sources(s,fresh).find(r=>r.label.includes('Statarea')).warning,false);
 const stale=H.sources(s,new Date('2026-10-28T08:01:00Z'));
 assert.equal(stale[0].warning,true);
 assert.equal(stale.find(r=>r.label.includes('Statarea')).warning,true);
 const quarantined=H.sources({...s,statarea_quarantined:[{id:'42'}]},fresh).find(r=>r.label.includes('Statarea'));
 assert.equal(quarantined.warning,true);assert.match(quarantined.errors[0],/1 наблюдения/);
 const missing=H.sources({...s,last_statarea_success_utc:null,last_build_utc:stamp},fresh).find(r=>r.label.includes('Statarea'));
 assert.equal(missing.stamp,null);assert.equal(missing.warning,true);
});
test('Forebet keeps its own receipt and partial warning after a newer publication',()=>{
 const s={...healthy,last_statarea_attempt_utc:stamp,last_statarea_success_utc:stamp,
  last_forebet_attempt_utc:stamp,last_forebet_data_success_utc:stamp,forebet_refresh_status:'ok'};
 const row=H.sources(s,now).find(r=>r.label.includes('Forebet'));
 assert.equal(row.stamp,stamp);assert.equal(row.warning,false);
 const stale=H.sources({...s,last_build_utc:'2026-10-28T12:00:00Z'},new Date('2026-10-28T12:00:00Z')).find(r=>r.label.includes('Forebet'));
 assert.equal(stale.stamp,stamp);assert.equal(stale.warning,true);
 const partial=H.sources({...s,forebet_refresh_status:'partial',forebet_quarantined:[{id:'9'}]},now).find(r=>r.label.includes('Forebet'));
 assert.equal(partial.warning,true);assert.match(partial.errors[0],/1/);
});
test('A disabled Forebet source is explicitly inactive without marking the working primary as failed',()=>{
 const rows=H.sources({...healthy,forebet_enabled:false,last_forebet_attempt_utc:stamp,
  forebet_refresh_status:'error',forebet_errors:['HTTP 403']},now);
 const source=rows.find(r=>r.label.includes('Forebet'));
 assert.match(source.label,/неактивен/);assert.match(source.text,/Изключен/);
 assert.equal(source.stamp,stamp);assert.equal(source.warning,false);
 assert.equal(rows[0].warning,false);
});
test('Soccerway uses its own clock and partial warnings; old Statarea errors stay inactive',()=>{
 const s={...healthy,calendar_provider:'Soccerway',soccerway_enabled:true,
  last_soccerway_data_success_utc:stamp,soccerway_refresh_status:'ok',
  last_statarea_attempt_utc:stamp,statarea_refresh_status:'error',statarea_errors:['TLS failure']};
 const fresh=new Date('2026-10-28T06:30:00Z'),rows=H.sources(s,fresh);
 assert.equal(rows.find(r=>r.label.includes('Soccerway')).warning,false);
 assert.equal(rows.find(r=>r.label.includes('Statarea')).warning,false);
 assert.match(rows.find(r=>r.label.includes('Statarea')).label,/неактивен/);
 assert.ok(H.sources({...s,soccerway_refresh_status:'partial',soccerway_quarantined:[{}]},fresh).find(r=>r.label.includes('Soccerway')).warning);
 assert.equal(H.sources({...s,last_soccerway_data_success_utc:null,last_build_utc:stamp},fresh).find(r=>r.label.includes('Soccerway')).stamp,null);
 const stale=H.sources(s,new Date('2026-10-28T08:01:00Z'));
 assert.equal(stale[0].warning,true);assert.equal(stale.find(r=>r.label.includes('Soccerway')).warning,true);
});
