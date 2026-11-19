/* MATCH LAB X public frontend. Soccerway fixtures via existing public snapshot,
   Football-Data.co.uk via independently sourced CSV histories. */
(function(){
"use strict";
const M=window.MLXModel,$=id=>document.getElementById(id);
const CORE=["E0","E1","D1","D2","I1","I2","SP1","SP2","F1","F2"];
const EXTRA=["E2","E3","SC0","N1","B1","P1","T1","G1"];
const META={
E0:["🇬🇧","Premier League"],E1:["🇬🇧","Championship"],D1:["🇩🇪","Bundesliga"],
D2:["🇩🇪","2. Bundesliga"],I1:["🇮🇹","Serie A"],I2:["🇮🇹","Serie B"],
SP1:["🇪🇸","La Liga"],SP2:["🇪🇸","Segunda División"],F1:["🇫🇷","Ligue 1"],
F2:["🇫🇷","Ligue 2"],E2:["🇬🇧","League One"],E3:["🇬🇧","League Two"],
SC0:["🏴","Scottish Premiership"],N1:["🇳🇱","Eredivisie"],B1:["🇧🇪","Pro League"],
P1:["🇵🇹","Primeira Liga"],T1:["🇹🇷","Süper Lig"],G1:["🇬🇷","Super League"]};
const meta=div=>META[div]||["⚽",div];
const node=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e;};
const clear=id=>{const el=$(id);el.replaceChildren();return el;};
const set=(id,v)=>{if($(id))$(id).textContent=String(v);};
const num=n=>Number(n||0).toLocaleString("bg-BG");
const pct=M.pct;
const dateBG=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Sofia",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const nowBG=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Sofia",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date()).replace(" ","T");
const shift=(day,n)=>{const x=new Date(day+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const human=day=>new Intl.DateTimeFormat("bg-BG",{day:"2-digit",month:"long",weekday:"long",timeZone:"UTC"}).format(new Date(day+"T12:00:00Z"));
const key=f=>[f.div,f.date,f.home,f.away].join("|");
let fixtures=[],coverage=null,active=null,selected="ALL",daysBrief=7,screen="overview",analysisToken=0;
const histCache=new Map(),histPending=new Map();
const supported=()=>CORE.concat(EXTRA.filter(d=>(coverage?.leagues?.[d]?.matches||0)>=500));
const current=()=>fixtures.filter(f=>supported().includes(f.div));
const future=(days=90)=>{const now=nowBG(),end=shift(dateBG(),days);
 return current().filter(f=>(f.date+"T"+f.time)>=now&&f.date<=end).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));};
