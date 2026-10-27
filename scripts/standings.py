"""Published standings, isolated from models and result history. No inferred ranks."""
import collections
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as u
from fixtures_official import pol_props, sfl_page, SFL_HOME, SFL_RPC, SFL_ACCOUNT
from match_registry import read_strict
from provider_clubs import LOOKUP, resolve

FEEDS = {'E0':'eng.1','E1':'eng.2','E2':'eng.3','E3':'eng.4','SC0':'sco.1','D1':'ger.1',
 'D2':'ger.2','I1':'ita.1','I2':'ita.2','SP1':'esp.1','SP2':'esp.2','F1':'fra.1','F2':'fra.2',
 'N1':'ned.1','B1':'bel.1','P1':'por.1','T1':'tur.1','G1':'gre.1','NOR':'nor.1','SWE':'swe.1',
 'DNK':'den.1','AUT':'aut.1','UCL':'uefa.champions','UEL':'uefa.europa','UECL':'uefa.europa.conf'}
CUPS = {'UCL':'Champions League','UEL':'Europa League','UECL':'Conference League'}
DIVISIONS = (*u.LEAGUES, *CUPS)
VIEW = 'docs/data/standings.json'
LINKS = Path(__file__).resolve().parents[1]/'docs/data/standings_clubs.json'
STATS = {'rank':'rank','played':'gamesPlayed','won':'wins','drawn':'ties','lost':'losses',
         'gf':'pointsFor','ga':'pointsAgainst','gd':'pointDifferential','points':'points'}


def season_start(div, today):
    return today.year if div in ('NOR','SWE') or today.month >= 7 else today.year-1


def season_key(div, today):
    year = season_start(div,today)
    return str(year) if div in ('NOR','SWE') else f'{year}/{str(year+1)[2:]}'


def integer(value, low=0, high=500):
    if type(value) not in (int,float) or not math.isfinite(value) or int(value) != value or not low <= value <= high:
        raise ValueError('Invalid numeric standing value')
    return int(value)


def table_groups(data):
    found = []
    def walk(node, path='root'):
        if not isinstance(node,dict): raise ValueError('Invalid standings group node')
        if isinstance(node.get('standings'),dict): found.append((node,path,node['standings']))
        for i,child in enumerate(node.get('children',[])): walk(child,path+'/'+str(child.get('id',i)))
    walk(data)
    return found


def parse_espn(raw, div, today):
    data = json.loads(raw.decode('utf-8-sig'));year = season_start(div,today)
    season = data.get('season') or {}
    if season.get('year') != year: raise ValueError('ESPN standings returned an old or wrong season')
    if str(season.get('startDate',''))[:10] > today.isoformat() or not season.get('endDate'):
        raise ValueError('ESPN season dates are missing or have not started')
    groups = []
    for node,path,table in table_groups(data):
        if not table.get('entries'): continue
        if table.get('season') != year: raise ValueError('ESPN table season mismatch')
        links = table.get('links',[])
        if not any(urllib.parse.urlparse(str(link.get('href',''))).path.rstrip('/').endswith('/league/'+FEEDS[div]) for link in links):
            raise ValueError('ESPN standings league identity mismatch')
        rows = []
        for entry in table['entries']:
            team = entry.get('team') or {};values = {v['name']:v.get('value') for v in entry.get('stats',[])}
            if not team.get('id') or not team.get('displayName'): raise ValueError('Missing standings club identity')
            row = {'team_id':str(team['id']),'name':team['displayName'],
                   'labels':list(dict.fromkeys(str(team[k]) for k in ('displayName','shortDisplayName','location','name') if team.get(k)))}
            row.update({key:integer(values.get(field), -500 if key in ('gd','points') else 0) for key,field in STATS.items()})
            if 'deductions' in values: row['reported_deductions'] = integer(values['deductions'],-500)
            rows.append(row)
        groups.append({'id':path,'name':str(node.get('name') or table.get('displayName') or 'Overall').strip(),
                       'phase_id':str(table.get('seasonType','')), 'rows':rows})
    if not groups: raise ValueError('No published ESPN table')
    return groups, data


def flight_objects(raw):
    decoder, chunks = json.JSONDecoder(), []
    text=raw.decode('utf-8-sig')
    for match in re.finditer(r'self\.__next_f\.push\(',text):
        try: value,_ = decoder.raw_decode(text,match.end())
        except ValueError: continue
        if isinstance(value,list) and len(value)>1 and isinstance(value[1],str): chunks.append(value[1])
    values = []
    for line in ''.join(chunks).splitlines():
        match = re.match(r'^[0-9a-f]+:(.*)$',line)
        if match:
            try: values.append(json.loads(match[1]))
            except ValueError: continue
    return values


