'use strict';
const fs=require('node:fs');
const S=require('../docs/scout-core.js');
const P=require('../docs/scout-patterns.js');
const history=JSON.parse(fs.readFileSync('docs/data/history.json','utf8'));
const fixtures=JSON.parse(fs.readFileSync('docs/data/fixtures.json','utf8'));
const index=S.build(history);
const now=new Date();
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
const scanner=P.runAll(index,fixtures,S,{days:7,now});
const singleMarkets=new Map();
for(const entry of scanner){
 const q=entry.signal;
 if(!singleMarkets.has(q.market))singleMarkets.set(q.market,new Map(P.run(index,fixtures,S,{market:q.market,days:7,now}).map(e=>[S.keyFixture(e.fixture),e])));
 const same=singleMarkets.get(q.market).get(S.keyFixture(entry.fixture));
 if(!same||JSON.stringify(same.signal)!==JSON.stringify(q))throw Error('All/single scanner evidence differs');
 if(new Set(entry.signals.map(s=>s.family)).size!==entry.signals.length)throw Error('Nested signals fill several preview slots');
 if(!Number.isFinite(q.rank)||q.home.n<5||q.away.n<5)throw Error('Unsupported scanner rank');
}
for(let i=1;i<scanner.length;i++)if(scanner[i-1].signal.rank<scanner[i].signal.rank)throw Error('Scanner ranks are not sorted');
const summary={history:history.length,fixtureFile:fixtures.length,upcoming:upcoming.length,leagues:leagues.length,qualifiedDomestic:qualified,international:euro,limitedDomestic:lacking,signals,
 scanner:{matches:scanner.length,leagueReferences:scanner.filter(e=>e.signal.evidence.reference.available).length,
  incompleteOrOlder:scanner.filter(e=>e.signal.evidence.notes.length).length,distinctPreviewFamilies:true,allAndSingleAgree:true}};
console.log(JSON.stringify(summary,null,2));
if(!history.length||!fixtures.length||!upcoming.length)throw Error('Empty football data or schedule');
if(!leagues.length)throw Error('No league coverage');
if(signals.some(s=>s.matches<0))throw Error('Invalid signal result');
