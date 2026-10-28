/* Local personal-data backup. No provider requests or model calculations. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./scout-core.js'),require('./scout-patterns.js'),require('./scout-selections.js'));
 else root.MatchpulseBackup=factory(root.MatchpulseScout,root.MatchpulsePatterns,root.MatchpulseSelections);
})(typeof globalThis!=='undefined'?globalThis:this,function(C,P,S){
'use strict';
const PICKS='matchpulse-scout-picks-v1',PRICES='matchpulse-selection-quotes-v1',JOURNAL='matchpulse-personal-restore-v1';
const FORMAT='matchpulse-personal-backup',MAX_BYTES=5*1024*1024,MAX_RECORDS=10000;
const pickMarkets=new Set([...P.MARKETS.map(m=>m.id),'1','2','1X','X2','home2','away2']);
const priceMarkets=new Set(S.MARKETS.map(m=>m.id));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=240)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const club=v=>text(v)&&/^[\p{L}\p{N}]/u.test(v.trim());
const division=v=>typeof v==='string'&&/^[A-Z0-9]{1,8}$/.test(v);
const clock=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const canonical=v=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
function safeKeys(value,depth=0){
 if(depth>12)throw Error('Файлът съдържа твърде вложени данни.');
 if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){
  if(['__proto__','prototype','constructor'].includes(key))throw Error('Файлът съдържа невалидни полета.');
  safeKeys(v,depth+1);
 }
}
function validate(doc){
 if(!plain(doc)||doc.format!==FORMAT||doc.schema!==1||!clock(doc.exported_at_utc)||!Array.isArray(doc.picks)||!plain(doc.manual_prices))throw Error('Избери JSON резервно копие от MATCHPULSE.');
 if(doc.picks.length>MAX_RECORDS||Object.keys(doc.manual_prices).length>MAX_RECORDS)throw Error('Файлът съдържа твърде много записи.');
 safeKeys(doc);
 const ids=new Set(),keys=new Set();
 for(const p of doc.picks){
  if(!plain(p)||!(text(p.id,160)||Number.isSafeInteger(p.id)&&p.id>=0)||!division(p.div)||!day(p.date)||!club(p.home)||!club(p.away)||!pickMarkets.has(p.market))throw Error('Има невалидна лична прогноза. Нищо не е променено.');
  if(p.odds!=null&&(!Number.isFinite(p.odds)||p.odds<1.01||p.odds>1000)||p.modelProbability!=null&&(!Number.isFinite(p.modelProbability)||p.modelProbability<0||p.modelProbability>1)||p.createdAt!=null&&!clock(p.createdAt)||p.analysisWindow!=null&&![5,10,20].includes(p.analysisWindow))throw Error('Невалиден коефициент, вероятност или час в лична прогноза.');
  const key=C.keyPick(p)+'::'+p.market;
  if(p.fixtureKey!=null&&p.fixtureKey!==C.keyPick(p))throw Error('Идентичността на мач в копието не съвпада.');
  if(ids.has(String(p.id))||keys.has(key))throw Error('Резервното копие съдържа повтарящи се прогнози.');
  ids.add(String(p.id));keys.add(key);
 }
 for(const [key,q] of Object.entries(doc.manual_prices)){
  const split=key.lastIndexOf('::'),parts=key.slice(0,split).split('|'),markets=key.slice(split+2).split('+');
  if(split<0||key.length>700||parts.length!==4||!division(parts[0])||!day(parts[1])||!text(parts[2])||!text(parts[3])||!markets.length||markets.length>2||new Set(markets).size!==markets.length||markets.some(id=>!priceMarkets.has(id))||!plain(q)||q.kind!=='manual'||!Number.isFinite(q.odds)||q.odds<=1||q.odds>1000||!clock(q.observed_at_utc))throw Error('Има невалидна ръчно въведена цена. Нищо не е променено.');
 }
 return doc;
}
function parse(raw){
 if(typeof raw!=='string'||raw.length>MAX_BYTES||new TextEncoder().encode(raw).length>MAX_BYTES)throw Error('Копието трябва да е JSON файл до 5 MB.');
 let doc;try{doc=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('Файлът не е валиден JSON. Нищо не е променено.');}
 return validate(doc);
}
function read(storage){
 const readKey=(key,fallback)=>{const raw=storage.getItem(key);return raw===null?fallback:JSON.parse(raw);};
 const picks=readKey(PICKS,[]),prices=readKey(PRICES,{});
 if(!Array.isArray(picks)||!plain(prices))throw Error('Локалните записи не са в очаквания формат.');
 return {picks,prices};
}
function create(storage,now=new Date()){
 recover(storage);
 const current=read(storage);
 const doc=validate({format:FORMAT,schema:1,exported_at_utc:now.toISOString(),picks:current.picks,manual_prices:current.prices});
 const raw=JSON.stringify(doc,null,2);parse(raw);return raw;
}
function merge(current,doc){
 validate(doc);
 const picks=current.picks.slice(),prices=Object.fromEntries(Object.entries(current.prices));
 const byId=new Map(picks.map(p=>[String(p.id),p])),byKey=new Map(picks.map(p=>[C.keyPick(p)+'::'+p.market,p]));
 const counts={picks:0,prices:0,duplicates:0,conflicts:0};
 for(const p of doc.picks){
  const key=C.keyPick(p)+'::'+p.market,existing=byKey.get(key)||byId.get(String(p.id));
  if(existing){counts[canonical(existing)===canonical(p)?'duplicates':'conflicts']++;continue;}
  picks.push(p);byKey.set(key,p);byId.set(String(p.id),p);counts.picks++;
 }
 for(const [key,q] of Object.entries(doc.manual_prices)){
  if(Object.hasOwn(prices,key)){counts[canonical(prices[key])===canonical(q)?'duplicates':'conflicts']++;continue;}
  prices[key]=q;counts.prices++;
 }
 return {picks,prices,counts};
}
function restoreKey(storage,key,value){if(value===null)storage.removeItem(key);else storage.setItem(key,value);}
function recover(storage){
 const raw=storage.getItem(JOURNAL);if(raw===null)return false;
 const saved=JSON.parse(raw);
 if(saved.schema!==1||!Object.hasOwn(saved,'picks')||!Object.hasOwn(saved,'prices')||[saved.picks,saved.prices].some(v=>v!==null&&typeof v!=='string'))throw Error('Недовършено възстановяване. Запази копието и презареди страницата.');
 restoreKey(storage,PICKS,saved.picks);restoreKey(storage,PRICES,saved.prices);storage.removeItem(JOURNAL);return true;
}
function apply(storage,doc){
 recover(storage);
 const result=merge(read(storage),doc);
 if(!result.counts.picks&&!result.counts.prices)return result.counts;
 const before={schema:1,picks:storage.getItem(PICKS),prices:storage.getItem(PRICES)};
 try{storage.setItem(JOURNAL,JSON.stringify(before));}
 catch{throw Error('Браузърът не разреши безопасно възстановяване. Нищо не е променено.');}
 try{
  storage.setItem(PICKS,JSON.stringify(result.picks));storage.setItem(PRICES,JSON.stringify(result.prices));storage.removeItem(JOURNAL);
 }catch(error){
  try{recover(storage);}catch{throw Error('Възстановяването не приключи. Презареди страницата, за да се върнат предишните записи.');}
  throw Error('Браузърът не разреши записването. Предишните записи са възстановени.');
 }
 return result.counts;
}
function mount({storage,onChanged,onRecovered=()=>{}}){
 const el=id=>document.getElementById(id),status=el('backupStatus');let pending=null,token=0;
 const clear=()=>{pending=null;el('backupPreview').classList.add('hidden');el('backupFile').value='';};
 const description=c=>c.picks+' нови прогнози · '+c.prices+' нови цени · '+c.duplicates+' повторения · '+c.conflicts+' разминавания';
 try{if(recover(storage)){onRecovered();status.textContent='Предишните записи са върнати след недовършено възстановяване.';}}
 catch{status.textContent='Локалното запазване не е достъпно. Запази файла и опитай след презареждане.';}
 el('backupExport').onclick=()=>{
  try{
   const raw=create(storage),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
   a.download='MATCHPULSE-personal-backup-'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
   status.textContent='Копието е подготвено за изтегляне. Пази JSON файла за възстановяване.';
  }catch{status.textContent='Не успях да подготвя копието. Провери дали браузърът разрешава локално запазване.';}
 };
 el('backupFile').onchange=async()=>{
  const request=++token,file=el('backupFile').files[0];pending=null;el('backupPreview').classList.add('hidden');
  if(!file)return;
  try{
   if(file.size>MAX_BYTES)throw Error('Копието трябва да е JSON файл до 5 MB.');
   const doc=parse(await file.text());if(request!==token)return;
   const plan=merge(read(storage),doc);pending=doc;
   el('backupPreviewText').textContent=description(plan.counts)+'. Наличните записи и часовете им се запазват.';
   el('backupApply').disabled=!(plan.counts.picks||plan.counts.prices);
   el('backupPreview').classList.remove('hidden');status.textContent='Файлът е проверен. Прегледай броя преди възстановяване.';
  }catch(error){if(request===token)status.textContent=error.message;}
 };
 el('backupCancel').onclick=()=>{token++;clear();status.textContent='Възстановяването е отказано. Записите са запазени.';};
 el('backupApply').onclick=()=>{
  if(!pending)return;
  try{const counts=apply(storage,pending);onChanged();clear();status.textContent='Възстановено: '+description(counts)+'. Наличните записи са запазени.';}
  catch(error){status.textContent=error.message;}
 };
}
return {PICKS,PRICES,JOURNAL,FORMAT,MAX_BYTES,validate,parse,read,create,merge,recover,apply,mount};
});
