/* Controlled calendar + clock for selection/backup acceptance, not live data. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const D=require('../docs/scout-data.js');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'../tests/fixtures/selection-calendar-2026-10-28.json')));
const body=Buffer.from(JSON.stringify(fixtures)),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function prepare(page,clock='2026-10-28T07:00:00Z'){
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/data/client_manifest.json')));
 const divisions={};for(const f of fixtures)divisions[f[0]]=(divisions[f[0]]||0)+1;
 manifest.files['fixtures.json']={sha256:sha(body),bytes:body.length,rows:fixtures.length,divisions};manifest.version=sha(D.canonical(manifest.files));
 await page.route('**/data/fixtures.json*',route=>route.fulfill({contentType:'application/json',body}));
 await page.route('**/data/client_manifest.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(manifest)}));
 await page.addInitScript(({fixtures,clock})=>{
  const Original=Date,fixed=Original.parse(clock);window.Date=class extends Original{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
  if(location.protocol==='file:'){
   let data;Object.defineProperty(window,'SCOUT_EMBEDDED_DATA',{configurable:true,get(){return data;},set(value){value.fixtures=fixtures;data=value;}});
  }
 },{fixtures,clock});
}
module.exports={prepare};
