"""Official UEFA regulation-time archive, isolated from domestic model inputs."""
import collections
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as u
from club_identity import club_key, normal
from provider_clubs import ENTRIES
from match_registry import digest, row_key, read_strict

FEEDS = {'UCL': ('1', 'UEFA Champions League'), 'UEL': ('14', 'UEFA Europa League'),
         'UECL': ('2019', 'UEFA Conference League')}
DIRECTORY = 'data/europe'
VIEW = 'docs/data/europe_history.json'
REPORT = 'docs/data/europe_coverage.json'
CLUBS = 'data/europe_clubs.json'
PAGE_SIZE = 200
CALENDAR_ALIASES = json.loads((Path(__file__).resolve().parents[1]/'data/europe_calendar_aliases.json').read_text())['entries']


def club_labels(club):
    return [club['name'], *club['source_names'], *club.get('calendar_names', [])]


def season_year(today):
    return today.year+1 if today.month >= 6 else today.year


def url_for(division, year, offset=0):
    return (f'https://match.uefa.com/v5/matches?competitionId={FEEDS[division][0]}'
            f'&seasonYear={year}&limit={PAGE_SIZE}&offset={offset}&order=ASC')


def score_pair(value):
    if not isinstance(value, dict): return None
    pair = [value.get('home'), value.get('away')]
    return pair if all(type(n) is int and 0 <= n <= 30 for n in pair) else None


def labels(team):
    translations = team.get('translations') or {}
    return list(dict.fromkeys(str(v).strip() for v in [team.get('internationalName'),
        *[(translations.get(k) or {}).get('EN') for k in ('displayName', 'shortName', 'displayOfficialName')]] if v))


def choose_clubs(games, domestic, fixtures, existing=None):
    """Stable official IDs; only exact reviewed labels join existing club histories."""
    clubs = dict(existing or {})
    available, countries, domestic_keys = {}, {}, set()
    for row in domestic:
        domestic_keys.update(club_key(n) for n in row[5:7])
    for row in [*domestic, *fixtures]:
        for name in row[5:7]:
            available.setdefault(club_key(name), name)
            if row[0] not in FEEDS: countries.setdefault(club_key(name), set()).add(normal(row[1]))
    reviewed = {}
    for e in ENTRIES:
        for name in [e['source_name'], *e.get('source_names', [])]:
            reviewed.setdefault(normal(name), set()).add((e['target'], normal(u.LEAGUES[e['division']][0])))
    teams, all_names = {}, collections.defaultdict(set)
    # Newest source labels are preferred when initializing an unseen official ID.
    for game in sorted(games, key=lambda g: str(g.get('seasonYear', ''))):
        for side in ('homeTeam', 'awayTeam'):
            team = game.get(side) or {}
            if team.get('id') and not team.get('isPlaceHolder'):
                teams[str(team['id'])] = team
                all_names[str(team['id'])].update(labels(team))
    for identity, team in teams.items():
        names = list(dict.fromkeys([*labels(team), *sorted(all_names[identity])]))
        if not names: continue
        country_name = normal(((team.get('translations') or {}).get('countryName') or {}).get('EN'))
        country_name = {'turkiye': 'turkey'}.get(country_name, country_name)
        candidates = {available[club_key(n)] for n in names if club_key(n) in available and
                      (not countries.get(club_key(n)) or country_name in countries[club_key(n)])}
        candidates = {n for n in candidates if club_key(n) in domestic_keys} or candidates
        candidate_keys = {club_key(n) for n in candidates}
        if not candidates:
            candidates = {target for name in names for target, country in reviewed.get(normal(name), set()) if country == country_name}
            candidate_keys = {club_key(n) for n in candidates}
        if len(candidate_keys) > 1:
            raise ValueError('Ambiguous reviewed UEFA club identity: '+identity)
        selected = next(iter(candidates), names[0])
        previous = clubs.get(identity)
        if previous:
            if previous['country'] != team.get('countryCode'):
                raise ValueError('Official club country changed: '+identity)
            selected = previous['name']
        clubs[identity] = {'name': selected, 'country': team.get('countryCode'),
                           'source_names': sorted(set(names+(previous or {}).get('source_names', []))),
                           'resolution': (previous or {}).get('resolution') or ('exact_reviewed_label' if candidates else 'official_club_id')}
    for entry in CALENDAR_ALIASES:
        if entry['official_club_id'] in clubs:
            clubs[entry['official_club_id']]['calendar_names'] = [entry['calendar_label']]
    collisions = collections.defaultdict(list)
    for identity, club in clubs.items(): collisions[club_key(club['name'])].append(identity)
    for key, identities in collisions.items():
        if len(identities) < 2: continue
        for identity in identities:
            club = clubs[identity]
            if club['resolution'] == 'official_club_id':
                club['name'] += ' ('+str(club['country'])+')'
                club['resolution'] = 'official_club_id_country_disambiguated'
        if len({club_key(clubs[i]['name']) for i in identities}) != len(identities):
            raise ValueError('Unresolved homonymous official club IDs: '+key)
    return clubs


