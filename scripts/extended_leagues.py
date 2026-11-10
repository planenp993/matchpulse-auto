#!/usr/bin/env python3
"""Supplemental divisions, isolated from the exact 27-stream primary calendar.

Only literal public Soccerway fixtures/results HTML and Football-Data CSVs.
No timer, private API, inferred statistics, fuzzy identities or unproved ET scores.
Collect once, then apply observations against latest main without overwriting it.
"""
import argparse
import collections
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import sys
import threading
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as u
import match_registry as registry
import provider_archive
import soccerway as primary

CATALOG='ops/extended_leagues.json'
CLUBS='data/extended_clubs.json'
CSV_CLUBS='data/extended_csv_clubs.json'
ARCHIVE='data/supplemental_soccerway'
REQUEST='ops/extended_sync_request.json'
EXPECTED={'BRA','USA','ARG','MEX','JPN','CHN','FIN','IRL','ROU','RUS','EC','SC1','SC2','SC3'}
UTC=dt.timezone.utc
SOFIA=ZoneInfo('Europe/Sofia')
FIELDS=primary.FIELDS|{'ZA','ZEE','ZL','ZY','ZAF'}


def iso(now): return now.astimezone(UTC).isoformat(timespec='seconds')
def read(root,path,default): return registry.read_strict(root/path,default)


def catalog(root):
    doc=read(root,CATALOG,{})
    if doc.get('schema')!=1 or doc.get('interval_minutes')!=120 or set(doc.get('leagues',{}))!=EXPECTED:
        raise ValueError('Invalid isolated supplemental catalog')
    for div,c in doc['leagues'].items():
        if div in u.LEAGUES or not c.get('country') or not c.get('league') or not re.fullmatch(r'/[a-z-]+/[a-z0-9-]+/',c['path']) or not re.fullmatch(r'[A-Za-z0-9]{8}',c['template']) or c['season_kind'] not in ('calendar','split') or not c.get('phase_labels'):
            raise ValueError('Unverified supplemental division')
        if c['csv_url'] not in (f'https://www.football-data.co.uk/new/{div}.csv',f'https://www.football-data.co.uk/mmz4281/{{season}}/{div}.csv'):
            raise ValueError('Unapproved Football-Data source')
    return doc


def season(c,now):
    day=u.today_sofia(now);year=day.year if c['season_kind']=='calendar' or day.month>=7 else day.year-1
    return str(year) if c['season_kind']=='calendar' else f'{year}/{year+1}'


def csv_url(c,now):
    day=u.today_sofia(now);year=day.year if day.month>=7 else day.year-1
    return c['csv_url'].replace('{season}',f'{year%100:02d}{(year+1)%100:02d}')


