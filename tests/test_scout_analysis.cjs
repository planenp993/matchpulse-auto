'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const A=require('../docs/scout-analysis.js'),S=require('../docs/scout-core.js'),P=require('../docs/scout-patterns.js'),Model=require('../docs/model-core.js');
const row=(date,home,away,hg,ag,extra={},hx=null,ax=null)=>['E0','England','Premier League',date,'15:00',home,away,hg,ag,hx,ax,null,null,extra];
const fixture=row('2026-10-28','Alpha','Beta',null,null);
function history(){return Array.from({length:10},(_,i)=>row('2026-10-'+String(27-i).padStart(2,'0'),i%2?'Other':'Alpha',i%2?'Alpha':'Other',i%2?0:2,i%2?2:0,{HS:12,AS:6,HC:6,AC:2,HY:0,AY:1,HR:0,AR:0},1.5,.5));}
function dossier(rows=history(),f=fixture){const all=[...rows,...rows.map(r=>{const q=[...r];q[5]=q[5]===f[5]?f[6]:q[5];q[6]=q[6]===f[5]?f[6]:q[6];return q;})];return A.describe(S.profile(S.build(all),f,{windowSize:10}),{keyTeam:S.keyTeam,patterns:P,now:new Date('2026-10-27T20:00:00Z'),model:{lambdaHome:1.5,lambdaAway:1,total:2.5,distribution:Model.distribution(1.5,1,-.06)}});}
test('Form preserves selected order and counts draws, losses and real 5-game point blocks',()=>{
 const rows=history();rows[0][7]=0;rows[0][8]=0;rows[1][7]=2;rows[1][8]=0;
 const before=JSON.stringify(rows),f=A.form(rows,'Alpha',S.keyTeam);
 assert.deepEqual([f.wins,f.draws,f.losses,f.points],[8,1,1,25]);assert.equal(f.recentFive,10);assert.equal(f.previousFive,15);
 const html=A.formHTML({form:f});assert.equal((html.match(/class="form-chip /g)||[]).length,10);
 assert.ok(html.indexOf('2026-10-18')<html.indexOf('2026-10-27'));assert.equal(JSON.stringify(rows),before);
 assert.equal(A.form(rows.slice(0,5),'Alpha',S.keyTeam).previousFive,null);
});
test('For, against and match totals use the correct venue and the same observed cohort',()=>{
 const rows=history().slice(0,3);rows[0][13]={HS:10,AS:2};rows[1][13]={HS:4,AS:8};rows[2][13]={HS:99};
 const z=A.statistics(rows,'Alpha',A.STATISTICS.find(x=>x.key==='shots'),S.keyTeam);
 assert.equal(z.n,2);assert.equal(z.possible,3);assert.equal(z.own,9);assert.equal(z.opponent,3);assert.equal(z.total,12);
 assert.equal(z.values[2],null);assert.equal(z.lines[0].hits,0);
});
test('Observed zero stays zero, while unavailable or nonnumeric fields never become zero',()=>{
 const rows=[row('2026-10-01','Alpha','Other',0,0,{HR:0,AR:0}),row('2026-10-02','Alpha','Other',0,0,{HR:null,AR:0}),row('2026-10-03','Alpha','Other',0,0,{HR:'0',AR:0})];
 const z=A.statistics(rows,'Alpha',A.STATISTICS.find(x=>x.key==='red'),S.keyTeam);
 assert.equal(z.n,1);assert.equal(z.own,0);assert.equal(z.total,0);assert.equal(z.lines[0].hits,0);
 assert.equal(A.statistics(rows.slice(1),'Alpha',A.STATISTICS[0],S.keyTeam).own,null);
});
test('xG and actual goals share identical per-direction cohorts, including valid zero xG',()=>{
 const rows=[row('2026-10-01','Alpha','Other',4,1,{},1.2,.8),row('2026-10-02','Other','Alpha',2,0,{},null,0),row('2026-10-03','Alpha','Other',9,7,{},null,2)];
 const x=A.expectedGoals(rows,'Alpha',S.keyTeam);
 assert.deepEqual(x.own,{n:2,mean:.6,goals:2});assert.deepEqual(x.against,{n:2,mean:1.4,goals:4});
 assert.ok(!A.statsHTML(dossier(rows)).includes('NaN'));
});
test('Narrative respects small samples, model availability and explicit UEFA fallback scopes',()=>{
 let d=dossier(history().slice(0,2));const text=A.intro(d).join(' ');assert.match(text,/малка извадка/);assert.ok(!text.includes('чести мачове'));
 d=dossier();d.international=true;d.model=null;d.home.proxy=true;const euro=A.intro(d).join(' ');
 assert.match(euro,/няма моделни проценти/i);assert.match(euro,/нееднозначна клубна идентичност/);
});
test('Source profile excludes same-day, future and awarded matches from every dossier summary',()=>{
 const rows=history(),later=row('2026-10-29','Alpha','Other',100,0,{HS:999,AS:999}),same=row(fixture[3],'Alpha','Other',100,0),awarded=row('2026-10-25','Alpha','Other',100,0,{AWARDED:true});
 const d=dossier([...rows,later,same,awarded]);assert.equal(d.home.form.n,10);assert.equal(d.home.overall.gf,2);assert.equal(d.home.stats.shots.total,18);
});
test('Directional result events are phrased from the actual club perspective',()=>{
 assert.equal(A.eventText('1X','home'),'е без загуба');assert.equal(A.eventText('1X','away'),'е без победа');
 assert.equal(A.eventText('2','home'),'губи');assert.equal(A.eventText('home2','away'),'допуска поне 2 гола');
 const d=dossier(),html=A.trendsHTML(d);assert.match(html,/поредни мача/);assert.ok(!html.includes('streak-table'));
 assert.ok(d.tendencies.slice(0,4).every((v,i,arr)=>arr.findIndex(x=>x.family===v.family)===i));
});
test('Missing most-recent statistic interrupts a streak instead of borrowing an older observation',()=>{
 const rows=history();rows[0][13]={};const d=dossier(rows);
 assert.equal(d.tendencies.some(v=>v.group==='shots'),false);
});
test('Match expansion keeps the actual home-away score, individually missing stats and full names',()=>{
 const r=row('2026-10-22','Other','Alpha',1,4,{HS:3,AS:14,HR:0,AR:null},null,1.5);
 const html=A.historyHTML([r],'Alpha',S.keyTeam);
 assert.ok(html.indexOf('>Other</span>')<html.indexOf('<b>1:4</b>'));assert.match(html,/>Alpha<\/span>/);
 assert.match(html,/result-toggle/);assert.match(html,/Червени картони<\/span><b>0<\/b><b>—<\/b>/);
 assert.ok(!html.includes('Г Other'));assert.match(html,/xG<\/span><b>—<\/b><b>1,50<\/b>/);
});
test('Dossier exports probabilities, source clocks, venue cohorts and per-match evidence without inventing news',()=>{
 const d=dossier(),before=JSON.stringify(d),text=A.brief(d,{keyTeam:S.keyTeam,generatedAt:'2026-10-27T20:00:00Z',status:{last_history_success_utc:'2026-10-27T10:00:00Z'}});
 for(const part of ['ПРОЧИТ НА МАЧА','СЪЩЕСТВУВАЩ МОДЕЛ','Само домакинства','Само гостувания','Наблюдаван xGA','Последни резултати','Удари 12:6','няма архив','не са проверени','Класиране: не е налично','2026-10-27T10:00:00Z'])assert.ok(text.includes(part),part);
 assert.equal(JSON.stringify(d),before);assert.ok(!text.includes('undefined'));assert.ok(!text.includes('NaN'));
});
test('Standings are labelled current and never reconstructed or matched using unreviewed display names',()=>{
 const doc={checks:{E0:{status:'error'}},tables:{E0:{season:'2026/27',provider:'ESPN',observed_at_utc:'2026-10-27T12:00:00Z',groups:[{name:'League',rows:[{name:'Alpha',club_key:null,rank:1,points:90},{name:'Reviewed Beta',club_key:'beta',rank:9,points:7,played:6,won:2,drawn:1,lost:3,gf:4,ga:9,gd:-5}]}]}}};
 const text=A.standingsBrief(doc,'E0',['Alpha','Beta'],S.keyTeam).join('\n');assert.ok(!text.includes('90'));assert.match(text,/9\. Reviewed Beta/);assert.match(text,/проверка е неуспешна/);assert.match(text,/не историческа предмачова/);
});
test('Provider and club text is escaped in chips, match expansions, trends and introductory prose',()=>{
 const name='<img src=x onerror="alert(1)">',d=dossier(history().map(r=>r.map((x,i)=>[5,6].includes(i)&&x==='Alpha'?name:x)),row(fixture[3],name,'Beta',null,null));
 for(const html of [A.formHTML(d.home),A.historyHTML(d.home.all,name,S.keyTeam),A.trendsHTML(d),A.introHTML(d),A.statsHTML(d)]){assert.ok(!html.includes('<img'),html.slice(0,100));assert.ok(html.includes('&lt;img'));}
});
test('UI module and stylesheet have content versions and the offline preview embeds the dossier module',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8');for(const name of ['scout-analysis.js','scout-archive.js','scout.js','scout.css']){
  const version=crypto.createHash('sha256').update(fs.readFileSync('docs/'+name)).digest('hex').slice(0,12);assert.ok(html.includes(name+'?v='+version),name);
 }
 assert.ok(fs.readFileSync('scripts/build_scout_preview.py','utf8').includes('scout-analysis.js'));
});
test('Form curve rises on wins, remains level on draws and falls on losses without altering results',()=>{
 const rows=[row('2026-10-23','Alpha','Other',0,2),row('2026-10-22','Other','Alpha',1,1),row('2026-10-21','Alpha','Other',2,0)];
 const f=A.form(rows,'Alpha',S.keyTeam),before=JSON.stringify(f),curve=A.formCurve(f);
 assert.deepEqual(curve.map(x=>x.value),[1,1,0]);assert.equal(JSON.stringify(f),before);
 const html=A.formHTML({form:f});assert.match(html,/<svg/);assert.match(html,/polyline/);assert.ok(!html.includes('Предишни 5'));assert.ok(!html.includes('form-points'));
});
test('Current tendencies are dated live runs only, exclude old-season runs and honor missing newest values',()=>{
 const recent=history().slice(0,5),d=dossier(recent);
 const current=A.trendsHTML(d);assert.ok(current.includes('active-match-date'));assert.ok(!current.includes('event-trail'));assert.ok(!current.includes('trail-no'));
 for(const v of d.tendencies)for(const side of v.sides){assert.equal(side.rows.length,side.measure.currentStreak);assert.equal(side.until,side.rows[0][3]);}
 const old=dossier(history().map(r=>{const q=[...r];q[3]=r[3].replace('2026-10','2026-05');return q;}));
 assert.equal(old.tendencies.length,0);assert.match(A.trendsHTML(old),/Няма потвърдена продължаваща серия/);
});
test('A pending newer result suppresses the affected club current runs without fabricating a loss',()=>{
 const d=dossier(),p={fixture:d.fixture,windowSize:10,home:{...d.home,pendingLatest:{date:'2026-10-27'}},away:d.away};
 const trends=A.tendencies(p,P,S.keyTeam,'2026-10-27');
 assert.ok(trends.every(t=>t.sides.every(s=>s.side!=='home')));
 const out=A.trendsHTML({...d,tendencies:trends,home:p.home});assert.match(out,/очаква се резултат/);assert.equal(d.home.form.losses,0);
});
test('Intro interprets close model outcomes and a balanced total without inventing a strong favorite',()=>{
 const d=dossier(),prob={...d.model.distribution.probs,homeWin:.38,draw:.25,awayWin:.37,over25:.49};
 d.model={...d.model,distribution:{probs:prob}};const text=A.intro(d).join(' ');
 assert.match(text,/няма отчетлив фаворит/);assert.match(text,/49% за над 2,5 и 51% за под 2,5/);
 assert.ok(!text.includes('Съществуващият модел'));assert.equal((A.introHTML(d).match(/<p>/g)||[]).length,3);
});
