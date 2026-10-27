'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const S=require('../docs/scout-selections.js'),C=require('../docs/scout-core.js'),M=require('../docs/model-core.js');
const history=JSON.parse(fs.readFileSync('docs/data/history.json')),
 fixtures=JSON.parse(fs.readFileSync('docs/data/fixtures.json')),
 index=C.build(history),now=new Date('2026-10-28T07:00:00Z');
const fixture=fixtures.find(f=>f[0]==='E0'&&f[3]>='2026-10-29'),profile=C.profile(index,fixture,{windowSize:10});
const engine=S.createEngine(history,M,C);
const evaluate=(f=fixture,options={})=>engine.evaluate(f,{profile:C.profile(index,f,{windowSize:10}),now,...options});

test('Joint builder probability equals intersecting score cells, not multiplied marginal probabilities',()=>{
 const matrix=M.distribution(1.8,1.1,-.06).matrix;
 const actual=S.probability(matrix,['1X','u35']);
 let exact=0;for(let h=0;h<matrix.length;h++)for(let a=0;a<matrix[h].length;a++)if(h>=a&&h+a<=3)exact+=matrix[h][a];
 assert.equal(actual,exact);
 assert.ok(Math.abs(actual-S.probability(matrix,['1X'])*S.probability(matrix,['u35']))>.001);
 assert.equal(S.probability(matrix,['1','2']),0);
 assert.equal(S.probability(matrix,['btts','o15']),S.probability(matrix,['btts']));
 assert.equal(S.probability([[.4,.1],[.2,.1]],['1']),null);
 assert.equal(S.probability(matrix,['corners85']),null);
 assert.equal(S.fair(0),null);assert.equal(S.fair(NaN),null);assert.equal(S.fair(.6),1/.6);
});

test('Every new candidate uses the identical unchanged live distribution and preserves input data',()=>{
 const before=crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex');
 const result=evaluate(),live=M.evaluate(history,fixture,'standard');
 assert.deepEqual(result.model.distribution,live.distribution);
 assert.equal(result.candidates.length,S.MARKETS.length);
 const expected={'1':live.distribution.probs.homeWin,'X':live.distribution.probs.draw,'2':live.distribution.probs.awayWin,
  o25:live.distribution.probs.over25,btts:live.distribution.probs.btts,home1:live.distribution.probs.homeOver05,away2:live.distribution.probs.awayOver15};
 for(const [id,p] of Object.entries(expected)){const c=result.candidates.find(c=>c.id===id);assert.ok(Math.abs(c.probability-p)<1e-12);assert.equal(c.fair,1/c.probability);}
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(history)).digest('hex'),before);
});

test('Primary rank can select a more informative event over the highest probability; alternatives diversify',()=>{
 const matrix=M.distribution(1.6,1.1,-.06).matrix;
 const candidate=(id,rank)=>({id,rank,family:S.MARKETS.find(m=>m.id===id).family,eligible:true,probability:S.probability(matrix,[id]),quote:{aboveModel:false}});
 const high=candidate('o15',.01),specific=candidate('1',.10),opposite=candidate('2',.09),compatible=candidate('home2',.05);
 assert.ok(high.probability>specific.probability);
 const result=S.select([high,specific,opposite,compatible],matrix);
 assert.equal(result.main.id,'1');assert.ok(!result.alternatives.some(c=>c.id==='2'));
 assert.equal(new Set([result.main,...result.alternatives].map(c=>c.family)).size,1+result.alternatives.length);
 assert.equal(S.select([{...specific,eligible:false}],matrix).main,null);
});

test('Indexed selection replay preserves the live model across all covered domestic divisions',()=>{
 const samples=[...new Set(fixtures.map(f=>f[0]))].filter(d=>!['UCL','UEL','UECL'].includes(d))
  .map(d=>fixtures.find(f=>f[0]===d&&f[3]>='2026-10-29')).filter(Boolean);
 let compared=0;
 for(const f of samples){const candidate=evaluate(f);if(!candidate.model)continue;
  assert.deepEqual(candidate.model.distribution,M.evaluate(history,f,'standard').distribution,f[0]);compared++;
 }
 assert.ok(compared>=18);
});

test('Price comparison rejects missing, old, future and historical prices and retains unrounded probability',()=>{
 const q={odds:1.9,kind:'fixture_csv',observed_at_utc:'2026-10-27T13:00:00Z',book:'bet365'};
 assert.equal(S.quoteAssessment(q,.6,now).edge,.6*1.9-1);
 assert.equal(S.quoteAssessment(q,.6,now).aboveModel,true);
 for(const patch of [{kind:'historical_csv'},{observed_at_utc:'2026-10-20T12:00:00Z'},{observed_at_utc:'2026-10-30T12:00:00Z'},{observed_at_utc:'invalid'}]){
  const result=S.quoteAssessment({...q,...patch},.6,now);assert.equal(result.edge,null);assert.equal(result.aboveModel,false);
 }
 assert.equal(S.quoteAssessment(null,.6,now).status,'missing');
 assert.equal(S.quoteAssessment({...q,odds:1},.6,now).edge,null);
 assert.equal(S.quoteAssessment(q,null,now).edge,null);
});