def event_regulation(game, total):
    """Only a complete, score-balanced official goal timeline can arbitrate 90 minutes."""
    events = (game.get('playerEvents') or {}).get('scorers')
    if total is None or not isinstance(events, list) or len(events) != sum(total): return None
    teams = [str((game.get(side) or {}).get('id')) for side in ('homeTeam', 'awayTeam')]
    all_goals, regulation = [0, 0], [0, 0]
    for event in events:
        identity, phase = str(event.get('teamId')), event.get('phase')
        if identity not in teams or phase not in ('FIRST_HALF', 'SECOND_HALF', 'EXTRA_TIME_FIRST_HALF', 'EXTRA_TIME_SECOND_HALF'): return None
        if event.get('goalType') not in ('OWN', 'SCORED', 'PENALTY'): return None
        side = teams.index(identity)
        if event.get('goalType') == 'OWN': side = 1-side
        all_goals[side] += 1
        if phase in ('FIRST_HALF', 'SECOND_HALF'): regulation[side] += 1
    return regulation if all_goals == total else None


def parse_match(game, division, year, clubs, now, source):
    expected = FEEDS[division][0]
    if str((game.get('competition') or {}).get('id')) != expected or str(game.get('seasonYear')) != str(year):
        raise ValueError('Wrong UEFA competition or season')
    if not game.get('id'): raise ValueError('Missing official match ID')
    home, away = game.get('homeTeam') or {}, game.get('awayTeam') or {}
    if not home.get('id') or not away.get('id') or home.get('isPlaceHolder') or away.get('isPlaceHolder'):
        return None
    hid, aid = str(home['id']), str(away['id'])
    if hid == aid or hid not in clubs or aid not in clubs:
        raise ValueError('Invalid UEFA club IDs')
    status = game.get('status')
    if status not in ('FINISHED', 'CANCELED', 'CANCELLED', 'ABANDONED'): return None
    time = (game.get('kickOffTime') or {}).get('dateTime')
    kickoff = None
    try:
        kickoff = dt.datetime.fromisoformat(str(time).replace('Z', '+00:00'))
        if kickoff.tzinfo is None: kickoff = None
    except (ValueError, TypeError): pass
    date = kickoff.astimezone(ZoneInfo('Europe/Sofia')).date() if kickoff else dt.date.fromisoformat((game.get('kickOffTime') or {}).get('date', ''))
    if not dt.date(year-1, 6, 1) <= date < dt.date(year, 7, 1):
        raise ValueError('UEFA kickoff outside requested season')
    local = kickoff.astimezone(ZoneInfo('Europe/Sofia')) if kickoff else None
    if date > u.today_sofia(now) or kickoff and kickoff >= now: raise ValueError('Future UEFA result')
    scores = game.get('score') or {}
    regular, total = score_pair(scores.get('regular')), score_pair(scores.get('total'))
    shootout, aggregate = score_pair(scores.get('penalty')), score_pair(scores.get('aggregate'))
    winner = game.get('winner') or {}
    match_reason = (winner.get('match') or {}).get('reason')
    aggregate_reason = (winner.get('aggregate') or {}).get('reason')
    administrative = status != 'FINISHED' or any(t in str(match_reason).upper() for t in ('AWARD', 'FORFEIT', 'WALKOVER', 'ABANDON'))
    resolution = None
    timeline = event_regulation(game, total) if not administrative else None
    if timeline is not None and regular is not None and timeline != regular:
        resolution = {'method': 'complete_official_goal_events', 'reported_regulation': regular,
                      'verified_regulation': timeline, 'timeline_total': total,
                      'goal_events': [{'team_id': str(g['teamId']), 'goal_type': g['goalType'], 'phase': g['phase'], 'time': g.get('time')} for g in game['playerEvents']['scorers']]}
        regular = timeline
    if status == 'FINISHED' and not administrative and (regular is None or total is None):
        raise ValueError('Finished UEFA match lacks explicit regulation/total scores')
    if regular is not None and total is not None and any(t < r for t, r in zip(total, regular)):
        raise ValueError('UEFA final score is below its regulation score')
    # Aggregate decisions can be attached to BOTH legs. They do not establish
    # extra time in the first leg. Keep original score types instead of guessing.
    extra = [t-r for t, r in zip(total, regular)] if not administrative and regular is not None and total is not None and total != regular else None
    row = [division, 'Europe', FEEDS[division][1], date.isoformat(), local.strftime('%H:%M') if local else '',
           clubs[hid]['name'], clubs[aid]['name'], *(regular or [None, None]), None, None, None, None]
    round_data = game.get('round') or {}
    record = {'id': 'UEFA:'+str(game['id']), 'division': division, 'season': f'{year-1}/{str(year)[2:]}',
              'home_id': hid, 'away_id': aid, 'home': row[5], 'away': row[6],
              'date': row[3], 'kickoff_utc': kickoff.astimezone(dt.timezone.utc).isoformat(timespec='seconds') if kickoff else None,
              'status': status, 'phase': game.get('competitionPhase'), 'round': (round_data.get('metaData') or {}).get('name'),
              'round_mode': round_data.get('mode'), 'leg_type': game.get('type'),
              'scores': {'regulation': regular if not administrative else None, 'after_play': total if not administrative else None, 'extra_time_goals': extra,
                         'penalties': shootout, 'aggregate': aggregate, 'administrative': total if administrative else None,
                         'reported_regulation': regular if administrative else None},
              'decision': {'match': match_reason, 'aggregate': aggregate_reason},
              'administrative': administrative, 'analysis_eligible': not administrative and regular is not None,
              'source': source, 'score_resolution': resolution}
    return record


