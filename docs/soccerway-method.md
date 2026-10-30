# Soccerway primary calendar and recent results

The owner explicitly chose Soccerway as the primary source on 30 October 2026,
after ordinary public HTML access succeeded from GitHub run 41083973132.
`ops/calendar_source.json` activates the adapter; code pushes and CI do not
download provider data. A separate `[data-sync]` operational request performs
the first production check. Forebet remains disabled after its real HTTP 403;
the external scheduler setup remains paused.

The exact catalog covers 24 domestic leagues plus UCL, UEL and UECL. One public
fixtures page per competition contains literal full `fixtures` and `results`
feeds, distinct from the short 15-event summary cards. The first full payload
can itself be a partial season: retain its visible/total counts and verify that
it covers the requested seven days backward/forward. Do not claim a full-season
archive or silently call private pagination endpoints. Validate sport, current
season, tournament template ID, competition path and country for every feed.
Two bounded HTTP workers stop on denied/rate-limited access; no login, proxy,
certificate bypass or automatic fallback to an unavailable source.

`AD` is an absolute Unix kickoff and is converted to Europe/Sofia, including
midnight and both DST folds. `AA` is the stable match ID; **PX/PY** are club IDs.
JA/JB are event-specific participant/lineup references and must not join clubs.
FH/FK supply plain club names even when displayed AE/AF labels include a country.
Only the explicit ordinary regulation FT state/stage 3/3 with both valid goals
and a kickoff at least two hours earlier enters domestic history. Scheduled 1/1
observations supply the future calendar. Extra-time, penalties, live, awarded
and unknown outcomes stay in evidence; no regulation scores are inferred.
No predictions, advertising, odds or inferred xG/shots/corners/cards are imported.
UEFA observations never enter domestic model/scanner history; official UEFA
continues to supply the separate regulation-result archive and standings.

`data/soccerway_clubs.json` contains 30 exact competition-scoped reviewed labels.
Each link has three exact historical dated scores against at least two opponents
and source URL/SHA-256. The sole two-game UECL exception (Braga) also requires
the reviewed official club ID and all seven complete standings totals/receipts.
Reviewed aliases are bound to their source club ID; no fuzzy/cross-league guesses.

An explicit stable-ID bridge in `data/soccerway_matches.json` joins the already
published Montpellier–Metz fixture: same F2 season, canonical clubs and round 12,
FixtureDownload match 105 and Soccerway KANaRkbT, with both public feed hashes.
Soccerway moves this future kickoff from 7 November to 6 November. The existing
registry ID and old forecast keys survive; ordinary diary writers append schedule
events. Other possible cross-date matches remain quarantined until reviewed.

Sanitized observations are permanently retained under `data/soccerway`, including
unmatched or non-regulation records. Monthly shards retain stable IDs, correction
variants and independent first/last observation clocks and source hashes. Old
patches cannot regress views or source clocks; missing/corrupt indexed shards
block publication. Apply and stage within the existing latest-main retry loop.
Unlisted fixtures remain retained; absence alone never means cancellation.
An agreeing result preserves all richer existing Football-Data statistics; a
conflicting score is retained for review without changing the published score.
Quote CSVs can enrich existing odds only, never add a fixture or move its kickoff.

`last_soccerway_attempt_utc`, `last_soccerway_data_success_utc` and
`last_soccerway_success_utc` distinguish an attempt, useful partial retrieval and
a complete clean check. Actual GitHub event/run/attempt is retained beside each.
A publication does not renew them. The planner targets approximately 30 minutes;
unreliable GitHub schedule delivery remains a separate unresolved constraint.

Run `python scripts/soccerway.py --check`, all Python/Node regressions, source
archives, frozen research, five append-only diary checks and browser acceptances.
