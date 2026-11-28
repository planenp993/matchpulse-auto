'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const publishPages=require('../scripts/deploy_pages.cjs');
const {createHash}=require('node:crypto');
const {gzipSync}=require('node:zlib');

test('Pages retries the same artifact if the public manifest is from an older build',async()=>{
 const revision='a'.repeat(40), version='b'.repeat(64), deployments=[], warnings=[], outputs={};
 let requests=0, forecasts=0, calendars=0, values=0;
 const bytes=Buffer.from('{"version":1}'),expectedPrime=createHash('sha256').update(bytes).digest('hex');
 const valueState=Buffer.from('{"schema":1,"picks":[]}'),expectedValue=createHash('sha256').update(valueState).digest('hex');
 const archive=Buffer.from('{"schema":1,"days":{}}'),expectedCalendar=createHash('sha256').update(archive).digest('hex');
 await publishPages({
  artifactId:42, revision, version, expectedPrime, expectedCalendar, expectedValue, site:'https://example.test/scout',
  context:{repo:{owner:'example',repo:'scout'},sha:'c'.repeat(40)},
  github:{async request(method,params){
   if(method.startsWith('POST ')){
    deployments.push([params.artifact_id,params.pages_build_version]);
    return {data:{id:params.pages_build_version}};
   }
   assert.equal(params.pages_deployment_id,revision);
   return {data:{status:'succeed'}};
  }},
  core:{info(){}, warning(message){warnings.push(message);},async getIDToken(){return 'test-token';},
   setOutput(key,value){outputs[key]=value;}},
  fetchPage:async url=>{
   if(url.pathname==='/scout/algorithm/data/snapshot.json.gz'){
    forecasts++;
    return new Response(forecasts===1?gzipSync('outdated'):gzipSync(bytes));
   }
   if(url.pathname==='/scout/algorithm/data/match-history/index.json'){
    calendars++;
    return new Response(archive);
   }
   if(url.pathname==='/scout/algorithm/data/prime-value/state.json'){values++;return new Response(valueState);}
   assert.equal(url.pathname,'/scout/data/client_manifest.json');
   requests++;
   return {ok:true,json:async()=>({version:requests<=12?'d'.repeat(64):version})};
  },
  pause:async()=>{}
 });
 assert.deepEqual(deployments,[[42,revision],[42,revision]]);
 assert.match(warnings[0],/did not serve the uploaded snapshot/);
 assert.equal(forecasts,2);
 assert.equal(calendars,1);
 assert.equal(values,1);
 assert.equal(outputs.page_url,'https://example.test/scout/');
});