def parse_pol(raw, calendar, today):
    slug = f'{season_start("POL",today)}-{season_start("POL",today)+1}'
    props = pol_props(calendar,slug)
    season_ids = {g.get('seasonId') for g in props['enrichedMatches']+props['enrichedPostponedMatches'] if g.get('seasonId')}
    found = []
    def walk(value):
        if isinstance(value,dict):
            if isinstance(value.get('rows'),list) and value.get('seasonId') in season_ids and value.get('rowsByType'):
                found.append(value)
            for child in value.values():walk(child)
        elif isinstance(value,list):
            for child in value:walk(child)
    walk(flight_objects(raw))
    if len(found) != 1: raise ValueError('Missing or wrong-season official Polish table')
    rows = []
    for source in found[0]['rows']:
        if source.get('standingType') != 'total': raise ValueError('Polish home/away table cannot replace overall')
        row = {'team_id':str(source['teamId']),'name':source['teamName'],'labels':[source['teamName']]}
        row.update({key:integer(source.get(field),-500 if key in ('gd','points') else 0) for key,field in
                    {'rank':'rank','played':'played','won':'won','drawn':'drawn','lost':'lost','gf':'goalsFor','ga':'goalsAgainst','gd':'goalDifference','points':'points'}.items()})
        rows.append(row)
    return [{'id':'regular','name':'Regular Season','phase_id':'regular','rows':rows}]


def parse_sfl(raw, events, competition, internal):
    data = json.loads(raw.decode('utf-8-sig')).get('result',{}).get('data')
    if not isinstance(data,dict) or data.get('competitionId') != competition:
        raise ValueError('Wrong Swiss standings competition')
    games = json.loads(events.decode('utf-8-sig')).get('result',{}).get('data')
    if not isinstance(games,list) or not games or any(g.get('competitionId') != internal for g in games):
        raise ValueError('Wrong Swiss team directory/competition')
    names = {}
    for game in games:
        for side in ('home','away'):
            identity,name = str(game.get(side+'TeamProviderId')),game.get(side+'TeamName')
            if not identity or not name: raise ValueError('Missing official Swiss club name')
            if identity in names and names[identity] != name: raise ValueError('Conflicting Swiss club names')
            names[identity] = name
    groups = []
    for i,source in enumerate(data.get('rankings',[])):
        if not source.get('rankings'): continue
        rows = []
        for entry in source['rankings']:
            identity = str(entry['teamId'])
            if identity not in names: raise ValueError('Swiss ranking club absent from official season directory')
            row = {'team_id':identity,'name':names[identity],'labels':[names[identity]],'gf':None,'ga':None}
            row.update({key:integer(entry.get(field),-500 if key in ('gd','points') else 0) for key,field in
                        {'rank':'ranking','played':'gamesPlayed','won':'gamesWon','drawn':'gamesDraw','lost':'gamesLost','gd':'goalDifference','points':'points'}.items()})
            rows.append(row)
        groups.append({'id':str(i),'name':source['stageName'],'phase_id':str(i),'rows':rows})
    if not groups: raise ValueError('Empty official Swiss ranking')
    return groups


def reviewed_links():
    doc=read_strict(LINKS,{'schema':1,'entries':[]})
    if doc.get('schema')!=1 or not isinstance(doc.get('entries'),list):raise ValueError('Invalid standings club crosswalk')
    result={}
    for entry in doc['entries']:
        key=(entry['division'],entry['provider'],entry['team_id']);proof=entry.get('evidence',[])
        special=entry.get('full_phase_verification') or {}
        if key in result or entry['division'] not in DIVISIONS or not entry.get('target') or not entry.get('source_names'):
            raise ValueError('Duplicate or invalid standings club crosswalk')
        if len(proof)<3 and not (len(proof)==2 and special.get('official_club_id') and special.get('matching_totals',{}).get('played')==2):
            raise ValueError('Insufficient reviewed standings identity evidence')
        if len({p['provider_match_id'] for p in proof})!=len(proof) or len({p['opponent_key'] for p in proof})<2:
            raise ValueError('Uninformative standings identity evidence')
        result[key]=entry
    return result


