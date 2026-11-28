'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const modulePromise=import('../docs/algorithm/conditional-prices.js');
const now=Date.parse('2026-11-28T09:00:00Z'), asOf=new Date(now-30000).toISOString(), day='2026-11-28';
const probabilities=(p,q=.50)=>({over_2_5:p,under_2_5:1-p,btts_yes:q,btts_no:1-q});
const fixture=(id,p,extra={})=>({id,league:'E0',home:'Home '+id,away:'Away '+id,model:'xg',
  kickoff:'2026-11-28T16:00:00Z',issued:asOf,probabilities:probabilities(p),chances:probabilities(p),...extra});
const args=matches=>({snapshot:{asOf,matches},fitted:{},day,now});
const select=async a=>(await modulePromise).conditionalPriceSelection(a);

test('conditional price is rounded upward and only floors within 1.70–2.00 are listed',async()=>{
  const r=await select(args([fixture('boundary',.525),fixture('too-low',.5249),fixture('high-fair',.50),fixture('too-short-fair',.59),fixture('valid',.56)]));
  assert.equal(r.checked,5);assert.equal(r.qualified,2);
  assert.deepEqual(r.rows.map(x=>[x.m.id,x.floor]),[['valid',1.88],['boundary',2]]);
  for(const x of r.rows)assert.ok(x.floor*x.p>=1.05-1e-9);
});
test('top-five takes priority; other approved leagues only when top five is empty',async()=>{
  const a=fixture('core',.53),b=fixture('other',.58,{league:'E1'});
  const r=await select(args([a,b]));
  assert.equal(r.scope,'top5');assert.deepEqual(r.rows.map(x=>x.m.id),['core']);
  const q=await select(args([fixture('no-core',.51),b]));
  assert.equal(q.scope,'other');assert.deepEqual(q.rows.map(x=>x.m.id),['other']);
});
test('current odds never enter the conditional ranking or floor',async()=>{
  const fixtures=[fixture('a',.55),fixture('b',.57),fixture('c',.53),fixture('d',.58)];
  const project=r=>r.rows.map(x=>[x.m.id,x.key,x.p,x.floor]);
  const old=await select(args(fixtures));
  const changed=fixtures.map(m=>({...m,marketPrices:{over_2_5:{selected:9,opposite:1.1,seen:asOf,source:'test'}},price:99}));
  assert.deepEqual(project(await select(args(changed))),project(old));
  assert.equal(old.rows.length,3);
});
test('no late, stale, duplicate, European or trial-only fixture in the conditional list',async()=>{
  const candidates=[fixture('ok',.55),fixture('late',.57,{kickoff:'2026-11-28T10:29:59Z'}),
    fixture('future-issued',.57,{issued:'2026-11-28T09:01:00Z'}),
    fixture('euro',.57,{league:'UCL',model:'europe'}),
    fixture('trial',.57,{reserveOnly:true}),fixture('trial-market',.57,{trialMarket:'over_2_5'}),
    fixture('unapproved',.57,{league:'E1',model:'results',reserve:{forecast:{}}}),
    fixture('dup',.58),fixture('dup',.10,{issued:'2026-11-28T09:01:00Z'})];
  const r=await select(args(candidates));
  assert.deepEqual(r.rows.map(x=>x.m.id),['ok']);
  const stale=args(candidates);stale.snapshot.asOf='2026-11-28T06:00:00Z';
  assert.equal((await select(stale)).status,'stale');assert.equal((await select({...args(candidates),day:'2026-11-27'})).status,'past');
});
test('uses the base selection forecast, not the displayed alternative probability',async()=>{
  const m=fixture('split',.65,{selectionForecast:{probabilities:probabilities(.55)},chances:probabilities(.54)});
  const r=await select(args([m]));
  assert.equal(r.rows[0].p,.55);assert.equal(r.rows[0].floor,1.91);
});
test('new presentation assets have content versions',()=>{
  const base='docs/algorithm/';
  const version=p=>crypto.createHash('sha256').update(fs.readFileSync(base+p)).digest('hex').slice(0,12);
  const app=fs.readFileSync(base+'app.js','utf8'),html=fs.readFileSync(base+'index.html','utf8');
  assert.ok(app.includes('conditional-prices.js?v='+version('conditional-prices.js')));
  assert.ok(html.includes('app.js?v='+version('app.js'))&&html.includes('style.css?v='+version('style.css')));
});
