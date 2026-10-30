"""Supplemental public Forebet fixtures/finals; never imports predictions or odds.

DATE_BAH is the site's fixed UTC+01 source clock (the public changeDate
formatter subtracts one hour for UTC). Convert the instant before selecting a
UTC day; do not use the runner/browser timezone. Every accepted identity is
scoped to one exact competition and an existing canonical club.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import update as u
import match_registry as registry
import statarea as sta
from club_identity import normal

BASE = 'https://www.forebet.com'
ARCHIVE = 'data/forebet'
CROSSWALK = 'data/forebet_clubs.json'
DIVISIONS = sta.DIVISIONS
SOURCE_ZONE = dt.timezone(dt.timedelta(hours=1))
COMPETITIONS = {
    ('England', 'Premier League'): 'E0', ('England', 'Championship'): 'E1',
    ('England', 'League One'): 'E2', ('England', 'League Two'): 'E3',
    ('Scotland', 'Premiership'): 'SC0', ('Germany', 'Bundesliga'): 'D1',
    ('Germany', '2. Bundesliga'): 'D2', ('Italy', 'Serie A'): 'I1',
    ('Italy', 'Serie B'): 'I2', ('Spain', 'La Liga'): 'SP1',
    ('Spain', 'Segunda Division'): 'SP2', ('France', 'Ligue 1'): 'F1',
    ('France', 'Ligue 2'): 'F2', ('Netherlands', 'Eredivisie'): 'N1',
    ('Belgium', 'Jupiler Pro League'): 'B1', ('Portugal', 'Liga Portugal'): 'P1',
    ('Türkiye', 'Süper Lig'): 'T1', ('Greece', 'Super League'): 'G1',
    ('Norway', 'Eliteserien'): 'NOR', ('Sweden', 'Allsvenskan'): 'SWE',
    ('Denmark', 'Superliga'): 'DNK', ('Austria', 'Bundesliga'): 'AUT',
    ('Poland', 'Ekstraklasa'): 'POL', ('Switzerland', 'Super League'): 'SWZ',
    ('', 'UEFA Champions League'): 'UCL', ('', 'UEFA Europa League'): 'UEL',
    ('', 'UEFA Europa Conference League'): 'UECL',
}


def configuration(root):
    primary = sta.configuration(root) or {}
    value = primary.get('secondary')
    if value is None:
        return None
    if value.get('provider') != 'Forebet' or not 30 <= value.get('interval_minutes', 0) <= 1440:
        raise ValueError('Invalid supplemental calendar configuration')
    return value


def listing_url(day):
    start = dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc)
    # The ordinary More control requests this overlap around its selected day.
    # The parser below retains only the actual requested UTC day.
    query = {'ln': 'en', 'tp': '1x2', 'in': day, 'ord': 0, 'tz': 0,
             'tzs': int((start-dt.timedelta(hours=3)).timestamp()),
             'tze': int((start+dt.timedelta(hours=25)).timestamp())}
    return BASE+'/scripts/getrs.php?'+urllib.parse.urlencode(query)


def fetch(url):
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Matchpulse-Calendar/1.0 (+https://github.com/planenp993/matchpulse-auto)',
        'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=25) as response:
        if response.status != 200 or not response.url.startswith(BASE+'/'):
            raise ValueError('Unexpected Forebet response')
        raw = response.read(20_000_001)
    if len(raw) > 20_000_000:
        raise ValueError('Forebet response exceeds bound')
    return raw


def parse(raw, day):
    data = json.loads(raw.decode('utf-8-sig'))
    if not isinstance(data, list) or len(data) != 2 or not isinstance(data[0], list) or not isinstance(data[1], dict):
        raise ValueError('Invalid Forebet listing schema')
    rows, leagues = data
    if not rows or not leagues:
        raise ValueError('Unpublished/empty global Forebet day')
    records, seen, in_day = [], set(), 0
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Malformed Forebet match')
        identity = str(row.get('id', ''))
        if not re.fullmatch(r'\d+', identity) or identity in seen:
            raise ValueError('Duplicate/invalid Forebet identity')
        seen.add(identity)
        metadata = leagues.get(str(row.get('league_id')))
        if not isinstance(metadata, list) or len(metadata) < 3:
            # Some global cup rows have no league metadata. They cannot pass
            # our exact competition gate; never infer a division from clubs.
            continue
        label = tuple(str(x).strip() for x in metadata[:2])
        division = COMPETITIONS.get(label)
        # DATE_BAH belongs to the source's fixed clock, not to Europe/Sofia.
        value = row.get('DATE_BAH')
        try:
            instant = dt.datetime.strptime(value, '%Y-%m-%d %H:%M:%S').replace(tzinfo=SOURCE_ZONE).astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            if division:
                raise ValueError('Unsupported/missing Forebet kickoff')
            continue
        if instant.date().isoformat() != day:
            continue
        in_day += 1
        if not division:
            continue
        home, away = row.get('HOST_NAME'), row.get('GUEST_NAME')
        club_ids = [str(row.get('host_id', '')), str(row.get('guest_id', ''))]
        if not isinstance(home, str) or not isinstance(away, str) or not home or home == away or not all(re.fullmatch(r'\d+', x) for x in club_ids):
            raise ValueError('Malformed Forebet club identity')
        status = str(row.get('comment') or '').strip()
        score = [u.goals(row.get(k)) for k in ('Host_SC', 'Guest_SC')]
        extra = [str(row[k]) for k in ('penalty_score', 'extra_time_score') if row.get(k) not in (None, '', '-')]
        final = status == 'FT' and not extra and all(x is not None for x in score)
        # Only the observed source fields below can enter our evidence archive.
        records.append({'id': identity, 'division': division, 'competition': ' / '.join(label),
            'source_date_utc': day, 'kickoff_utc': instant.isoformat(timespec='seconds'),
            'source_clock': value, 'home': home, 'away': away, 'club_ids': club_ids,
            'league_id': str(row['league_id']), 'status': status, 'extra': extra,
            'score_display': score, 'regulation': score if final else None})
    if not in_day:
        raise ValueError('Forebet response has no matches on requested UTC day')
    return records, in_day


def proof_history(root):
    rows = registry.read_strict(root/'docs/data/history.json', []) + registry.read_strict(root/'docs/data/europe_history.json', [])
    return {(r[0], r[3], u.club_key(r[5]), u.club_key(r[6])): r[7:9] for r in rows}


def validate_name(entry, root, history=None):
    proof = entry.get('evidence', [])
    if (len({e['provider_match_id'] for e in proof}) < 3 or
            len({e['provider_match_id'] for e in proof}) != len(proof) or
            len({e['opponent_key'] for e in proof}) < 2):
        raise ValueError('Forebet name link needs three exact scores/two opponents')
    history = proof_history(root) if history is None else history
    target = u.club_key(entry['target'])
    for e in proof:
        clubs = [u.club_key(e['home']), u.club_key(e['away'])]
        if (clubs.count(target) != 1 or e['opponent_key'] != clubs[1-clubs.index(target)] or
                history.get((entry['division'], e['date'], *clubs)) != e['regulation'] or
                not re.fullmatch(r'\d+', e['provider_match_id']) or
                not e.get('source_url', '').startswith(BASE+'/en/football/matches/') or
                not re.fullmatch(r'[a-f0-9]{64}', e.get('source_sha256', '')) or
                not e.get('match_url', '').endswith('-'+e['provider_match_id'])):
            raise ValueError('Forebet name proof disagrees with archived identity/score')


class Names(sta.Names):
    def __init__(self, root, history, fixtures):
        super().__init__(root, history, fixtures)
        proof = {(r[0], r[3], u.club_key(r[5]), u.club_key(r[6])): r[7:9] for r in history}
        for entry in registry.read_strict(root/CROSSWALK, {'schema': 1, 'entries': []})['entries']:
            validate_name(entry, root, proof)
            self.add(entry['division'], entry['source_name'], entry['target'])


def project(batch, names, now):
    for field in ('observations', 'rows', 'results', 'quarantined'):
        batch[field] = []
    signatures = {}
    for item in batch['records']:
        record = item['match']
        signatures.setdefault(record['id'], set()).add(registry.digest(record))
    ambiguous = {i for i, values in signatures.items() if len(values) != 1}
    seen = set()
    for item in batch['records']:
        record = item['match']; identity = record['id']
        if identity in seen:
            continue
        seen.add(identity)
        home = names.resolve(record['division'], record['home'])
        away = names.resolve(record['division'], record['away'])
        reason = 'conflicting_provider_observations' if identity in ambiguous else None
        if not home or not away or u.club_key(home) == u.club_key(away):
            reason = 'unmatched_or_ambiguous_club'
        instant = dt.datetime.fromisoformat(record['kickoff_utc'])
        if record['status'] in ('FT', 'AET', 'Pen.') and instant > now-dt.timedelta(hours=2):
            reason = 'unconfirmed_final_kickoff'
        if reason:
            batch['quarantined'].append({'id': identity, 'division': record['division'],
                'home': record['home'], 'away': record['away'], 'reason': reason})
            continue
        local = instant.astimezone(ZoneInfo('Europe/Sofia')); div = record['division']
        row = [div, *DIVISIONS[div], local.date().isoformat(), local.strftime('%H:%M'),
               home, away, None, None, None, None, None, None, 'Forebet / UTC→Europe-Sofia']
        state = {'Postp.': 'postponed', 'Cancl.': 'cancelled'}.get(record['status'])
        if state is None and (record['status'] or instant <= now):
            state = 'provisional_result'
        observation = {'row': row, 'provider_id': 'Forebet:'+identity,
                       'kickoff_utc': record['kickoff_utc'], 'status': state}
        batch['observations'].append(observation)
        if record['regulation'] is not None:
            if div not in sta.EUROPE:
                batch['results'].append({**observation, 'row': [*row[:7], *record['regulation'],
                    None, None, None, None, {'SRC': 'Forebet', 'PROVIDER_ID': identity}]})
        elif not record['status'] and instant > now:
            batch['rows'].append(row)
    return batch


def dates(now, wide=False, initial=False, config=None):
    config = config or {}; today = u.today_sofia(now)
    back = config.get('daily_past_days', 7) if wide or initial else 2
    ahead = config.get('future_days', 7) if wide else 2
    # Check the useful current window before an old/unpublished wider page can
    # stop the batch. A denial still stops all remaining requests.
    offsets = [0, 1, 2, -1, -2, -3, *range(3, ahead+1), *range(-4, -back-2, -1)]
    return [(today+dt.timedelta(days=i)).isoformat() for i in offsets]


def needs_help(root, primary, now):
    if not primary: return False
    if primary['errors'] or primary['quarantined']: return True
    observed = {registry.row_key(o['row']) for o in primary['observations']}
    horizon = set(dates(now))
    for row in registry.read_strict(root/'docs/data/fixtures.json', []):
        if row[3] in horizon and registry.row_key(row) not in observed:
            return True
    finals = {registry.row_key(o['row']) for o in primary['results']}
    book = registry.read_strict(root/'data/match_registry.json', registry.empty())
    for match in book['matches'].values():
        if match['state'] not in ('awaiting_result','provisional_result') or match['schedule'][3] not in horizon:
            continue
        instant = match.get('kickoff_utc')
        if instant and dt.datetime.fromisoformat(instant) <= now-dt.timedelta(hours=3) and not finals.intersection(match['legacy_keys']):
            return True
    return False


def collect(root, now, wide=False, initial=False, download=None):
    names = Names(root, registry.read_strict(root/'docs/data/history.json', [])+
                  registry.read_strict(root/'docs/data/europe_history.json', []),
                  registry.read_strict(root/'docs/data/fixtures.json', []))
    batch = {'provider': 'Forebet', 'wide': wide, 'initial': initial, 'days': {},
             'records': [], 'observations': [], 'rows': [], 'results': [], 'quarantined': [], 'errors': []}
    stop, lock = [], threading.Lock()
    def one(day):
        url = listing_url(day)
        try:
            with lock:
                if stop:
                    raise ValueError('Source batch stopped after HTTP '+str(stop[0]))
            raw = (download or fetch)(url)
            records, total = parse(raw, day)
            return day, records, {'status': 'ok', 'global_matches': total,
                'supported_matches': len(records), 'url': url, 'sha256': hashlib.sha256(raw).hexdigest()}
        except Exception as error:
            if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403, 429, 503):
                with lock:
                    if not stop: stop.append(error.code)
            return day, [], {'status': 'error', 'url': url, 'error': f'{type(error).__name__}: {error}'}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for day, records, receipt in pool.map(one, dates(now, wide, initial, configuration(root))):
            batch['days'][day] = receipt
            if receipt['status'] == 'ok':
                batch['records'].extend({'match': r, 'source': {'url': receipt['url'], 'sha256': receipt['sha256']}} for r in records)
            else:
                batch['errors'].append(day+': '+receipt['error'])
    return project(batch, names, now)


def align_registry(root, batch, book, primary=None):
    batch = sta.align_registry(root, batch, book)
    primary_by_key = {registry.row_key(o['row']): o for o in (primary or {}).get('observations', [])}
    published = {}
    for m in book['matches'].values():
        for key in m['legacy_keys']: published[key] = m
    rejected = set()
    for o in batch['observations']:
        row = o['row']; key = registry.row_key(row); first = primary_by_key.get(key)
        reason = None
        if first and (first['kickoff_utc'] != o['kickoff_utc'] or
                      first.get('status') in ('postponed', 'cancelled') and first.get('status') != o.get('status') or
                      o.get('status') in ('postponed', 'cancelled') and first.get('status') != o.get('status')):
            reason = 'calendar_source_disagreement'
        elif not first and key in published:
            m = published[key]
            if any(p.startswith('Statarea:') for p in m['provider_ids']) and m.get('kickoff_utc') and m['kickoff_utc'] != o['kickoff_utc']:
                reason = 'existing_primary_kickoff_differs'
        elif key not in published:
            # A second source cannot silently invent a new identity for a likely
            # reschedule. Joining across dates requires an already linked ID.
            pair = [u.club_key(n) for n in row[5:7]]
            linked = any(o['provider_id'] in m['provider_ids'] for m in book['matches'].values())
            if not linked and any(m['division'] == row[0] and m['clubs'] == pair and
                    abs((dt.date.fromisoformat(m['schedule'][3])-dt.date.fromisoformat(row[3])).days) <= 2
                    for m in book['matches'].values()):
                reason = 'unlinked_possible_reschedule'
        if reason:
            rejected.add(o['provider_id'])
            item = {'id': o['provider_id'].split(':', 1)[1], 'reason': reason, 'key': key}
            batch['quarantined'].append(item)
            registry.record_conflict(book, 'calendar_source_disagreement',
                {**item, 'provider_id': o['provider_id'], 'incoming': o['kickoff_utc'],
                 'kept': first['kickoff_utc'] if first else published.get(key, {}).get('kickoff_utc')})
    accepted = [o for o in batch['observations'] if o['provider_id'] not in rejected]
    keys = {registry.row_key(o['row']) for o in accepted}
    return {**batch, 'observations': accepted,
            'rows': [r for r in batch['rows'] if registry.row_key(r) in keys],
            'results': [o for o in batch['results'] if o['provider_id'] not in rejected]}


def apply_results(batch, history, book):
    changed, conflicts = [], 0
    for observation in batch['results']:
        row = observation['row']; key = u.key(row); old = history.get(key)
        if old is not None and old[7:9] != row[7:9]:
            registry.record_conflict(book, 'forebet_score_conflict',
                {'key': registry.row_key(row), 'provider_id': observation['provider_id'], 'kept': old, 'incoming': row})
            conflicts += 1
        elif old is None:
            history[key] = row; changed.append(row)
    return changed, conflicts


def apply_batch(root, batch, status, history, book, stamp, trigger=None, primary=None):
    total = persist(root, batch, stamp)
    if status.get('last_forebet_attempt_utc', '') > stamp:
        return None, [], 0
    batch = align_registry(root, batch, book, primary)
    changed, conflicts = apply_results(batch, history, book)
    registry.observe(book, batch['observations'], stamp)
    good = sum(c['status'] == 'ok' for c in batch['days'].values())
    complete = good == len(batch['days']) and not batch['quarantined'] and not conflicts
    status.update(last_forebet_attempt_utc=stamp, forebet_refresh_status='ok' if complete else 'partial' if good else 'error',
        forebet_checks=batch['days'], forebet_errors=batch['errors'], forebet_quarantined=batch['quarantined'],
        forebet_archived_matches=total)
    if trigger: status['last_forebet_attempt_trigger'] = trigger
    if complete:
        status['last_forebet_success_utc'] = stamp
        if trigger: status['last_forebet_success_trigger'] = trigger
    if good: status['last_forebet_data_success_utc'] = stamp
    status.setdefault('forebet_day_success_utc', {}).update({d: stamp for d,c in batch['days'].items() if c['status']=='ok'})
    if batch['wide']:
        status.update(last_forebet_wide_attempt_utc=stamp, forebet_wide_status='ok' if complete else 'partial')
    if changed: status['last_forebet_result_change_utc'] = stamp
    return batch, changed, conflicts


def merge_calendar(batch, primary, fixtures, status, book, stamp, now):
    """Supplement exact identities; existing source evidence is never erased."""
    additions, confirmations = 0, 0
    if batch is not None:
        observed = {o['provider_id'] for o in batch['observations']}
        affected = {key for m in book['matches'].values() if observed.intersection(m['provider_ids']) for key in m['legacy_keys']}
        cached = {u.key(r): r for r in fixtures}
        incoming = []
        for row in batch['rows']:
            old = cached.get(u.key(row)); fresh = list(row)
            if old is not None:
                fresh[9:13] = old[9:13]
                if len(old)>13 and 'Statarea' in str(old[13]):
                    fresh[13] = 'Statarea + Forebet / UTC→Europe-Sofia'; confirmations += 1
            else:
                additions += 1
            incoming.append(fresh)
        fixtures = u.merge_fixtures([*incoming, *[r for r in fixtures if registry.row_key(r) not in affected]])
    if batch is None and primary is None:
        return fixtures
    good = set()
    for field in ('statarea_day_success_utc', 'forebet_day_success_utc'):
        for day, value in status.get(field, {}).items():
            age = (now-dt.datetime.fromisoformat(value)).total_seconds()/3600
            if -1/60 <= age <= 2: good.add(day)
    required = set(dates(now))
    current_good = {d for source in (batch, primary) if source is not None for d,c in source['days'].items() if c['status']=='ok'}
    if current_good:
        status['fixtures_updated_utc'] = stamp
        status['fixtures_checked_utc'] = stamp
        status['last_fixture_attempt_utc'] = max(stamp,status.get('last_fixture_attempt_utc',''))
    # Successful downloads alone do not resolve rejected identities. At least
    # one source must also have a complete, unquarantined recent check.
    resolved = any(status.get(field) and -1/60 <= (now-dt.datetime.fromisoformat(status[field])).total_seconds()/3600 <= 2
                   for field in ('last_statarea_success_utc', 'last_forebet_success_utc'))
    complete = required.issubset(good) and resolved
    issues = []
    for source in (primary, batch):
        if source is not None: issues.extend(source['errors'])
    status.update(fixtures_feed_status='ok_secondary' if complete else 'partial' if good else 'error',
        fixtures_source='Statarea + Forebet / verified source clocks; Football-Data historical statistics and quotes',
        secondary_fixture_counts={div: sum(r[0]==div for r in fixtures) for div in DIVISIONS},
        secondary_fixture_sources_ok=len(DIVISIONS) if complete else 0,
        secondary_fixture_sources_total=len(DIVISIONS),
        stale_secondary_leagues=[] if complete else sorted(DIVISIONS),
        secondary_fixture_errors=[] if complete else issues,
        calendar_complement={'forebet_added_fixtures':additions,'forebet_confirmed_fixtures':confirmations,
            'required_utc_days':sorted(required),'fresh_utc_days':sorted(required.intersection(good))})
    return fixtures


def persist(root, batch, stamp):
    """Reapply observations onto latest shards. Corrections append, not replace."""
    check(root)  # Missing/corrupt indexed shards must block, never reset.
    index = registry.read_strict(root/ARCHIVE/'index.json', {'schema': 1, 'matches': {}})
    if index.get('schema') != 1 or not isinstance(index.get('matches'), dict):
        raise ValueError('Corrupt Forebet archive index')
    shards = {}
    for item in batch['records']:
        match, source = item['match'], item['source']
        identity = match['id']
        month = index['matches'].setdefault(identity, match['source_date_utc'][:7])
        if not re.fullmatch(r'\d{4}-\d{2}', month):
            raise ValueError('Invalid Forebet shard identity')
        if month not in shards:
            shards[month] = registry.read_strict(root/ARCHIVE/(month+'.json'), {'schema': 1, 'matches': {}})
        shard = shards[month]
        if shard.get('schema') != 1 or not isinstance(shard.get('matches'), dict):
            raise ValueError('Corrupt Forebet archive shard')
        saved = shard['matches'].setdefault(identity, {'first_observed_utc': stamp,
            'last_observed_utc': stamp, 'current': match, 'observations': {}})
        if not isinstance(saved.get('observations'), dict):
            raise ValueError('Corrupt Forebet match observations')
        signature = registry.digest(match)
        previous = saved['observations'].get(signature)
        if previous is None:
            saved['observations'][signature] = {'match': match, 'first_observed_utc': stamp,
                'last_confirmed_utc': stamp, 'first_source': source, 'last_source': source}
        else:
            if stamp < previous['first_observed_utc']:
                previous.update(first_observed_utc=stamp, first_source=source)
            if stamp >= previous['last_confirmed_utc']:
                previous.update(last_confirmed_utc=stamp, last_source=source)
        saved['first_observed_utc'] = min(saved['first_observed_utc'], stamp)
        if stamp >= saved['last_observed_utc']:
            saved.update(last_observed_utc=stamp, current=match)
    for month, shard in shards.items():
        u.writejson(root/ARCHIVE/(month+'.json'), shard)
    u.writejson(root/ARCHIVE/'index.json', index)
    return len(index['matches'])



def check(root):
    seen_names = set()
    history = proof_history(root)
    for entry in registry.read_strict(root/CROSSWALK, {'schema': 1, 'entries': []})['entries']:
        scoped = (entry['division'], normal(entry['source_name']))
        if entry['division'] not in DIVISIONS or scoped in seen_names:
            raise ValueError('Duplicate/unsupported Forebet club link')
        seen_names.add(scoped)
        validate_name(entry, root, history)
    index = registry.read_strict(root/ARCHIVE/'index.json', {'schema': 1, 'matches': {}})
    if index.get('schema') != 1 or not isinstance(index.get('matches'), dict):
        raise ValueError('Invalid Forebet index')
    found = {}
    for path in sorted((root/ARCHIVE).glob('????-??.json')) if (root/ARCHIVE).exists() else []:
        shard = registry.read_strict(path, {})
        if shard.get('schema') != 1 or not isinstance(shard.get('matches'), dict):
            raise ValueError('Invalid Forebet shard')
        for identity, saved in shard['matches'].items():
            if identity in found or index['matches'].get(identity) != path.stem:
                raise ValueError('Forebet index/shard disagreement')
            found[identity] = path.stem
            if not saved.get('observations') or saved['first_observed_utc'] > saved['last_observed_utc']:
                raise ValueError('Invalid Forebet observation history')
            for signature, value in saved['observations'].items():
                if signature != registry.digest(value['match']) or value['match']['id'] != identity:
                    raise ValueError('Changed Forebet observation')
            if registry.digest(saved['current']) not in saved['observations']:
                raise ValueError('Unarchived current Forebet observation')
    if found != index.get('matches'):
        raise ValueError('Incomplete Forebet archive index')
    return {'forebet_matches': len(found), 'shards': len(set(found.values())), 'reviewed_names': len(seen_names)}



if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', required=True)
    parser.parse_args()
    print(json.dumps(check(u.ROOT)))