async function fetchJSON(path){
 const res=await fetch(path+"?v="+Date.now(),{cache:"no-store"});
 if(!res.ok)throw Error("HTTP "+res.status+" за "+path);
 return res.json();
}
let sharedHistoryPending=null;
async function history(div){
 if(histCache.has(div))return histCache.get(div);
 if(!sharedHistoryPending)sharedHistoryPending=fetchJSON("../data/history.json").then(data=>{
   if(!Array.isArray(data))throw Error("Невалиден публикуван исторически архив");
   for(const row of data){
     if(!Array.isArray(row)||!META[row[0]]||!Number.isInteger(row[7])||!Number.isInteger(row[8]))continue;
     const extra=row[13]||{};
     const validNum=v=>Number.isInteger(v)&&v>=0?v:null;
     const item=[row[3],row[5],row[6],row[7],row[8],
       validNum(extra.HTHG),validNum(extra.HTAG),
       validNum(extra.HS),validNum(extra.AS),validNum(extra.HST),validNum(extra.AST),
       validNum(extra.HC),validNum(extra.AC),validNum(extra.HY),validNum(extra.AY)];
     if(!histCache.has(row[0]))histCache.set(row[0],[]);
     histCache.get(row[0]).push(item);
   }
   for(const list of histCache.values())list.sort((a,b)=>a[0].localeCompare(b[0]));
 }).catch(err=>{sharedHistoryPending=null;throw err});
 await sharedHistoryPending;
 return histCache.get(div)||[];
}
function closeMenu(){$("sidebar").classList.remove("open");$("menuBackdrop").classList.remove("open");}
function goto(next){
 if(!["overview","fixtures","analysis","research","sources"].includes(next))return;
 screen=next;
 document.querySelectorAll(".screen").forEach(x=>x.classList.toggle("active",x.id==="screen-"+next));
 document.querySelectorAll(".navitem").forEach(x=>x.classList.toggle("active",x.dataset.screen===next));
 set("crumb",({overview:"Общ преглед",fixtures:"Програма",analysis:"Анализ на мач",research:"Research Lab",sources:"Данни и източници"})[next]);
 closeMenu();window.scrollTo(0,0);
 if(next==="fixtures")renderFixtures();
 if(next==="analysis")renderAnalysis();
 if(next==="sources")renderCoverage();
}
function wire(){
 for(const x of document.querySelectorAll("[data-screen]"))x.addEventListener("click",()=>goto(x.dataset.screen));
 for(const x of document.querySelectorAll("[data-goto]"))x.addEventListener("click",()=>goto(x.dataset.goto));
 $("menuToggle").addEventListener("click",()=>{$("sidebar").classList.toggle("open");$("menuBackdrop").classList.toggle("open");});
 $("menuBackdrop").addEventListener("click",closeMenu);
 $("searchMatches").addEventListener("input",renderFixtures);
 $("rangeFilter").addEventListener("change",renderFixtures);
 $("leagueFilter").addEventListener("change",()=>{selected=$("leagueFilter").value;renderFixtures();});
 $("matchSelect").addEventListener("change",()=>{active=$("matchSelect").value;renderAnalysis();});
 for(const b of document.querySelectorAll("#quickDates button"))b.addEventListener("click",()=>{
   daysBrief=Number(b.dataset.days);document.querySelectorAll("#quickDates button").forEach(t=>t.classList.toggle("active",t===b));renderOverview();
 });
}
function loadFixtures(raw){
 if(!Array.isArray(raw))throw Error("Неочакван формат на Soccerway календара");
 const list=[];
 for(const f of raw){
  if(!Array.isArray(f)||f.length<14)continue;
  const [div,, ,date,time,home,away]=f;
  if(!META[div]||!home||!away||!/^\d{4}-\d{2}-\d{2}$/.test(String(date))||!/^\d{2}:\d{2}$/.test(String(time)))continue;
  if(!String(f[13]||"").toLowerCase().includes("soccerway"))continue;
  list.push({div,date,time,home:String(home),away:String(away),source:String(f[13])});
 }
 fixtures=list;
}
function sidebar(){
 const target=clear("leagueNav");
 const groups=[["ТОП 5 + ВТОРИ ЛИГИ",CORE],["ДРУГИ ЛИГИ",EXTRA.filter(d=>(coverage?.leagues?.[d]?.matches||0)>=500)]];
 for(const [label,leagues] of groups){
  target.appendChild(node("div","navlabel",label));
  for(const div of leagues){
   const b=node("button","leagueitem");b.type="button";
   b.append(node("span","leagueflag",meta(div)[0]),node("strong",null,meta(div)[1]),node("small",null,div));
   b.addEventListener("click",()=>{selected=div;$("leagueFilter").value=div;goto("fixtures");});
   target.appendChild(b);
  }
 }
 const sel=$("leagueFilter");sel.replaceChildren();
 for(const d of ["ALL",...supported()]){
  const o=node("option",null,d==="ALL"?"Всички първенства":meta(d)[0]+" "+meta(d)[1]);o.value=d;sel.appendChild(o);
 }
 sel.value=supported().includes(selected)?selected:"ALL";
}
function counters(){
 const leagues=supported(),stats=coverage?.leagues||{};
 set("metricHistory",coverage?num(leagues.reduce((a,d)=>a+(stats[d]?.matches||0),0)):"—");
 set("metricLeagues",leagues.length);
 set("metricFixtures",num(future(90).length));
 set("metricShots",coverage?num(leagues.reduce((a,d)=>a+(stats[d]?.on_target_matches||0),0)):"—");
 set("clockText",dateBG()+" · София");
 set("dataState",fixtures.length&&coverage?"Актуални източници":fixtures.length?"Частично покритие":"Проверка на данните");
}
function gameButton(f,small=false){
 const b=node("button",small?"match-row":"fixture-line");b.type="button";
 if(small){
  const when=node("span"),info=node("span");
  when.append(node("span","match-time",f.time),node("small","match-day",f.date.slice(5)));
  info.append(node("span","match-team",f.home+" – "+f.away),node("span","match-meta",meta(f.div)[0]+" "+meta(f.div)[1]));
  b.append(when,info,node("span","row-right","↗"));
 }else b.append(node("span","match-time",f.time),node("span","fixture-code",f.div),
  node("span","fixture-teams",f.home+" – "+f.away),node("span","fixture-arrow","↗"));
 b.addEventListener("click",()=>{active=key(f);$("matchSelect").value=active;goto("analysis");});
 return b;
}
function renderOverview(){
 const root=clear("overviewMatches");
 const list=future(daysBrief).filter(f=>CORE.includes(f.div)).slice(0,10);
 if(!list.length)root.appendChild(node("div","loading-state","Няма публикувани срещи от топ първенствата за този период."));
 else list.forEach(f=>root.appendChild(gameButton(f,true)));
}
function renderFixtures(){
 const root=clear("fixtureGroups"),term=M.norm($("searchMatches").value);
 const list=future(Number($("rangeFilter").value)).filter(f=>(selected==="ALL"||f.div===selected)
 &&(!term||M.norm(f.home+" "+f.away+" "+meta(f.div)[1]).includes(term)));
 set("fixtureCountHeader",list.length+" срещи");
 if(!list.length){root.appendChild(node("div","empty-state","Няма срещи за избраните филтри."));return;}
 const byDate=new Map();
 for(const f of list){if(!byDate.has(f.date))byDate.set(f.date,[]);byDate.get(f.date).push(f);}
 for(const [date,items] of byDate){
  const box=node("section","date-group"),title=node("div","date-heading");
  title.append(node("span",null,human(date)),node("small",null,items.length+" срещи"));box.appendChild(title);
  items.forEach(f=>box.appendChild(gameButton(f)));
  root.appendChild(box);
 }
}
function chooseMatches(){
 const sel=$("matchSelect");sel.replaceChildren();
 for(const f of future(90)){
  const o=node("option",null,f.date.slice(5)+" · "+f.time+" · "+f.home+" – "+f.away+" ("+f.div+")");
  o.value=key(f);sel.appendChild(o);
 }
 if(active&&Array.from(sel.options).some(o=>o.value===active))sel.value=active;
 else{sel.selectedIndex=0;active=sel.value;}
}
function card(title){
 const e=node("article","analysis-card");e.appendChild(node("h3",null,title));return e;
}
function labelBar(root,title,value){
 const head=node("div","prob-header");head.append(node("span",null,title),node("strong",null,pct(value)));
 const bg=node("div","progbar"),fill=node("span");fill.style.width=Math.max(0,Math.min(100,value*100))+"%";bg.appendChild(fill);
 root.append(head,bg);
}
function teamStats(root,who,stats){
 root.appendChild(node("div","section-label",who));
 const forms=node("div","form-track");
 for(const f of stats.all.form.length?stats.all.form:["—"])
  forms.appendChild(node("span","formdot "+f,f==="W"?"П":f==="D"?"Р":f==="L"?"З":"—"));
 root.appendChild(forms);
 for(const [label,val] of [["Исторически мачове",stats.seen],["Вкарани / мач (10)",stats.all.for],
 ["Допуснати / мач (10)",stats.all.against],["Точни удари / мач (10)",stats.all.sot]]){
  const tr=node("div","teamstat"),left=node("div");
  left.appendChild(node("small",null,label));
  tr.append(left,node("strong",null,val===null||val===undefined?"—":label==="Исторически мачове"?val:val.toFixed(2)));
  root.appendChild(tr);
 }
}
function showAnalysis(f,estimate){
 const root=node("div","analysis-body");
 const hero=node("div","match-hero"),left=node("div");
 left.append(node("span","overline",meta(f.div)[0]+" "+meta(f.div)[1]),
   node("h2",null,f.home+" – "+f.away),
   node("p",null,f.date+" · "+f.time+" ч. (София) · "+f.source));
 const right=node("div","lambda");
 right.append(node("div",null,estimate.ready?estimate.lh.toFixed(2)+" : "+estimate.la.toFixed(2):"—"),
  node("small",null,estimate.ready?"Очаквани голове λ":"Недостатъчно данни"));
 hero.append(left,right);root.appendChild(hero);
 if(!estimate.ready){const c=card("Няма надеждна оценка");c.appendChild(node("p","quality-msg",estimate.reason));root.appendChild(c);return root;}
 const grid=node("div","analysis-grid"),prediction=card("Вероятности · публичен базов модел");
 prediction.appendChild(node("p","caption","Експериментален Poisson от общия резултатен архив с Football-Data UK статистики и OpenFootball допълнения. Не е частният Dixon–Coles или RDE."));
 for(const [k,t] of [["home","Победа домакин"],["draw","Равенство"],["away","Победа гост"]])labelBar(prediction,t,estimate.markets[k]);
 const markets=node("div","market-mini");
 for(const [k,t] of [["over25","Над 2.5"],["btts","Гол/Гол"],["over35","Над 3.5"]]){
  const m=node("div","mini-value");m.append(node("strong",null,pct(estimate.markets[k])),node("small",null,t));markets.appendChild(m);
 }
 prediction.appendChild(markets);
 const form=card("Отбори · последна форма");
 teamStats(form,f.home,estimate.home);teamStats(form,f.away,estimate.away);
 grid.append(prediction,form);root.appendChild(grid);
 const section=node("div","analysis-grid"),exact=card("Вероятни крайни резултати"),direct=card("Директни срещи");
 estimate.matrix.slice().sort((a,b)=>b[2]-a[2]).slice(0,7).forEach(x=>labelBar(exact,x[0]+":"+x[1],x[2]));
 if(!estimate.h2h.length)direct.appendChild(node("p","caption","Няма достатъчно проверени директни срещи в разглеждания период."));
 for(const r of estimate.h2h){const line=node("div","h2h-item");line.append(node("span",null,r[0]),node("span",null,r[1]+" – "+r[2]),node("span",null,r[3]+":"+r[4]));direct.appendChild(line);}
 section.append(exact,direct);root.appendChild(section);
 const lower=node("div","analysis-grid"),sim=card("Сценарии на полувремето"),quality=card("Произход на оценката");
 sim.appendChild(node("p","caption","При 45' зададеният резултат се комбинира с независим Poisson модел за втората част. Това не е причинна тактическа симулация."));
 const ctrl=node("div","ht-controls"),sh=node("select"),sa=node("select");
 sh.setAttribute("aria-label","Голове домакин");sa.setAttribute("aria-label","Голове гост");
 for(const select of [sh,sa])for(let i=0;i<=4;i++){const o=node("option",null,i);o.value=i;select.appendChild(o);}
 ctrl.append(node("span","hint","45'"),sh,node("span",null,":"),sa);sim.appendChild(ctrl);
 const button=node("button","sim-button","Генерирай 10 000 сценария ↗"),result=node("div","sim-results");
 result.hidden=true;
 const render=(monte=false)=>{
  const after=M.afterHalf(estimate,Number(sh.value),Number(sa.value));
  if(!after)return;
  const p=monte?M.sample(after.matrix,10000):after.markets;
  result.textContent=(monte?"10 000 тегления: ":"При HT "+sh.value+":"+sa.value+": ")+
  "1 "+pct(p.home)+" · X "+pct(p.draw)+" · 2 "+pct(p.away)+" · Над 2.5 "+pct(p.over25)+" · Г/Г "+pct(p.btts);
  result.hidden=false;
 };
 sh.addEventListener("change",()=>render(false));sa.addEventListener("change",()=>render(false));
 button.addEventListener("click",()=>render(true));sim.append(button,result);
 quality.append(node("p","caption","Използвани "+estimate.n+" исторически срещи от Football-Data UK с дата преди "+f.date+". Отделна версия на базов Poisson, без частните модели."),
  node("p","quality-msg","Оценките не доказват предимство срещу букмейкърските коефициенти. Не представляват съвет за залог."));
 lower.append(sim,quality);root.appendChild(lower);return root;
}
async function renderAnalysis(){
 const id=active||$("matchSelect").value;
 const f=fixtures.find(x=>key(x)===id),root=clear("analysisBody");
 if(!f){root.appendChild(node("div","empty-state","Избери бъдещ мач от програмата."));return;}
 $("matchSelect").value=key(f);
 set("matchSource","Soccerway · "+f.div+" · "+f.date);
 root.appendChild(node("div","loading-state","Зареждане на историческия архив (Football-Data UK + проверени допълнения)…"));
 const token=++analysisToken;
 try{
  const rows=await history(f.div);
  if(token!==analysisToken)return;
  root.replaceChildren(showAnalysis(f,M.estimate(rows,f)));
 }catch(e){
  if(token!==analysisToken)return;
  root.replaceChildren(node("div","empty-state","Общият исторически архив за "+f.div+" не е достъпен: "+e.message));
 }
}
function renderCoverage(){
 const root=clear("coverageRows"),info=coverage?.leagues||{};
 set("lastSync",coverage?.generated_utc?"Обновено: "+coverage.generated_utc.slice(0,16).replace("T"," ")+" UTC":"Историята още не е изградена");
 for(const div of supported()){
  const x=info[div]||{},tr=node("tr");
  const cells=[meta(div)[0]+" "+meta(div)[1],num(x.matches),num(x.on_target_matches),
   current().filter(f=>f.div===div).length,x.ready?"Достатъчно история":"Изчаква данни"];
  cells.forEach((v,i)=>tr.appendChild(node("td",i===4?(x.ready?"ready-label":"partial-label"):"",v)));
  root.appendChild(tr);
 }
}
async function init(){
 wire();
 const errors=[];
 try{loadFixtures(await fetchJSON("../data/fixtures.json"));}catch(e){errors.push(e.message);}
 try{
  const [manifest,audit]=await Promise.all([
    fetchJSON("../data/client_manifest.json"),fetchJSON("../data/coverage_audit.json")]);
  const divisions=manifest?.files?.["history.json"]?.divisions;
  if(!divisions||!audit?.leagues)throw Error("Липсва проверен каталог");
  coverage={schema:1,generated_utc:audit.checked_utc,
    leagues:Object.fromEntries(Object.entries(divisions).map(([div,count])=>[div,{
      matches:count,ready:count>=500,
      on_target_matches:audit.leagues[div]?.coverage?.on_target?.available||0
    }]))};
 }catch(e){errors.push(e.message);}
 sidebar();counters();chooseMatches();renderOverview();
 if(errors.length){set("dataState","Частични данни");console.warn("MATCH LAB X",errors.join("; "));}
}
window.MLXSite={loadFixtures,future,goto};
init();
})();
