"""Official domestic calendars. Parse public structured data, never infer scores."""
import datetime as dt
import json
import re
import urllib.parse
from zoneinfo import ZoneInfo
from provider_clubs import resolve

FEEDS = {'POL': 'Ekstraklasa', 'SWZ': 'SwissFootballLeague'}
SFL_HOME = 'https://sfl.ch/de/calendar/spielplan-superleague'
SFL_RPC = 'https://origins-webex-orchestrator.origins-digital.com/trpc/matchDays.getEvents'
# Public site/tenant identifier used by the official anonymous web client.
SFL_ACCOUNT = 'Os-hXumIK'


def season_start(today):
    return today.year if today.month >= 7 else today.year-1


def pol_props(raw, expected_season):
    text = raw.decode('utf-8-sig')
    decoder, fragments = json.JSONDecoder(), []
    for match in re.finditer(r'self\.__next_f\.push\(', text):
        try:
            value, _ = decoder.raw_decode(text, match.end())
        except ValueError:
            continue
        if isinstance(value, list) and len(value) > 1 and isinstance(value[1], str):
            fragments.append(value[1])
    found = []
    def walk(value):
        if isinstance(value, dict):
            if {'enrichedMatches', 'enrichedPostponedMatches', 'weekNumber', 'seasonSlug', 'rounds'} <= value.keys():
                found.append(value)
            for child in value.values(): walk(child)
        elif isinstance(value, list):
            for child in value: walk(child)
    for line in ''.join(fragments).splitlines():
        match = re.match(r'^[0-9a-f]+:(.*)$', line)
        if match:
            try: walk(json.loads(match[1]))
            except ValueError: continue
    if len(found) != 1 or found[0]['seasonSlug'] != expected_season:
        raise ValueError('Official Polish season/calendar identity is missing or stale')
    props = found[0]
    if not isinstance(props['enrichedMatches'], list) or not isinstance(props['enrichedPostponedMatches'], list):
        raise ValueError('Invalid Polish calendar lists')
    return props


def instant(value):
    if not value: return None
    try:
        value = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return value if value.tzinfo else None
    except ValueError:
        return None


def collect_pol(download, metadata, now, end, observer=None):
    start = season_start(now.date())
    slug = f'{start}-{start+1}'
    base = f'https://ekstraklasa.org/terminarz/{slug}/'
    root = pol_props(download(base), slug)
    rounds = {int(x['number']): x['slug'] for x in root['rounds']}
    first = root['weekNumber']
    if type(first) is not int or first not in rounds or any(not re.fullmatch(r'kolejka-\d+', x) for x in rounds.values()):
        raise ValueError('Invalid official round index')
    games, reached = {}, False
    # Only advertised rounds, stop after proving the calendar extends past the
    # horizon. A failed page invalidates this league, preserving its prior view.
    for number in range(first, min(max(rounds), first+7)+1):
        if number not in rounds: raise ValueError('Missing official round')
        page = root if number == first else pol_props(download(base+rounds[number]+'/'), slug)
        if page['weekNumber'] != number: raise ValueError('Official round response mismatch')
        for game in page['enrichedMatches']+page['enrichedPostponedMatches']:
            if game.get('matchId'): games[game['matchId']] = game
        dates = [dt.date.fromisoformat(g['date']) for g in page['enrichedMatches'] if g.get('date')]
        if dates and min(dates) > end:
            reached = True
            break
        if number == max(rounds): reached = True
    if not reached: raise ValueError('Could not verify the full requested Polish horizon')
    rows = []
    for identity, game in games.items():
        if game.get('status') != 'fixture' or game.get('showsScore') is not False: continue
        moved = game.get('postponed') is True
        kickoff = instant(game.get('postponedDatetime') if moved else game.get('matchDatetime'))
        if not kickoff: continue  # Round weekend placeholders are not confirmed dates.
        local = kickoff.astimezone(now.tzinfo)
        if not now.date() <= local.date() <= end: continue
        time_known = bool(game.get('postponedLocalTime') if moved else game.get('localTime'))
        # Source uses midnight when a rescheduled hour has not been announced.
        if moved and local.hour == 1 and kickoff.hour == 0: time_known = False
        home, away = game.get('homeTeam', {}), game.get('awayTeam', {})
        if not home.get('name') or not away.get('name') or home.get('id') == away.get('id'): continue
        row = ['POL', *metadata, local.date().isoformat(), local.strftime('%H:%M') if time_known else '',
               resolve('POL', 'Ekstraklasa', home.get('id'), home['name']),
               resolve('POL', 'Ekstraklasa', away.get('id'), away['name']),
               None, None, None, None, None, None, 'Ekstraklasa / UTC→Europe-Sofia'+('' if time_known else '; kickoff unconfirmed')]
        if observer: observer({'row': row, 'provider_id': 'Ekstraklasa:'+identity, 'phase': game.get('stage'), 'round': game.get('week'), 'status': 'scheduled'})
        if not time_known or local >= now: rows.append(row)
    return sorted(rows, key=lambda r: (r[3], r[4], r[5]))