def parse(raw,div,c,now):
    if len(raw)>primary.LIMIT: raise ValueError('Soccerway page exceeds bound')
    text=raw.decode('utf-8-sig')
    if not re.search(r'tournamentTemplateId:\s*"'+re.escape(c['template'])+'"',text): raise ValueError('Wrong competition template')
    headings=re.findall(r'<div[^>]*class="heading__info"[^>]*>([^<]+)',text)
    if len(headings)!=1 or html.unescape(headings[0]).strip()!=season(c,now): raise ValueError('Wrong supplemental season')
    feeds={};records={}
    pattern=r'cjs\.initialFeeds\[([\'\"])(fixtures|results)\1\]\s*=\s*\{\s*data:\s*`(.*?)`,\s*allEventsCount:\s*(\d+)'
    for _,kind,data,total in re.findall(pattern,text,re.S):
        empty_calendar=kind=='fixtures' and data=='' and int(total)==0
        if kind in feeds or '${' in data or (not empty_calendar and not data.startswith('SA÷1')):
            raise ValueError('Ambiguous/nonliteral football feed')
        seen=set();dates=[];context={};count=0
        for block in data.split('¬~'):
            fields={}
            for part in block.split('¬'):
                key,sep,value=part.partition('÷')
                if sep and key in FIELDS:
                    if key in fields: raise ValueError('Duplicate provider field')
                    fields[key]=html.unescape(value)
            if 'ZEE' in fields: context=fields
            if 'AA' not in fields: continue
            if context.get('ZEE')!=c['template'] or context.get('ZL')!=c['path'] or context.get('ZAF',context.get('ZY'))!=c['country']:
                raise ValueError('Mixed competition/country')
            identity=fields['AA'];ids=[fields.get('PX',''),fields.get('PY','')]
            if identity in seen or not re.fullmatch(r'[A-Za-z0-9]{8}',identity) or not all(re.fullmatch(r'[A-Za-z0-9]{8}',v) for v in ids) or ids[0]==ids[1]: raise ValueError('Invalid/duplicate stable IDs')
            seen.add(identity);count+=1
            names=[fields.get('FH') or fields.get('AE'),fields.get('FK') or fields.get('AF')]
            if not all(names) or names[0]==names[1] or not fields.get('AB') or not fields.get('AC'): raise ValueError('Missing labels/status')
            instant=None
            if re.fullmatch(r'\d{10}',fields.get('AD','')):
                instant=dt.datetime.fromtimestamp(int(fields['AD']),UTC)
                if not 2020<=instant.year<=2100: raise ValueError('Invalid provider epoch')
                dates.append(instant.astimezone(SOFIA).date().isoformat())
            score=[u.goals(fields.get(k)) for k in ('AG','AH')]
            record={'id':identity,'division':div,'competition_id':c['template'],'season':season(c,now),'club_ids':ids,'home':names[0],'away':names[1],
                    'kickoff_utc':iso(instant) if instant else None,'source_date_utc':instant.date().isoformat() if instant else None,
                    'phase':context.get('ZA'),'round':int(fields['ER'][6:]) if re.fullmatch(r'Round \d+',fields.get('ER','')) else None,
                    'state':fields['AB'],'stage':fields['AC'],'display_score':score,
                    'regulation':score if (fields['AB'],fields['AC'])==('3','3') and all(v is not None for v in score) else None}
            if identity in records and records[identity]!=record: raise ValueError('Contradictory provider observations')
            records[identity]=record
        if count>int(total) or not count and int(total)>0: raise ValueError('Truncated empty feed')
        boundary=(u.today_sofia(now)+dt.timedelta(days=7 if kind=='fixtures' else -7)).isoformat()
        covered=count==int(total) or bool(dates) and (max(dates)>=boundary if kind=='fixtures' else min(dates)<=boundary)
        feeds[kind]={'rows':count,'published_total':int(total),'first_date':min(dates) if dates else None,'last_date':max(dates) if dates else None,'window_covered':bool(covered)}
    if set(feeds)!={'fixtures','results'}: raise ValueError('Missing full fixtures/results feeds')
    return list(records.values()),feeds


