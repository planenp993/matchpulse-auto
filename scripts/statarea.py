"""Public Statarea calendar/results, with UTC verification and durable evidence.

Only exact competition/club identities and explicit regulation finals enter the
compatible views. Raw public match observations survive quarantine and outages.
No browser, login, prices, prediction text or personal data is collected.
"""
import argparse
import datetime as dt
import hashlib
import http.cookiejar
import json
import re
import threading
import urllib.parse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import update as u
import match_registry as registry
from club_identity import normal

BASE = 'https://www.statarea.com'
CONFIG = 'ops/calendar_source.json'
ARCHIVE = 'data/statarea'
CROSSWALK = 'data/statarea_clubs.json'
EUROPE = {'UCL': ('Europe', 'Champions League'), 'UEL': ('Europe', 'Europa League'),
          'UECL': ('Europe', 'Conference League')}
DIVISIONS = {**u.LEAGUES, **EUROPE}
COMPETITIONS = dict(zip([
    'England - Premier League', 'England - Championship', 'England - League One',
    'England - League Two', 'Scotland - Premiership', 'Germany - Bundesliga',
    'Germany - 2. Bundesliga', 'Italy - Serie A', 'Italy - Serie B', 'Spain - Laliga',
    'Spain - Laliga2', 'France - Ligue 1', 'France - Ligue 2', 'Netherlands - Eredivisie',
    'Belgium - Jupiler Pro League', 'Portugal - Liga Portugal', 'Turkey - Super Lig',
    'Greece - Super League', 'Norway - Eliteserien', 'Sweden - Allsvenskan',
    'Denmark - Superliga', 'Austria - Bundesliga', 'Poland - Ekstraklasa',
    'Switzerland - Super League', 'Europe - Champions League - League Phase',
    'Europe - Europa League - League Phase', 'Europe - Conference League - League Phase'
], ['E0', 'E1', 'E2', 'E3', 'SC0', 'D1', 'D2', 'I1', 'I2', 'SP1', 'SP2', 'F1',
    'F2', 'N1', 'B1', 'P1', 'T1', 'G1', 'NOR', 'SWE', 'DNK', 'AUT', 'POL', 'SWZ',
    'UCL', 'UEL', 'UECL']))


# Explicit labels observed on the public 2026-05-02/03/16/17, 02-18/19 and 08-19/20
# UTC calendars. Never use a prefix rule: women's/youth competitions share it.
for base, div, phases in [
    ('Scotland - Premiership', 'SC0', ('Championship Group', 'Relegation Group')),
    ('Belgium - Jupiler Pro League', 'B1', ('Championship Group', 'Conference League Group', 'Relegation Group', 'Relegation')),
    ('Austria - Bundesliga', 'AUT', ('Championship Group', 'Relegation Group')),
    ('Denmark - Superliga', 'DNK', ('Championship Group', 'Relegation Group')),
    ('Greece - Super League', 'G1', ('Championship Group', 'Conference League Group', 'Relegation Group')),
    ('Switzerland - Super League', 'SWZ', ('Championship Group', 'Relegation Group')),
    ('Europe - Champions League', 'UCL', ('Qualification', 'Play Offs')),
    ('Europe - Europa League', 'UEL', ('Qualification', 'Play Offs')),
    ('Europe - Conference League', 'UECL', ('Qualification', 'Play Offs')),
]:
    for phase in phases:
        COMPETITIONS[base+' - '+phase] = div
# This inter-division relegation tie is a calendar event, not an ordinary
# top-division training observation. Its source scores remain in our archive.
CALENDAR_ONLY = {'Belgium - Jupiler Pro League - Relegation'}


def configuration(root):
    value = registry.read_strict(root/CONFIG, {})
    if not value:
        return None  # Legacy/test snapshots remain reproducible without activation.
    if value.get('schema') != 1 or value.get('provider') != 'Statarea':
        raise ValueError('Invalid calendar source configuration')
    return value


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def text(self):
        return ' '.join(x.text() if isinstance(x, Node) else x for x in self.children).strip()

    def select(self, cls):
        found = []
        for child in self.children:
            if isinstance(child, Node):
                if cls in child.attrs.get('class', '').split():
                    found.append(child)
                found.extend(child.select(cls))
        return found

    def first(self, cls):
        return next(iter(self.select(cls)), Node())


class Tree(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
            'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__()
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack)-1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, value):
        self.stack[-1].children.append(value)


