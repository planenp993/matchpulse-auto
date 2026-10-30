# Soccerway feasibility probe — 30 October 2026

## Verified GitHub outcome

Run 41083973132 succeeded on 30 October at 15:47:46 UTC / 17:47:46 Sofia.
The actual GitHub runner received HTTP 200, 1,348,832 bytes, and parsed 15
fixture rows plus 15 result rows. The sanitized source receipt, response hash
and run URL are retained in `ops/source-probes/soccerway-2026-10-30.json`.
It explicitly records zero imported matches and production disabled.

An independent local comparison with the existing canonical archive agreed on
11 recognized results and 12 fixture times, with no disagreement. Manchester
Utd and Nottingham labels remain unresolved, without fuzzy substitutions.
This proves feasibility of the public-page approach from GitHub; a production
adapter still needs competition/identity coverage, pagination and regulation
status validation. The trial does not fix the separate missing refresh clock.

The owner requested an actual Soccerway trial as an alternative to currently
unavailable sources. This is an explicit read-only experiment, not a production
provider activation or a change to the automatic refresh clock.

One normal anonymous page is sufficient for the initial trial:
https://www.soccerway.com/england/premier-league/fixtures/

The local HTTP response was 200 and contained the public embedded
`summary-fixtures` and `summary-results` feeds, 15 matches each. Kickoffs are
Unix timestamps; a sample upcoming match is Chelsea–Manchester Utd on
31 October at 12:30 UTC. These are source facts, not canonical identity joins.
The page is bounded at 6 MB with a 25-second timeout and an identifying user
agent. No browser, login, private endpoint, proxy, prediction or odds is used.
Access denial is reported after one request without retry or bypass.

`scripts/soccerway_probe.py` retains only match IDs, club labels, UTC instants,
raw state/stage codes and observed display scores. Other page fields, including
advertisements and bookmaker/TV links, are discarded. A display score is not
yet certified as a regulation score. The page's 15 rows are a partial sample,
not an assertion of full league, season or 24-league coverage.

The actual deployment-environment trial is isolated in `soccerway-probe.yml`.
An operational push must change only `ops/soccerway_probe_request.json`, start
its commit title with `[source-probe] `, and identify Soccerway in schema 1.
Ordinary code pushes and CI do not fetch it. The regular publisher ignores
this request file, so the probe cannot create a publication or renew source
clocks. The probe has contents-read permission, no repository write scope.
Its sanitized receipt is logged and uploaded as SOCCERWAY-SOURCE-PROBE.

Success requires actual embedded match data from GitHub, not merely HTTP 200
or an accessible page in local research. The real run must be checked before
claiming that Soccerway works from GitHub. No fixture/history/diary/model file
is modified by the probe, and zero matches are imported into production.
