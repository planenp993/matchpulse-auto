'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Scout=require('../docs/scout-core.js');
const scope={window:{MatchpulseScout:Scout,MatchpulseDaily:require('../docs/scout-daily.js')}};
vm.runInNewContext(fs.readFileSync('docs/scout-presentation.js','utf8'),scope);
scope.window.MatchpulsePresentation=scope.MatchpulsePresentation;
vm.runInNewContext(fs.readFileSync('docs/scout-selection-ui.js','utf8'),scope);
const {dailyShortlist}=scope.window.MatchpulseSelectionUI;
const fixture=(n,division='E0')=>[division,division==='E0'?'England':'Scotland','League','2026-11-14','17:00','Home '+n,'Away '+n];
const market=(id,family,rank,probability=.65,eligible=true)=>({id,family,rank,probability,eligible});

test('Daily shortlist ranks supported goals, retains one choice per match and caps the post at five',()=>{
 const rows=Array.from({length:7},(_,i)=>({fixture:fixture(i),candidates:[market('o25','total',i/100)]}));
 rows.push({fixture:fixture(6),candidates:[market('u25','total',.03)]});
 rows[6].candidates.push(market('1','result',.9),market('u35','total',.8,.54),market('o35','total',.7,.8,false),market('btts','btts',.065));
 const list=Array.from(dailyShortlist(rows));
 assert.deepEqual(list.map(x=>x.entry.fixture[5]),['Home 6','Home 5','Home 4','Home 3','Home 2']);
 assert.equal(list[0].pick.id,'btts');
 assert.equal(new Set(list.map(x=>x.key)).size,list.length);
});

test('Daily shortlist leaves vacancies and uses the existing league priority for tied evidence',()=>{
 const rows=[{fixture:fixture(1,'SC0'),candidates:[market('u25','total',.1)]},
  {fixture:fixture(2),candidates:[market('o15','total',.1)]},
  {fixture:fixture(3),candidates:[market('1','result',.4),market('o25','total',.2,.64,false)]}];
 assert.deepEqual(Array.from(dailyShortlist(rows),x=>x.entry.fixture[0]),['E0','SC0']);
 assert.equal(dailyShortlist(rows.slice(2)).length,0);
});
