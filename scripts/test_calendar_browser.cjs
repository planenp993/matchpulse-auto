/* Replays the reported missing-day bug using real, immutable published records. */
(async()=>{
 'use strict';
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{chromium}=require('playwright');
 const B=require('./schedule_archive.cjs'),J=require('./forecast_diary.cjs'),D=require('../docs/scout-data.js');
 const record=J.readLedger('docs/data/diary/selections/match-plans-v3').forecasts[0],date=record.fixture.date;
 const fixed=new Date(date+'T12:00:00Z');fixed.setUTCDate(fixed.getUTCDate()+1);
 const registry=JSON.parse(fs.readFileSync('data/match_registry.json'));
 const ledgers=B.VERSIONS.map(([version,p])=>({version,...J.readLedger(p)}));
 const doc=B.build({registry,ledgers,now:fixed}),entry=doc.entries.find(e=>e.forecast?.id===record.id);
 assert.ok(entry);const body=Buffer.from(JSON.stringify(doc)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const manifest=JSON.parse(fs.readFileSync('docs/data/client_manifest.json'));manifest.files['schedule_archive.json']={bytes:body.length,sha256:hash(body)};manifest.version=hash(D.canonical(manifest.files));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SCOUT_BROWSER_EXECUTABLE?{executablePath:process.env.SCOUT_BROWSER_EXECUTABLE}:{})}),errors=[];
 async function page(width=1280,offline=false,fail=false){
  const p=await browser.newPage({viewport:{width,height:900}});p.on('pageerror',e=>errors.push(String(e)));let requests=0;
  await p.route('**/data/client_manifest.json*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(manifest)}));
  await p.route('**/data/schedule_archive.json*',r=>{requests++;return r.fulfill(fail&&requests===1?{status:503,body:'unavailable'}:{contentType:'application/json',body});});
  await p.addInitScript(({fixed,doc,date})=>{
   const Original=Date;window.Date=class extends Original{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};
   // Even a still-retained fixture must not need the upcoming-only path.
   if(location.protocol==='file:'){let data;Object.defineProperty(window,'SCOUT_EMBEDDED_DATA',{get(){return data;},set(v){v.scheduleArchive=doc;v.fixtures=v.fixtures.filter(f=>f[3]!==date);data=v;}});}
  },{fixed:+fixed,doc,date});
  await p.goto(offline?'file://'+path.resolve('scout-offline.html'):'http://127.0.0.1:8765/scout.html',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>document.getElementById('lastSync').textContent.includes('Програма:'));
  await p.locator('#dateInput').fill(date);await p.locator('#dateInput').dispatchEvent('change');
  return p;
 }
 async function dayReady(p){await p.waitForFunction(()=>document.querySelectorAll('.fixture-row').length>0&&!document.getElementById('programSummary').textContent.includes('Зареждам'));}
 const p=await page();await dayReady(p);
 const key=record.fixture_key,button=p.locator('.fixture-row').filter({hasText:record.fixture.home+' – '+record.fixture.away});
 assert.equal(await button.count(),1);assert.ok((await p.locator('#programTitle').textContent()).includes('Архивна'));
 assert.ok((await button.textContent()).includes('Записана:'));
 const privateBefore=await p.evaluate(()=>localStorage.getItem('matchpulse-scout-picks-v1'));
 await p.evaluate(()=>{window.__archiveLiveCalls=0;const original=Model.evaluate;Model.evaluate=(...args)=>{window.__archiveLiveCalls++;return original(...args);};});
 await button.click();await p.waitForFunction(()=>document.getElementById('matchPlan')?.getAttribute('aria-busy')==='false');
 assert.ok((await p.locator('#matchPlan').textContent()).includes('Предмачов запис'));
 assert.equal(await p.locator('#matchPlan [data-archived-market]').first().getAttribute('data-archived-market'),record.selection.main.id);
 assert.equal(await p.locator('#matchPlan .selection-metrics b').first().textContent(),(100*record.selection.main.probability).toFixed(1)+'%');
 assert.deepEqual(await p.evaluate(()=>dossier(activeMatch).model.distribution.probs),record.model.probabilities);
 assert.equal(await p.evaluate(()=>window.__archiveLiveCalls),0);assert.equal(await p.locator('#savePick').count(),0);assert.equal(await p.locator('#matchPlan [data-selection-input]').count(),0);
 await p.context().grantPermissions(['clipboard-read','clipboard-write']);await p.locator('#copyMatch').click();
 await p.waitForFunction(()=>document.getElementById('copyStatus').textContent.includes('копирано'));
 assert.ok((await p.evaluate(()=>navigator.clipboard.readText())).includes('ЗАПИСАНА ПРОГНОЗА'));
 await p.locator('#matchPlan').screenshot({path:'scout-calendar-plan.png'});await p.locator('#closeMatch').click();
 assert.equal(await p.evaluate(()=>localStorage.getItem('matchpulse-scout-picks-v1')),privateBefore);
 await p.screenshot({path:'scout-calendar-desktop.png',fullPage:false});
 for(const width of [390,320]){
  const mobile=await page(width);await dayReady(mobile);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mobile.locator('.fixture-row').filter({hasText:record.fixture.home+' – '+record.fixture.away}).click();await mobile.waitForFunction(()=>document.getElementById('matchPlan')?.getAttribute('aria-busy')==='false');
  assert.equal(await mobile.locator('#matchOverlay').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await mobile.locator('#matchPlan').screenshot({path:'scout-calendar-'+width+'.png'});await mobile.close();
 }
 const offline=await page(1280,true);await dayReady(offline);assert.ok((await offline.locator('#scheduleList').textContent()).includes(record.fixture.home));assert.equal(await offline.locator('script[src]').count(),0);
 const retry=await page(1280,false,true);await retry.locator('#retryCalendarArchive').waitFor();await retry.locator('#retryCalendarArchive').click();await dayReady(retry);
 assert.deepEqual(errors,[]);console.log('CALENDAR_ARCHIVE_BROWSER_OK '+JSON.stringify({date,key,sourceRecord:record.sha256,frozenProbabilities:true,noRetrospectiveForecast:true,privatePicksUntouched:true,mobileWidths:[390,320],offline:true,retry:true}));
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