class PublicSession:
    """Fresh anonymous site preference; cookie values never leave this object."""
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.opener.addheaders = [('User-Agent',
            'Matchpulse-Calendar/1.0 (+https://github.com/planenp993/matchpulse-auto)')]
        payload = urllib.parse.urlencode({'object': json.dumps(
            {'action': 'setCustomTimezone', 'timezone': 'GMT 0'})}).encode()
        self._read(BASE+'/actions/controller/', payload)

    def _read(self, url, data=None):
        with self.opener.open(url, data=data, timeout=25) as response:
            if response.status != 200 or not response.url.startswith(BASE+'/'):
                raise ValueError('Unexpected calendar response')
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError('Calendar response too large')
        return raw

    def __call__(self, url):
        return self._read(url)


def parse(raw, day):
    tree = Tree()
    tree.feed(raw.decode('utf-8-sig', errors='strict'))
    selected = [n.text() for n in tree.root.first('date').select('value')
                if n.attrs.get('id') == 'cdate']
    if selected != [day]:
        raise ValueError('Wrong/missing Statarea calendar date')
    if [n.text() for n in tree.root.select('gmt')] != ['GMT 0']:
        raise ValueError('Statarea UTC preference not confirmed (or unpublished day)')
    all_matches = tree.root.select('match')
    if not all_matches:
        raise ValueError('Empty global calendar is not a confirmed empty day')
    records, seen = [], set()
    for competition in tree.root.select('competition'):
        label = competition.first('header').first('name').text()
        div = COMPETITIONS.get(label)
        if not div:
            continue
        for match in competition.select('match'):
            identity = match.attrs.get('id', '')
            home, away = match.first('hostteam'), match.first('guestteam')
            h, a = home.first('name').text(), away.first('name').text()
            if not re.fullmatch(r'\d+', identity) or identity in seen or not h or not a or h == a:
                raise ValueError('Malformed/duplicate supported match identity')
            seen.add(identity)
            clock = match.first('time').text()
            kickoff = None
            if re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', clock):
                kickoff = dt.datetime.fromisoformat(day+'T'+clock+'+00:00').isoformat(timespec='seconds')
            state = match.first('status').text()
            system = match.first('systemstatus').text()
            extras = [n.text() for n in match.select('extra') if n.text()]
            score = [home.first('goals').text(), away.first('goals').text()]
            values = [u.goals(x) for x in score]
            final = state == 'fin' and system == '1' and not extras and all(x is not None for x in values)
            records.append({'id': identity, 'division': div, 'competition': label,
                'source_date_utc': day, 'clock_utc': clock, 'kickoff_utc': kickoff,
                'home': h, 'away': a, 'status': state, 'system_status': system,
                'score_display': score, 'extra': extras, 'regulation': values if final else None})
            if label in CALENDAR_ONLY:
                records[-1]['calendar_only'] = True
    return records, len(all_matches)


class Names:
    """Competition-scoped exact identities; no fuzzy runtime substitutions."""
    def __init__(self, root, history, fixtures):
        self.known, self.labels = {}, {}
        for row in [*history, *fixtures]:
            for name in row[5:7]:
                self.known.setdefault(row[0], {})[u.club_key(name)] = name
                self.add(row[0], name, name)
        for path in ['docs/data/provider_clubs.json', 'docs/data/standings_clubs.json']:
            for entry in registry.read_strict(root/path, {}).get('entries', []):
                for name in [entry.get('source_name', ''), *entry.get('source_names', [])]:
                    if name:
                        self.add(entry['division'], name, entry['target'])
        # UEFA has already reviewed official club IDs and their exact labels.
        # Reuse those labels only in a competition where that canonical club is
        # independently present; never introduce a global cross-country alias.
        for entry in registry.read_strict(root/'data/europe_clubs.json', {}).values():
            for div in EUROPE:
                if u.club_key(entry['name']) in self.known.get(div, {}):
                    for name in entry.get('source_names', []):
                        self.add(div, name, entry['name'])
        for entry in registry.read_strict(root/CROSSWALK, {'schema': 1, 'entries': []})['entries']:
            validate_name(entry, root)
            self.add(entry['division'], entry['source_name'], entry['target'])

    def add(self, div, source, target):
        self.labels.setdefault((div, normal(source)), set()).add(u.club_key(target))

    def resolve(self, div, name):
        candidates = self.labels.get((div, normal(name)), {u.club_key(name)})
        known = self.known.get(div, {})
        # Ambiguity never disappears just because one candidate is absent today.
        if len(candidates) != 1:
            return None
        return known.get(next(iter(candidates)))


