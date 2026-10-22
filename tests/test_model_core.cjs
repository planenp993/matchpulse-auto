'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const model=require('../docs/model-core.js');
const row=(div,date,h,a,hg,ag,hxg=null,axg=null)=>[div,'England','Test league',date,'15:00',h,a,hg,ag,hxg,axg,null,null];
const sample=[];
const teams=['Arsenal','Chelsea','Everton','Liverpool'];
for(let week=0;week<18;week++){
 const yyyy='2026',mm=week<9?'01':'02',dd=String(week<9?week+1:week-8).padStart(2,'0'),date=yyyy+'-'+mm+'-'+dd;
 sample.push(row('E0',date,teams[week%4],teams[(week+1)%4],1+(week%3),week%2,1.1,0.9));
 sample.push(row('E0',date,teams[(week+2)%4],teams[(week+3)%4],week%3,1+((week+1)%2),0.9,1.4));
}
test('Name normalization does not collapse Cyrillic clubs',()=>{
 assert.equal(model.clubKey('ЦСКА София'),'цска софия');
 assert.notEqual(model.clubKey('ЦСКА София'),model.clubKey('Левски'));
 assert.equal(model.clubKey('Manchester United'),'man united');
 assert.equal(model.clubKey('Bayern'),'bayern munich');
 assert.equal(model.clubKey("Nott'm Forest"),'nottm forest');
 assert.equal(model.clubKey('Man Utd'),'man united');
});
test('All distributions sum to 1 and markets are coherent',()=>{
 const d=model.distribution(1.48,1.22,-0.06);
 const matrixSum=d.matrix.flat().reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(matrixSum-1)<1e-11);
 const p=d.probs;
 assert.ok(p.over05>=p.over15&&p.over15>=p.over25&&p.over25>=p.over35&&p.over35>=p.over45);
 assert.ok(p.homeOver05>=p.homeOver15&&p.homeOver15>=p.homeOver25);
 assert.ok(p.awayOver05>=p.awayOver15&&p.awayOver15>=p.awayOver25);
 assert.ok(p.btts>0&&p.btts<1);
 const over25=d.matrix.flatMap((r,h)=>r.map((v,a)=>h+a>=3?v:0)).reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(over25-p.over25)<1e-11);
});
test('Data cutoff excludes both match and future scores',()=>{
 const fixture=['E0','England','Premier League','2026-03-05','19:00','Arsenal','Chelsea'];
 const clean=model.evaluate(sample,fixture);
 assert.ok(!clean.error,clean.error);
 const future=row('E0','2026-03-05','Arsenal','Chelsea',19,0,20,0);
 const tomorrow=row('E0','2026-03-06','Chelsea','Arsenal',0,20,0,20);
 const dirty=model.evaluate([...sample,future,tomorrow],fixture);
 assert.equal(dirty.lambdaHome,clean.lambdaHome);
 assert.equal(dirty.lambdaAway,clean.lambdaAway);
});
test('No invented goal probabilities when one club has no matches',()=>{
 const fixture=['E0','England','Premier League','2026-03-05','19:00','Arsenal','Unknown XX'];
 assert.ok(model.evaluate(sample,fixture).error);
});
test('Model works with all three preset strategies',()=>{
 const fixture=['E0','England','Premier League','2026-03-05','19:00','Arsenal','Chelsea'];
 for(const preset of ['standard','recent','cautious']){
  const v=model.evaluate(sample,fixture,preset);
  assert.ok(v.lambdaHome>0&&v.lambdaAway>0&&!v.error);
  assert.ok(v.quality.homeN>=5&&v.quality.awayN>=5);
 }
});
test('Euro fixtures explicitly show lack of international strength adjustment',()=>{
 const fixture=['UCL','Europe','Champions League','2026-03-05','19:00','Arsenal','Chelsea'];
 const v=model.evaluate(sample,fixture);
 assert.equal(v.euro,true);assert.match(v.quality.warning,/Международен мач/);
});
test('Match Lab HTML scripts parse without syntax errors',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../docs/lab.html'),'utf8');
 const inline=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 assert.equal(inline.length,1);
 for(const code of inline)assert.doesNotThrow(()=>new Function(code));
 assert.match(html,/MATCH LAB/);
 assert.match(html,/model-core\.js/);
});
test('Legacy dashboard redirect and matching Match Lab deep links parse correctly',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../docs/index.html'),'utf8');
 const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 assert.ok(scripts.length>=2);
 for(const code of scripts)assert.doesNotThrow(()=>new Function(code));
 assert.match(html,/lab\.html\?m=/);
 assert.match(html,/dashboard/);
});