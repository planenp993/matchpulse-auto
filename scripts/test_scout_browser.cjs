/* Browser smoke test for Scout, run by branch-only GH Action. */
(async()=>{
 const {chromium}=require('playwright');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.SCOUT_BROWSER_EXECUTABLE?{executablePath:process.env.SCOUT_BROWSER_EXECUTABLE}:{})});
 console.log('Scout browser: '+browser.version());
 const base='http://127.0.0.1:8765/scout.html';
 const failures=[],stats={};
 const desktop=await browser.newPage({viewport:{width:1365,height:920},deviceScaleFactor:1});
 desktop.on('pageerror',e=>failures.push('desktop: '+String(e)));
 await desktop.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
 await desktop.waitForFunction(()=>document.getElementById('lastSync')?.textContent.includes('Програма:'),{timeout:20000});
 const covered=await desktop.locator('#leagueSelect option').evaluateAll(options=>options.map(x=>x.value));
 for(const league of ['D1','I1','D2','I2','B1','G1','SP2','SC0','P1','T1','E2','E3']){
  if(!covered.includes(league))throw new Error('Expanded calendar is missing '+league);
 }
 stats.calendarCompetitions=covered.filter(Boolean).length;
 await desktop.locator('[data-day="7"]').click();
 await desktop.locator('#leagueSelect').selectOption('E0');

 const fixtures=await desktop.locator('.fixture-row').count();
 if(!fixtures)throw new Error('No next-7-days fixtures');
 stats.fixtures=fixtures;
 await desktop.screenshot({path:'scout-desktop.png',fullPage:true});
 await desktop.locator('.fixture-row').first().click();
 if((await desktop.locator('.team-elo').count())!==2)throw new Error('Each team needs its simple Elo reference');
 await desktop.locator('#drawerWindow').selectOption('20');
 if((await desktop.locator('.goal-chart').first().locator(':scope > div').count())!==20)throw new Error('The 20-game chart is truncated');
 await desktop.locator('.history-section summary').click();
 const lists=await desktop.locator('.history-section .history-grid > div').all();
 if((await lists[0].locator('.match-history').count())!==20)throw new Error('The 20-game result list is truncated');
 await desktop.locator('.history-section summary').click();
 await desktop.screenshot({path:'scout-match.png',fullPage:false});
 await desktop.locator('#drawerWindow').selectOption('5');
 if(!(await desktop.locator('#matchContent').textContent()).includes('последните 5 мача'))throw new Error('In-match 5-game stats did not re-render');
 if((await desktop.locator('#researchWindow').inputValue())!=='5')throw new Error('Global selector did not sync');
 await desktop.locator('#drawerWindow').selectOption('10');

 if(await desktop.locator('#matchOverlay').evaluate(el=>el.classList.contains('hidden')))throw new Error('Match drawer failed to open');
 if(!(await desktop.locator('#matchContent').textContent()).includes('1X2 и двоен шанс'))throw new Error('Missing 1X2 analysis');
 if(!(await desktop.locator('#matchContent').textContent()).includes('Двоен шанс 1X'))throw new Error('Missing double chance');
 await desktop.locator('.extra-analytics summary').click();
 if(!(await desktop.locator('.extra-analytics').textContent()).includes('Корнери'))throw new Error('Missing corner statistics');
 await desktop.locator('#pickMarket').selectOption('1X');
 await desktop.locator('#closeMatch').click();
 await desktop.locator('[data-view="scanner"]').click();
 await desktop.locator('#scanWindow').selectOption('7');
 await desktop.locator('.scanner-more summary').click();
 await desktop.locator('#scanVenue').selectOption('venue');
 if(!(await desktop.locator('#scannerSummary').textContent()).includes('домакинства'))throw new Error('Venue scanner did not activate');
 await desktop.locator('#scanVenue').selectOption('all');
 await desktop.locator('#scanStreak').selectOption('3');
 await desktop.locator('#scanBoth').selectOption('no');
 await desktop.locator('#scanMarket').selectOption('corners85');
 if((await desktop.locator('#scanMarket').inputValue())!=='corners85')throw new Error('Corner scanner selection failed');
 for(const market of ['corners85','yellow35','shots215']){
  await desktop.locator('#scanMarket').selectOption(market);
  const count=await desktop.locator('.scan-card').count();
  if(!count)throw new Error('No observable '+market+' signal despite imported real statistics');
  stats[market]=count;
 }
 await desktop.locator('#scanMarket').selectOption('o25');
 await desktop.locator('#scanMarket').selectOption('all');
 if((await desktop.locator('#scanMarket').inputValue())!=='all')throw new Error('All-markets scanner toggle missing');
 const autoCount=await desktop.locator('.scan-card').count();
 if(!autoCount)throw new Error('Auto-discovery should find at least one observable streak');
 const ranks=await desktop.locator('.scan-card').evaluateAll(cards=>cards.map(c=>Number(c.dataset.evidenceRank)));
 if(ranks.some((value,i)=>!Number.isFinite(value)||(i>0&&value>ranks[i-1])))throw new Error('Scanner evidence ranks are invalid or out of order');
 const contexts=await desktop.locator('.scan-context').allTextContents();
 if(contexts.length!==autoCount||contexts.some(text=>!text.includes('Лига:')&&!text.includes('Малка база за лигата')))throw new Error('Missing league-reference context');
 if(!(await desktop.locator('#scannerSummary').textContent()).startsWith(String(autoCount)+' '))throw new Error('Scanner summary disagrees with visible cards');
 stats.allMarketCandidates=autoCount;
 stats.evidenceRanking=true;
 await desktop.locator('#scanStreak').selectOption('7');
 if((await desktop.locator('#scanStreak').inputValue())!=='7')throw new Error('7+ streak selector missing');
 await desktop.locator('#scanStreak').selectOption('3');
 await desktop.locator('#scanMarket').selectOption('o25');

 const scans=await desktop.locator('.scan-card').count();
 stats.scannerCards=scans;
 if(!scans)throw new Error('No goal-trend signal on fixture test data');
 await desktop.locator('.scan-card .button').first().click();
 await desktop.locator('#pickMarket').selectOption('o25');
 await desktop.locator('#pickOdds').fill('1.85');
 await desktop.locator('#savePick').click();
 const cards=await desktop.locator('.pick-card').count();
 if(!cards)throw new Error('Notebook did not store a pick');
 stats.saved=cards;
 const saved=await desktop.evaluate(()=>JSON.parse(localStorage.getItem('matchpulse-scout-picks-v1')));
 if(!(saved[0].modelProbability>0&&saved[0].modelProbability<1))throw new Error('Prematch model probability was not saved');
 if(![5,10,20].includes(saved[0].analysisWindow))throw new Error('Missing saved analysis window');
 const download=desktop.waitForEvent('download');
 await desktop.locator('#exportPicks').click();
 const csv=require('node:fs').readFileSync(await (await download).path(),'utf8');
 if(!csv.includes('modelProbability')||!csv.includes('pending')||!csv.includes(String(saved[0].modelProbability)))throw new Error('CSV lacks the recorded probability or actual result state');
 await desktop.reload({waitUntil:'domcontentloaded'});
 await desktop.waitForFunction(()=>document.getElementById('lastSync')?.textContent.includes('Програма:'));
 const retained=await desktop.evaluate(()=>JSON.parse(localStorage.getItem('matchpulse-scout-picks-v1')));
 if(retained[0].modelProbability!==saved[0].modelProbability)throw new Error('Saved probability changed on reload');
 await desktop.locator('[data-view="diary"]').click();
 await desktop.waitForFunction(()=>document.querySelectorAll('.diary-entry').length>0,{timeout:20000});
 const diary=require('node:fs').readFileSync('docs/data/diary_report.json','utf8'),diaryDoc=JSON.parse(diary),firstForecast=diaryDoc.recent[0];
 if((await desktop.locator('.diary-totals b').first().textContent())!==String(diaryDoc.totals.recorded))throw new Error('Diary count is not the published prospective count');
 const firstEntry=desktop.locator('[data-forecast-id="'+firstForecast.id+'"]');
 if(!(await firstEntry.locator('.diary-probabilities').textContent()).includes('1 '+(firstForecast.probabilities.homeWin*100).toFixed(0)+'%'))throw new Error('Diary does not show the saved pre-match probability');
 const privateAfterDiary=await desktop.evaluate(()=>JSON.parse(localStorage.getItem('matchpulse-scout-picks-v1')));
 if(JSON.stringify(privateAfterDiary)!==JSON.stringify(retained))throw new Error('Automatic diary changed private picks');
 const paired=diaryDoc.paired_model_test;
 if(paired){
  await desktop.locator('#view-diary summary').click();
  const quality=desktop.locator('#diaryQuality');
  if(!(await quality.textContent()).includes('Паралелна проверка: '+paired.totals.recorded))throw new Error('Paired comparison count is missing');
  if(!(await quality.locator('thead').textContent()).includes('Кандидат'))throw new Error('Paired model columns are missing');
  const ns=await quality.locator('tbody tr td:nth-child(2)').allTextContents();
  if(ns.some(n=>n!==String(paired.totals.settled)))throw new Error('Paired quality table mixes different cohorts');
  await desktop.locator('#view-diary summary').click();
 }
 await desktop.screenshot({path:'scout-diary.png',fullPage:false});
 stats.diaryForecasts=diaryDoc.totals.recorded;
 await desktop.locator('[data-view="schedule"]').click();
 await desktop.locator('#scheduleStandings > summary').click();
 await desktop.waitForFunction(()=>!document.getElementById('standingsContent').textContent.includes('Зареждане'));
 const publishedTables=JSON.parse(require('node:fs').readFileSync('docs/data/standings.json','utf8'));
 if(publishedTables.tables.E0){
  await desktop.locator('#standingsLeague').selectOption('E0');
  await desktop.waitForFunction(()=>document.querySelectorAll('#standingsContent tbody tr').length===20);
  stats.standingsRows=await desktop.locator('#standingsContent tbody tr').count();
  await desktop.locator('#scheduleStandings').screenshot({path:'scout-standings.png'});
  await desktop.locator('#scheduleStandings > summary').click();
  await desktop.locator('[data-day="7"]').click();
  await desktop.locator('#leagueSelect').selectOption('E0');
  await desktop.locator('.fixture-row').first().click();
  await desktop.locator('#matchStandingsDetails > summary').click();
  await desktop.waitForFunction(()=>document.querySelectorAll('#matchStandingsContent .standing-selected').length===2);
  stats.standingsHighlighted=await desktop.locator('#matchStandingsContent .standing-selected').count();
  await desktop.locator('#closeMatch').click();
 }else await desktop.locator('#scheduleStandings > summary').click();

 const mobile=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 mobile.on('pageerror',e=>failures.push('mobile: '+String(e)));
 await mobile.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
 await mobile.waitForFunction(()=>document.getElementById('lastSync')?.textContent.includes('Програма:'),{timeout:20000});
 await mobile.locator('[data-day="7"]').click();
 if(await mobile.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1))throw new Error('Mobile schedule overflows horizontally');
 if((await mobile.locator('.fixture-row').first().boundingBox()).y>700)throw new Error('Mobile program is buried below introductory copy');
 await mobile.screenshot({path:'scout-mobile.png',fullPage:true});
 await mobile.locator('.fixture-row').first().click();
 await mobile.locator('#drawerWindow').selectOption('20');
 if(await mobile.locator('.drawer').evaluate(el=>el.scrollWidth>el.clientWidth+1))throw new Error('Mobile analysis overflows horizontally');
 if(publishedTables.tables[await mobile.evaluate(()=>activeMatch[0])]){
  await mobile.locator('#matchStandingsDetails > summary').click();
  await mobile.waitForFunction(()=>document.querySelectorAll('#matchStandingsContent tbody tr').length>0);
  if(await mobile.locator('.drawer').evaluate(el=>el.scrollWidth>el.clientWidth+1))throw new Error('Mobile standings overflow the analysis');
  await mobile.locator('#matchStandingsDetails').screenshot({path:'scout-standings-mobile.png'});
  if(await mobile.locator('#matchStandingsContent .standings-table th').first().boundingBox()===null)throw new Error('Mobile standings are hidden');
 }
 await mobile.locator('#closeMatch').click();
 stats.mobileFixtures=await mobile.locator('.fixture-row').count();
 if(!stats.mobileFixtures)throw new Error('Mobile day program is empty');
 await mobile.locator('[data-view="scanner"]').click();
 await mobile.locator('#scanWindow').selectOption('7');
 if(!(await mobile.locator('.scan-context').count()))throw new Error('Mobile scanner context missing');
 if(await mobile.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1))throw new Error('Mobile scanner overflows horizontally');
 await mobile.screenshot({path:'scout-scanner.png',fullPage:false});
 await mobile.locator('[data-view="diary"]').click();
 await mobile.waitForFunction(()=>document.querySelectorAll('.diary-entry').length>0,{timeout:20000});
 if(paired)await mobile.locator('#view-diary summary').click();
 if(await mobile.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1))throw new Error('Mobile diary overflows horizontally');
 stats.europeArchive=await desktop.evaluate(()=>({domestic:index.history.length,total:archive.international.history.length,
  europeanInDomestic:index.history.some(r=>MatchpulseArchive.european(r))}));
 if(stats.europeArchive.europeanInDomestic)throw new Error('UEFA rows contaminated the domestic index');
 if(stats.europeArchive.total>stats.europeArchive.domestic){
  const euroFixture=await desktop.evaluate(()=>fixtures.find(f=>MatchpulseArchive.european(f)&&!profile(f).home.proxy&&!profile(f).away.proxy));
  if(!euroFixture)throw new Error('Imported UEFA archive is unavailable to all future dossiers');
  await desktop.evaluate(f=>openMatch(f),euroFixture);
  if(!(await desktop.locator('#matchContent').textContent()).includes('няма моделни проценти'))throw new Error('UEFA model guard disappeared');
  const scope=await desktop.evaluate(()=>({home:profile(activeMatch).home.all.map(r=>r[0]),away:profile(activeMatch).away.all.map(r=>r[0]),div:activeMatch[0]}));
  if(!scope.home.length||!scope.away.length||[...scope.home,...scope.away].some(d=>d!==scope.div))throw new Error('UEFA dossier mixed domestic or other tournament form');
  await desktop.locator('#closeMatch').click();
 }
 if(failures.length)throw new Error('Browser JS errors: '+failures.join(' | '));
 console.log('SCOUT_BROWSER_OK '+JSON.stringify(stats));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
