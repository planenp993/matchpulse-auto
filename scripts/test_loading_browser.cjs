/* Reproducible delivery benchmark: unchanged football data, gzip, paced replies.
 * The baseline is the last published version before the loading optimization.
 */
(async()=>{
 'use strict';
 const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),crypto=require('node:crypto');
 const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict'),{chromium}=require('playwright');
 const C=require('../docs/scout-core.js'),M=require('../docs/model-core.js'),D=require('../docs/scout-data.js');
 const ROOT=path.resolve(__dirname,'..'),DOC=path.join(ROOT,'docs'),BASE='7c5e981b7559237763d9a79caa7e353bdf89e60f';
 const history=JSON.parse(fs.readFileSync(path.join(DOC,'data/history.json'))),fixtures=JSON.parse(fs.readFileSync(path.join(DOC,'data/fixtures.json')));
 const sample=fixtures.find(f=>!['UCL','UEL','UECL'].includes(f[0])&&parseInt(f[4],10)>=12&&M.evaluate(history,f,'standard').distribution);
 assert.ok(sample,'A supported future fixture is required for the paired delivery test');
 const key=C.keyFixture(sample),fixed=Date.parse(sample[3]+'T06:00:00Z'),overrides=new Map(),bodies=new Map(),compressed=new Map();
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 function resource(route){
  const match=/^\/(baseline|updated)\/([A-Za-z0-9_.\/-]+)$/.exec(route);
  if(!match||match[2].includes('..'))return null;
  const [_,variant,file]=match;
  if(file.startsWith('data/'))return overrides.get(file.slice(5))||fs.readFileSync(path.join(DOC,file));
  if(!bodies.has(route))bodies.set(route,variant==='baseline'?execFileSync('git',['show',BASE+':docs/'+file],{cwd:ROOT,maxBuffer:2*1024*1024}):fs.readFileSync(path.join(DOC,file)));
  return bodies.get(route);
 }
 const server=http.createServer((req,res)=>{
  let body;try{body=resource(new URL(req.url,'http://localhost').pathname);}catch{}
  if(!body){res.writeHead(404);res.end();return;}
  const ext=path.extname(new URL(req.url,'http://localhost').pathname),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
  const digest=hash(body),gzip=String(req.headers['accept-encoding']).includes('gzip');
  if(gzip){if(!compressed.has(digest))compressed.set(digest,zlib.gzipSync(body));body=compressed.get(digest);}
  res.writeHead(200,{'Content-Type':(types[ext]||'text/plain')+'; charset=utf-8','Content-Length':body.length,'Cache-Control':'public,max-age=600',...(gzip?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{})});
  let at=0,timer;
  const write=()=>{if(res.destroyed)return;const end=Math.min(body.length,at+8192);res.write(body.subarray(at,end));at=end;if(at===body.length)res.end();else timer=setTimeout(write,32);};
  timer=setTimeout(write,60);res.on('close',()=>clearTimeout(timer));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SCOUT_BROWSER_EXECUTABLE?{executablePath:process.env.SCOUT_BROWSER_EXECUTABLE}:{})});
 const errors=[];
 async function prepare(){
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(({fixed})=>{
   const Original=Date;window.Date=class extends Original{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};
   document.addEventListener('DOMContentLoaded',()=>{
    const check=()=>{if(document.getElementById('lastSync')?.textContent.includes('Програма:')&&document.querySelector('.fixture-row')){window.__calendarAt=performance.now();window.__coreAtCalendar=document.documentElement.dataset.scoutCore==='ready';observer.disconnect();}};
    const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true,characterData:true});check();
   });
  },{fixed});return page;
 }
 async function measure(page,variant,reload=false){
  const seen=[],listener=r=>{if(r.url().includes('/data/'))seen.push(new URL(r.url()).pathname.split('/').at(-1));};page.on('request',listener);
  if(reload)await page.reload({waitUntil:'domcontentloaded'});else await page.goto('http://127.0.0.1:'+port+'/'+variant+'/scout.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Number.isFinite(window.__calendarAt),{timeout:60000});
  const calendar=await page.evaluate(()=>({ms:window.__calendarAt,coreReady:window.__coreAtCalendar}));
  if(variant==='updated'){
   assert.equal(calendar.coreReady,false,'The first schedule must precede full archive processing');
   assert.ok(!seen.some(n=>['europe_history.json','match_links.json','europe_fixture_names.json','coverage_audit.json'].includes(n)),'Supplementary archives must wait for a request');
  }
  const index=await page.evaluate(key=>fixtureRows.findIndex(f=>Scout.keyFixture(f)===key),key);assert.ok(index>=0);
  await page.locator('[data-fixture="'+index+'"]').click();
  await page.locator('#matchContent .model-analysis').waitFor({state:'visible',timeout:60000});
  const result=await page.evaluate(()=>({calendarMs:Math.round(window.__calendarAt),analysisMs:Math.round(performance.now()),
   encodedJSONBytes:performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname.includes('/data/')).reduce((n,r)=>n+r.encodedBodySize,0),
   model:Model.evaluate(history,activeMatch,'standard').distribution.probs,
   personalPicks:localStorage.getItem('matchpulse-scout-picks-v1'),manualPrices:localStorage.getItem('matchpulse-selection-quotes-v1')}));
  await page.locator('#closeMatch').click();page.removeListener('request',listener);return result;
 }
 const baseline=await prepare(),updated=await prepare(),report={browser:browser.version(),baselineCommit:BASE,fixtureKey:key,
  conditions:{gzip:true,perResponseKiBPerSecond:250,initialReplyDelayMs:60,viewport:[390,844]},baseline:{},updated:{}};
 report.baseline.cold=await measure(baseline,'baseline');report.baseline.warm=await measure(baseline,'baseline',true);
 report.updated.cold=await measure(updated,'updated');report.updated.warm=await measure(updated,'updated',true);
 for(const item of [report.baseline.warm,report.updated.cold,report.updated.warm]){
  assert.deepEqual(item.model,report.baseline.cold.model);assert.equal(item.personalPicks,null);assert.equal(item.manualPrices,null);
 }
 assert.ok(report.updated.cold.calendarMs<.6*report.baseline.cold.calendarMs,'Initial schedule must improve in the paced paired test');
 assert.ok(report.updated.warm.encodedJSONBytes<.2*report.baseline.warm.encodedJSONBytes,'Warm reload must avoid re-downloading unchanged archives');
 // A changed published history invalidates its old cached body. Only inert test
 // metadata changes; goals/statistics and all model probabilities stay identical.
 const changed=JSON.parse(fs.readFileSync(path.join(DOC,'data/history.json')));changed[0][13]={...(typeof changed[0][13]==='object'?changed[0][13]:{}),LOADING_CACHE_TEST:true};
 const raw=Buffer.from(JSON.stringify(changed)),manifest=JSON.parse(fs.readFileSync(path.join(DOC,'data/client_manifest.json')));
 manifest.files['history.json'].sha256=hash(raw);manifest.files['history.json'].bytes=raw.length;manifest.version=hash(D.canonical(manifest.files));
 overrides.set('history.json',raw);overrides.set('client_manifest.json',Buffer.from(JSON.stringify(manifest)));
 report.updated.newPublication=await measure(updated,'updated',true);
 assert.equal(await updated.evaluate(()=>history[0][13].LOADING_CACHE_TEST),true);assert.deepEqual(report.updated.newPublication.model,report.baseline.cold.model);
 assert.ok(report.updated.newPublication.encodedJSONBytes>report.updated.warm.encodedJSONBytes);
 assert.deepEqual(errors,[]);report.checks={unchangedModel:true,privateDataUntouched:true,newPublicationInvalidatesCache:true,extrasDeferred:true};
 fs.writeFileSync(path.join(ROOT,'scout-loading-browser.json'),JSON.stringify(report,null,2)+'\n');
 console.log('SCOUT_LOADING_BROWSER_OK '+JSON.stringify(report));await browser.close();await new Promise(resolve=>server.close(resolve));
})().catch(error=>{console.error(error);process.exit(1);});