def view_row(record):
    if not record['analysis_eligible']: return None
    local = dt.datetime.fromisoformat(record['kickoff_utc']).astimezone(ZoneInfo('Europe/Sofia')) if record['kickoff_utc'] else None
    return [record['division'], 'Europe', FEEDS[record['division']][1], record['date'], local.strftime('%H:%M') if local else '',
            record['home'], record['away'], *record['scores']['regulation'], None, None, None, None,
            {'SRC': 'UEFA/'+record['id'], 'PHASE': record['phase'], 'ROUND': record['round'],
             'AFTER_PLAY': record['scores']['after_play'], 'PENALTIES': record['scores']['penalties']}]


def collect(download, root, now, full=False):
    current = season_year(u.today_sofia(now))
    years = range(2022, current+1) if full else [current]
    tasks = [(division, year) for division in FEEDS for year in years]
    def one(task):
        division, year = task
        games, receipts, seen = [], [], set()
        try:
            for page in range(12):
                url = url_for(division, year, page*PAGE_SIZE)
                raw = download(url)
                data = json.loads(raw.decode('utf-8-sig'))
                if not isinstance(data, list): raise ValueError('UEFA response is not a list')
                if not data and not games: raise ValueError('UEFA season is empty')
                receipts.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'rows': len(data)})
                for game in data:
                    identity = str(game.get('id'))
                    if identity in seen: raise ValueError('Duplicate UEFA pagination; refusing a truncated archive')
                    seen.add(identity);game['_mp_source'] = receipts[-1];games.append(game)
                if len(data) < PAGE_SIZE: break
            else: raise ValueError('UEFA pagination did not terminate')
            return division, year, games, receipts, None
        except Exception as error:
            return division, year, [], receipts, f'{division}/{year}: {type(error).__name__}: {error}'
    groups = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        groups = list(pool.map(one, tasks))
    domestic = u.readjson(root/'docs/data/history.json', [])
    fixtures = u.readjson(root/'docs/data/fixtures.json', [])
    clubs = choose_clubs([g for _,_,games,_,_ in groups for g in games], domestic, fixtures, read_strict(root/CLUBS, {}))
    out = {'groups': [], 'clubs': clubs, 'errors': [], 'schedule': []}
    for division, year, games, receipts, error in groups:
        if error: out['errors'].append(error);continue
        if year == current:
            for game in games:
                home, away = game.get('homeTeam') or {}, game.get('awayTeam') or {}
                if str(home.get('id')) in clubs and str(away.get('id')) in clubs:
                    date = str((game.get('kickOffTime') or {}).get('date', ''))
                    if date:
                        out['schedule'].append({'division': division, 'date': date, 'home_id': str(home['id']), 'away_id': str(away['id']), 'id': 'UEFA:'+str(game['id'])})
        try:
            records = []
            existing_records = read_strict(root/DIRECTORY/division/f'{year}.json', {}).get('matches', {})
            for game in games:
                # Placeholder shells have no competition identity or clubs.
                if not game.get('competition') and not game.get('homeTeam'): continue
                record = parse_match(game, division, year, clubs, now, game['_mp_source'])
                if record:
                    # Fingerprints make retries preserve a concurrently revised record.
                    record['base_sha256'] = digest(existing_records.get(record['id']))
                    records.append(record)
            expected = (125 if division == 'UCL' else 141) if year <= 2024 else (153 if division == 'UECL' else 189)
            main = sum(r['phase'] == 'TOURNAMENT' for r in records)
            out['groups'].append({'division': division, 'season_year': year, 'records': records, 'receipts': receipts,
                'main_records': main, 'closed_expected_main': expected if year < current else None,
                'coverage': 'current_season' if year == current else 'complete_main' if main == expected else 'needs_review'})
        except Exception as error:
            out['errors'].append(f'{division}/{year}: {type(error).__name__}: {error}')
    return out


