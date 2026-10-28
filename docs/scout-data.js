/* Public snapshot delivery only. No prediction results or personal data here. */
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.MatchpulseData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const FILES=Object.freeze({'history.json':'history','fixtures.json':'fixtures','status.json':'status',
 'europe_history.json':'europe','match_links.json':'links','europe_fixture_names.json':'europeNames',
 'standings.json':'standings','coverage_audit.json':'coverage','diary_report.json':'diary',
 'selection_diary_report.json':'selectionDiary','selection_quotes.json':'selectionQuotes'});
const CACHEABLE=new Set(['history.json','europe_history.json','match_links.json','europe_fixture_names.json']);
const CACHE='matchpulse-public-snapshots-v1';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function validManifest(doc){
 if(doc?.schema!==1||!doc.files||typeof doc.files!=='object'||!/^[a-f0-9]{64}$/.test(doc.version||''))return false;
 return Object.keys(FILES).every(name=>{
  const f=doc.files[name];return f&&/^[a-f0-9]{64}$/.test(f.sha256||'')&&Number.isSafeInteger(f.bytes)&&f.bytes>0;
 });
}
async function create(options={}){
 const embedded=options.embedded===undefined?root.SCOUT_EMBEDDED_DATA:options.embedded;
 const base=options.baseURL||root.location?.href||'https://example.invalid/scout.html';
 const request=options.fetch||root.fetch?.bind(root),memo=new Map();let manifest=null,cache=null,crypto=null;
 try{crypto=options.crypto===undefined?root.crypto:options.crypto;}catch{}
 const digest=crypto?.subtle?async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join(''):null;
 const url=name=>new URL('data/'+name,base).href;
 async function network(name,stamp=''){
  const target=new URL(url(name));if(stamp)target.searchParams.set('v',stamp);
  const response=await request(target.href,{cache:'no-store',signal:AbortSignal.timeout(name==='client_manifest.json'?3000:name==='history.json'?30000:12000)});
  if(!response.ok)throw Error(name+' HTTP '+response.status);return response;
 }
 if(!embedded){
  try{
   const doc=await (await network('client_manifest.json',options.freshManifest?String(Date.now()):'')).json();
   if(!validManifest(doc)||!digest||await digest(new TextEncoder().encode(canonical(doc.files)))!==doc.version)throw Error('Invalid snapshot manifest');
   manifest=doc;
   try{
    const storage=options.cacheStorage===undefined?root.caches:options.cacheStorage;
    if(storage)cache=await storage.open(CACHE);
   }catch{cache=null;}
  }catch{manifest=null;cache=null;}
 }
 async function decode(response,expected){
  const bytes=await response.arrayBuffer();
  if(expected&&(bytes.byteLength!==expected.bytes||await digest(bytes)!==expected.sha256)){
   const error=Error('Публикуваните данни са променени. Презареди страницата.');error.code='SNAPSHOT_CHANGED';throw error;
  }
  return {bytes,value:JSON.parse(new TextDecoder().decode(bytes))};
 }
 async function get(name){
  if(!Object.hasOwn(FILES,name))throw Error('Unsupported public snapshot');
  if(memo.has(name))return memo.get(name);
  const pending=(async()=>{
   if(embedded){const value=embedded[FILES[name]];if(value===undefined||value===null)throw Error('Missing offline '+name);return value;}
   const expected=manifest?.files[name],key=expected?url(name)+'?v='+expected.sha256:null;
   if(cache&&CACHEABLE.has(name)){
    try{
     const saved=await cache.match(key);
     if(saved){try{return (await decode(saved,expected)).value;}catch{await cache.delete(key);}}
    }catch{}
   }
   const result=await decode(await network(name,expected?.sha256),expected);
   if(cache&&CACHEABLE.has(name)){
    try{
     await cache.put(key,new Response(result.bytes,{headers:{'Content-Type':'application/json'}}));
     // Keep at most two verified versions per public file, scoped to this Site.
     const siblings=(await cache.keys()).filter(r=>{const u=new URL(r.url);return u.origin+u.pathname===url(name);});
     for(const old of siblings.filter(r=>r.url!==key).slice(0,-1))await cache.delete(old);
    }catch{}
   }
   return result.value;
  })();
  memo.set(name,pending);pending.catch(()=>memo.delete(name));return pending;
 }
 return {get,manifest,embedded:!!embedded};
}
return {FILES,CACHEABLE,CACHE,canonical,validManifest,create};
});
