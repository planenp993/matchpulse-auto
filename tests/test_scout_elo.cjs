'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const S=require('../docs/scout-core.js'),E=require('../docs/scout-elo.js'),Stats=require('../docs/scout-markets.js');
const row=(day,home,away,hg,ag,extra=null)=>['E0','England','Premier League',day,'18:00',home,away,hg,ag,null,null,null,null,...(extra?[extra]:[])];
function fixture(date='2026-11-01'){return row(date,'Alpha','Beta',null,null)}
function history(){
 const rows=[],teams=['Alpha','Beta','Gamma','Delta'];
 for(let i=1;i<=15;i++){
   const day='2026-10-'+String(i).padStart(2,'0');
   rows.push(row(day,'Alpha','Beta',i%3+1,0,{HC:i%5+4,AC:i%4+3,HY:2,AY:3,HS:10+i%4,AS:8+i%3}));
   rows.push(row(day,'Gamma','Delta',1,0,{HC:6,AC:5,HY:1,AY:1,HS:8,AS:9}));
 }
 return rows;
}
test('Elo is strictly pre-match with no same-day or future leakage',()=>{
 const rows=history(),e=E.build(rows,S.keyTeam);
 const first=e.before.get(rows[0]);
 assert.equal(first.home,1500);assert.equal(first.away,1500);
 const sameDay=e.before.get(rows[1]);
 assert.equal(sameDay.home,1500);assert.equal(sameDay.away,1500);
 const prev=E.teamAt(e,'E0','Alpha','2026-10-10');
 const shock=row('2026-11-22','Beta','Alpha',28,0);
 const altered=E.build([...rows,shock],S.keyTeam);
 assert.equal(E.teamAt(altered,'E0','Alpha','2026-10-10').rating,prev.rating);
 assert.equal(E.teamAt(altered,'E0','Alpha','2026-10-10').games,prev.games);
 assert.ok(E.teamAt(e,'E0','Alpha','2026-10-16').games>5);
});
test('same division ratings are deterministic and no cross-league comparison',()=>{
 const rows=history(),e=E.build(rows,S.keyTeam);
 const alt=E.build(rows.slice().reverse(),S.keyTeam);
 const home=E.teamAt(e,'E0','Alpha','2026-11-01'),home2=E.teamAt(alt,'E0','Alpha','2026-11-01');
 assert.equal(home.rating,home2.rating);
 assert.equal(E.teamAt(e,'D1','Alpha','2026-11-01').games,0);
 const m=E.matchup(e,fixture());
 assert.ok(m.usable);assert.ok(m.home.rating>m.away.rating);
 assert.ok(m.homeExpected>0&&m.homeExpected<1);
});
test('last 5/10/15 windows apply equally to goals, corners, shots and venue',()=>{
 const rows=history(),i=S.build(rows),e=E.build(rows,S.keyTeam);e.opponentClass=E.opponentClass;
 for(const n of [5,10,15]){
  const p=S.profile(i,fixture(),{windowSize:n,eloIndex:e});
  assert.equal(p.home.overall.n,n);assert.equal(p.away.overall.n,n);
  const cards=Stats.compare(p,1);
  for(const c of cards){if(c.key==='corners'||c.key==='shots')assert.equal(c.home.n,n)}
  assert.ok(p.home.local.n<=n);assert.ok(p.away.local.n<=n);
 }
});
test('strong/weak filter only uses the selected N most recent matches',()=>{
 const rows=history(),i=S.build(rows),e=E.build(rows,S.keyTeam);e.opponentClass=E.opponentClass;
 const baseline=S.profile(i,fixture(),{windowSize:5,eloIndex:e});
 const strong=S.profile(i,fixture(),{windowSize:5,opponentFilter:'strong',eloIndex:e});
 const weak=S.profile(i,fixture(),{windowSize:5,opponentFilter:'weak',eloIndex:e});
 assert.ok(strong.home.all.length<=5&&weak.home.all.length<=5);
 for(const r of strong.home.all)assert.equal(E.opponentClass(e,r,'Alpha'),'strong');
 for(const r of weak.home.all)assert.equal(E.opponentClass(e,r,'Alpha'),'weak');
 assert.ok(strong.home.all.length+weak.home.all.length<=baseline.home.all.length);
});
test('historical opponent classes only available with sufficient pre-match Elo sample',()=>{
 const rows=history(),e=E.build(rows,S.keyTeam);
 assert.equal(E.opponentClass(e,rows[0],'Alpha'),'unknown');
 const last=rows[rows.length-2],cls=E.opponentClass(e,last,'Alpha');
 assert.ok(['strong','weak','similar'].includes(cls));
 const summary=E.breakdown(e,rows.filter(x=>x[5]==='Alpha'),'Alpha');
 assert.equal(summary.total,15);
 assert.equal(summary.strong+summary.weak+summary.similar+summary.unknown,15);
});
test('Elo engine and research controls are included in Scout HTML and offline builder',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../docs/scout.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../docs/scout.js'),'utf8');
 const bundle=fs.readFileSync(path.join(__dirname,'../scripts/build_scout_preview.py'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(js));
 for(const id of ['researchWindow','researchOpp','drawerWindow','drawerOpp'])assert.ok(html.includes(id));
 assert.match(html,/scout-elo\.js/);assert.match(bundle,/scout-elo\.js/);
 assert.match(js,/eloReport\(f,p\)/);
});