def apply(root, batch, book, stamp):
    """Merge official IDs without replacing a published score; export only 90 minutes."""
    if batch is None:
        return u.readjson(root/VIEW, []), {}, None
    clubs = read_strict(root/CLUBS, {})
    for identity, fresh in batch['clubs'].items():
        old = clubs.get(identity)
        if old and (old['name'], old['country']) != (fresh['name'], fresh['country']):
            raise ValueError('UEFA club mapping changed after collection: '+identity)
        clubs[identity] = {**fresh, 'source_names': sorted(set(fresh['source_names']+(old or {}).get('source_names', [])))}
    u.writejson(root/CLUBS, clubs)
    u.writejson(root/'data/europe_schedule.json', batch.get('schedule', []))
    checks, changed, conflicts = [], 0, 0
    for group in batch['groups']:
        if group['division'] not in FEEDS or type(group['season_year']) is not int or not 2022 <= group['season_year'] <= season_year(u.today_sofia()):
            raise ValueError('Invalid UEFA shard identity')
        path = root/DIRECTORY/group['division']/f"{group['season_year']}.json"
        shard = read_strict(path, {'schema': 1, 'division': group['division'], 'season_year': group['season_year'], 'matches': {}})
        if shard.get('schema') != 1 or shard.get('division') != group['division'] or shard.get('season_year') != group['season_year'] or not isinstance(shard.get('matches'), dict):
            raise ValueError('Corrupt UEFA archive: '+str(path))
        for record in group['records']:
            old = shard['matches'].get(record['id'])
            meaningful = lambda r: {k:v for k,v in r.items() if k not in ('source', 'base_sha256')}
            fresh = {k:v for k,v in record.items() if k != 'base_sha256'}
            if old and meaningful(old) == meaningful(fresh): continue
            if old and (old['scores'] != fresh['scores'] or old['analysis_eligible'] != fresh['analysis_eligible'] or
                        (old['home_id'], old['away_id'], old['date']) != (fresh['home_id'], fresh['away_id'], fresh['date'])):
                import match_registry as registry
                registry.record_conflict(book, 'uefa_record_conflict', {'id': record['id'], 'kept': old, 'incoming': fresh})
                conflicts += 1;continue
            if old and digest(old) != record.get('base_sha256'): continue
            shard['matches'][record['id']] = fresh;changed += 1
        shard.update(checked_utc=max(stamp, shard.get('checked_utc', '')), receipts=group['receipts'], coverage=group['coverage'], closed_expected_main=group['closed_expected_main'])
        u.writejson(path, shard)
        checks.append({'division': group['division'], 'season_year': group['season_year'], 'coverage': group['coverage']})
    all_records, coverage = [], []
    for path in sorted((root/DIRECTORY).glob('*/*.json')):
        shard = read_strict(path, {})
        if not isinstance(shard, dict) or shard.get('schema') != 1 or not isinstance(shard.get('matches'), dict):
            raise ValueError('Corrupt UEFA archive: '+str(path))
        records = list(shard['matches'].values());all_records.extend(records)
        coverage.append({'division': shard['division'], 'season_year': shard['season_year'], 'records': len(records),
            'regulation_results': sum(r['analysis_eligible'] for r in records),
            'main_records': sum(r['phase'] == 'TOURNAMENT' for r in records),
            'qualifying_records': sum(r['phase'] == 'QUALIFYING' for r in records),
            'administrative_excluded': sum(r['administrative'] for r in records),
            'extra_time_score_differs': sum(r['scores']['extra_time_goals'] is not None for r in records),
            'shootouts': sum(r['scores']['penalties'] is not None for r in records),
            'regulation_fields_corrected_from_complete_timeline': sum(r.get('score_resolution') is not None for r in records),
            'closed_expected_main': shard.get('closed_expected_main'), 'coverage': shard['coverage'], 'checked_utc': shard['checked_utc']})
    rows = sorted([r for r in map(view_row, all_records) if r], key=lambda r:(r[3], r[0], r[5], r[6]))
    if len({row_key(r) for r in rows}) != len(rows): raise ValueError('Duplicate UEFA regulation view keys')
    report = {'schema': 1, 'checked_utc': max([stamp, *[c['checked_utc'] for c in coverage]]), 'provider': 'UEFA official match service',
              'regulation_results': len(rows), 'records': len(all_records), 'seasons': coverage,
              'errors': batch['errors'], 'conflicts_this_patch': conflicts,
              'scope': 'Main phase and available qualifiers. Administrative matches excluded. Scores are after 90 minutes; domestic model inputs remain separate.'}
    u.writejson(root/VIEW, rows);u.writejson(root/REPORT, report)
    return rows, clubs, {'changed': changed, 'conflicts': conflicts, 'checks': checks, 'errors': batch['errors'],
                         'complete': bool(checks) and not batch['errors'] and not conflicts and all(c['coverage'] != 'needs_review' for c in checks)}


