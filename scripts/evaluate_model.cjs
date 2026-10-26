/* Replay the actual browser model, with its own strict pre-match date cutoff. */
const fs=require('node:fs');
const path=require('node:path');
const M=require('../docs/model-core.js');
const round=x=>Math.round(x*10000)/10000;

function report(history,{since='2026-08-20',until=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Sofia'}).format(new Date()),preset='standard'}={}){
 const games=history.filter(M.isPlayed),observations=[];
 for(const game of games){
  if(game[3]<since||game[3]>until||['UCL','UEL','UECL'].includes(game[0]))continue;
  const value=M.evaluate(games,game,preset);
  if(value.error||!value.bases.count)continue;
  const probability=value.distribution.probs.over25;
  const baseline=M.distribution(value.bases.home,value.bases.away,0).probs.over25;
  observations.push({division:game[0],date:game[3],actual:+(game[7]+game[8]>=3),probability,baseline});
 }
 const score=(rows,key)=>rows.reduce((sum,r)=>sum+(r[key]-r.actual)**2,0)/rows.length;
 const bins=[];
 for(let low=0;low<100;low+=20){
  const rows=observations.filter(r=>r.probability*100>=low&&r.probability*100<(low===80?101:low+20));
  if(rows.length)bins.push({range:`${low}-${low+20}%`,n:rows.length,
   forecast:round(rows.reduce((s,r)=>s+r.probability,0)/rows.length),actual:round(rows.reduce((s,r)=>s+r.actual,0)/rows.length)});
 }
 const leagues=[...new Set(observations.map(r=>r.division))].sort().map(league=>{
  const rows=observations.filter(r=>r.division===league);
  return {league,n:rows.length,brier:round(score(rows,'probability')),baseline_brier:round(score(rows,'baseline'))};
 });
 return {n:observations.length,since,until:observations.length?observations.reduce((last,r)=>r.date>last?r.date:last,''):until,
  market:'Over 2.5 goals',model:`MatchpulseModel.evaluate / ${preset}`,
  brier:observations.length?round(score(observations,'probability')):null,
  baseline_brier:observations.length?round(score(observations,'baseline')):null,
  bins,leagues,method:'Actual browser module; fixed preset; strict date-before-fixture cutoff; shared aliases; administrative scores excluded',
  limitations:'Retrospective diagnostic only; no prospective validation, bookmaker prices or yield/ROI evidence'};
}

if(require.main===module){
 const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1]};
 const raw=args.includes('--stdin')?fs.readFileSync(0,'utf8'):fs.readFileSync(path.resolve(__dirname,'../docs/data/history.json'),'utf8');
 process.stdout.write(JSON.stringify(report(JSON.parse(raw),{since:value('--since'),until:value('--until')})));
}
module.exports={report};
