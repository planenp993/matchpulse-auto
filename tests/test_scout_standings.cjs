'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../docs/scout-standings.js');
const now=new Date('2026-10-27T18:00:00Z');
function doc(){return {checks:{E0:{status:'ok'}},tables:{E0:{season:'2026/27',provider:'ESPN',source_url:'https://www.espn.com/soccer/standings/_/league/eng.1',observed_at_utc:now.toISOString(),groups:[{name:'Regular Season',rows:[
 {rank:1,name:'Home',club_key:'home',played:4,won:2,drawn:1,lost:1,gf:6,ga:4,gd:2,points:7,points_adjustment:0},
 {rank:2,name:'Away',club_key:'away',played:4,won:1,drawn:1,lost:2,gf:3,ga:4,gd:-1,points:4,points_adjustment:0}]}]}}};}
test('Published table preserves provider order and highlights only reviewed fixture clubs',()=>{
 const d=doc();d.tables.E0.groups[0].rows[0].points=1;d.tables.E0.groups[0].rows[0].points_adjustment=-6;
 const html=T.render(d,'E0',{home:'Home',away:'Away',keyTeam:x=>x.toLowerCase(),now});
 assert.ok(html.indexOf('>Home</th>')<html.indexOf('>Away</th>'));
 assert.equal((html.match(/class="standing-selected"/g)||[]).length,2);assert.match(html,/Корекция спрямо 3П \+ Р: -6/);
 assert.match(html,/Редовен сезон/);assert.match(html,/Сезон 2026\/27/);
});
test('Missing Swiss goals stay unavailable while an observed zero difference stays zero',()=>{
 const d=doc();Object.assign(d.tables.E0.groups[0].rows[0],{gf:null,ga:null,gd:0});
 const html=T.render(d,'E0',{now});assert.match(html,/>—<\/td><td>0<\/td>/);
});
test('Outage and stale success show cached status without inventing a new observation time',()=>{
 const d=doc();d.checks.E0.status='error';const before=JSON.stringify(d);const html=T.render(d,'E0',{now:new Date('2026-10-30T18:00:00Z')});
 assert.match(html,/запазената таблица/);assert.match(html,/27\.10/);assert.equal(JSON.stringify(d),before);
});
test('Old season is labelled explicitly after annual rollover in Bulgarian time',()=>{
 assert.equal(T.season('NOR',new Date('2026-12-31T22:30:00Z')),'2027');
 assert.equal(T.season('E0',new Date('2026-12-31T22:30:00Z')),'2026/27');
 const d=doc();d.tables.E0.season='2025/26';assert.match(T.render(d,'E0',{now}),/предишен сезон/);
});
test('Separate playoff phases retain their own rank scope',()=>{
 const d=doc();d.tables.E0.groups=[{name:'Group Championship',rows:d.tables.E0.groups[0].rows},{name:'Group Relegation',rows:d.tables.E0.groups[0].rows}];
 const html=T.render(d,'E0',{now});assert.match(html,/Шампионска група/);assert.match(html,/Група за оставане/);assert.equal((html.match(/<table /g)||[]).length,2);
});
test('Unreviewed clubs remain unhighlighted and provider HTML or hostile URLs cannot execute',()=>{
 const d=doc();d.tables.E0.groups[0].rows[0].club_key=null;d.tables.E0.groups[0].rows[0].name='<img src=x onerror="alert(1)">';d.tables.E0.source_url='javascript:alert(1)';
 const html=T.render(d,'E0',{home:'Home',keyTeam:x=>x.toLowerCase(),now});
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('standing-selected'));assert.ok(html.includes('&lt;img'));
});
test('Missing tables explain availability and standings remain inside existing panels',()=>{
 assert.match(T.render({tables:{}},'E0',{now}),/още не е налично/);
 const fs=require('node:fs'),html=fs.readFileSync('docs/scout.html','utf8');
 assert.equal((html.match(/class="nav(?:\s|")/g)||[]).length,5);assert.ok(!html.includes('data-view="standings"'));
 assert.ok(html.includes('scheduleStandings'));assert.ok(html.includes('standingsLeague'));
});