def link_clubs(groups, div, provider, root, today):
    available = {}
    reviewed = reviewed_links()
    rows = u.readjson(root/'docs/data/history.json',[]) if div not in CUPS else u.readjson(root/'docs/data/europe_history.json',[])
    for row in rows:
        if row[0] == div and (div not in CUPS or row[3] >= f'{season_start(div,today)}-07-01' and len(row)>13 and row[13].get('PHASE')=='TOURNAMENT'):
            for name in row[5:7]: available.setdefault(u.club_key(name),name)
    aliases = collections.defaultdict(set)
    if div in CUPS:
        for club in read_strict(root/'data/europe_clubs.json',{}).values():
            key = u.club_key(club['name'])
            if key in available:
                for label in [club['name'],*club['source_names']]: aliases[u.club_key(label)].add(key)
    for group in groups:
        for row in group['rows']:
            labels = row.pop('labels')
            entry=reviewed.get((div,provider,row['team_id']))
            if entry and row['name'] in entry['source_names']:
                canonical=entry['target'];keys={u.club_key(canonical)};available.setdefault(u.club_key(canonical),canonical)
            elif (div,provider,row['team_id']) in LOOKUP:
                canonical = resolve(div,provider,row['team_id'],row['name']);keys={u.club_key(canonical)}
                available.setdefault(u.club_key(canonical),canonical)
            else:
                keys = {u.club_key(label) for label in labels if u.club_key(label) in available}
                keys |= {key for label in labels for key in aliases[u.club_key(label)]}
            row['club_key'] = next(iter(keys)) if len(keys)==1 else None
            if row['club_key']: row['name'] = available[row['club_key']]
            row['provider_id'] = provider+':'+div+':'+row['team_id']
            row['points_adjustment'] = row['points']-(3*row['won']+row['drawn'])
    return groups


def validate(table):
    if table.get('division') not in DIVISIONS or not table.get('season') or not table.get('groups'):
        raise ValueError('Invalid standings snapshot identity')
    total_ids = set()
    for group in table['groups']:
        identities, ranks = set(), []
        for row in group['rows']:
            if row['team_id'] in identities: raise ValueError('Duplicate team in a standings group')
            identities.add(row['team_id']);total_ids.add(row['team_id'])
            for key in ('rank','played','won','drawn','lost','points','gd'):
                integer(row[key], -500 if key in ('points','gd') else 0)
            if row['rank'] < 1 or row['rank'] > 80 or row['played'] != row['won']+row['drawn']+row['lost']:
                raise ValueError('Incoherent standings match totals/rank')
            if row['gf'] is not None and row['ga'] is not None and row['gf']-row['ga'] != row['gd']:
                raise ValueError('Incoherent official goal difference')
            if row['points_adjustment'] != row['points']-3*row['won']-row['drawn']:
                raise ValueError('Incoherent official point adjustment')
            ranks.append(row['rank'])
        if len(identities)<2 or ranks != sorted(ranks): raise ValueError('Incomplete or unordered standings group')
    if len(total_ids) < (30 if table['division'] in CUPS else 10): raise ValueError('Truncated competition table')
    return table


def collect(download, root, now):
    today = u.today_sofia(now);stamp = now.astimezone(dt.timezone.utc).isoformat(timespec='seconds')
    def one(div):
        receipts = []
        def get(url,**kwargs):
            raw = download(url,**kwargs);receipts.append({'url':url,'sha256':hashlib.sha256(raw).hexdigest()});return raw
        try:
            provider = {'POL':'Ekstraklasa','SWZ':'SwissFootballLeague'}.get(div,'ESPN')
            if div=='POL':
                year=season_start(div,today);slug=f'{year}-{year+1}'
                url=f'https://ekstraklasa.org/tabela/{slug}/'
                raw=get(url);calendar=get(f'https://ekstraklasa.org/terminarz/{slug}/');groups=parse_pol(raw,calendar,today)
            elif div=='SWZ':
                competition,season,internal=sfl_page(get(SFL_HOME),today)
                params={'language':'de','competitionProviderId':competition,'seasonId':season}
                url=SFL_RPC.replace('matchDays.getEvents','rankings.getOne')+'?input='+urllib.parse.quote(json.dumps(params,separators=(',',':')))
                raw=get(url,headers={'x-account-key':SFL_ACCOUNT})
                params={'matchDay':'','language':'de','competitionProviderId':competition,'seasonProviderId':season}
                events=get(SFL_RPC+'?input='+urllib.parse.quote(json.dumps(params,separators=(',',':'))),headers={'x-account-key':SFL_ACCOUNT})
                groups=parse_sfl(raw,events,competition,internal)
            else:
                url=f'https://site.api.espn.com/apis/v2/sports/soccer/{FEEDS[div]}/standings?season={season_start(div,today)}'
                groups,_=parse_espn(get(url),div,today)
            groups=link_clubs(groups,div,provider,root,today)
            table=validate({'division':div,'season':season_key(div,today),'groups':groups,'provider':provider,
                'observed_at_utc':stamp,'receipts':receipts,'source_url':f'https://www.espn.com/soccer/standings/_/league/{FEEDS[div]}' if div in FEEDS else 'https://sfl.ch/de/superleague-tabelle' if div=='SWZ' else url})
            return div,table,None
        except Exception as error:return div,None,f'{div}: {type(error).__name__}: {error}'
    out={'tables':{},'errors':{},'observed_at_utc':stamp}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for div,table,error in pool.map(one,DIVISIONS):
            if error:out['errors'][div]=error
            else:out['tables'][div]=table
    return out


