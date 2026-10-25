'use strict';
const fs=require('node:fs');
const S=require('../docs/scout-core.js');
const history=JSON.parse(fs.readFileSync('docs/data/history.json','utf8'));
const fixtures=JSON.parse(fs.readFileSync('docs/data/fixtures.json','utf8'));
const index=S.build(history);
const now=new Date('2026-10-25T07:00:00Z');
const upcoming=S.getUpcoming(fixtures,now);
const leagues=[...new Set(upcoming.map(f=>f[0]))];
let qualified=0, euro=0, lacking=0;
for(const f of upcoming){
 const p=S.profile(index,f);
 if(p.international)euro++;
 else if(p.home.overall.n>=8&&p.away.overall.n>=8)qualified++;
 else lacking++;
}
const signals=['o25','btts','home2','away2','u35'].map(m=>({market:m,matches:S.scan(index,fixtures,{market:m,days:7,minSample:8,now}).length}));
const summary={history:history.length,fixtureFile:fixtures.length,upcoming:upcoming.length,leagues:leagues.length,qualifiedDomestic:qualified,international:euro,limitedDomestic:lacking,signals};
console.log(JSON.stringify(summary,null,2));
if(!history.length||!fixtures.length||!upcoming.length)throw Error('Empty football data or schedule');
if(!leagues.length)throw Error('No league coverage');
if(signals.some(s=>s.matches<0))throw Error('Invalid signal result');
