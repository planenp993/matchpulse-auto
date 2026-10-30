"""Primary Soccerway fixtures/recent regulation finals from public HTML.

Only the large fixtures/results feeds are used, not the short summary cards.
Exact tournament IDs, Unix instants, reviewed identities and raw evidence are
kept separate from compatible views. No prediction, odds or private API.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import html
import io
import json
from pathlib import Path
import re
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parent))
import update as u
import statarea as sta
import match_registry as registry
import provider_archive
from club_identity import normal

BASE='https://www.soccerway.com'
ARCHIVE='data/soccerway'
CROSSWALK='data/soccerway_clubs.json'
MATCH_LINKS='data/soccerway_matches.json'
CATALOG='ops/soccerway_leagues.json'
LIMIT=6_000_000
FIELDS={'AA','AD','AE','AF','FH','FK','PX','PY','AG','AH','AB','AC','ER'}


def catalog(root):
    value=registry.read_strict(root/CATALOG,{})
    if set(value)!=set(sta.DIVISIONS):raise ValueError('Incomplete Soccerway competition catalog')
    for div,c in value.items():
        if c['country']!=sta.DIVISIONS[div][0] or not re.fullmatch(r'/[a-z-]+/[a-z0-9-]+/',c['path']) or not re.fullmatch(r'[A-Za-z0-9]{8}',c['template']):raise ValueError('Invalid Soccerway competition identity')
    return value


def fetch(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Matchpulse-Calendar/1.0 (+https://github.com/planenp993/matchpulse-auto)','Accept':'text/html','Accept-Encoding':'gzip'})
    with urllib.request.urlopen(req,timeout=25) as response:
        if response.status!=200 or response.url!=url:raise ValueError('Unexpected Soccerway response/redirect')
        raw=response.read(LIMIT+1);encoding=response.headers.get('Content-Encoding','')
    if len(raw)>LIMIT:raise ValueError('Soccerway response exceeds bound')
    if encoding=='gzip':raw=gzip.GzipFile(fileobj=io.BytesIO(raw)).read(LIMIT+1)
    if len(raw)>LIMIT:raise ValueError('Soccerway decoded page exceeds bound')
    return raw


def parse(raw,div,competition,now):
    if len(raw)>LIMIT:raise ValueError('Soccerway page exceeds bound')
    text=raw.decode('utf-8-sig',errors='strict')
    if not re.search(r'tournamentTemplateId:\s*"'+re.escape(competition['template'])+'"',text):raise ValueError('Wrong Soccerway tournament template')
    season=re.search(r'<div[^>]*class="heading__info"[^>]*>([^<]+)',text)
    year=u.today_sofia(now).year if div in ('NOR','SWE') else u.current_years(u.today_sofia(now),div)[-1]
    expected=str(year) if div in ('NOR','SWE') else f'{year}/{year+1}'
    if not season or season[1].strip()!=expected:raise ValueError('Expired/unconfirmed Soccerway season')
    feeds={};records={}
    pattern=r'cjs\.initialFeeds\[([\'\"])(fixtures|results)\1\]\s*=\s*\{\s*data:\s*`(.*?)`,\s*allEventsCount:\s*(\d+)'
    for _,kind,data,total in re.findall(pattern,text,re.S):
        if kind in feeds or '${' in data:raise ValueError('Ambiguous/nonliteral Soccerway full feed')
        if not data.startswith('SA÷1'):raise ValueError('Wrong Soccerway sport')
        count=0;dates=[];context={};seen=set()
        for block in data.split('¬~'):
            fields={}
            for part in block.split('¬'):
                key,sep,value=part.partition('÷')
                if sep and (key in FIELDS or key in ('ZEE','ZL','ZY','ZAF')):
                    if key in fields:raise ValueError('Duplicate Soccerway field')
                    fields[key]=html.unescape(value)
            if 'ZEE' in fields:context=fields
            if 'AA' not in fields:continue
            if context.get('ZEE')!=competition['template'] or context.get('ZL')!=competition['path'] or context.get('ZAF',context.get('ZY'))!=competition['country']:raise ValueError('Mixed Soccerway competition')
            identity=fields['AA'];club_ids=[fields.get('PX',''),fields.get('PY','')]
            if identity in seen or not re.fullmatch(r'[A-Za-z0-9]{8}',identity) or not all(re.fullmatch(r'[A-Za-z0-9]{8}',x) for x in club_ids) or club_ids[0]==club_ids[1]:raise ValueError('Invalid/duplicate Soccerway identity')
            seen.add(identity);count+=1
            home,away=fields.get('FH') or fields.get('AE'),fields.get('FK') or fields.get('AF')
            if not home or not away or home==away:raise ValueError('Invalid Soccerway club labels')
            clock=fields.get('AD','');instant=None
            if re.fullmatch(r'\d{10}',clock):
                instant=dt.datetime.fromtimestamp(int(clock),dt.timezone.utc)
                if not 2020<=instant.year<=2100:raise ValueError('Invalid Soccerway epoch')
                dates.append(instant.astimezone(ZoneInfo('Europe/Sofia')).date().isoformat())
            score=[u.goals(fields.get(k)) for k in ('AG','AH')]
            state,stage=fields.get('AB'),fields.get('AC')
            if not state or not stage:raise ValueError('Missing Soccerway event status')
            record={'id':identity,'division':div,'competition_id':competition['template'],'club_ids':club_ids,
                'home':home,'away':away,'kickoff_utc':instant.isoformat(timespec='seconds') if instant else None,
                'round':int(fields['ER'][6:]) if re.fullmatch(r'Round \d+',fields.get('ER','')) else None,
                'source_date_utc':instant.date().isoformat() if instant else None,
                'state':state,'stage':stage,'display_score':score,
                'regulation':score if (state,stage)==('3','3') and all(x is not None for x in score) else None}
            if identity in records and records[identity]!=record:raise ValueError('Contradictory Soccerway full feeds')
            records[identity]=record
        if count>int(total) or not count and int(total)>0:raise ValueError('Missing Soccerway full-feed rows')
        target=(u.today_sofia(now)+dt.timedelta(days=7 if kind=='fixtures' else -7)).isoformat()
        covered=count==int(total) or bool(dates) and (max(dates)>=target if kind=='fixtures' else min(dates)<=target)
        feeds[kind]={'rows':count,'published_total':int(total),'first_date':min(dates) if dates else None,
            'last_date':max(dates) if dates else None,'requested_window_covered':bool(covered)}
    if set(feeds)!={'fixtures','results'}:raise ValueError('Missing large Soccerway fixture/result feed')
    return list(records.values()),feeds


def proof_index(root):
    rows=registry.read_strict(root/'docs/data/history.json',[])+registry.read_strict(root/'docs/data/europe_history.json',[])
    return {(r[0],r[3],u.club_key(r[5]),u.club_key(r[6])):r[7:9] for r in rows}


def validate_name(entry,root,index):
    evidence=entry.get('evidence',[]);target=u.club_key(entry['target'])
    if len({e['provider_match_id'] for e in evidence})!=len(evidence) or len({e['opponent_key'] for e in evidence})<2:raise ValueError('Soccerway identity needs distinct scores/opponents')
    if len(evidence)<3:sta.validate_name(entry,root)
    for e in evidence:
        pair=[u.club_key(e['home']),u.club_key(e['away'])]
        if pair.count(target)!=1 or e['opponent_key']!=pair[1-pair.index(target)] or index.get((entry['division'],e['date'],*pair))!=e['regulation'] or not re.fullmatch(r'[A-Za-z0-9]{8}',e['provider_match_id']) or not e['source_url'].startswith(BASE+'/') or not re.fullmatch(r'[a-f0-9]{64}',e['source_sha256']):raise ValueError('Soccerway name proof disagrees with archived facts')
    if not re.fullmatch(r'[A-Za-z0-9]{8}',entry['club_id']):raise ValueError('Invalid reviewed Soccerway club ID')


class Names(sta.Names):
    def __init__(self,root,history,fixtures):
        super().__init__(root,history,fixtures);self.ids={};self.id_labels={};self.reviewed={};self.label_ids={}
        index={(r[0],r[3],u.club_key(r[5]),u.club_key(r[6])):r[7:9] for r in history}
        for e in registry.read_strict(root/CROSSWALK,{'schema':1,'entries':[]})['entries']:
            validate_name(e,root,index)
            self.reviewed[(e['division'],normal(e['source_name']))]=u.club_key(e['target'])
            self.label_ids[(e['division'],normal(e['source_name']))]=e['club_id']
            scoped=(e['division'],e['club_id'])
            self.ids.setdefault(scoped,set()).add(u.club_key(e['target']))
            self.id_labels.setdefault(scoped,set()).add(normal(e['source_name']))
    def club(self,div,name,identity):
        reviewed=self.reviewed.get((div,normal(name)))
        if reviewed and self.label_ids[(div,normal(name))]!=identity:return None
        direct=self.known.get(div,{}).get(reviewed) if reviewed else self.resolve(div,name)
        scoped=(div,identity);known=self.ids.get(scoped)
        if known:
            if len(known)!=1:return None
            key=next(iter(known))
            if normal(name) not in self.id_labels[scoped] and (not direct or u.club_key(direct)!=key):return None
            return self.known.get(div,{}).get(key)
        return direct


def project(batch,names,now):
    batch.update(rows=[],results=[],observations=[],quarantined=[])
    today=u.today_sofia(now)
    for item in batch['records']:
        r=item['match'];clock=r['kickoff_utc']
        if not clock:
            batch['quarantined'].append({'id':r['id'],'division':r['division'],'reason':'unconfirmed_kickoff'});continue
        instant=dt.datetime.fromisoformat(clock);local=instant.astimezone(ZoneInfo('Europe/Sofia'))
        if not today-dt.timedelta(days=7)<=local.date()<=today+dt.timedelta(days=7):continue
        home=names.club(r['division'],r['home'],r['club_ids'][0]);away=names.club(r['division'],r['away'],r['club_ids'][1])
        reason=None
        if not home or not away or u.club_key(home)==u.club_key(away):reason='unmatched_or_ambiguous_club'
        if r['regulation'] is not None and instant>now-dt.timedelta(hours=2):reason='unconfirmed_final_kickoff'
        if reason:
            batch['quarantined'].append({'id':r['id'],'division':r['division'],'home':r['home'],'away':r['away'],'reason':reason});continue
        row=[r['division'],*sta.DIVISIONS[r['division']],local.date().isoformat(),local.strftime('%H:%M'),home,away,None,None,None,None,None,None,'Soccerway / UTC→Europe-Sofia']
        o={'row':row,'provider_id':'Soccerway:'+r['id'],'kickoff_utc':clock,'round':r.get('round'),
           'status':None if (r['state'],r['stage'])==('1','1') else 'provisional_result'}
        batch['observations'].append(o)
        if r['regulation'] is not None and r['division'] not in sta.EUROPE:
            batch['results'].append({**o,'row':[*row[:7],*r['regulation'],None,None,None,None,{'SRC':'Soccerway','PROVIDER_ID':r['id']}]})
        elif (r['state'],r['stage'])==('1','1') and instant>now:batch['rows'].append(row)
    return batch


def collect(root,now,download=None,divisions=None):
    leagues=catalog(root);selected=divisions or list(leagues);stop=[];lock=threading.Lock()
    batch={'provider':'Soccerway','records':[],'checks':{},'errors':[]}
    def one(div):
        url=BASE+leagues[div]['path']+'fixtures/'
        try:
            with lock:
                if stop:raise ValueError('Batch stopped after HTTP '+str(stop[0]))
            raw=(download or fetch)(url);records,feeds=parse(raw,div,leagues[div],now)
            return div,records,{'status':'ok','url':url,'sha256':hashlib.sha256(raw).hexdigest(),'feeds':feeds,
                'window_covered':all(x['requested_window_covered'] for x in feeds.values())}
        except Exception as error:
            if isinstance(error,urllib.error.HTTPError) and error.code in (401,403,429,503):
                with lock:
                    if not stop:stop.append(error.code)
            return div,[],{'status':'error','url':url,'error':type(error).__name__+': '+str(error)}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for div,records,receipt in pool.map(one,selected):
            batch['checks'][div]=receipt
            if receipt['status']=='ok':batch['records'].extend({'match':r,'source':{'url':receipt['url'],'sha256':receipt['sha256']}} for r in records)
            else:batch['errors'].append(div+': '+receipt['error'])
    history=registry.read_strict(root/'docs/data/history.json',[])+registry.read_strict(root/'docs/data/europe_history.json',[])
    return project(batch,Names(root,history,registry.read_strict(root/'docs/data/fixtures.json',[])),now)


def apply(root,batch,status,history,book,fixtures,stamp,now,trigger=None):
    check(root);total=provider_archive.persist(root,ARCHIVE,batch['records'],stamp)
    if status.get('last_soccerway_attempt_utc','')>stamp:return fixtures,[],0
    # A one-time reviewed stable-ID bridge may connect an already published
    # future fixture whose date moved before this provider was introduced.
    raw={r['match']['id']:r['match'] for r in batch['records']}
    observed={o['provider_id'] for o in batch['observations']}
    for link in match_links(root,book):
        identity='Soccerway:'+link['soccerway_match_id'];r=raw.get(link['soccerway_match_id'])
        if identity not in observed:continue
        if not r or r['division']!=link['division'] or r['club_ids']!=link['club_ids'] or r['round']!=link['round']:raise ValueError('Reviewed Soccerway match ID changed competition/clubs/round')
        match=book['matches'][link['registry_id']]
        registry.observe(book,[{'row':[*match['schedule'],None,None,None,None,None,None,'Soccerway / reviewed existing key / Sofia'],
            'provider_id':identity,'kickoff_utc':match.get('kickoff_utc')}],stamp)
    batch=sta.align_registry(root,batch,book)
    # Do not duplicate a likely cross-date reschedule on the first provider join.
    rejected=set()
    for o in batch['observations']:
        row=o['row'];key=registry.row_key(row);pair=[u.club_key(n) for n in row[5:7]]
        if u.key(row) in history:continue  # The archived dated score already proves this identity.
        candidates=[m for m in book['matches'].values() if m['division']==row[0] and m['clubs']==pair and abs((dt.date.fromisoformat(m['schedule'][3])-dt.date.fromisoformat(row[3])).days)<=2]
        if candidates and not any(key in m['legacy_keys'] or o['provider_id'] in m['provider_ids'] for m in candidates):
            rejected.add(o['provider_id']);batch['quarantined'].append({'id':o['provider_id'],'reason':'unlinked_possible_reschedule'})
    batch['observations']=[o for o in batch['observations'] if o['provider_id'] not in rejected]
    batch['results']=[o for o in batch['results'] if o['provider_id'] not in rejected]
    keys={registry.row_key(o['row']) for o in batch['observations']}
    changed,conflicts=[],0
    for observation in batch['results']:
        row=observation['row'];key=u.key(row);old=history.get(key)
        if old is not None and old[7:9]!=row[7:9]:
            registry.record_conflict(book,'soccerway_score_conflict',{'key':registry.row_key(row),
                'provider_id':observation['provider_id'],'kept':old,'incoming':row})
            conflicts+=1
        elif old is None:
            history[key]=row;changed.append(row)
    registry.observe(book,batch['observations'],stamp)
    observed={o['provider_id'] for o in batch['observations']}
    affected={k for m in book['matches'].values() if observed.intersection(m['provider_ids']) for k in m['legacy_keys']}
    cached={u.key(r):r for r in fixtures};incoming=[]
    for row in batch['rows']:
        if registry.row_key(row) not in keys:continue
        fresh=list(row);old=cached.get(u.key(row))
        if old is not None:fresh[9:13]=old[9:13]
        incoming.append(fresh)
    fixtures=u.merge_fixtures([*incoming,*[r for r in fixtures if registry.row_key(r) not in affected]])
    good=[d for d,c in batch['checks'].items() if c['status']=='ok'];covered=[d for d in good if batch['checks'][d]['window_covered']]
    complete=len(covered)==len(sta.DIVISIONS) and not batch['quarantined'] and not conflicts
    state='ok' if complete else 'partial' if good else 'error'
    status.update(last_soccerway_attempt_utc=stamp,soccerway_refresh_status=state,soccerway_checks=batch['checks'],
        soccerway_errors=batch['errors'],soccerway_quarantined=batch['quarantined'],soccerway_archived_matches=total,
        soccerway_sources_ok=len(good),soccerway_sources_total=len(sta.DIVISIONS))
    if trigger:status['last_soccerway_attempt_trigger']=trigger
    if good:
        status.update(last_soccerway_data_success_utc=stamp,fixtures_updated_utc=stamp)
        if trigger:status['last_soccerway_data_success_trigger']=trigger
    if complete:
        status['last_soccerway_success_utc']=stamp
        if trigger:status['last_soccerway_success_trigger']=trigger
    if changed:status['last_soccerway_result_change_utc']=stamp
    status.update(last_fixture_attempt_utc=stamp,fixtures_checked_utc=stamp,fixtures_feed_status=state,
        fixtures_source='Soccerway / verified competition IDs and UTC epochs; Football-Data historical statistics and quotes',
        secondary_fixture_sources_ok=len(covered),secondary_fixture_sources_total=len(sta.DIVISIONS),
        secondary_fixture_counts={d:sum(r[0]==d for r in incoming) for d in sta.DIVISIONS},
        stale_secondary_leagues=sorted(set(sta.DIVISIONS)-set(covered)),secondary_fixture_errors=batch['errors'])
    return fixtures,changed,conflicts


def match_links(root,book):
    links=registry.read_strict(root/MATCH_LINKS,{'schema':1,'entries':[]});seen=set()
    if links.get('schema')!=1:raise ValueError('Invalid Soccerway match link schema')
    for link in links['entries']:
        identity=link['soccerway_match_id'];match=book['matches'].get(link['registry_id']);c=catalog(root)[link['division']]
        if identity in seen or not re.fullmatch(r'[A-Za-z0-9]{8}',identity) or not match or match['division']!=link['division'] or match['clubs']!=link['clubs'] or match['season']!=link['season'] or match.get('round')!=link['round'] or link['existing_provider_id'] not in match['provider_ids'] or link['old_key'] not in match['legacy_keys']:raise ValueError('Reviewed Soccerway match link no longer proves a unique existing fixture')
        if link['source_url']!=BASE+c['path']+'fixtures/' or not all(re.fullmatch(r'[a-f0-9]{64}',link[k]) for k in ('source_sha256','existing_source_sha256')) or not all(re.fullmatch(r'[A-Za-z0-9]{8}',i) for i in link['club_ids']):raise ValueError('Invalid reviewed Soccerway match receipt')
        seen.add(identity)
    return links['entries']


def check(root):
    seen=set();index=proof_index(root)
    for e in registry.read_strict(root/CROSSWALK,{'schema':1,'entries':[]})['entries']:
        key=(e['division'],normal(e['source_name']))
        if e['division'] not in sta.DIVISIONS or key in seen:raise ValueError('Duplicate/unsupported Soccerway club link')
        seen.add(key);validate_name(e,root,index)
    links=match_links(root,registry.read_strict(root/'data/match_registry.json',registry.empty()))
    return {**provider_archive.check(root,ARCHIVE),'reviewed_names':len(seen),'reviewed_match_links':len(links)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true',required=True);parser.parse_args()
    catalog(u.ROOT);print(json.dumps(check(u.ROOT)))