def registry_aliases(book, rows, clubs, stamp):
    """Keep the oldest calendar identity when both official club labels prove a join."""
    import match_registry as registry
    aliases, observations = {}, []
    by_day = collections.defaultdict(list)
    for identity, match in list(book['matches'].items()):
        if match['division'] in FEEDS:
            for key in match['legacy_keys']:
                parts = key.split('|')
                if len(parts) == 4: by_day[tuple(parts[:2])].append((identity, key, parts[2:]))
    labels_by_name = {}
    for club in clubs.values():
        labels_by_name.setdefault(club_key(club['name']), set()).update(club_key(n) for n in club_labels(club))
    for row in rows:
        actual = row_key(row)
        home = labels_by_name.get(club_key(row[5]), {club_key(row[5])})
        away = labels_by_name.get(club_key(row[6]), {club_key(row[6])})
        candidates = {}
        for identity, old_key, pair in by_day[(row[0], row[3])]:
            if identity in book['matches'] and pair[0] in home and pair[1] in away:
                if old_key in aliases and aliases[old_key] != actual:
                    raise ValueError('Ambiguous UEFA calendar identity')
                aliases[old_key] = actual
                candidates[identity] = book['matches'][identity]
        provider = row[13]['SRC'].removeprefix('UEFA/')
        if not candidates:
            observations.append({'row': row, 'provider_id': provider, 'phase': row[13]['PHASE'], 'round': row[13]['ROUND']})
            continue
        ordered = sorted(candidates.values(), key=lambda m:(m['first_seen_utc'], m['id']))
        kept = ordered[0]
        if any(m.get('result') not in (None, row[7:9]) for m in ordered):
            raise ValueError('Conflicting scores on verified UEFA identity join')
        for retired in ordered[1:]:
            kept['legacy_keys'] = sorted(set(kept['legacy_keys']+retired['legacy_keys']))
            kept['provider_ids'] = sorted(set(kept['provider_ids']+retired['provider_ids']))
            kept['merged_ids'] = sorted(set(kept.get('merged_ids', [])+[retired['id']]+retired.get('merged_ids', [])))
            del book['matches'][retired['id']]
        kept['legacy_keys'] = sorted(set(kept['legacy_keys']+[actual]))
        kept['provider_ids'] = sorted(set(kept['provider_ids']+[provider]))
        kept['last_seen_utc'] = max(kept['last_seen_utc'], stamp)
    registry.observe(book, observations, stamp)
    return aliases