def crosswalk(root,leagues):
    names={};targets={};countries=collections.defaultdict(set)
    for r in read(root,'docs/data/history.json',[]):
        for name in r[5:7]: countries[u.club_key(name)].add(r[1])
    for e in read(root,CLUBS,{})['entries']:
        key=(e['division'],e['club_id']);div=e['division']
        if div not in leagues or key in names or not re.fullmatch(r'[A-Za-z0-9]{8}',e['club_id']) or not e.get('source_names') or not e.get('target') or not e.get('evidence'): raise ValueError('Invalid approved source identity')
        scope=(div,u.club_key(e['target']))
        if scope in targets and targets[scope]!=e['club_id']: raise ValueError('Ambiguous club target in division')
        targets[scope]=e['club_id'];names[key]=e;countries[u.club_key(e['target'])].add(leagues[div]['country'])
        for proof in e['evidence']:
            if not re.fullmatch(r'[A-Za-z0-9]{8}',proof['provider_match_id']) or proof['source_url']!=primary.BASE+leagues[div]['path']+'fixtures/' or not re.fullmatch(r'[a-f0-9]{64}',proof['source_sha256']): raise ValueError('Missing public identity evidence')
    if any(len(countries[u.club_key(e['target'])])!=1 for e in names.values()): raise ValueError('Cross-country club key collision')
    csv_names={};csv_entries=read(root,CSV_CLUBS,{})['entries'];proved={(e['division'],e['club_id']):e['csv_name'] for e in csv_entries}
    for e in csv_entries:
        key=(e['division'],e['club_id']);proof=e.get('evidence',[])
        if key not in names or key in csv_names or len({p['provider_match_id'] for p in proof})<3 or len({p['opponent_id'] for p in proof})<2 or not e.get('csv_name'): raise ValueError('Unproved Football-Data club join')
        if not re.fullmatch(r'[a-f0-9]{64}',e.get('source_csv',{}).get('sha256','')) or not re.fullmatch(r'[a-f0-9]{64}',e.get('source_soccerway',{}).get('sha256','')): raise ValueError('Missing cross-source proof fingerprints')
        for p in proof:
            opponent=proved.get((e['division'],p['opponent_id']))
            if not opponent or {e['csv_name'],opponent}!={p['home_csv'],p['away_csv']}: raise ValueError('Proof does not resolve both opponents')
            if p['date_csv'] not in (p['kickoff_utc'][:10],dt.datetime.fromisoformat(p['kickoff_utc']).astimezone(SOFIA).date().isoformat()) or e['csv_name'] not in (p['home_csv'],p['away_csv']) or not all(type(v) is int and 0<=v<=30 for v in p['regulation']): raise ValueError('Invalid score/date identity proof')
        csv_names[key]=e['csv_name']
    return names,csv_names


def parse_csv(raw,div,c,now):
    rows=u.parse_csv(raw);out=[]
    for item in rows:
        if u.val(item,'Div') and u.val(item,'Div')!=div: raise ValueError('Wrong CSV division')
        if u.val(item,'Country') and u.val(item,'Country')!=c['country']: raise ValueError('Wrong CSV country')
        if u.val(item,'League') and u.val(item,'League')!=c['league']: continue
        day=u.dayparse(u.val(item,'Date'))
        score=[u.goals(u.val(item,'HG','FTHG')),u.goals(u.val(item,'AG','FTAG'))]
        if not day or not all(v is not None for v in score): continue
        if day>u.today_sofia(now): raise ValueError('Future CSV final')
        if day<u.today_sofia(now)-dt.timedelta(days=400): continue
        home,away=u.val(item,'Home','HomeTeam'),u.val(item,'Away','AwayTeam')
        if not home or not away or home==away: raise ValueError('Invalid CSV clubs')
        out.append({'date':day.isoformat(),'home':home,'away':away,'score':score,'stats':u.match_stats(item)})
    if not out: raise ValueError('No recent completed CSV observations')
    return out


def due(root,now):
    doc=catalog(root);status=read(root,'docs/data/status.json',{}).get('supplemental_leagues',{})
    try: elapsed=(now-dt.datetime.fromisoformat(status['last_attempt_utc'])).total_seconds()/60
    except (KeyError,ValueError,TypeError): elapsed=float('inf')
    return elapsed>=doc['interval_minutes']-5


