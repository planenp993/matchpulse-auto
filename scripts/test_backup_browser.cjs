/* Personal backup acceptance uses synthetic notes in isolated browser storage. */
(async()=>{
 'use strict';
 const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SCOUT_BROWSER_EXECUTABLE?{executablePath:process.env.SCOUT_BROWSER_EXECUTABLE}:{})});
 const errors=[],base='http://127.0.0.1:8765/scout.html';
 async function page(viewport={width:1280,height:900},url=base){
  const p=await browser.newPage({viewport});p.on('pageerror',e=>errors.push(String(e)));
  await p.addInitScript(()=>{const Original=Date,now=Original.parse('2026-10-28T08:00:00Z');window.Date=class extends Original{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};});
  await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.getElementById('lastSync').textContent.includes('Програма:'));
  await p.locator('[data-view="picks"]').click();await p.locator('.personal-backup > summary').click();return p;
 }
 const source=await page();
 const seed=await source.evaluate(()=>{
  const f=fixtures.find(f=>f[0]==='I1'&&f[3]==='2026-10-28'&&f[5]==='Milan');
  const pick={id:'synthetic-backup-test',div:f[0],date:f[3],time:f[4],home:f[5],away:f[6],fixtureKey:Scout.keyFixture(f),market:'o25',odds:1.85,modelProbability:.618,analysisWindow:10,model:'standard',createdAt:'2026-10-28T07:00:00Z'};
  const prices={[Scout.keyFixture(f)+'::1']:{kind:'manual',odds:1.2,book:'Въведена от теб',observed_at_utc:'2026-10-24T07:00:00Z'}};
  localStorage.setItem(MatchpulseBackup.PICKS,JSON.stringify([pick]));localStorage.setItem(MatchpulseBackup.PRICES,JSON.stringify(prices));
  return {picks:[pick],prices,key:Scout.keyFixture(f)};
 });
 const download=source.waitForEvent('download');await source.locator('#backupExport').click();
 const raw=fs.readFileSync(await (await download).path(),'utf8'),doc=JSON.parse(raw);
 assert.equal(doc.format,'matchpulse-personal-backup');assert.deepEqual(doc.picks,seed.picks);assert.deepEqual(doc.manual_prices,seed.prices);
 const target=await page({width:390,height:844});
 const file=text=>({name:'personal-backup.json',mimeType:'application/json',buffer:Buffer.from(text)});
 await target.locator('#backupFile').setInputFiles(file(raw));
 await target.waitForFunction(()=>!document.getElementById('backupPreview').classList.contains('hidden'));
 assert.equal(await target.evaluate(()=>localStorage.getItem(MatchpulseBackup.PICKS)),null);
 assert.ok((await target.locator('#backupPreviewText').textContent()).includes('1 нови прогнози'));
 await target.locator('#backupApply').click();
 assert.deepEqual(await target.evaluate(()=>MatchpulseBackup.read(localStorage)),{picks:seed.picks,prices:seed.prices});
 assert.ok((await target.locator('.pick-card').textContent()).includes('62%'));
 await target.evaluate(async key=>{await MatchpulseLoading.ensureExtras();openMatch(fixtures.find(f=>Scout.keyFixture(f)===key));},seed.key);
 await target.waitForFunction(()=>document.getElementById('matchPlan')?.getAttribute('aria-busy')==='false'&&document.querySelector('#matchPlan .selection-primary'));
 const card=target.locator('#matchPlan');
 assert.ok((await card.textContent()).includes('Въведена от теб'));assert.ok((await card.textContent()).includes('Стара / непотвърдена цена'));
 await target.locator('#closeMatch').click();
 await target.locator('[data-view="picks"]').click();
 await target.locator('#backupFile').setInputFiles(file(raw));await target.waitForFunction(()=>!document.getElementById('backupPreview').classList.contains('hidden'));
 assert.equal(await target.locator('#backupApply').isEnabled(),false);await target.locator('#backupCancel').click();
 const before=await target.evaluate(()=>MatchpulseBackup.read(localStorage));
 await target.locator('#backupFile').setInputFiles(file('{invalid json'));
 await target.waitForFunction(()=>document.getElementById('backupStatus').textContent.includes('не е валиден JSON'));
 assert.deepEqual(await target.evaluate(()=>MatchpulseBackup.read(localStorage)),before);
 assert.equal(await target.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await target.setViewportSize({width:320,height:780});assert.equal(await target.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await target.screenshot({path:'scout-backup-mobile.png',fullPage:false});
 await target.reload({waitUntil:'domcontentloaded'});await target.waitForFunction(()=>document.getElementById('lastSync').textContent.includes('Програма:'));
 assert.deepEqual(await target.evaluate(()=>MatchpulseBackup.read(localStorage)),before);
 const offline=await page({width:1280,height:900},'file://'+path.resolve('scout-offline.html'));
 await offline.locator('#backupFile').setInputFiles(file(raw));await offline.waitForFunction(()=>!document.getElementById('backupPreview').classList.contains('hidden'));
 await offline.locator('#backupApply').click();assert.deepEqual(await offline.evaluate(()=>MatchpulseBackup.read(localStorage)),before);
 const blocked=await browser.newPage();blocked.on('pageerror',e=>errors.push(String(e)));
 await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}}));
 await blocked.goto(base,{waitUntil:'domcontentloaded'});await blocked.waitForFunction(()=>document.getElementById('lastSync').textContent.includes('Програма:'));
 assert.ok((await blocked.locator('#backupStatus').textContent()).includes('не е достъпно'));
 assert.deepEqual(errors,[]);console.log('PERSONAL_BACKUP_BROWSER_OK export preview restore dedup corrupt-file mobile offline storage-blocked');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
