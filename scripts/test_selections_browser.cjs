/* Deterministic browser acceptance for the new view, with real bundled history. */
(async()=>{
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SCOUT_BROWSER_EXECUTABLE?{executablePath:process.env.SCOUT_BROWSER_EXECUTABLE}:{})});
 const errors=[],stats={browser:browser.version(),checkedAt:new Date().toISOString()},base='http://127.0.0.1:8765/scout.html';
 async function prepare(page){
  page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   const Original=Date,fixed=Original.parse('2026-10-28T07:00:00Z');
   window.Date=class extends Original{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
  });
 }
 async function ready(page){await page.waitForFunction(()=>document.getElementById('lastSync')?.textContent.includes('Програма:'));}
 async function selectionReady(page){await page.waitForFunction(()=>document.getElementById('selectionList')?.getAttribute('aria-busy')==='false'&&!document.getElementById('selectionSummary').textContent.includes('Преглеждам'),{timeout:60000});}
 async function selectWeek(page){
  await page.locator('[data-view="selections"]').click();await selectionReady(page);
  await page.locator('[data-selection-period="7"]').click();await selectionReady(page);
 }
 const desktop=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});await prepare(desktop);
 await desktop.goto(base,{waitUntil:'domcontentloaded',timeout:60000});await ready(desktop);
 const privateBefore=await desktop.evaluate(()=>localStorage.getItem('matchpulse-scout-picks-v1'));
 const initialModel=await desktop.evaluate(()=>{const f=fixtures.find(r=>r[0]==='E0'&&r[3]>='2026-10-29');return {key:Scout.keyFixture(f),probabilities:Model.evaluate(history,f,'standard').distribution.probs};});
 await selectWeek(desktop);
 assert.ok(await desktop.locator('.selection-primary').count()>0);
 const summary=await desktop.locator('#selectionSummary').textContent();assert.ok(summary.includes('без ясен избор'));stats.summary=summary;
 const totalBefore=await desktop.locator('.selection-card').count();await desktop.locator('#selectionMore').click();assert.ok(await desktop.locator('.selection-card').count()>totalBefore);
 const card=desktop.locator('.selection-card').filter({has:desktop.locator('.selection-primary')}).first(),key=await card.getAttribute('data-selection-fixture');
 const primary=card.locator('.selection-primary'),market=await primary.getAttribute('data-selection-market');
 const expected=await desktop.evaluate(({key,market})=>{const f=fixtures.find(r=>Scout.keyFixture(r)===key),m=Model.evaluate(history,f,'standard');const p=window.MatchpulseSelections.probability(m.distribution.matrix,[market]);return {probability:(p*100).toFixed(1)+'%',fair:(1/p).toFixed(2)};},{key,market});
 assert.equal(await primary.locator('.selection-metrics b').nth(0).textContent(),expected.probability);
 assert.equal(await primary.locator('.selection-metrics b').nth(1).textContent(),expected.fair);
 await card.locator('.selection-why summary').click();assert.ok((await card.textContent()).includes('10 налични срещи'));
 await card.screenshot({path:'scout-selection-card.png'});
 await card.locator('.selection-why summary').click();
 await primary.locator('.selection-compare summary').click();
 const input=primary.locator('[data-selection-input]');await input.fill('4,00');await input.blur();await selectionReady(desktop);
 const saved=await desktop.evaluate(()=>JSON.parse(localStorage.getItem('matchpulse-selection-quotes-v1')||'{}'));
 assert.equal(saved[key+'::'+market].odds,4);assert.equal(saved[key+'::'+market].kind,'manual');
 assert.ok((await desktop.locator('#selectionList').textContent()).includes('Въведена от теб'));
 await desktop.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__selectionCopied=text;}}}));
 await desktop.locator('[data-selection-copy]').first().click();await desktop.waitForFunction(()=>window.__selectionCopied?.includes('Честен')||window.__selectionCopied?.includes('честен'));
 assert.ok((await desktop.evaluate(()=>window.__selectionCopied)).includes('selections-v1'));
 await desktop.locator('[data-selection-analysis]').first().click();
 assert.ok(await desktop.locator('#matchOverlay').isVisible());await desktop.locator('#closeMatch').click();
 await desktop.locator('#selectionQuality').selectOption('price');
 assert.ok(await desktop.locator('.selection-primary').count()>0);assert.ok((await desktop.locator('#selectionList').textContent()).includes('Цена над моделната')||(await desktop.locator('#selectionList').textContent()).includes('цена над моделната'));
 await desktop.locator('#selectionQuality').selectOption('all');
 await desktop.locator('[data-selection-tab="builders"]').click();assert.ok(await desktop.locator('.selection-builder').count()>0);
 const builder=desktop.locator('.selection-builder').first(),builderKey=await builder.locator('[data-selection-market]').getAttribute('data-selection-market');
 assert.ok(builderKey.split('+').length===2);await desktop.screenshot({path:'scout-builders.png',fullPage:false});
 await builder.locator('.selection-compare summary').click();const builderInput=builder.locator('[data-selection-input]');
 await builderInput.fill('4.00');await builderInput.blur();await selectionReady(desktop);
 await desktop.locator('#selectionQuality').selectOption('price');
 assert.ok(await desktop.locator('.selection-builder').count()>0);
 assert.ok((await desktop.locator('#selectionList').textContent()).includes('Въведена от теб'));
 const comparedBuilder=desktop.locator('.selection-builder').first();await comparedBuilder.locator('.selection-compare summary').click();
 await comparedBuilder.locator('[data-selection-input]').fill('');await comparedBuilder.locator('[data-selection-input]').blur();await selectionReady(desktop);
 await desktop.locator('#selectionQuality').selectOption('all');stats.builderPriceFilter=true;
 await desktop.locator('[data-selection-tab="columns"]').click();assert.ok(await desktop.locator('.selection-column').count()>0);
 stats.columns=await desktop.locator('.selection-column').count();await desktop.screenshot({path:'scout-columns.png',fullPage:false});
 await desktop.locator('[data-selection-tab="matches"]').click();
 await desktop.locator('#selectionLeague').selectOption('UCL');await selectionReady(desktop);
 assert.equal(await desktop.locator('.selection-primary').count(),0);assert.ok((await desktop.locator('#selectionList').textContent()).includes('Евротурнир'));
 await desktop.locator('#selectionLeague').selectOption('');await selectionReady(desktop);
 await desktop.evaluate(()=>window.scrollTo(0,0));await desktop.screenshot({path:'scout-selections.png',fullPage:false});
 await desktop.reload({waitUntil:'domcontentloaded'});await ready(desktop);await selectWeek(desktop);
 const retained=await desktop.evaluate(()=>JSON.parse(localStorage.getItem('matchpulse-selection-quotes-v1')||'{}'));
 assert.deepEqual(retained,saved);
 assert.equal(await desktop.evaluate(()=>localStorage.getItem('matchpulse-scout-picks-v1')),privateBefore);
 const unchanged=await desktop.evaluate(key=>{const f=fixtures.find(r=>Scout.keyFixture(r)===key);return Model.evaluate(history,f,'standard').distribution.probs;},initialModel.key);
 assert.deepEqual(unchanged,initialModel.probabilities);stats.manualPricePersistence=true;stats.unchangedModel=true;stats.privatePicksUntouched=true;

 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});await prepare(mobile);
 await mobile.goto(base,{waitUntil:'domcontentloaded'});await ready(mobile);await selectWeek(mobile);
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await mobile.screenshot({path:'scout-selections-mobile.png',fullPage:false});
 const mobileCard=mobile.locator('.selection-card').filter({has:mobile.locator('.selection-primary')}).first();
 await mobileCard.screenshot({path:'scout-selection-card-mobile.png'});
 await mobile.setViewportSize({width:320,height:780});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);stats.mobileWidths=[390,320];
 await mobile.locator('[data-selection-tab="builders"]').click();assert.ok(await mobile.locator('.selection-builder').count()>0);
 await mobile.locator('[data-selection-tab="columns"]').click();assert.ok(await mobile.locator('.selection-column').count()>0);

 const fallback=await browser.newPage({viewport:{width:1280,height:900}});await prepare(fallback);
 await fallback.route('**/data/selection_quotes.json*',route=>route.fulfill({status:503,body:'unavailable'}));
 await fallback.goto(base,{waitUntil:'domcontentloaded'});await ready(fallback);await selectWeek(fallback);
 assert.ok(await fallback.locator('.selection-primary').count()>0);
 assert.ok((await fallback.locator('#selectionQuoteStatus').textContent()).includes('не се заредиха'));stats.quoteFailureFallback=true;

 const offline=await browser.newPage({viewport:{width:1280,height:900}});await prepare(offline);
 await offline.goto('file://'+path.resolve('scout-offline.html'),{waitUntil:'domcontentloaded',timeout:60000});await ready(offline);await selectWeek(offline);
 assert.ok(await offline.locator('.selection-primary').count()>0);
 assert.equal(await offline.locator('script[src]').count(),0);stats.offline=true;
 assert.deepEqual(errors,[]);fs.writeFileSync('scout-selections-browser.json',JSON.stringify(stats,null,2)+'\n');
 console.log('SELECTIONS_BROWSER_OK '+JSON.stringify(stats));await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
