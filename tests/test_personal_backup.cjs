'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const B=require('../docs/scout-backup.js'),C=require('../docs/scout-core.js');
const pick={id:'sample-1',div:'E0',date:'2026-10-30',time:'18:00',home:'Arsenal',away:'Chelsea',market:'o25',odds:1.85,modelProbability:.618,analysisWindow:10,model:'standard',createdAt:'2026-10-28T07:00:00Z'};
const key=C.keyPick(pick)+'::1',quote={odds:2.35,kind:'manual',book:'Въведена от теб',observed_at_utc:'2026-10-24T07:00:00Z'};
const data=()=>({format:B.FORMAT,schema:1,exported_at_utc:'2026-10-28T08:00:00Z',picks:[structuredClone(pick)],manual_prices:{[key]:structuredClone(quote)}});
class Storage{
 constructor(values={}){this.values=new Map(Object.entries(values));this.fail=null;}
 getItem(k){return this.values.get(k)??null;}
 setItem(k,v){if(this.fail===k){this.fail=null;throw Error('storage blocked');}this.values.set(k,String(v));}
 removeItem(k){this.values.delete(k);}
}
test('Export and restore retain exact pre-match numbers, manual quote ages and extra saved metadata',()=>{
 const p={...pick,fixtureKey:C.keyPick(pick),extra:{note:'original'}};
 const source=new Storage({[B.PICKS]:JSON.stringify([p]),[B.PRICES]:JSON.stringify({[key]:quote})});
 const raw=B.create(source,new Date('2026-10-28T08:00:00Z')),doc=B.parse(raw),target=new Storage();
 const counts=B.apply(target,doc);assert.equal(counts.picks,1);assert.equal(counts.prices,1);
 assert.deepEqual(B.read(target),{picks:[p],prices:{[key]:quote}});
 assert.equal(B.read(target).picks[0].modelProbability,.618);
 assert.equal(B.read(target).prices[key].observed_at_utc,'2026-10-24T07:00:00Z');
 assert.equal(source.getItem(B.PICKS),JSON.stringify([p]));assert.equal(target.getItem(B.JOURNAL),null);
});
test('Repeated restores deduplicate; local conflicts win and missing records are added',()=>{
 const local={...pick,odds:2.1},localQuote={...quote,odds:3.1};
 const target=new Storage({[B.PICKS]:JSON.stringify([local]),[B.PRICES]:JSON.stringify({[key]:localQuote})});
 const doc=data(),newPick={...pick,id:'sample-2',date:'2026-11-01'};doc.picks.push(newPick);
 const before=target.getItem(B.PICKS),plan=B.merge(B.read(target),doc);
 assert.equal(target.getItem(B.PICKS),before);assert.equal(plan.counts.conflicts,2);assert.equal(plan.counts.picks,1);
 B.apply(target,doc);assert.deepEqual(B.read(target),{picks:[local,newPick],prices:{[key]:localQuote}});
 const repeated=B.apply(target,doc);assert.equal(repeated.picks,0);assert.equal(repeated.prices,0);assert.equal(repeated.duplicates,1);
});
test('ID collisions preserve the current record even if the incoming fixture differs',()=>{
 const target=new Storage({[B.PICKS]:JSON.stringify([pick])});
 const doc=data();doc.picks[0].date='2026-11-01';
 assert.equal(B.apply(target,doc).conflicts,1);assert.deepEqual(B.read(target).picks,[pick]);
});
test('Corrupt, incompatible and unsafe files fail before any writes',()=>{
 const invalid=[];
 for(const edit of [d=>d.schema=2,d=>d.picks[0].modelProbability=1.2,d=>d.picks[0].market='unknown',d=>d.picks[0].fixtureKey='wrong',d=>d.picks[0].date='2026-02-30',d=>d.picks.push({...pick}),d=>d.manual_prices[key].kind='fixture_csv']){const doc=data();edit(doc);invalid.push(JSON.stringify(doc));}
 invalid.push('not json','{"format":"matchpulse-personal-backup","schema":1,"exported_at_utc":"2026-10-28T08:00Z","picks":[],"manual_prices":{"__proto__":{}}}');
 const target=new Storage({[B.PICKS]:JSON.stringify([pick])}),before=target.getItem(B.PICKS);
 for(const raw of invalid){assert.throws(()=>B.parse(raw));assert.equal(target.getItem(B.PICKS),before);}
 assert.throws(()=>B.parse(' '.repeat(B.MAX_BYTES+1)),/5 MB/);
});
test('A failed second write rolls back both stores byte-for-byte',()=>{
 const target=new Storage({[B.PICKS]:'[]',[B.PRICES]:'{}'});target.fail=B.PRICES;
 assert.throws(()=>B.apply(target,data()),/Предишните записи са възстановени/);
 assert.equal(target.getItem(B.PICKS),'[]');assert.equal(target.getItem(B.PRICES),'{}');assert.equal(target.getItem(B.JOURNAL),null);
 const blocked=new Storage({[B.PICKS]:'[]'});blocked.fail=B.JOURNAL;
 assert.throws(()=>B.apply(blocked,data()),/Нищо не е променено/);assert.equal(blocked.getItem(B.PICKS),'[]');
});
test('An interrupted restore recovers original keys, including absent keys, before exporting',()=>{
 const target=new Storage({[B.JOURNAL]:JSON.stringify({schema:1,picks:null,prices:JSON.stringify({[key]:quote})}),[B.PICKS]:JSON.stringify([pick]),[B.PRICES]:'{}'});
 const exported=B.parse(B.create(target,new Date('2026-10-28T08:00:00Z')));
 assert.deepEqual(exported.picks,[]);assert.deepEqual(exported.manual_prices,{[key]:quote});
 assert.equal(target.getItem(B.PICKS),null);assert.equal(target.getItem(B.JOURNAL),null);
});
test('Versioned backup module is included in the offline preview',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 const hash=crypto.createHash('sha256').update(fs.readFileSync('docs/scout-backup.js')).digest('hex').slice(0,12);
 assert.ok(html.includes('scout-backup.js?v='+hash));assert.ok(builder.includes('scout-backup.js'));
});
