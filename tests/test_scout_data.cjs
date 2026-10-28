'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const D=require('../docs/scout-data.js'),baseURL='https://example.test/matchpulse/scout.html';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const bodies=new Map(Object.keys(D.FILES).map(name=>[name,Buffer.from(JSON.stringify(name.includes('history')||name==='fixtures.json'?[]:{}))]));
 const calls=[];
 const manifest=()=>{const files=Object.fromEntries([...bodies].map(([name,body])=>[name,{sha256:sha(body),bytes:body.length}]));return {schema:1,files,version:sha(D.canonical(files))};};
 let brokenManifest=false;
 const fetch=async url=>{const name=new URL(url).pathname.split('/').at(-1);calls.push({name,url});return name==='client_manifest.json'?new Response(JSON.stringify(brokenManifest?{}:manifest())):new Response(bodies.get(name),{status:bodies.has(name)?200:404});};
 return {bodies,calls,fetch,manifest,breakManifest(){brokenManifest=true;}};
}
class Cache{
 constructor(){this.rows=new Map();}
 async match(k){return this.rows.get(k)?.clone();}
 async put(k,v){this.rows.set(k,v.clone());}
 async delete(k){return this.rows.delete(typeof k==='string'?k:k.url);}
 async keys(){return [...this.rows.keys()].map(url=>({url}));}
}
const options=(f,cache)=>({fetch:f.fetch,baseURL,crypto:crypto.webcrypto,cacheStorage:{open:async()=>cache}});
test('A new page checks the manifest but reuses verified public archives when their bytes are unchanged',async()=>{
 const f=fixture(),cache=new Cache();f.bodies.set('history.json',Buffer.from('[1,2,3]'));
 const a=await D.create(options(f,cache));assert.deepEqual(await a.get('history.json'),[1,2,3]);
 await a.get('history.json');
 const b=await D.create(options(f,cache));assert.deepEqual(await b.get('history.json'),[1,2,3]);
 assert.equal(f.calls.filter(c=>c.name==='client_manifest.json').length,2);
 assert.equal(f.calls.filter(c=>c.name==='history.json').length,1);
 assert.ok(f.calls.find(c=>c.name==='history.json').url.includes('?v='+sha(f.bodies.get('history.json'))));
});
test('New publication hashes fetch new bytes, and old cached generations are never a fallback',async()=>{
 const f=fixture(),cache=new Cache();await (await D.create(options(f,cache))).get('history.json');
 f.bodies.set('history.json',Buffer.from('[4,5]'));
 assert.deepEqual(await (await D.create(options(f,cache))).get('history.json'),[4,5]);
 assert.equal(f.calls.filter(c=>c.name==='history.json').length,2);
 f.breakManifest();f.bodies.set('history.json',Buffer.from('[6]'));
 assert.deepEqual(await (await D.create(options(f,cache))).get('history.json'),[6]);
 assert.equal(f.calls.filter(c=>c.name==='history.json').length,3);
});
test('Corrupt cache bytes are discarded and fetched again with their content verified',async()=>{
 const f=fixture(),cache=new Cache();await (await D.create(options(f,cache))).get('history.json');
 const key=[...cache.rows.keys()][0];cache.rows.set(key,new Response('[999]'));
 assert.deepEqual(await (await D.create(options(f,cache))).get('history.json'),[]);
 assert.equal(f.calls.filter(c=>c.name==='history.json').length,2);
});
test('A snapshot changing between manifest and download is rejected rather than mixed silently',async()=>{
 const f=fixture(),cache=new Cache(),loader=await D.create(options(f,cache));
 f.bodies.set('history.json',Buffer.from('[1]'));
 await assert.rejects(loader.get('history.json'),{code:'SNAPSHOT_CHANGED'});
 assert.equal(cache.rows.size,0);
 assert.deepEqual(await (await D.create(options(f,cache))).get('history.json'),[1]);
});
test('Unavailable cache storage or digest support still allows direct current downloads',async()=>{
 const f=fixture(),o=options(f,new Cache());o.cacheStorage={open:async()=>{throw Error('blocked');}};
 assert.deepEqual(await (await D.create(o)).get('history.json'),[]);
 assert.deepEqual(await (await D.create({...o,crypto:null})).get('history.json'),[]);
 assert.equal(f.calls.filter(c=>c.name==='history.json').length,2);
});
test('Only whitelisted public archives persist, with at most two versions per resource',async()=>{
 const f=fixture(),cache=new Cache();
 for(let i=0;i<4;i++){f.bodies.set('history.json',Buffer.from(JSON.stringify([i])));await (await D.create(options(f,cache))).get('history.json');}
 assert.equal(cache.rows.size,2);
 const loader=await D.create(options(f,cache));await loader.get('status.json');await loader.get('fixtures.json');
 assert.equal(cache.rows.size,2);await assert.rejects(loader.get('../personal-notes.json'));
});
test('Offline embedded arrays never contact the network or cache storage',async()=>{
 const history=[[1,2,3]],loader=await D.create({embedded:{history},fetch(){throw Error('unexpected request');},cacheStorage:{open(){throw Error('unexpected cache');}}});
 assert.equal(await loader.get('history.json'),history);await assert.rejects(loader.get('fixtures.json'));
});
test('The delivery module is versioned and embedded in the offline build',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 assert.ok(html.includes('scout-data.js?v='+sha(fs.readFileSync('docs/scout-data.js')).slice(0,12)));
 assert.ok(builder.includes('scout-data.js'));
});
