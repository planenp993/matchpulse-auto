"""Verified recent domestic full-time scores while primary CSVs catch up."""
import datetime as dt
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
import update as u
from fixtures_espn import read_board
from fixtures_official import pol_props, sfl_page, SFL_HOME, SFL_RPC, SFL_ACCOUNT, instant
from provider_clubs import resolve
from match_registry import row_key, digest, read_strict
import urllib.parse
from zoneinfo import ZoneInfo

ESPN = {'NOR': 'nor.1', 'SWE': 'swe.1', 'DNK': 'den.1', 'AUT': 'aut.1'}
PROVENANCE = 'data/result_provenance.json'


def pair(a, b):
    values = [u.goals(a), u.goals(b)]
    return values if all(v is not None for v in values) else None


def collect(download, history, now):
    today = u.today_sofia(now)
    known = {div: {u.club_key(n) for r in history if r[0] == div for n in r[5:7]} for div in u.EXTRA}
    latest = {div: max((r[3] for r in history if r[0] == div), default=(today-dt.timedelta(days=28)).isoformat()) for div in u.EXTRA}
    since = {div: max(today-dt.timedelta(days=28), min(today-dt.timedelta(days=7), dt.date.fromisoformat(latest[div])-dt.timedelta(days=3))) for div in u.EXTRA}

    def one(div):
        rows, receipts, skipped = [], [], []
        def get(url, **kwargs):
            raw = download(url, **kwargs)
            receipts.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
            return raw
        def add(provider, identity, kickoff, home_id, home, away_id, away, score, source):
            local = kickoff.astimezone(ZoneInfo('Europe/Sofia'))
            if not since[div] <= local.date() <= today: return
            if kickoff > now-dt.timedelta(hours=2): return
            h, a = resolve(div, provider, home_id, home), resolve(div, provider, away_id, away)
            if u.club_key(h) not in known[div] or u.club_key(a) not in known[div] or u.club_key(h) == u.club_key(a):
                skipped.append({'provider_id': identity, 'reason': 'unmatched_club', 'home': h, 'away': a});return
            row = [div, *u.LEAGUES[div], local.date().isoformat(), local.strftime('%H:%M'), h, a, *score,
                   None, None, None, None, {'SRC': 'result-bridge/'+provider, 'PROVIDER_ID': identity}]
            rows.append({'row': row, 'provider_id': identity, 'kickoff_utc': kickoff.astimezone(dt.timezone.utc).isoformat(timespec='seconds'), 'source': source})
        try:
            if div in ESPN:
                slug = ESPN[div]
                board = read_board(get, slug, today.isoformat())
                league = next(x for x in board['leagues'] if x['slug'] == slug)
                if league.get('calendarEndDate') and str(league['calendarEndDate'])[:10] < today.isoformat():
                    raise ValueError('Expired ESPN season')
                if league.get('calendarType') != 'day' or league.get('calendarIsWhitelist') is not True or not isinstance(league.get('calendar'), list):
                    raise ValueError('No authoritative recent match calendar')
                days = sorted({x[:10] for x in league['calendar'] if since[div].isoformat() <= x[:10] <= today.isoformat()})
                boards = [(board, receipts[-1])]
                for day in days:
                    if day != today.isoformat(): boards.append((read_board(get, slug, day), receipts[-1]))
                seen = set()
                for board, source in boards:
                    for event in board['events']:
                        for game in event.get('competitions', []):
                            status = game.get('status', event.get('status', {}))
                            terminal = status.get('type') or {}
                            if terminal.get('state') != 'post' or terminal.get('completed') is not True or terminal.get('name') != 'STATUS_FULL_TIME' or status.get('period') != 2: continue
                            if game.get('format', {}).get('regulation', {}).get('periods', 2) != 2: continue
                            identity = 'ESPN:'+slug+':'+str(game.get('id') or event.get('id'))
                            if identity in seen: continue
                            seen.add(identity)
                            sides = {s.get('homeAway'): s for s in game.get('competitors', [])}
                            if set(sides) != {'home', 'away'}: continue
                            home, away = sides['home'], sides['away']
                            score = pair(home.get('score'), away.get('score'))
                            kickoff = instant(game.get('date', event.get('date')))
                            if score is None or kickoff is None or home.get('shootoutScore') is not None or away.get('shootoutScore') is not None: continue
                            add('ESPN', identity, kickoff, home['team'].get('id'), home['team'].get('displayName'), away['team'].get('id'), away['team'].get('displayName'), score, source)
            elif div == 'POL':
                start = today.year if today.month >= 7 else today.year-1
                slug = f'{start}-{start+1}';base = f'https://ekstraklasa.org/terminarz/{slug}/'
                root = pol_props(get(base), slug);rounds = {int(x['number']): x['slug'] for x in root['rounds']}
                first = root['weekNumber'];games = {}
                for number in range(first, max(0, first-7), -1):
                    if number not in rounds: raise ValueError('Missing recent official round')
                    page = root if number == first else pol_props(get(base+rounds[number]+'/'), slug)
                    source = receipts[-1]
                    if page['weekNumber'] != number: raise ValueError('Wrong recent Polish round')
                    for game in page['enrichedMatches']+page['enrichedPostponedMatches']:
                        if game.get('matchId'): games[game['matchId']] = (game, source)
                    dates = [dt.date.fromisoformat(g['date']) for g in page['enrichedMatches'] if g.get('date')]
                    if dates and max(dates) < since[div]: break
                for identity, (game, source) in games.items():
                    if game.get('status') != 'played' or game.get('showsScore') is not True or game.get('stage') != 'Regular Season': continue
                    score = pair(game.get('homeScore'), game.get('awayScore'))
                    kickoff = instant(game.get('postponedDatetime') if game.get('postponed') else game.get('matchDatetime'))
                    if score is None or kickoff is None: continue
                    home, away = game['homeTeam'], game['awayTeam']
                    add('Ekstraklasa', 'Ekstraklasa:'+identity, kickoff, home['id'], home['name'], away['id'], away['name'], score, source)
            else:
                competition, season, internal = sfl_page(get(SFL_HOME), today)
                params = {'matchDay': '', 'language': 'de', 'competitionProviderId': competition, 'seasonProviderId': season}
                url = SFL_RPC+'?input='+urllib.parse.quote(json.dumps(params, separators=(',', ':')))
                data = json.loads(get(url, headers={'x-account-key': SFL_ACCOUNT}).decode('utf-8-sig')).get('result', {}).get('data')
                if not isinstance(data, list) or not data: raise ValueError('Missing recent Swiss results')
                if any(g.get('competitionId') != internal for g in data): raise ValueError('Wrong Swiss competition')
                source = receipts[-1]
                for game in data:
                    if game.get('gameStatus') != 'post-game' or game.get('periodId') != 14 or game.get('periodLength') != 45 or game.get('stage') not in ('Reguläre Saison', 'Regular Season'): continue
                    score = pair(game.get('homeScore'), game.get('awayScore'))
                    kickoff = instant(str(game.get('date', ''))[:10]+'T'+str(game.get('time', '')))
                    if score is None or kickoff is None: continue
                    add('SwissFootballLeague', 'SwissFootballLeague:'+str(game['providerId']), kickoff, game['homeTeamProviderId'], game['homeTeamName'], game['awayTeamProviderId'], game['awayTeamName'], score, source)
            unique = {}
            for record in rows:
                key = row_key(record['row'])
                if key in unique and unique[key]['row'][7:9] != record['row'][7:9]: raise ValueError('Conflicting duplicate recent result')
                unique[key] = record
            return div, list(unique.values()), {'status': 'ok', 'records': len(unique), 'requests': len(receipts), 'since': since[div].isoformat(), 'receipts': receipts, 'quarantined': skipped}, None
        except Exception as error:
            return div, [], {'status': 'error', 'requests': len(receipts), 'error': f'{type(error).__name__}: {error}'}, f'{div}: {type(error).__name__}: {error}'
    result = {'records': [], 'checks': {}, 'errors': []}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for div, rows, check, error in pool.map(one, u.EXTRA):
            result['checks'][div] = check
            if error: result['errors'].append(error)
            else: result['records'].extend(rows)
    return result


def apply(root, batch, history, book, stamp):
    import match_registry as registry
    evidence = read_strict(root/PROVENANCE, {'schema': 1, 'matches': {}})
    if evidence.get('schema') != 1 or not isinstance(evidence.get('matches'), dict):
        raise ValueError('Corrupt result provenance')
    changed, conflicts, accepted = [], 0, []
    for record in batch['records']:
        row = record['row'];key = u.key(row);old = history.get(key)
        if old and old[7:9] != row[7:9]:
            registry.record_conflict(book, 'result_bridge_score_conflict', {'key': row_key(row), 'kept': old, 'incoming': row})
            conflicts += 1;continue
        if old is None:
            history[key] = row;changed.append(row)
        accepted.append(record)
        semantic = {'key': row_key(row), 'provider_id': record['provider_id'], 'regulation': row[7:9]}
        evidence['matches'].setdefault(digest(semantic), {**semantic, 'first_observed_utc': stamp, 'source': record['source']})
    registry.observe(book, accepted, stamp)
    u.writejson(root/PROVENANCE, evidence)
    return changed, conflicts