def fixture_names(root, fixtures, clubs):
    by_date = collections.defaultdict(list)
    for game in read_strict(root/'data/europe_schedule.json', []):
        by_date[(game['division'], game['date'])].append(game)
    out = {}
    for row in fixtures:
        if row[0] not in FEEDS: continue
        candidates = []
        for game in by_date[(row[0], row[3])]:
            home, away = clubs[game['home_id']], clubs[game['away_id']]
            if all(club_key(row[i]) in {club_key(n) for n in club_labels(club)} for i,club in ((5,home),(6,away))):
                candidates.append({'home': home['name'], 'away': away['name'], 'provider_id': game['id']})
        if len(candidates) == 1: out[row_key(row)] = candidates[0]
        elif len(candidates) > 1: raise ValueError('Ambiguous official UEFA fixture names')
    u.writejson(root/'docs/data/europe_fixture_names.json', out)
    return out


def check(root):
    exported, identities = [], set()
    for path in sorted((root/DIRECTORY).glob('*/*.json')):
        shard = read_strict(path, {})
        if shard.get('schema') != 1 or shard.get('division') not in FEEDS or not isinstance(shard.get('matches'), dict):
            raise ValueError('Corrupt UEFA archive: '+str(path))
        for identity, record in shard['matches'].items():
            if identity != record['id'] or identity in identities or record['division'] != shard['division']:
                raise ValueError('Duplicate or wrong official UEFA ID')
            identities.add(identity)
            if record['analysis_eligible']:
                score = record['scores']['regulation']
                if record['administrative'] or not isinstance(score,list) or len(score) != 2 or not all(type(v) is int and 0 <= v <= 30 for v in score):
                    raise ValueError('Ineligible UEFA result entered analysis')
                exported.append(view_row(record))
    exported.sort(key=lambda r:(r[3], r[0], r[5], r[6]))
    if exported != read_strict(root/VIEW, []): raise ValueError('UEFA view does not match its regulation archive')
    if len({row_key(r) for r in exported}) != len(exported): raise ValueError('Duplicate UEFA view key')
    return {'official_records':len(identities),'regulation_results':len(exported),'ok':True}


def reconcile_administrative(root, book, clubs):
    """An explicit UEFA cancellation voids a pending fixture, never invents a score."""
    by_date = collections.defaultdict(list)
    for match in book['matches'].values():
        if match['division'] in FEEDS:
            for key in match['legacy_keys']:
                parts = key.split('|')
                if len(parts) == 4: by_date[tuple(parts[:2])].append((match, parts[2:]))
    for path in (root/DIRECTORY).glob('*/*.json'):
        for record in read_strict(path, {}).get('matches', {}).values():
            if not record['administrative']: continue
            labels = [{club_key(n) for n in club_labels(clubs[record[side+'_id']])} for side in ('home', 'away')]
            for match, pair in by_date[(record['division'], record['date'])]:
                if pair[0] in labels[0] and pair[1] in labels[1] and match['result'] is None:
                    match['state'] = 'cancelled'
                    match['administrative_record'] = record['id']


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser();parser.add_argument('--check',action='store_true',required=True);parser.add_argument('--root',type=Path,default=u.ROOT)
    print(json.dumps(check(parser.parse_args().root)))