def validate_name(entry, root):
    evidence = entry.get('evidence', [])
    if len({e['provider_match_id'] for e in evidence}) != len(evidence) or len({e['opponent_key'] for e in evidence}) < 2:
        raise ValueError('Name link requires distinct matches and opponents')
    if len(evidence) >= 3:
        return
    # A new UEFA main phase has only two fixtures. Require BOTH official score
    # identities plus a reviewed official club ID and every complete table total.
    proof = entry.get('two_match_uefa_proof', {})
    clubs = registry.read_strict(root/'data/europe_clubs.json', {})
    club = clubs.get(proof.get('official_club_id'))
    if len(evidence) != 2 or entry['division'] not in EUROPE or not club or u.club_key(club['name']) != u.club_key(entry['target']):
        raise ValueError('Statarea name link lacks reviewed score evidence')
    values = dict(played=0, won=0, drawn=0, lost=0, gf=0, ga=0, gd=0)
    for e in evidence:
        target = u.club_key(entry['target'])
        if target not in [u.club_key(e['home']), u.club_key(e['away'])]:
            raise ValueError('UEFA club identity differs from evidence')
        score = e['regulation'] if u.club_key(e['home']) == target else list(reversed(e['regulation']))
        values['played'] += 1
        values['gf'] += score[0]; values['ga'] += score[1]
        values['won' if score[0] > score[1] else 'lost' if score[0] < score[1] else 'drawn'] += 1
    values['gd'] = values['gf']-values['ga']
    if values != proof.get('standing_totals') or not proof.get('standing_provider_id') or not proof.get('receipts'):
        raise ValueError('Two-match UEFA name proof disagrees with complete table')


def row_for(record, names):
    div = record['division']
    home, away = names.resolve(div, record['home']), names.resolve(div, record['away'])
    if not home or not away or u.club_key(home) == u.club_key(away):
        return None
    kickoff = record['kickoff_utc']
    if kickoff:
        local = dt.datetime.fromisoformat(kickoff).astimezone(ZoneInfo('Europe/Sofia'))
        day, clock = local.date().isoformat(), local.strftime('%H:%M')
        source = 'Statarea / UTC→Europe-Sofia'
    else:
        day, clock, source = record['source_date_utc'], '', 'Statarea / unconfirmed kickoff'
    return [div, *DIVISIONS[div], day, clock, home, away, None, None, None, None, None, None, source]


def dates(now, wide, initial=False, config=None):
    config = config or {}
    today = u.today_sofia(now)
    back = config.get('initial_past_days', 30) if initial else config.get('daily_past_days', 7) if wide else 2
    ahead = config.get('future_days', 7) if wide else 2
    # UTC pages overlap Sofia midnight, including both DST transitions.
    return [(today+dt.timedelta(days=i)).isoformat() for i in range(-back-1, ahead+1)]


def collect(root, now, wide=False, initial=False, download=None):
    config = configuration(root) or {}
    history = registry.read_strict(root/'docs/data/history.json', [])
    european = registry.read_strict(root/'docs/data/europe_history.json', [])
    fixtures = registry.read_strict(root/'docs/data/fixtures.json', [])
    names = Names(root, [*history, *european], fixtures)
    local = threading.local()
    circuit, circuit_lock = [], threading.Lock()
    def one(day):
        url = BASE+'/livescore/date/'+day
        try:
            with circuit_lock:
                if circuit:
                    raise ValueError('Source batch stopped after HTTP '+str(circuit[0]))
            if download is None:
                if not hasattr(local, 'session'):
                    local.session = PublicSession()
                get = local.session
            else:
                get = download
            raw = get(url)
            records, total = parse(raw, day)
            source = {'url': url, 'sha256': hashlib.sha256(raw).hexdigest()}
            return day, records, {'status': 'ok', 'global_matches': total,
                                 'supported_matches': len(records), **source}
        except Exception as error:
            if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403, 429, 503):
                with circuit_lock:
                    if not circuit: circuit.append(error.code)
            return day, [], {'status': 'error', 'url': url, 'error': f'{type(error).__name__}: {error}'}
    result = {'provider': 'Statarea', 'wide': wide, 'initial': initial, 'days': {},
              'records': [], 'observations': [], 'rows': [], 'results': [], 'quarantined': [], 'errors': []}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for day, records, check in pool.map(one, dates(now, wide, initial, config)):
            result['days'][day] = check
            if check['status'] != 'ok':
                result['errors'].append(day+': '+check['error'])
                continue
            for record in records:
                result['records'].append({'match': record, 'source': {'url': check['url'], 'sha256': check['sha256']}})
    return project(result, names, now)


