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
