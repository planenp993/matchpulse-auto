const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const M=require('../docs/model-core.js');
const S=require('../docs/scout-core.js');
const E=require('../docs/scout-elo.js');
const P=require('../docs/scout-patterns.js');
const registry=require('../docs/data/club_aliases.json');

test('Importer and browser share every reviewed club identity',()=>{
 const aliases=require('../docs/club-aliases.js');
 assert.deepEqual(aliases,registry.aliases);
 const names=[...Object.keys(aliases),'ЦСКА София','Левски','Bayern München','Kasımpaşa SK'];
 const python="import json,sys;sys.path.insert(0,'scripts');from club_identity import club_key;print(json.dumps([club_key(x) for x in json.load(sys.stdin)]))";
 const keys=JSON.parse(execFileSync('python',['-c',python],{cwd:path.resolve(__dirname,'..'),input:JSON.stringify(names),encoding:'utf8'}));
 assert.deepEqual(keys,names.map(M.clubKey));
 assert.equal(M.clubKey('FC Internazionale Milano'),M.clubKey('Inter'));
 assert.equal(M.clubKey('Heart of Midlothian'),M.clubKey('Hearts'));
 assert.notEqual(M.clubKey('Red Star FC'),M.clubKey('Red Star Belgrade'));
});

test('Administrative scores cannot influence form, Elo, trends or automatic settlement',()=>{
 const rows=Array.from({length:8},(_,i)=>['E2','England','League One',`2026-08-${String(i+1).padStart(2,'0')}`,'15:00','Bolton Wanderers','Reading FC',2,1,null,null,null,null]);
 rows[7].push({AWARDED:true,HS:20,AS:5});
 const f=['E2','England','League One','2026-09-01','15:00','Bolton','Reading',null,null,null,null,null,null];
 assert.equal(M.teamMatches(rows,'Bolton',f[3]).length,7);
 assert.equal(S.profile(S.build(rows),f).home.overall.n,7);
 assert.equal(E.teamAt(E.build(rows,M.clubKey),'E2','Bolton',f[3]).games,7);
 assert.equal(P.observation(rows[7],'Bolton','home','o25',M.clubKey),null);
 assert.equal(S.marketSettled({market:'1'},rows[7]),null);
});

test('Browser and offline entry points load identities before the model',()=>{
 for(const name of ['scout.html','lab.html']){
  const html=fs.readFileSync(path.resolve(__dirname,'../docs',name),'utf8');
  assert.ok(html.indexOf('src="club-aliases.js"')<html.indexOf('src="model-core.js"'));
 }
 const builder=fs.readFileSync(path.resolve(__dirname,'../scripts/build_scout_preview.py'),'utf8');
 assert.match(builder,/club-aliases\.js/);
});