def collect(root,now,download_html=primary.fetch,download_csv=u.fetch,trigger=None):
    config=catalog(root);leagues=config['leagues'];crosswalk(root,leagues);stop=threading.Event()
    batch={'schema':1,'observed_at_utc':iso(now),'trigger':trigger,'records':[],'checks':{},'csv_rows':{},'errors':[]}
    def one(div):
        c=leagues[div];url=primary.BASE+c['path']+'fixtures/';check={'source_url':url,'attempt_utc':iso(now)}
        if stop.is_set(): return div,[],[],{**check,'status':'error','error':'Stopped after provider rejection'}
        try:
            raw=download_html(url);records,feeds=parse(raw,div,c,now)
            check.update(status='ok',sha256=hashlib.sha256(raw).hexdigest(),feeds=feeds,season=season(c,now),window_covered=all(v['window_covered'] for v in feeds.values()))
        except Exception as error:
            if isinstance(error,urllib.error.HTTPError) and error.code in (401,403,429,503): stop.set()
            return div,[],[],{**check,'status':'error','error':type(error).__name__+': '+str(error)}
        csv=[];url_csv=csv_url(c,now)
        try:
            if stop.is_set(): raise ValueError('Collection circuit stopped')
            raw_csv=download_csv(url_csv);csv=parse_csv(raw_csv,div,c,now)
            check['csv']={'status':'ok','url':url_csv,'sha256':hashlib.sha256(raw_csv).hexdigest(),'rows':len(csv),'last_date':max(r['date'] for r in csv)}
        except Exception as error:
            if isinstance(error,urllib.error.HTTPError) and error.code in (401,403,429,503): stop.set()
            check['csv']={'status':'error','url':url_csv,'error':type(error).__name__+': '+str(error)}
        return div,records,csv,check
    with ThreadPoolExecutor(max_workers=2) as pool:
        for div,records,csv,check in pool.map(one,leagues):
            batch['checks'][div]=check;batch['csv_rows'][div]=csv
            if check['status']=='ok': batch['records'].extend({'match':r,'source':{'url':check['source_url'],'sha256':check['sha256']}} for r in records)
            else: batch['errors'].append(div+': '+check['error'])
            if check.get('csv',{}).get('status')=='error': batch['errors'].append(div+' CSV: '+check['csv']['error'])
    by_id={}
    for item in batch['records']:
        match=item['match']
        if match['id'] in by_id and by_id[match['id']]!=match: raise ValueError('Provider match ID changed division/identity')
        by_id[match['id']]=match
    return batch


def project(root,batch,now):
    leagues=catalog(root)['leagues'];names,csv_names=crosswalk(root,leagues)
    fixtures=[];results=[];observations=[];quarantine=[];enriched=collections.Counter()
    for item in batch['records']:
        r=item['match'];div=r['division'];c=leagues[div];identity='Soccerway:'+r['id'];instant=dt.datetime.fromisoformat(r['kickoff_utc']) if r.get('kickoff_utc') else None
        if r['competition_id']!=c['template'] or r['season']!=season(c,now): raise ValueError('Wrong projected competition/season')
        if r.get('phase') not in c['phase_labels']:
            quarantine.append({'id':r['id'],'division':div,'reason':'excluded_competition_phase' if r.get('phase') in c.get('excluded_phase_labels',[]) else 'unreviewed_competition_phase','phase':r.get('phase')});continue
        if not instant:
            quarantine.append({'id':r['id'],'division':div,'reason':'unconfirmed_kickoff'});continue
        clubs=[names.get((div,key)) for key in r['club_ids']]
        if not all(clubs) or any(r[side] not in e['source_names'] for side,e in zip(('home','away'),clubs)):
            quarantine.append({'id':r['id'],'division':div,'reason':'unreviewed_club_identity'});continue
        if instant>now+dt.timedelta(days=30): continue
        local=instant.astimezone(SOFIA)
        row=[div,c['country'],c['league'],local.date().isoformat(),local.strftime('%H:%M'),*[e['target'] for e in clubs],None,None,None,None,None,None,'Soccerway supplemental / UTC→Europe-Sofia']
        observation={'row':row,'provider_id':identity,'kickoff_utc':iso(instant),'season':r['season'] if c['season_kind']=='calendar' else r['season'][:5]+r['season'][-2:]}
        observations.append(observation)
        if (r['state'],r['stage'])==('1','1') and instant>=now:
            fixtures.append(row);continue
        if (r['state'],r['stage'])!=('3','3') or r.get('regulation') is None or instant>now-dt.timedelta(hours=2): continue
        meta={'SRC':'Soccerway supplemental','SOURCE_ID':identity,'SOURCE_URL':item['source']['url'],'SOURCE_SHA256':item['source']['sha256'],'SEASON':r['season'],'PHASE':r['phase']}
        h,a=(csv_names.get((div,key)) for key in r['club_ids'])
        possible=[x for x in batch['csv_rows'].get(div,[]) if h and a and x['home']==h and x['away']==a and x['date'] in {instant.date().isoformat(),local.date().isoformat()}]
        exact=[x for x in possible if x['score']==r['regulation']]
        if len(exact)>1 or possible and not exact:
            quarantine.append({'id':r['id'],'division':div,'reason':'ambiguous_or_conflicting_csv_score'});continue
        if exact:
            meta.update(exact[0]['stats']);meta.update(CSV_SOURCE_URL=batch['checks'][div]['csv']['url'],CSV_SOURCE_SHA256=batch['checks'][div]['csv']['sha256'],CSV_DATE=exact[0]['date']);enriched[div]+=1
        final=[*row[:7],*r['regulation'],None,None,None,None,meta]
        results.append(final)
    return {'fixtures':fixtures,'history':results,'observations':observations,'quarantined':quarantine,'csv_enriched':dict(enriched)}