def project(result, names, now):
    """Derive conservative compatible views; raw evidence is always retained."""
    for field in ('observations', 'rows', 'results', 'quarantined'):
        result[field] = []
    for item in result['records']:
        record = item['match']
        row = row_for(record, names)
        if row is None:
            result['quarantined'].append({'id': record['id'], 'division': record['division'],
                'home': record['home'], 'away': record['away'], 'reason': 'unmatched_or_ambiguous_club'})
            continue
        instant = dt.datetime.fromisoformat(record['kickoff_utc']) if record['kickoff_utc'] else None
        if record['status'] == 'fin' and (instant is None or instant > now-dt.timedelta(hours=2)):
            result['quarantined'].append({'id': record['id'], 'reason': 'unconfirmed_final_kickoff'})
            continue  # Keep the last good future schedule, not an impossible final.
        state = {'post': 'postponed', 'canc': 'cancelled'}.get(record['status'])
        final = record['regulation'] is not None
        if state is None and record['status'] != 'sched':
            state = 'provisional_result'
        observation = {'row': row, 'provider_id': 'Statarea:'+record['id'],
                       'kickoff_utc': record['kickoff_utc'], 'status': state}
        result['observations'].append(observation)
        if final:
            if record['division'] not in EUROPE and not record.get('calendar_only'):
                finished = [*row[:7], *record['regulation'], None, None, None, None,
                    {'SRC': 'Statarea', 'PROVIDER_ID': record['id']}]
                result['results'].append({**observation, 'row': finished})
            # Official UEFA regulation archive remains independent.
        elif record['status'] not in ('fin', 'post', 'canc', 'awrd', 'abd'):
            result['rows'].append(row)
    # A provider ID listed with two different dates/identities in one scan is
    # evidence to retain, not authority to choose one of the two silently.
    identities = {}
    for item in result['records']:
        identities.setdefault(item['match']['id'], set()).add(registry.digest(item['match']))
    ambiguous = {identity for identity, variants in identities.items() if len(variants) > 1}
    if ambiguous:
        result['quarantined'].extend({'id': identity, 'reason': 'conflicting_provider_observations'} for identity in sorted(ambiguous))
        rejected = {registry.row_key(o['row']) for o in result['observations'] if o['provider_id'].split(':')[1] in ambiguous}
        result['observations'] = [o for o in result['observations'] if o['provider_id'].split(':')[1] not in ambiguous]
        result['results'] = [o for o in result['results'] if o['provider_id'].split(':')[1] not in ambiguous]
        result['rows'] = [r for r in result['rows'] if registry.row_key(r) not in rejected]
    return result


def persist(root, batch, stamp):
    """Reapply observations onto latest shards. Corrections append, not replace."""
    check(root)  # Missing/corrupt indexed shards must block, never reset.
    index = registry.read_strict(root/ARCHIVE/'index.json', {'schema': 1, 'matches': {}})
    if index.get('schema') != 1 or not isinstance(index.get('matches'), dict):
        raise ValueError('Corrupt Statarea archive index')
    shards = {}
    for item in batch['records']:
        match, source = item['match'], item['source']
        identity = match['id']
        month = index['matches'].setdefault(identity, match['source_date_utc'][:7])
        if not re.fullmatch(r'\d{4}-\d{2}', month):
            raise ValueError('Invalid Statarea shard identity')
        if month not in shards:
            shards[month] = registry.read_strict(root/ARCHIVE/(month+'.json'), {'schema': 1, 'matches': {}})
        shard = shards[month]
        if shard.get('schema') != 1 or not isinstance(shard.get('matches'), dict):
            raise ValueError('Corrupt Statarea archive shard')
        saved = shard['matches'].setdefault(identity, {'first_observed_utc': stamp,
            'last_observed_utc': stamp, 'current': match, 'observations': {}})
        if not isinstance(saved.get('observations'), dict):
            raise ValueError('Corrupt Statarea match observations')
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


