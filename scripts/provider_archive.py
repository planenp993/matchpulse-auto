"""Permanent sanitized provider evidence, independent of published views."""
import re
import match_registry as registry
import update as u


def check(root, archive):
    index=registry.read_strict(root/archive/'index.json',{'schema':1,'matches':{}})
    if index.get('schema')!=1 or not isinstance(index.get('matches'),dict):raise ValueError('Invalid provider index')
    found={}
    for path in sorted((root/archive).glob('????-??.json')) if (root/archive).exists() else []:
        shard=registry.read_strict(path,{})
        if shard.get('schema')!=1 or not isinstance(shard.get('matches'),dict):raise ValueError('Invalid provider shard')
        for identity,saved in shard['matches'].items():
            if identity in found or index['matches'].get(identity)!=path.stem:raise ValueError('Provider index/shard mismatch')
            found[identity]=path.stem
            if not saved.get('observations') or saved['first_observed_utc']>saved['last_observed_utc']:raise ValueError('Invalid provider observation history')
            for signature,value in saved['observations'].items():
                if signature!=registry.digest(value['match']) or value['match']['id']!=identity:raise ValueError('Changed provider observation')
            if registry.digest(saved['current']) not in saved['observations']:raise ValueError('Unarchived provider current view')
    if found!=index['matches']:raise ValueError('Incomplete provider archive')
    return {'matches':len(found),'shards':len(set(found.values()))}


def persist(root, archive, records, stamp):
    check(root,archive)
    index=registry.read_strict(root/archive/'index.json',{'schema':1,'matches':{}});shards={}
    for item in records:
        match,source=item['match'],item['source'];identity=match['id']
        month=index['matches'].setdefault(identity,(match.get('source_date_utc') or stamp)[:7])
        if not re.fullmatch(r'\d{4}-\d{2}',month):raise ValueError('Invalid provider archive month')
        if month not in shards:shards[month]=registry.read_strict(root/archive/(month+'.json'),{'schema':1,'matches':{}})
        saved=shards[month]['matches'].setdefault(identity,{'first_observed_utc':stamp,'last_observed_utc':stamp,'current':match,'observations':{}})
        signature=registry.digest(match);old=saved['observations'].get(signature)
        if old is None:saved['observations'][signature]={'match':match,'first_observed_utc':stamp,'last_confirmed_utc':stamp,'first_source':source,'last_source':source}
        else:
            if stamp<old['first_observed_utc']:old.update(first_observed_utc=stamp,first_source=source)
            if stamp>=old['last_confirmed_utc']:old.update(last_confirmed_utc=stamp,last_source=source)
        saved['first_observed_utc']=min(stamp,saved['first_observed_utc'])
        if stamp>=saved['last_observed_utc']:saved.update(last_observed_utc=stamp,current=match)
    for month,shard in shards.items():u.writejson(root/archive/(month+'.json'),shard)
    u.writejson(root/archive/'index.json',index)
    return len(index['matches'])