def apply(root,batch,now=None):
    now=now or dt.datetime.now(UTC);stamp=batch['observed_at_utc'];observed=dt.datetime.fromisoformat(stamp)
    if observed>now+dt.timedelta(minutes=1): raise ValueError('Supplemental receipt in future')
    leagues=catalog(root)['leagues'];status=read(root,'docs/data/status.json',{});previous=status.get('supplemental_leagues',{})
    request_id=(batch.get('trigger') or {}).get('request_id')
    if request_id and request_id in status.get('processed_extended_requests',[]): return {'skipped':'supplemental request already processed'}
    if previous.get('last_attempt_utc','')>stamp: return {'skipped':'newer supplemental receipt retained'}
    projected=project(root,batch,observed);book=read(root,'data/match_registry.json',registry.empty())
    history=u.index_history(read(root,'docs/data/history.json',[]));fixtures=read(root,'docs/data/fixtures.json',[])
    provider_archive.persist(root,ARCHIVE,batch['records'],stamp)
    before_count=len(history);old_primary={k:v for k,v in history.items() if v[0] not in leagues};conflicts=[]
    identity_results={provider:m for m in book['matches'].values() for provider in m['provider_ids'] if m.get('result_key')}
    for row in projected['history']:
        key=u.key(row);old=history.get(key)
        known=identity_results.get(row[13]['SOURCE_ID'])
        if known and known['result_key']!=registry.row_key(row):
            registry.record_conflict(book,'supplemental_final_date_changed',{'kept':known['result_key'],'incoming':row});conflicts.append(registry.row_key(row));continue
        if old is not None and old[7:9]!=row[7:9]:
            registry.record_conflict(book,'supplemental_score_conflict',{'key':registry.row_key(row),'kept':old,'incoming':row});conflicts.append(registry.row_key(row));continue
        history[key]=u.merge_rows(old,row)
    # Stable IDs track moved dates; source absence never cancels a fixture.
    registry.observe(book,projected['observations'],stamp)
    observed_ids={o['provider_id'] for o in projected['observations']}
    affected={k for m in book['matches'].values() if observed_ids.intersection(m['provider_ids']) for k in m['legacy_keys']}
    fixtures=u.merge_fixtures([*projected['fixtures'],*[r for r in fixtures if r[0] not in leagues or registry.row_key(r) not in affected]])
    fixtures=[r for r in fixtures if r[0] not in leagues or r[3]>=u.today_sofia(now).isoformat() and u.key(r) not in history]
    historical=sorted(history.values(),key=lambda r:(r[3],r[0],r[5],r[6]))
    if old_primary!={k:v for k,v in history.items() if v[0] not in leagues}: raise ValueError('Primary history changed')
    europe=read(root,'docs/data/europe_history.json',[])
    registry.reconcile(book,[*historical,*europe],fixtures,iso(now),aliases=read(root,'data/result_provenance.json',{}).get('aliases',{}))
    # Remove divisions added by older writers. Diary eligibility now reads
    # supplemental receipts independently of the primary calendar.
    status['secondary_fixture_counts']={d:n for d,n in status.get('secondary_fixture_counts',{}).items() if d not in leagues}
    successful=[d for d,c in batch['checks'].items() if c['status']=='ok' and c.get('window_covered')]
    receipt={'last_attempt_utc':stamp,'checks':batch['checks'],'sources_total':len(leagues),'sources_ok':len(successful),
             'status':'ok' if len(successful)==len(leagues) and not conflicts and not batch['errors'] and not any(q['reason']!='excluded_competition_phase' for q in projected['quarantined']) else 'partial' if successful else 'error',
             'errors':batch['errors'],'quarantined':projected['quarantined'],'score_conflicts':conflicts,'csv_enriched':projected['csv_enriched'],
             'history_counts':{d:sum(r[0]==d for r in historical) for d in leagues},'fixture_counts':{d:sum(r[0]==d for r in fixtures) for d in leagues},
             'history_scope':'Only explicit public 3/3 regulation finals in the loaded season prefix. Football-Data enriches exact reviewed score/date joins; unchecked historical CSV finals are excluded.',
             'primary_clock_unchanged':True}
    if successful: receipt['last_data_success_utc']=stamp
    elif previous.get('last_data_success_utc'): receipt['last_data_success_utc']=previous['last_data_success_utc']
    if batch.get('trigger'): receipt['trigger']=batch['trigger']
    if request_id: status['processed_extended_requests']=sorted(set(status.get('processed_extended_requests',[])+[request_id]))
    status['supplemental_leagues']=receipt
    status.update(history_count=len(historical),fixtures_count=len(fixtures))
    for path,value in [('docs/data/history.json',historical),('docs/data/fixtures.json',fixtures),('data/match_registry.json',book),('docs/data/match_links.json',registry.links(book)),('docs/data/status.json',status)]: u.writejson(root/path,value)
    return {'sources_ok':len(successful),'history_added':len(history)-before_count,'supplemental_history':sum(r[0] in leagues for r in historical),'fixtures':len(projected['fixtures']),'csv_enriched':projected['csv_enriched'],'conflicts':conflicts,'quarantined':len(projected['quarantined'])}


