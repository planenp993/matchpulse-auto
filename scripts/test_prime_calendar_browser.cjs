'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {gunzipSync}=require('node:zlib');
const {chromium}=require('playwright');

(async()=>{
  const {sofiaDate}=await import('../docs/algorithm/catalog.js');
  const {calendarRows,shiftDay}=await import('../docs/algorithm/calendar-view.js');
  const {conditionalPriceSelection}=await import('../docs/algorithm/conditional-prices.js');
  const dir='docs/algorithm/data/';
  const snapshot=JSON.parse(gunzipSync(fs.readFileSync(dir+'snapshot.json.gz')));
  const index=JSON.parse(fs.readFileSync(dir+'match-history/index.json'));
  const now=Date.parse(snapshot.asOf)+20_000, today=sofiaDate(now);
  const fitted=JSON.parse(fs.readFileSync(dir+'extra-models.json'));
  const conditional=conditionalPriceSelection({snapshot,fitted,day:today,now});
  const selected=Object.keys(index.days).filter(d=>d<today&&index.days[d].forecasts>0&&index.days[d].results>0).sort().at(-1);
  assert.ok(selected,'a historical day with forecast and score');
  const bucket=JSON.parse(gunzipSync(fs.readFileSync(dir+'match-history/'+selected+'.json.gz')));
  const expected=calendarRows(bucket,snapshot,selected,now);
  const finished=expected.filter(m=>m.calendarState==='final');
  assert.ok(finished.some(m=>m.probabilities));
  const browser=await chromium.launch({headless:true,executablePath:process.env.SCOUT_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  try{
    for(const viewport of [{width:1280,height:850},{width:390,height:844}]){
      const page=await browser.newPage({viewport,deviceScaleFactor:1});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.clock.setFixedTime(new Date(now));
      await page.goto('http://127.0.0.1:8765/algorithm/',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>document.querySelector('#date-picker').value!=='');
      assert.equal(await page.locator('#conditional-prices').isVisible(),true);
      assert.match(await page.locator('#conditional-prices').innerText(),/не са реални котировки/);
      assert.equal(await page.locator('.conditional-row').count(),conditional.rows.length);
      assert.deepEqual(await page.locator('.conditional-row').evaluateAll(rows=>rows.map(x=>[x.dataset.match,x.dataset.floor])),
        conditional.rows.map(x=>[x.m.id,x.floor.toFixed(2)]));
      if(conditional.rows.length){
        await page.locator('.conditional-row').first().click();
        assert.match(await page.locator('#detail').innerText(),/праг за проверка/);
        assert.ok((await page.locator('#detail').innerText()).includes(conditional.rows[0].m.home));
        await page.getByRole('button',{name:'Затвори анализа'}).click();
      }
      // Arrows and the actual date input both work, including dates without picks.
      await page.locator('#previous-day').click();
      assert.equal(await page.locator('#date-picker').inputValue(),shiftDay(today,-1));
      assert.equal(await page.locator('#conditional-prices').isVisible(),false);
      await page.locator('#date-picker').fill(selected);
      await page.locator('#date-picker').dispatchEvent('change');
      await page.waitForFunction(n=>document.querySelectorAll('#fixture-list .final-row').length===n,finished.length);
      assert.equal(await page.locator('#fixture-list .match-button').count(),expected.length);
      assert.equal(await page.locator('#fixture-list .without-forecast').count(),expected.filter(m=>!m.probabilities).length);
      await page.locator('#fixture-list .final-row:not(.without-forecast)').first().click();
      assert.match(await page.locator('#detail').innerText(),/Предмачов запис/);
      assert.match(await page.locator('#detail').innerText(),/Краен резултат \d+:\d+/);
      await page.getByRole('button',{name:'Затвори анализа'}).click();
      if(await page.locator('#fixture-list .without-forecast').count()){
        await page.locator('#fixture-list .without-forecast').first().click();
        assert.match(await page.locator('#detail').innerText(),/няма запазена предмачова/);
        await page.getByRole('button',{name:'Затвори анализа'}).click();
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.locator('#today-date').click();
      assert.equal(await page.locator('#date-picker').inputValue(),today);
      assert.equal(await page.locator('.conditional-row').count(),conditional.rows.length);
      if(await page.locator('#value-review').isVisible()){
        await page.locator('#value-review summary').click();
        if(await page.locator('.value-row').count()){
          const row=page.locator('.value-row').first();
          await row.locator('input').fill('1,33');
          assert.match(await row.locator('.value-status').innerText(),/Под честния|Под прага/);
          assert.match(await row.locator('[data-price-source]').innerText(),/Въведен от теб/);
          await row.locator('input').fill('2,90');
          assert.match(await row.locator('.value-status').innerText(),/Покрива прага/);
          await row.locator('input').fill('');
        }
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
  console.log('Verified Prime full history, date navigation, no-API conditional price guide and actual-price check on desktop and phone.');
})().catch(error=>{console.error(error);process.exit(1);});
