'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../docs/scout-core.js'),P=require('../docs/scout-patterns.js');
const asOf='2026-10-26',now=new Date(asOf+'T08:00:00Z');
const dateBefore=(n,date=asOf)=>new Date(Date.parse(date+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
const row=(date,home,away,h=2,a=1,extra={})=>['E0','England','Test league',date,'18:00',home,away,h,a,null,null,null,null,extra];
const fixture=(home='Alpha',away='Beta',date='2026-10-28')=>row(date,home,away,null,null);
const reference=(rate=.5,n=100)=>({n,homeAsHome:rate,homeAsAway:rate,awayAsHome:rate,awayAsAway:rate,since:'2023-10-26',until:asOf});
function samples(n=10,{age=0,home='Alpha',away='Beta',stat=true,miss=0}={}){
 const rows=[];
 for(let i=1;i<=n;i++){
  const extra=stat&&i<=n-miss?{HC:6,AC:5,HY:3,AY:2,HS:14,AS:13,HST:5,AST:5,HTHG:1,HTAG:0}:{};
  rows.push(row(dateBefore(i+age),home,'Home rival '+i,3,1,extra));
  rows.push(row(dateBefore(i+age),'Away rival '+i,away,3,1,extra));
 }
 return rows;
}
function inspect(rows,{market='o25',windowSize=20,ref=reference(),home='Alpha',away='Beta',...options}={}){
 const profile=S.profile(S.build(rows),fixture(home,away),{windowSize});
 return P.inspect(profile,market,{teamKey:S.keyTeam,minimum:5,reference:ref,asOfDate:asOf,...options});
}
function leagueSeed(){
 return Array.from({length:80},(_,i)=>row(dateBefore(90+i),'League home '+i,'League away '+i,i%4,i%3,{HC:i%8,AC:4,HS:10+i%10,AS:10,HY:i%4,AY:2}));
}
test('Conservative sample support orders 5/5 below 10/10 and 20/20',()=>{
 assert.ok(P.conservativeSupport(5,5)<P.conservativeSupport(10,10));
 assert.ok(P.conservativeSupport(10,10)<P.conservativeSupport(20,20));
 assert.ok(Math.abs(P.conservativeSupport(10,10)-.7224598312)<1e-9);
 const small=inspect(samples(5)),large=inspect(samples(20));
 assert.equal(small.matched,true);assert.equal(large.matched,true);assert.ok(large.rank>small.rank);
});
test('Missing statistics and older observations reduce rank without inventing losses',()=>{
 const full=inspect(samples(),{market:'corners85',windowSize:10});
 const missing=inspect(samples(10,{miss:2}),{market:'corners85',windowSize:10});
 const old=inspect(samples(10,{age:400}),{market:'corners85',windowSize:10});
 assert.equal(missing.home.rate,1);assert.equal(missing.home.hits,8);assert.equal(missing.home.missing,2);
 assert.equal(missing.matched,true);assert.equal(old.matched,true);
 assert.ok(full.rank>missing.rank);assert.ok(full.rank>old.rank);
 assert.ok(missing.evidence.notes.includes('Непълни статистики'));assert.ok(old.evidence.notes.includes('По-стара извадка'));
});
test('The weaker club controls support and shared head-to-head games are not pooled',()=>{
 const shared=Array.from({length:5},(_,i)=>row(dateBefore(i+1),'Alpha','Beta',3,1));
 const separate=inspect(samples(5)),overlap=inspect(shared);
 assert.equal(overlap.rank,separate.rank);
 const unbalanced=inspect([...samples(5),...samples(10,{home:'Other home',away:'Beta'})]);
 assert.equal(unbalanced.home.n,5);assert.equal(unbalanced.away.n,15);
 assert.ok(Math.abs(unbalanced.rank-separate.rank)<1e-12);
});
test('Streak length and repeated markets do not add a second ranking bonus',()=>{
 const first=samples(),second=samples();
 // Both variants have 8/10 hits. Only the position of one older failure changes.
 for(const rows of [first,second])for(const offset of [0,1]){
  const positions=rows===first?[3,8]:[7,8];
  for(const i of positions){rows[2*i+offset][7]=0;rows[2*i+offset][8]=0;}
 }
 const a=inspect(first),b=inspect(second);
 assert.equal(a.home.hits,b.home.hits);assert.notEqual(a.home.currentStreak,b.home.currentStreak);
 assert.equal(a.rank,b.rank);
 const strongest={...a,market:'o25',family:'total-goals',group:'goals'},nested={...a,market:'o15',family:'total-goals',group:'goals'};
 const cards=P.distinctSignals([strongest,nested,{...a,market:'corners85',family:'corners',group:'corners'},{...a,market:'shots215',family:'shots',group:'shots'}]);
 assert.deepEqual(cards.map(s=>s.market),['o25','corners85','shots215']);
 const early={fixture:fixture('Alpha','Beta','2026-10-27'),signal:strongest,totalSignals:1};
 const late={fixture:fixture('Alpha','Beta','2026-10-28'),signal:strongest,totalSignals:99};
 assert.ok(P.compareEntries(early,late)<0);
});
test('Ordinary high-frequency events lose priority relative to a lower league frequency',()=>{
 const common=inspect(samples(),{ref:reference(.9)}),unusual=inspect(samples(),{ref:reference(.4)});
 assert.ok(unusual.rank>common.rank);assert.equal(unusual.home.rate,common.home.rate);
 const unsupported=inspect(samples(),{ref:reference(.4,49)});
 assert.equal(unsupported.evidence.reference.available,false);
 assert.ok(common.rank>unsupported.rank);assert.ok(unsupported.evidence.notes.includes('Малка база за лигата'));
});
test('League reference excludes same-day, future, awarded and out-of-window matches',()=>{
 const f=fixture(),valid=leagueSeed(),index=S.build(valid),clean=P.leagueReference(index,f,S,asOf);
 const dirty=S.build([...valid,row(asOf,'Alpha','Beta',20,0),row('2026-10-27','Alpha','Beta',0,20),
  row('2023-10-25','Alpha','Beta',9,9),row('2026-10-24','Alpha','Beta',9,9,{AWARDED:true})]);
 assert.deepEqual(P.leagueReference(dirty,f,S,asOf),clean);
 assert.equal(clean.get('o25').n,80);
 assert.equal(clean.get('ht05').n,0);assert.equal(clean.get('corners85').n,80);
 const earlier=P.leagueReference(dirty,fixture('Alpha','Beta','2026-09-01'),S,asOf);
 assert.equal(earlier.get('o25').until,'2026-09-01');
});
test('Directional baseline follows venue and the actual home/away mix of each sample',()=>{
 const rows=Array.from({length:60},(_,i)=>row(dateBefore(i+40),'League home '+i,'League away '+i,2,0));
 rows.push(...samples(10));
 const index=S.build(rows),f=fixture(),r=P.leagueReference(index,f,S,asOf).get('1');
 assert.equal(r.homeAsHome,1);assert.equal(r.homeAsAway,0);assert.equal(r.awayAsHome,0);assert.equal(r.awayAsAway,1);
 const p=S.profile(index,f,{windowSize:10}),signal=P.inspect(p,'1',{teamKey:S.keyTeam,reference:r,asOfDate:asOf});
 assert.equal(signal.evidence.reference.homeRate,1);assert.equal(signal.evidence.reference.awayRate,1);
 const mixed=[...samples(5),...samples(5,{home:'Beta',away:'Alpha',age:10})],m=S.profile(S.build(mixed),f,{windowSize:10});
 const mix=P.inspect(m,'1',{teamKey:S.keyTeam,reference:r,asOfDate:asOf});
 assert.equal(mix.evidence.reference.homeRate,.5);assert.equal(mix.evidence.reference.awayRate,.5);
});
test('All-market and single-market views share evidence, eligibility and ordering',()=>{
 const history=[...leagueSeed(),...samples(10),...samples(8,{home:'Gamma',away:'Delta'})],index=S.build(history);
 const fixtures=[fixture(),fixture('Gamma','Delta')],options={days:7,windowSize:10,now};
 const all=P.runAll(index,fixtures,S,options);
 assert.equal(all.length,2);
 for(const entry of all){
  const singles=P.run(index,fixtures,S,{...options,market:entry.signal.market}),same=singles.find(x=>S.keyFixture(x.fixture)===S.keyFixture(entry.fixture));
  assert.deepEqual(same.signal,entry.signal);assert.equal(entry.strength,entry.signal.rank);
  assert.equal(new Set(entry.signals.map(s=>s.family)).size,entry.signals.length);
 }
 assert.deepEqual(P.runAll(index,fixtures.slice().reverse(),S,options),all);
});
test('Duplicate fixture aliases remain one card and international proxies are excluded',()=>{
 const history=[...leagueSeed(),...samples(10,{home:'Manchester United',away:'Chelsea'})],index=S.build(history);
 const canonical=fixture('Man Utd','Chelsea'),alias=fixture('Manchester United','Chelsea'),euro=[...canonical];euro[0]='UCL';
 for(const runner of [P.run,P.runAll]){
  const out=runner(index,[canonical,alias,euro],S,{market:'o25',days:7,now});
  assert.equal(out.length,1);assert.equal(out[0].profile.international,false);
 }
});
test('Existing league, venue, both-teams, 5/10/20 and streak filters keep their meaning',()=>{
 const index=S.build([...leagueSeed(),...samples(20)]),f=fixture();
 for(const windowSize of [5,10,20])for(const runner of [P.run,P.runAll]){
  const out=runner(index,[f],S,{market:'o25',venue:true,both:true,windowSize,streak:5,days:7,now});
  assert.equal(out.length,1);assert.equal(out[0].signal.home.total,windowSize);assert.equal(out[0].signal.away.total,windowSize);
  assert.equal(runner(index,[f],S,{market:'o25',league:'D1',days:7,now}).length,0);
  assert.equal(runner(index,[f],S,{market:'o25',days:1,now}).length,0);
 }
});
