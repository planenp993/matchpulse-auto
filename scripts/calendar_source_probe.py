"""One-off public calendar feasibility. No production writes or raw response archives.
HTTP success does not establish reuse permission or continuing reliability.
"""
import concurrent.futures as cf
import datetime as dt
import gzip,hashlib,json,re,time,urllib.request
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

class Node:
 def __init__(self,tag='',attrs=None):self.tag,self.attrs,self.children=tag,dict(attrs or []),[]
 def text(self):return ' '.join(x.text() if isinstance(x,Node) else x for x in self.children).strip()
 def select(self,cls):
  found=[]
  for x in self.children:
   if isinstance(x,Node):
    if cls in x.attrs.get('class','').split():found.append(x)
    found.extend(x.select(cls))
  return found
 def first(self,cls):
  a=self.select(cls);return a[0] if a else Node()
class Tree(HTMLParser):
 def __init__(self):super().__init__();self.root=Node();self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  n=Node(tag,attrs);self.stack[-1].children.append(n)
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.stack.append(n)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:self.stack=self.stack[:i];break
 def handle_data(self,s):self.stack[-1].children.append(s)

def statarea(b):
 t=Tree();t.feed(b.decode('utf8','replace'));rows=[]
 for league in t.root.select('competition'):
  label=league.first('header').first('name').text()
  for m in league.select('match'):
   h,a=m.first('hostteam'),m.first('guestteam')
   if not h.text() or not a.text():continue
   rows.append({'id':m.attrs.get('id'),'competition':label,'home':h.first('name').text(),'away':a.first('name').text(),'clock':m.first('time').text(),'state':m.first('status').text(),'score':[h.first('goals').text(),a.first('goals').text()]})
 return {'events':len(rows),'competitions':sorted({r['competition'] for r in rows}),'rows':rows,'gmt_labels':re.findall(r"class=['\"]gmt['\"]>\s*([^<]+)",b.decode('utf8','replace')),'timezone_must_be_verified':True,'score_may_include_penalties':True}

def espn(b):
 d=json.loads(b);rows=[]
 for e in d.get('events',[]):
  for g in e.get('competitions',[]):
   sides={x.get('homeAway'):x for x in g.get('competitors',[])}
   if not {'home','away'}<=sides.keys():continue
   h,a=sides['home'],sides['away'];s=g.get('status',e.get('status',{})).get('type',{})
   rows.append({'id':g.get('id',e.get('id')),'date':g.get('date',e.get('date')),'competition':e.get('season',{}).get('slug'),'home':h.get('team',{}).get('displayName'),'away':a.get('team',{}).get('displayName'),'state':s.get('name'),'completed':s.get('completed'),'score':[h.get('score'),a.get('score')]})
 return {'events':len(rows),'competitions':sorted({r['competition'] for r in rows if r['competition']}),'rows':rows,'undocumented_endpoint':True,'reuse_permission_not_established':True}

def futbolbro(b):
 found=[]
 def scan(v):
  if isinstance(v,list):
   for x in v:scan(x)
  elif isinstance(v,dict):
   if 'fixturesByDateAndTournament' in v:found.append(v['fixturesByDateAndTournament']);return
   for k,x in v.items():
    if k not in {'votes','users','user','comments'}:scan(x)
 for m in re.finditer(r'self\.__next_f\.push\((\[[\s\S]*?\])\)',b.decode('utf8','replace')):
  try:parts=json.loads(m.group(1))
  except ValueError:continue
  for part in parts:
   if not isinstance(part,str):continue
   for line in part.splitlines():
    _,sep,payload=line.partition(':')
    if sep:
     try:scan(json.loads(payload))
     except ValueError:pass
 rows=[]
 for dates in found:
  for day,groups in dates.items():
   for g in groups:
    for e in g.get('fixtures',[]):
     def name(x):return x.get('name',x.get('nameBg')) if isinstance(x,dict) else x
     rows.append({'id':e.get('fixtureId'),'date':e.get('startTime'),'day':day,'competition':g.get('tournamentName'),'home':name(e.get('home')),'away':name(e.get('away')),'state':e.get('status',{}).get('short')})
 return {'events':len(rows),'competitions':sorted({str(r['competition']) for r in rows}),'rows':rows,'reuse_permission_not_established':True}

def fetch(task):
 name,url,parser=task;t=time.monotonic();out={'name':name,'url':url}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'Matchpulse-Calendar-Research/1.0 (one-off public feasibility test)','Accept-Encoding':'gzip'})
  with urllib.request.urlopen(req,timeout=35) as r:
   b=r.read()
   if b[:2]==b'\x1f\x8b':b=gzip.decompress(b)
   out.update(http_status=r.status,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),cache_control=r.headers.get('Cache-Control'),age=r.headers.get('Age'),content_type=r.headers.get('Content-Type'))
   if parser:out.update(parser(b))
   else:out['text']=b.decode('utf8','replace')[:3000]
 except Exception as e:out['error']=type(e).__name__+': '+str(e)
 out['seconds']=round(time.monotonic()-t,3);return out

def main():
 today=dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo('Europe/Sofia')).date()
 tasks=[('statarea-'+(today+dt.timedelta(days=i)).isoformat(),'https://www.statarea.com/livescore/date/'+(today+dt.timedelta(days=i)).isoformat(),statarea) for i in range(-1,8)]
 tasks += [('statarea-robots','https://www.statarea.com/robots.txt',None),('espn-today','https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates='+today.strftime('%Y%m%d')+'&limit=1000',espn),('espn-weekend','https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates='+(today+dt.timedelta(days=2)).strftime('%Y%m%d')+'&limit=1000',espn),('futbolbro','https://futbolbro.com/',futbolbro)]
 with cf.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(fetch,tasks))
 report={'checked_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'purpose':'one-off read-only feasibility; not a licence or a reliability test','results':results}
 Path('calendar-provider-probe.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 for r in results:print(json.dumps({k:v for k,v in r.items() if k not in {'rows','text'}},ensure_ascii=False))
 print('STATAREA_COMPETITIONS '+json.dumps(sorted({x for r in results if r['name'].startswith('statarea-') for x in r.get('competitions',[])}),ensure_ascii=False))
if __name__=='__main__':main()
