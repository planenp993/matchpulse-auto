'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {gunzipSync,gzipSync}=require('node:zlib');
const {chromium}=require('playwright');

(async()=>{
  const {sofiaDate}=await import('../docs/algorithm/catalog.js');
  const {calendarKey,shiftDay}=await import('../docs/algorithm/calendar-view.js');
  const dir='docs/algorithm/data/';
  const original=JSON.parse(gunzipSync(fs.readFileSync(dir+'snapshot.json.gz')));
  const registered=JSON.parse(fs.readFileSync(dir+'prime-value/state.json'));
  const fixtureDay=shiftDay(sofiaDate(Date.parse(registered.createdAt)),1);
  const t=Date.parse(fixtureDay+'T08:00:00Z'),kickoff=new Date(t+6*3600000).toISOString();
  const observed=new Date(t+10*3600000).toISOString();
  const base=original.matches.find(m=>m.league==='E0'&&m.facts);
  assert.ok(base);
  const probs=(x,b=.62)=>({over_2_5:x,under_2_5:1-x,btts_yes:b,btts_no:1-b});
  const testFixture={...base,id:'epl/prime-value-test',home:'Test Home',away:'Test Away',kickoff,issued:new Date(t-20000).toISOString(),
    model:'similar_defence',probabilities:{...base.probabilities,...probs(.63)},selectionForecast:{probabilities:probs(.63)},chances:probs(.62)};
  const key=calendarKey('E0',fixtureDay,testFixture.home,testFixture.away);
  const finalBucket={schema:1,day:fixtureDay,forecasts:[],results:[{key,league:'E0',home:testFixture.home,away:testFixture.away,kickoff,
    exactKickoff:true,score:[2,1],observed,source:'Test regulation result'}]};
  const browser=await chromium.launch({headless:true,executablePath:process.env.SCOUT_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  try{
    for(const viewport of [{width:1280,height:850},{width:390,height:844}]){
      const page=await browser.newPage({viewport,deviceScaleFactor:1});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      let settled=false;
      const iso=()=>new Date(settled?Date.parse(observed):t-20000).toISOString();
      await page.route('**/algorithm/data/snapshot.json.gz',route=>route.fulfill({status:200,contentType:'application/gzip',body:gzipSync(JSON.stringify({
        ...original,asOf:iso(),calendarTime:iso(),xgTime:iso(),forecastRelease:registered.rule.release,matches:settled?[]:[testFixture]
      }))}));
      await page.route('**/algorithm/data/prime-value/state.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        ...registered,updatedAt:iso(),latest:{day:fixtureDay,at:iso(),snapshotAt:iso(),status:'no_quotes',
          counts:{scheduled:1,eligible:1,twoModels:1,quotedPairs:0,quotedMatches:0,qualified:0},reasons:{}},
        stats:{recorded:0,settled:0,hits:0,pending:0,review:0,hitRate:null,roi:null,profit:null,averageOdds:null,brier:null},
        picks:[],days:[{day:fixtureDay,checked:1,quotedPairs:0,selected:0,status:'no_quotes'}]
      })}));
      await page.route('**/algorithm/data/match-history/index.json',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        schema:1,start:'2026-11-23',cursor:'a'.repeat(40),days:settled?{[fixtureDay]:{forecasts:0,results:1,sha256:'b'.repeat(64)}}:{}
      })}));
      await page.route('**/algorithm/data/match-history/'+fixtureDay+'.json.gz*',route=>route.fulfill({status:200,contentType:'application/gzip',
        body:gzipSync(JSON.stringify(finalBucket))}));
      await page.clock.setFixedTime(new Date(t));
      await page.goto('http://127.0.0.1:8765/algorithm/#value',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#pv-fixture option')?.value==='epl/prime-value-test');
      assert.equal(await page.locator('#pv-today-count').innerText(),'0 / 3');
      assert.match(await page.locator('#pv-status').innerText(),/Няма свежи/);
      await page.locator('#pv-book').fill('Test Bookmaker');
      await page.locator('#pv-first').fill('1,33');
      await page.locator('#pv-other').fill('3,50');
      await page.locator('#pv-form button').click();
      assert.match(await page.locator('#pv-drafts').innerText(),/Извън 1,70–2,00/);
      assert.equal(await page.locator('#pv-commit').isEnabled(),false);
      await page.locator('#pv-first').fill('1,90');
      await page.locator('#pv-other').fill('1,96');
      await page.locator('#pv-form button').click();
      assert.match(await page.locator('#pv-draft-count').innerText(),/^1 от максимум 3/);
      await page.locator('#pv-commit').click();
      await page.waitForFunction(()=>document.querySelectorAll('#pv-local-diary .pv-card').length===1);
      assert.match(await page.locator('#pv-local-diary').innerText(),/Test Home – Test Away/);
      assert.equal(await page.locator('#pv-today-count').innerText(),'0 / 3');
      // A local paper record persists, but never modifies the public diary.
      await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelectorAll('#pv-local-diary .pv-card').length===1);
      assert.match(await page.locator('#pv-local-diary').innerText(),/Чака резултат/);
      settled=true;
      await page.clock.setFixedTime(new Date(Date.parse(observed)+1000));
      await page.locator('#refresh').click();
      await page.waitForFunction(()=>document.querySelector('#pv-local-diary')?.textContent.includes('Позната'));
      assert.match(await page.locator('#pv-local-stats').innerText(),/90,0%/);
      assert.equal(await page.locator('#pv-today-count').innerText(),'0 / 3');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
  console.log('Verified Prime Value public zero-quote state, price band, local pre-match recording, persistence, separate public journal and final settlement on desktop and phone.');
})().catch(error=>{console.error(error);process.exit(1);});
