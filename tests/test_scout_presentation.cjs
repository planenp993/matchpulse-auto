'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Model=require('../docs/model-core.js'),Scout=require('../docs/scout-core.js');
const scope={MatchpulseModel:Model,MatchpulseScout:Scout};
vm.runInNewContext(fs.readFileSync('docs/scout-presentation.js','utf8'),scope);
const View=scope.MatchpulsePresentation,fixture=['E0','England','Premier League','2026-11-05','20:00','Home','Away'];
test('Programme puts leading leagues and Europe ahead of other regions',()=>{
 const leagues=[['JPN','Japan'],['SC2','Scotland'],['SP1','Spain'],['CHN','China'],['D2','Germany'],
  ['UCL','Europe'],['BRA','Brazil'],['E0','England'],['UEL','Europe']];
 leagues.sort((a,b)=>View.leagueOrder(a)-View.leagueOrder(b));
 assert.deepEqual(leagues.map(r=>r[0]),['UCL','E0','SP1','UEL','SC2','D2','JPN','CHN','BRA']);
});
test('Goal threshold presentation sums the existing score matrix and preserves its model',()=>{
 const distribution=Model.distribution(1.45,1.1,-.06),before=JSON.stringify(distribution),html=View.goals(fixture,{distribution});
 const rows=[...html.matchAll(/<tr><th scope="row">Над ([\d,]+)<\/th>(.*?)<\/tr>/g)];
 assert.equal(rows.length,5);
 for(const row of rows){
  const line=Number(row[1].replace(',','.')),shown=[...row[2].matchAll(/>(\d+)%<\/b>/g)].map(x=>Number(x[1]));
  const expected=['home','away','total'].map(side=>Math.round(distribution.matrix.reduce((sum,r,h)=>sum+r.reduce((n,p,a)=>n+((side==='home'?h:side==='away'?a:h+a)>line?p:0),0),0)*100));
  assert.deepEqual(shown,expected);assert.ok(shown[2]>=shown[0]&&shown[2]>=shown[1]);
 }
 assert.equal(JSON.stringify(distribution),before);
 assert.equal(View.goals(fixture,{distribution:{probs:distribution.probs}}),'','An archived probability record must not invent a score matrix');
 assert.equal(View.goals(fixture,null),'');
});
test('Match sections escape names and separate unavailable models from historical data',()=>{
 const hostile=[...fixture];hostile[5]='<img src=x onerror=alert(1)>';
 const html=View.goals(hostile,{distribution:Model.distribution(1,1,-.06)});
 assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));
 assert.match(View.overview(fixture,{international:true},null),/няма моделни проценти/);
 assert.match(View.overview(fixture,{international:false},null),/Няма запазена/);
 const tabs=View.tabs('form');assert.equal((tabs.match(/role="tab"/g)||[]).length,6);assert.match(tabs,/data-match-tab="form" aria-selected="true"/);
});
test('Every changed presentation asset is content versioned and available offline',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 for(const name of ['scout.js','scout-presentation.js','scout.css','scout-dark.css']){
  const version=crypto.createHash('sha256').update(fs.readFileSync('docs/'+name)).digest('hex').slice(0,12);
  assert.ok(html.includes(name+'?v='+version),name);
 }
 assert.ok(builder.includes('scout-presentation.js'));assert.ok(builder.includes('club-marks.json'));
});