def sfl_page(raw, today):
    text = raw.decode('utf-8-sig')
    match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', text, re.S)
    if not match: raise ValueError('Missing official SFL page metadata')
    props = json.loads(match[1])['props']['pageProps']
    competition = props['calendar']['competitions']
    if len(competition) != 1 or competition[0].get('name') != 'Super League':
        raise ValueError('Wrong Swiss competition')
    name = f'{season_start(today)}/{season_start(today)+1}'
    seasons = [s for s in props['seasons'] if s.get('name') == name and s.get('competitionProviderId') == competition[0]['providerId']]
    if len(seasons) != 1: raise ValueError('Wrong or missing Swiss season')
    return competition[0]['providerId'], seasons[0]['providerId'], competition[0]['internalId']


def collect_sfl(download, metadata, now, end, observer=None):
    competition, season, internal = sfl_page(download(SFL_HOME), now.date())
    params = {'matchDay': '', 'language': 'de', 'competitionProviderId': competition, 'seasonProviderId': season}
    url = SFL_RPC+'?input='+urllib.parse.quote(json.dumps(params, separators=(',', ':')))
    raw = json.loads(download(url, headers={'x-account-key': SFL_ACCOUNT}).decode('utf-8-sig'))
    games = raw.get('result', {}).get('data')
    if not isinstance(games, list) or not games:
        raise ValueError('Missing official Swiss event list')
    if any(g.get('competitionId') != internal for g in games):
        raise ValueError('Swiss match competition identity mismatch')
    last = max(str(g.get('date', ''))[:10] for g in games)
    if last < end.isoformat():
        raise ValueError('Swiss event list does not cover the requested horizon')
    rows = []
    for game in games:
        status = game.get('gameStatus')
        if status not in ('pre-game', 'post-game', 'postponed', 'cancelled'): continue
        date = str(game.get('date', ''))[:10]
        clock = str(game.get('time', ''))
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date): continue
        if not (now.date()-dt.timedelta(days=7)).isoformat() <= date <= end.isoformat(): continue
        # An unannounced round placeholder does not establish an individual date.
        if not re.fullmatch(r'\d{2}:\d{2}:\d{2}Z', clock) or clock == '00:00:00Z': continue
        kickoff = instant(date+'T'+clock)
        if not kickoff: continue
        local = kickoff.astimezone(now.tzinfo)
        if not game.get('providerId') or not game.get('homeTeamName') or not game.get('awayTeamName'):
            raise ValueError('Missing official Swiss match identity')
        row = ['SWZ', *metadata, local.date().isoformat(), local.strftime('%H:%M'),
               resolve('SWZ', 'SwissFootballLeague', game.get('homeTeamProviderId'), game['homeTeamName']),
               resolve('SWZ', 'SwissFootballLeague', game.get('awayTeamProviderId'), game['awayTeamName']),
               None, None, None, None, None, None, 'SwissFootballLeague / UTC→Europe-Sofia']
        if row[5] == row[6]: raise ValueError('Same club on both Swiss fixture sides')
        if observer:
            observer({'row': row, 'provider_id': 'SwissFootballLeague:'+game['providerId'], 'round': game.get('week'),
                      'phase': game.get('stage'), 'status': 'provisional_result' if status == 'post-game' else 'scheduled' if status == 'pre-game' else status})
        if status == 'pre-game' and now <= local and now.date() <= local.date() <= end:
            rows.append(row)
    return sorted(rows, key=lambda r: (r[3], r[4], r[5]))


def collect_league(download, division, metadata, now, end, observer=None):
    return (collect_pol if division == 'POL' else collect_sfl)(download, metadata, now, end, observer)