def check(root):
    cfg=catalog(root);names,csv_names=crosswalk(root,cfg['leagues']);proof=provider_archive.check(root,ARCHIVE)
    if set(primary.catalog(root)) & set(cfg['leagues']): raise ValueError('Supplemental catalog leaked into primary')
    return {'supplemental_clubs':len(names),'csv_proved_clubs':len(csv_names),'raw_evidence':proof,'primary_catalog':len(primary.catalog(root))}


def requested(root,event,commit=None):
    if event=='workflow_run': return True
    if event!='push' or not commit: return False
    title=subprocess.check_output(['git','show','-s','--format=%s',commit],cwd=root,text=True).strip()
    paths=subprocess.check_output(['git','diff-tree','--no-commit-id','--name-only','-r',commit],cwd=root,text=True).splitlines()
    if not title.startswith('[extended-sync] ') or paths!=[REQUEST]: return False
    doc=json.loads(subprocess.check_output(['git','show',commit+':'+REQUEST],cwd=root))
    if not isinstance(doc.get('id'),str) or not doc['id']: raise ValueError('Invalid supplemental request')
    return doc['id']==read(root,REQUEST,{}).get('id') and doc['id'] not in read(root,'docs/data/status.json',{}).get('processed_extended_requests',[])


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['plan','collect','apply','check']);p.add_argument('--patch',type=Path);p.add_argument('--event',default='workflow_run');p.add_argument('--commit');args=p.parse_args();now=dt.datetime.now(UTC)
    if args.action=='plan': print(json.dumps({'due':requested(u.ROOT,args.event,args.commit) and due(u.ROOT,now)}));return
    if args.action=='check': print(json.dumps(check(u.ROOT)));return
    if not args.patch: p.error('--patch required')
    if args.action=='collect':
        if not requested(u.ROOT,args.event,args.commit) or not due(u.ROOT,now): raise SystemExit('Supplemental collection is not due/authorized')
        trigger={k:v for k,v in {'event':args.event,'run_id':__import__('os').environ.get('GITHUB_RUN_ID'),'commit':args.commit}.items() if v}
        if args.event=='push': trigger['request_id']=read(u.ROOT,REQUEST,{})['id']
        u.writejson(args.patch,collect(u.ROOT,now,trigger=trigger))
    else: print(json.dumps(apply(u.ROOT,json.loads(args.patch.read_text()),now)))


if __name__=='__main__': main()