test('Event evidence maps own goals against the opponent conceded goals and keeps actual venue mix',()=>{
 const row=(date,h,a,hg,ag)=>['E0','England','Premier League',date,'18:00',h,a,hg,ag,null,null,null,null,{}];
 const rows=[row('2026-10-21','Alpha','Other',2,0),row('2026-10-20','Other','Alpha',0,2),
  row('2026-10-19','Other','Beta',2,0),row('2026-10-18','Beta','Other',0,2),row(fixture[3],'Alpha','Other',20,0)];
 const threshold=S.MARKETS.find(m=>m.id==='home2').test,baseline={normal:.4,reverse:.3,n:100};
 const h=S.measure(rows.slice(0,2),'Alpha',true,threshold,baseline,C,fixture[3]);
 const a=S.measure(rows.slice(2,4),'Beta',false,threshold,baseline,C,fixture[3]);
 assert.deepEqual([h.hits,h.n,a.hits,a.n],[2,2,2,2]);assert.ok(Math.abs(h.baseline-.35)<1e-12);
 assert.equal(S.measure([rows[4]],'Alpha',true,threshold,baseline,C,fixture[3]).n,0);
});

test('International, late, incomplete, stale and unresolved fixtures receive no manufactured selections',()=>{
 const euro=[...fixture];euro[0]='UCL';assert.match(evaluate(euro).reason,/Евротурнир/);
 assert.match(evaluate(fixture,{pending:true}).reason,/по-нов/);
 assert.match(evaluate(fixture,{profile:{...profile,home:{...profile.home,all:profile.home.all.slice(0,4)}}}).reason,/поне 5/);
 const stale=structuredClone(profile);stale.home.all=stale.home.all.map(r=>{r[3]='2025-01-01';return r;});
 assert.match(evaluate(fixture,{profile:stale}).reason,/45 дни/);
 const today=[...fixture];today[3]='2026-10-28';today[4]='';today[13]='Football-Data';
 assert.match(evaluate(today).reason,/Непотвърден/);
 const started=[...fixture];started[3]='2026-10-27';
 assert.equal(evaluate(started).candidates.length,0);
});

test('Selection inputs exclude same-day, later and awarded results and do not change the model horizon',()=>{
 const extra=[...fixture];extra[7]=8;extra[8]=8;extra[13]={AWARDED:true};
 const same=[...extra];same[13]={};const later=[...same];later[3]='2026-12-01';
 const award=[...extra];award[3]='2026-10-20';
 const amended=[...history,extra,same,later,award],other=S.createEngine(amended,M,C),p=C.profile(C.build(amended),fixture,{windowSize:10});
 const a=evaluate(),b=other.evaluate(fixture,{profile:p,now});
 assert.deepEqual(b.model.distribution,a.model.distribution);
 assert.deepEqual(b.candidates.map(c=>c.evidence),a.candidates.map(c=>c.evidence));
 assert.equal(b.model.settings.sampleSize,undefined);assert.ok(b.model.quality.homeN<=30);
});

test('Real builder output excludes duplicate conditions and has correct joint probability and family diversity',()=>{
 const f=fixtures.find(f=>f[0]==='I1'&&f[3]==='2026-10-28'&&f[5]==='Milan');
 const result=evaluate(f);assert.ok(result.builders.length>0);
 assert.equal(new Set(result.builders.map(b=>b.familyPair)).size,result.builders.length);
 for(const b of result.builders){
  assert.equal(b.probability,S.probability(result.model.distribution.matrix,b.legs));
  const marginal=b.legs.map(id=>result.candidates.find(c=>c.id===id).probability);
  assert.ok(b.probability<Math.min(...marginal)-1e-9);assert.ok(b.probability>=.30&&b.probability<=.78);
 }
});

test('Columns keep one date, unique fixtures and clubs, with explicit independence and exact product',()=>{
 const make=(home,away,date='2026-10-30')=>({fixture:['E0','England','Premier League',date,'18:00',home,away],main:{id:'1',eligible:true,probability:.7,fair:1/.7,rank:.1,quote:{aboveModel:false}}});
 const pool=[make('Arsenal','Chelsea'),make('Manchester City','Liverpool'),make('Everton','Brentford'),make('Leeds','Fulham'),make('Arsenal','Brighton'),make('Arsenal','Chelsea'),make('Other','New','2026-10-31')];
 const out=S.columns(pool,C);assert.equal(out.length,3);
 for(const column of out){
  const clubs=column.legs.flatMap(l=>[C.keyTeam(l.fixture[5]),C.keyTeam(l.fixture[6])]);
  assert.equal(new Set(clubs).size,clubs.length);assert.equal(new Set(column.legs.map(l=>l.key)).size,column.size);
  assert.equal(new Set(column.legs.map(l=>l.fixture[3])).size,1);
  assert.equal(column.probability,column.legs.reduce((v,l)=>v*l.pick.probability,1));
  assert.equal(column.fair,1/column.probability);assert.equal(column.assumption,'independent_matches');
 }
});

test('HTML content versions cover both selection modules and the offline builder embeds prices and modules',()=>{
 const html=fs.readFileSync('docs/scout.html','utf8'),builder=fs.readFileSync('scripts/build_scout_preview.py','utf8');
 for(const path of ['scout-selections.js','scout-selection-ui.js']){
  const hash=crypto.createHash('sha256').update(fs.readFileSync('docs/'+path)).digest('hex').slice(0,12);
  assert.ok(html.includes(path+'?v='+hash));assert.ok(builder.includes(path));
 }
 assert.ok(builder.includes('selection_quotes.json'));
 assert.ok(html.indexOf('data-view="selections"')>html.indexOf('data-view="diary"'));
});
