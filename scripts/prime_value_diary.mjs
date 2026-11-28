// Public pre-match Prime Value pilot. Independent of the official Prime diary.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { sofiaDate, priceReference, LEAGUE_BY_ID } from '../docs/algorithm/catalog.js';
import { RULE, FAMILIES, valueFixtures, normalizePair, assessPair, rankValue, sealValuePick, valueSettlement, valueStats } from '../docs/algorithm/prime-value-v1.js';
import { calendarKey } from '../docs/algorithm/calendar-view.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = 'docs/algorithm/data/prime-value/';
const cal = 'docs/algorithm/data/match-history/';
const snapshotPath = 'docs/algorithm/data/snapshot.json.gz';
const sourceFiles = [
  'scripts/prime_value_diary.mjs','docs/algorithm/prime-value-v1.js','docs/algorithm/value-check.js','docs/algorithm/core.js',
  'docs/algorithm/catalog.js','docs/algorithm/europe.js','docs/algorithm/club-aliases.js','docs/algorithm/model-core.js',
  'docs/algorithm/refresh-state.js','docs/algorithm/calendar-view.js',
  'docs/algorithm/data/scoring-config.json','docs/algorithm/data/extra-models.json','docs/algorithm/data/europe-models.json',
  'docs/algorithm/data/champion.json','scripts/prime_chances.mjs','scripts/prime_full_forecast.mjs','scripts/prime-chances-state.json.gz'
];
const json = path => JSON.parse(readFileSync(root + path,'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ms = value => Date.parse(value);
const iso = t => new Date(t).toISOString();
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const sealed = record => ({ ...record, sha256: sha(JSON.stringify(record)) });
function verify(record) {
  const {sha256,...body} = record;
  if (sha256 !== sha(JSON.stringify(body))) throw Error('Changed sealed Prime Value record');
  return body;
}
export function fingerprints() {
  return Object.fromEntries(sourceFiles.map(path => [path,sha(readFileSync(root+path))]));
}
const validSHA = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validateConfig(config) {
  if (config?.schema !== 1 || !Number.isFinite(ms(config.createdAt)) || !same(config.rule,RULE) ||
      !same(Object.keys(config.modelSources ?? {}), sourceFiles) || !Object.values(config.modelSources).every(validSHA))
    throw Error('Invalid registered Prime Value rule');
}
function readLines(name) {
  const raw = readFileSync(root+dir+name,'utf8');
  if (raw && !raw.endsWith('\n')) throw Error('Incomplete Prime Value journal line');
  return raw.trimEnd().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
function write(path, content) {
  if (existsSync(root+path) && readFileSync(root+path,'utf8')===content) return;
  writeFileSync(root+path+'.tmp',content);
  renameSync(root+path+'.tmp',root+path);
}
const writeLines = (name, rows) => write(dir+name, rows.map(r=>JSON.stringify(r)+'\n').join(''));

function pairedFromRaw(fixture, original, raw, submissions, now) {
  const result = [];
  const submitted = submissions?.fixtures?.[fixture.id];
  const direct = priceReference(original, raw, now);
  for (const family of fixture.families) {
    const samples=[];
    if (family==='over_2_5' && ['Bet365','Pinnacle'].includes(direct?.source))
      samples.push({ selected:direct.over,opposite:direct.under,seen:direct.seen,source:direct.source,kind:'csv' });
    if (original.marketPrices?.[family]) samples.push({...original.marketPrices[family],kind:'published'});
    if (submitted && ms(submitted.kickoff)===ms(fixture.kickoff) && submitted.markets?.[family])
      samples.push({...submitted.markets[family],kind:'owner'});
    const pairs=samples.map(pair=>normalizePair(fixture,family,{...pair,matchId:fixture.id,kickoff:fixture.kickoff,family},now))
      .filter(Boolean).sort((a,b)=>ms(b.seen)-ms(a.seen));
    if (pairs.length) result.push({fixture,family,pair:pairs[0]});
  }
  return result;
}

export function buildEvaluation({snapshot, fitted, euroFitted, raw, submissions, snapshotHash, quoteHash, compatible, now, previous=[]}) {
  const pool=valueFixtures(snapshot,fitted,euroFitted,now);
  const at=iso(now), day=pool.day;
  if (!compatible) pool.status='fingerprint';
  const evidence=pool.status==='ready' ? pool.fixtures.flatMap(f=>pairedFromRaw(f,snapshot.matches.find(m=>m.id===f.id),raw,submissions,now)) : [];
  const assessments=evidence.flatMap(e=>assessPair(e.fixture,e.family,e.pair,now));
  const candidates=assessments.filter(r=>r.reason==='pass');
  const picked=rankValue(assessments,previous,day).map(r=>sealValuePick(r,at,snapshot.asOf,'public'));
  const counts={scheduled:pool.scheduled,eligible:pool.eligible,twoModels:pool.fixtures.length,
    quotedPairs:evidence.length,quotedMatches:new Set(evidence.map(e=>e.fixture.id)).size,
    qualified:new Set(candidates.map(r=>r.fixture.id)).size};
  const status=pool.status!=='ready' ? pool.status : !pool.fixtures.length ? 'no_models' :
    !evidence.length ? 'no_quotes' : !candidates.length ? 'no_pass' : picked.length ? 'selected' :
      previous.filter(p=>p.day===day).length>=RULE.cap ? 'full' : 'already_recorded';
  return { schema:1,at,day,snapshotAt:snapshot.asOf,snapshotHash,quoteHash,status,counts,evidence,picks:picked,
    reasons:Object.fromEntries([...new Set(assessments.map(r=>r.reason))].sort().map(reason=>[reason,assessments.filter(r=>r.reason===reason).length])) };
}

export function validateLedger(config, evaluations, results) {
  validateConfig(config);
  const picks=[], ids=new Set();
  let previousAt=ms(config.createdAt);
  for(const row of evaluations){
    const e=verify(row), now=ms(e.at);
    if(e.schema!==1 || !(now>=previousAt) || sofiaDate(now)!==e.day || !validSHA(e.snapshotHash) || !validSHA(e.quoteHash) ||
      !Number.isFinite(ms(e.snapshotAt)) || !Array.isArray(e.evidence) || !Array.isArray(e.picks) || !e.counts)
      throw Error('Invalid Prime Value evaluation');
    previousAt=now;
    const keys=new Set();
    const sides=[];
    for(const {fixture,family,pair} of e.evidence){
      const key=fixture.id+'|'+family;
      if(keys.has(key)||!LEAGUE_BY_ID[fixture.league]||!fixture.id||!fixture.home||!fixture.away||
          !fixture.families.includes(family)||!Object.hasOwn(FAMILIES,family)||
          fixture.calendarKey!==calendarKey(fixture.league,e.day,fixture.home,fixture.away)||
          !['csv','published','owner'].includes(pair.kind)||
          !same(normalizePair(fixture,family,pair,now),pair)||
          ![fixture.prime,fixture.chances].every(probabilities=>FAMILIES[family].every(k=>
            Number.isFinite(probabilities?.[k])&&probabilities[k]>0&&probabilities[k]<1)&&
            Math.abs(FAMILIES[family].reduce((s,k)=>s+probabilities[k],0)-1)<1e-6)||
          !(ms(fixture.issued)<=ms(e.snapshotAt)&&ms(e.snapshotAt)<=now)||
          now-ms(e.snapshotAt)>RULE.forecastAgeMs) throw Error('Invalid or duplicate public quote evidence');
      keys.add(key);
      const assessments=assessPair(fixture,family,pair,now);
      if(assessments.length!==2) throw Error('Stale quote in sealed evaluation');
      sides.push(...assessments);
    }
    const expected=rankValue(sides,picks,e.day).map(r=>sealValuePick(r,e.at,e.snapshotAt,'public'));
    if(!same(e.picks,expected)||e.counts.quotedPairs!==keys.size||e.counts.quotedMatches!==new Set(e.evidence.map(v=>v.fixture.id)).size||
       e.counts.qualified!==new Set(sides.filter(r=>r.reason==='pass').map(v=>v.fixture.id)).size)
      throw Error('Published Prime Value choices differ from fixed rule');
    for(const p of e.picks){
      if(ids.has(p.id)||picks.some(old=>old.fixture.id===p.fixture.id||old.fixture.calendarKey===p.fixture.calendarKey))
        throw Error('Duplicate Prime Value choice');
      ids.add(p.id);picks.push(p);
    }
  }
  const latest=new Map();const byId=new Map(picks.map(p=>[p.id,p]));
  let lastResultAt=ms(config.createdAt);
  for(const row of results){
    const event=verify(row), p=byId.get(event.id), r=event.result, at=ms(event.at), old=latest.get(event.id);
    if(!p||!(at>=lastResultAt)||!r||!['hit','miss','review'].includes(r.state)||!r.source||
       !(ms(r.observed)<=at&&ms(r.observed)-ms(p.fixture.kickoff)>=3*3_600_000)||
       !Array.isArray(r.score)||r.score.length!==2||!r.score.every(g=>Number.isInteger(g)&&g>=0&&g<=30)||
       old&&ms(r.observed)<ms(old.observed)) throw Error('Invalid Prime Value result event');
    if(r.state!=='review'){
      const [h,a]=r.score;const hit=({over_2_5:h+a>=3,under_2_5:h+a<3,btts_yes:h>0&&a>0,btts_no:h===0||a===0})[p.key];
      if(r.state!==(hit?'hit':'miss')||r.reason!==null) throw Error('Incorrect Prime Value settlement');
    }
    lastResultAt=at;latest.set(event.id,r);
  }
  return picks.map(p=>({...p,result:latest.get(p.id)??null}));
}

export function buildState(config,evaluations,results){
  const entries=validateLedger(config,evaluations,results);
  const latest=evaluations.at(-1);
  const days=new Map();
  for(const e of evaluations){
    const d=days.get(e.day)??{day:e.day,checked:0,quotedPairs:0,selected:0,status:e.status};
    d.checked++;d.quotedPairs=Math.max(d.quotedPairs,e.counts.quotedPairs);d.selected+=e.picks.length;d.status=e.status;days.set(e.day,d);
  }
  return {schema:1,configHash:sha(JSON.stringify(config)),createdAt:config.createdAt,rule:config.rule,
    latest:latest?{day:latest.day,at:latest.at,snapshotAt:latest.snapshotAt,status:latest.status,counts:latest.counts,reasons:latest.reasons}:null,
    updatedAt:results.at(-1)&&(!latest||ms(results.at(-1).at)>ms(latest.at))?results.at(-1).at:latest?.at??config.createdAt,
    days:[...days.values()].reverse(),stats:valueStats(entries),picks:entries.slice().reverse()};
}
function assertPrefix(base){
  if(!base)return;
  const paths=['config.json','evaluations.jsonl','results.jsonl'];
  for(const p of paths){
    let old;try{old=execFileSync('git',['show',base+':'+dir+p],{cwd:root,maxBuffer:64*1024*1024});}catch(error){
      // Only a genuinely absent path at first registration allows a new ledger.
      const tree=execFileSync('git',['ls-tree',base,'--',dir+p],{cwd:root,encoding:'utf8'});
      if(tree.trim())throw error;
      continue;
    }
    const current=readFileSync(root+dir+p);
    if(p==='config.json'?!old.equals(current):!old.equals(current.subarray(0,old.length)))
      throw Error('Prime Value prior public records changed: '+p);
  }
}
function loadBucket(index,day){
  if(!index.days[day])return null;
  const bytes=readFileSync(root+cal+day+'.json.gz');
  if(sha(bytes)!==index.days[day].sha256)throw Error('Invalid calendar day for settlement '+day);
  const bucket=JSON.parse(gunzipSync(bytes));
  if(bucket.day!==day||bucket.schema!==1)throw Error('Invalid calendar day');
  return bucket;
}
function main(){
  const args=process.argv.slice(2),baseArg=args.indexOf('--base-ref'),base=baseArg>=0?args[baseArg+1]:null;
  if(args.includes('--init')){
    if(existsSync(root+dir+'config.json'))throw Error('Prime Value is already registered');
    mkdirSync(root+dir,{recursive:true});
    const config={schema:1,createdAt:iso(Date.now()),rule:RULE,modelSources:fingerprints()};
    write(dir+'config.json',JSON.stringify(config,null,2)+'\n');
    writeLines('evaluations.jsonl',[]);writeLines('results.jsonl',[]);
    write(dir+'state.json',JSON.stringify(buildState(config,[],[]))+'\n');
    console.log('Registered Prime Value v1; no retrospective records.');
    return;
  }
  const config=json(dir+'config.json'),evaluations=readLines('evaluations.jsonl'),results=readLines('results.jsonl');
  assertPrefix(base);
  const entries=validateLedger(config,evaluations,results);
  if(args.includes('--check')){
    if(!same(json(dir+'state.json'),buildState(config,evaluations,results)))throw Error('Prime Value state does not match ledger');
    console.log('Verified Prime Value · '+evaluations.length+' evaluations, '+entries.length+' selections, '+results.length+' result events.');
    return;
  }
  const now=Date.now();
  if(now<ms(config.createdAt)||evaluations.at(-1)&&now<ms(evaluations.at(-1).at))throw Error('Prime Value clock moved backwards');
  const snapshotBytes=readFileSync(root+snapshotPath), snapshot=JSON.parse(gunzipSync(snapshotBytes));
  const raw=json('docs/data/selection_quotes.json'), submissions=json('ops/prime_value_prices.json');
  if(submissions.schema!==1||!submissions.fixtures||typeof submissions.fixtures!=='object'||Array.isArray(submissions.fixtures))
    throw Error('Invalid Prime Value price input');
  const previous=entries.map(({result,...p})=>p);
  const evaluation=buildEvaluation({snapshot,fitted:json('docs/algorithm/data/extra-models.json'),euroFitted:json('docs/algorithm/data/europe-models.json'),
    raw,submissions,now,snapshotHash:sha(snapshotBytes),quoteHash:sha(JSON.stringify({raw,submissions})),
    compatible:same(config.modelSources,fingerprints()),previous});
  const last=evaluations.at(-1);
  // Do not create a new log line just for a repeated execution of the same
  // evaluated snapshot, except if its freshness or candidate set changed.
  if(evaluation.picks.length||!last||!['day','snapshotHash','quoteHash','counts','evidence','status'].every(k=>same(last[k],evaluation[k])))
    evaluations.push(sealed(evaluation));
  const all=validateLedger(config,evaluations,results);
  const calIndex=json(cal+'index.json'),buckets=new Map();
  for(const p of all){
    if(!buckets.has(p.day))buckets.set(p.day,loadBucket(calIndex,p.day));
    const actual=valueSettlement(p,buckets.get(p.day),now);
    if(actual&&(!p.result||ms(actual.observed)>=ms(p.result.observed))&&!same(actual,p.result))
      results.push(sealed({id:p.id,at:iso(now),result:actual}));
  }
  const state=buildState(config,evaluations,results);
  writeLines('evaluations.jsonl',evaluations);writeLines('results.jsonl',results);
  write(dir+'state.json',JSON.stringify(state)+'\n');
  assertPrefix(base);
  console.log('Prime Value '+evaluation.day+' · '+evaluation.status+' · '+evaluation.counts.twoModels+' with two models · '+
    evaluation.counts.quotedPairs+' fresh pairs · '+evaluation.counts.qualified+' qualified · '+state.stats.recorded+' sealed selections.');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main();