def apply(root, batch, stamp, history=None):
    doc=read_strict(root/VIEW,{'schema':1,'tables':{},'checks':{}})
    if doc.get('schema') != 1 or not isinstance(doc.get('tables'),dict) or not isinstance(doc.get('checks'),dict):
        raise ValueError('Corrupt standings snapshot')
    for table in doc['tables'].values():validate(table)
    if batch:
        for div in set(batch['tables'])|set(batch['errors']):
            previous=doc['checks'].get(div,{})
            if previous.get('attempt_utc','') > batch['observed_at_utc']:continue
            table=batch['tables'].get(div)
            if table:
                validate(table);doc['tables'][div]=table
                doc['checks'][div]={'status':'ok','attempt_utc':batch['observed_at_utc'],'success_utc':batch['observed_at_utc']}
            else:
                doc['checks'][div]={**previous,'status':'error','attempt_utc':batch['observed_at_utc'],'error':batch['errors'][div]}
    doc['checked_utc']=max(stamp,doc.get('checked_utc',''))
    today=u.today_sofia(dt.datetime.fromisoformat(doc['checked_utc']))
    current=[div for div in DIVISIONS if doc['tables'].get(div,{}).get('season')==season_key(div,today)]
    history=history if history is not None else u.readjson(root/'docs/data/history.json',[])+u.readjson(root/'docs/data/europe_history.json',[])
    for div,table in doc['tables'].items():
        observed=collections.Counter()
        start=f'{season_start(div,today)}-'+('01-01' if div in ('NOR','SWE') else '07-01')
        comparable=len(table['groups'])==1 and table['groups'][0]['phase_id'] in ('1','regular','0') and table['season']==season_key(div,today)
        if comparable:
            for row in history:
                if row[0]!=div or row[3]<start:continue
                stats=row[13] if len(row)>13 and isinstance(row[13],dict) else {}
                if stats.get('AWARDED') or div in CUPS and stats.get('PHASE')!='TOURNAMENT':continue
                for name in row[5:7]:observed[u.club_key(name)]+=1
        table['archive_ahead']=[{'club_key':r['club_key'],'archive_games':observed[r['club_key']],'table_games':r['played']} for g in table['groups'] for r in g['rows'] if r['club_key'] and r['played']<observed[r['club_key']]]
    doc['coverage']={'lagging':sorted(div for div,t in doc['tables'].items() if t.get('archive_ahead')),'expected':len(DIVISIONS),'available_current_season':len(current),
        'failed':sorted(div for div,c in doc['checks'].items() if c['status']=='error')}
    u.writejson(root/VIEW,doc)
    return doc


def check(root):
    doc=read_strict(root/VIEW,{'schema':1,'tables':{},'checks':{}})
    if doc.get('schema')!=1 or not isinstance(doc.get('checks'),dict):raise ValueError('Corrupt standings snapshot')
    reviewed_links()
    for table in doc['tables'].values():validate(table)
    return {'tables':len(doc['tables']),'groups':sum(len(t['groups']) for t in doc['tables'].values()),
            'teams':sum(len(g['rows']) for t in doc['tables'].values() for g in t['groups']), 'ok':True}


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true',required=True);p.add_argument('--root',type=Path,default=u.ROOT)
    print(json.dumps(check(p.parse_args().root)))