def align_registry(root, batch, book):
    """Keep existing calendar identities, using only reviewed official UEFA IDs.

    Older UEFA fixtures can have a different canonical spelling even though
    official regulation joins already proved both keys. This is a per-match
    ingestion join, never a new compiled/global club alias.
    """
    clubs = registry.read_strict(root/'data/europe_clubs.json', {})
    labels = {}
    for identity, club in clubs.items():
        for name in [club['name'], *club.get('source_names', []), *club.get('calendar_names', [])]:
            labels.setdefault(u.club_key(name), set()).add(identity)
    def official_pair(names):
        pair = [labels.get(u.club_key(n), set()) for n in names]
        return [next(iter(v)) for v in pair] if all(len(v) == 1 for v in pair) else None
    by_key, by_provider, by_date = {}, {}, {}
    for match in book['matches'].values():
        for key in match['legacy_keys']:
            by_key.setdefault(key, {})[match['id']] = match
            parts = key.split('|')
            by_date.setdefault(tuple(parts[:2]), {})[match['id']] = match
        for provider in match['provider_ids']:
            by_provider.setdefault(provider, {})[match['id']] = match
    replacements, accepted, rejected, quarantined = {}, [], set(), list(batch['quarantined'])
    for observation in batch['observations']:
        row = observation['row']
        candidates = {**by_key.get(registry.row_key(row), {}), **by_provider.get(observation['provider_id'], {})}
        incoming_pair = official_pair(row[5:7]) if row[0] in EUROPE else None
        if not candidates and incoming_pair:
            candidates = {i: m for i, m in by_date.get((row[0], row[3]), {}).items()
                          if official_pair(m['schedule'][5:7]) == incoming_pair}
        reason = None
        if len(candidates) > 1:
            reason = 'ambiguous_existing_match'
        elif candidates:
            match = next(iter(candidates.values()))
            if match['division'] != row[0]:
                reason = 'provider_identity_changed'
            elif match['clubs'] != [u.club_key(n) for n in row[5:7]]:
                if incoming_pair and incoming_pair == official_pair(match['schedule'][5:7]):
                    aligned = list(row); aligned[5:7] = match['schedule'][5:7]
                    replacements[registry.digest(row)] = aligned
                    observation = {**observation, 'row': aligned}
                else:
                    reason = 'provider_identity_changed'
            if match.get('result') is not None and match.get('actual_date', match['schedule'][3]) != row[3]:
                reason = 'published_result_date_changed'
        if reason:
            rejected.add(observation['provider_id'])
            quarantined.append({'id': observation['provider_id'].split(':')[1], 'reason': reason})
        else:
            accepted.append(observation)
    allowed = {registry.digest(o['row']) for o in accepted}
    rows = [replacements.get(registry.digest(row), row) for row in batch['rows']]
    return {**batch, 'observations': accepted, 'rows': [r for r in rows if registry.digest(r) in allowed],
            'results': [o for o in batch['results'] if o['provider_id'] not in rejected], 'quarantined': quarantined}


def apply_results(batch, history, book):
    changed, conflicts = [], 0
    for observation in batch['results']:
        row = observation['row']
        key, old = u.key(row), history.get(u.key(row))
        if old is not None and old[7:9] != row[7:9]:
            registry.record_conflict(book, 'statarea_score_conflict', {
                'key': registry.row_key(row), 'provider_id': observation['provider_id'],
                'kept': old, 'incoming': row})
            conflicts += 1
        elif old is None:
            history[key] = row
            changed.append(row)
        # A confirming score must never replace richer CSV statistics/source.
    return changed, conflicts


def check(root):
    seen_names = set()
    for entry in registry.read_strict(root/CROSSWALK, {'schema': 1, 'entries': []})['entries']:
        scoped = (entry['division'], normal(entry['source_name']))
        if entry['division'] not in DIVISIONS or scoped in seen_names:
            raise ValueError('Duplicate/unsupported Statarea club link')
        seen_names.add(scoped)
        validate_name(entry, root)
    index = registry.read_strict(root/ARCHIVE/'index.json', {'schema': 1, 'matches': {}})
    if index.get('schema') != 1 or not isinstance(index.get('matches'), dict):
        raise ValueError('Invalid Statarea index')
    found = {}
    for path in sorted((root/ARCHIVE).glob('????-??.json')) if (root/ARCHIVE).exists() else []:
        shard = registry.read_strict(path, {})
        if shard.get('schema') != 1 or not isinstance(shard.get('matches'), dict):
            raise ValueError('Invalid Statarea shard')
        for identity, saved in shard['matches'].items():
            if identity in found or index['matches'].get(identity) != path.stem:
                raise ValueError('Statarea index/shard disagreement')
            found[identity] = path.stem
            if not saved.get('observations') or saved['first_observed_utc'] > saved['last_observed_utc']:
                raise ValueError('Invalid Statarea observation history')
            for signature, value in saved['observations'].items():
                if signature != registry.digest(value['match']) or value['match']['id'] != identity:
                    raise ValueError('Changed Statarea observation')
            if registry.digest(saved['current']) not in saved['observations']:
                raise ValueError('Unarchived current Statarea observation')
    if found != index.get('matches'):
        raise ValueError('Incomplete Statarea archive index')
    return {'statarea_matches': len(found), 'shards': len(set(found.values()))}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', required=True)
    parser.parse_args()
    print(json.dumps(check(u.ROOT)))
