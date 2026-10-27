"""Reviewed source IDs to existing club names; no fuzzy matching or model edits."""
import json
from pathlib import Path
from club_identity import normal

PATH = Path(__file__).resolve().parents[1]/'docs/data/provider_clubs.json'
ENTRIES = json.loads(PATH.read_text())['entries']
LOOKUP = {(e['division'], e['provider'], str(e['team_id'])): e for e in ENTRIES}
if len(LOOKUP) != len(ENTRIES):
    raise ValueError('Duplicate scoped provider club identity')


def resolve(division, provider, identity, name):
    entry = LOOKUP.get((division, provider, str(identity)))
    if entry is None:
        return str(name).strip()
    if normal(name) not in {normal(n) for n in [entry['source_name'], *entry.get('source_names', [])]}:
        raise ValueError('Provider team ID now has an unreviewed name: '+str(identity))
    return entry['target']
