/* Publish the artifact under the commit it contains, then verify Pages serves it. */
'use strict';

const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const {setTimeout:wait}=require('node:timers/promises');
const route='/repos/{owner}/{repo}/pages/deployments';
const terminalFailures=new Set(['deployment_failed','deployment_perms_error','deployment_content_failed','deployment_cancelled','deployment_lost']);

async function publishPages({
 github,core,context,artifactId=Number(process.env.PAGES_ARTIFACT_ID),site=process.env.PAGES_BASE_URL,
 revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 version=JSON.parse(readFileSync('docs/data/client_manifest.json','utf8')).version,
 fetchPage=fetch,pause=wait
}){
 if(!Number.isSafeInteger(artifactId)||artifactId<=0||!/^[a-f0-9]{40}$/.test(revision)||!/^[a-f0-9]{64}$/.test(version))throw Error('Invalid Pages artifact or snapshot version');
 if(!site)throw Error('Missing Pages URL');
 const siteUrl=new URL(site.endsWith('/')?site:site+'/');
 if(siteUrl.protocol!=='https:')throw Error('Expected HTTPS Pages URL');
 const request=async (operation,params)=>(await github.request(operation,{...context.repo,...params,request:{signal:AbortSignal.timeout(15000)}})).data;
 core.info('Publishing Pages artifact '+artifactId+' from checked-out revision '+revision);
 for(const timeout of [600000,360000]){
  try{
   const deployment=await request('POST '+route,{artifact_id:artifactId,pages_build_version:revision,oidc_token:await core.getIDToken()});
   const identity={pages_deployment_id:deployment.id||revision};
   let deployed=false;
   const deadline=Date.now()+timeout;
   while(Date.now()<deadline){
    let result;
    try{result=await request('GET '+route+'/{pages_deployment_id}',identity);}
    catch(error){core.warning('Pages status request failed'+(error.status?' (HTTP '+error.status+')':''));}
    if(result?.status==='succeed'){deployed=true;break;}
    if(terminalFailures.has(result?.status))throw Error('Pages returned '+result.status);
    await pause(5000);
   }
   if(!deployed){
    try{await request('POST '+route+'/{pages_deployment_id}/cancel',identity);}
    catch(error){core.warning('Could not cancel the timed-out Pages deployment'+(error.status?' (HTTP '+error.status+')':''));}
    throw Error('Pages deployment timed out');
   }
   const manifestUrl=new URL('data/client_manifest.json',siteUrl);
   for(let check=0;check<12;check++){
    manifestUrl.searchParams.set('verify',revision+'-'+process.env.GITHUB_RUN_ATTEMPT+'-'+timeout+'-'+check);
    try{
     const response=await fetchPage(manifestUrl,{cache:'no-store',signal:AbortSignal.timeout(8000)});
     if(response.ok&&(await response.json()).version===version){
      core.info('Public Pages snapshot verified: '+version);
      core.setOutput('page_url',siteUrl.href);
      return;
     }
    }catch{}
    await pause(5000);
   }
   throw Error('Pages reported success but did not serve the uploaded snapshot');
  }catch(error){
   if(timeout===360000)throw Error('Pages publication failed: '+error.message);
   core.warning('Retrying the same Pages artifact: '+error.message);
   await pause(45000);
  }
 }
}

module.exports=publishPages;
