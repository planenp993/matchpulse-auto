# Statarea calendar and retained results

Activated on 29 October 2026 through `ops/calendar_source.json`. Statarea is the
normal calendar/recent-result provider for the 24 domestic divisions and the
three UEFA competitions, including verified qualification/playoff labels. Football-Data UK remains the historical/statistics and
quote source. Official UEFA archives and descriptive standings remain separate.
Legacy calendar/result adapters are retained for reproducible old tests/manual
development, but are not fetched by the activated production calendar path.

## Requests and freshness

GitHub Actions ticks at minute 17 and 47 of every hour. Auto mode checks the last
attempt with five minutes of queue tolerance. It reads UTC pages for the last two
days, today and the next two days, with one extra preceding UTC day for Sofia's
midnight boundary. Once about every 24 hours it checks seven days back and seven
days forward. The first initialization reads 30 days back. Slower CSV, official
UEFA and standings clocks retain their existing independent gates. Ordinary code
pushes and CI never download sports data.

Two anonymous worker sessions use the site's own public `setCustomTimezone`
preference with `GMT 0`. Each HTML response must confirm both the exact requested
date and `GMT 0`. Cookie values are neither logged nor saved. At most two HTTP
requests run concurrently; 401/403/429/503 stops the remaining batch. A failed or
unpublished day never becomes an authoritative empty calendar. GitHub can delay
scheduled jobs; 30 minutes is the configured cadence, not a freshness guarantee.

Measured on 29 October: all 39 initial UTC pages were readable, covering 27
configured competitions, 1,129 supported matches and 292 scheduled/live rows.
Pages beyond approximately a week do not provide a complete calendar. Existing
farther-out fixtures survive with their old source labels until directly
confirmed; absence alone never means cancelled. There is no source switch or
request to the old calendar adapters on a failed Statarea day.

## Meaning of an accepted result

Only the exact competition allowlist is read. Verified championship/relegation
split-group labels retain the same domestic division. The Belgian inter-division
relegation tie is calendar-only and cannot enter ordinary domestic history.
The labels were checked on the public UTC calendars for 2–3/16–17 May, 18–19 February
and 19–20 August 2026. Cups, women, youth and similarly
named competitions are not silently added. A regulation final requires `fin`,
system status `1`, two valid integer scores and no extra-time/shootout marker.
`P`, extra time, awarded/abandoned matches, live scores and missing kickoff
confirmation remain outside domestic final-score history. The kickoff must be at
least two hours before observation. Missing corners, shots, cards, xG and prices
remain missing. Confirming an existing result preserves its richer CSV fields.

Different published scores go to the persistent conflict register; the existing
score stays. A provider identity or published result-date change is quarantined
for review. A later valid result may settle an existing frozen forecast; no past
forecast or percentage is manufactured. UEFA provider observations are retained,
while the separate official UEFA regulation archive remains its analytical view.

## Club identity

`data/statarea_clubs.json` is an ingestion-only exact-name crosswalk, scoped by
competition. It does not change model aliases or a sealed diary engine. It reuses
already reviewed provider/standing labels and official UEFA club labels. There
are 45 additional reviewed links. Normally each has at least three exact dated
regulation scores against at least two opponents. Celta's UEFA label also has
independent domestic proof for the same canonical club. Four clubs with only two
UEFA main-phase games require both exact scores, different opponents, the
reviewed official club ID and all seven complete table totals; the evidence and
source receipts are saved. Runtime never guesses a spelling with fuzzy matching.

Existing UEFA calendar aliases keep the original per-match identity when both
club labels resolve to the same unique reviewed official IDs. Ambiguous joins
stay quarantined. Raw provider observations are retained even when a row cannot
enter the published analytical views.

## Durable local evidence

`data/statarea/index.json` points stable provider match IDs to monthly JSON shards.
The first observation assigns the shard; a cross-month reschedule keeps it.
Every semantic schedule/status/score variant has immutable match fields and a
source URL/hash, first-observed time and last-confirmed time. Identical variants
deduplicate. Corrections add a variant, and late patch replay cannot roll back
the current observation. No raw HTML or provider prediction text is stored.

These files are committed to our repository inside the existing post-reset
retry loop. Published domestic results persist in `history.json`, match identities
in `match_registry.json`, and existing past schedules/forecasts in their existing
archives. A provider outage does not remove them. Missing/corrupt indexed shards
block publication instead of resetting an archive.

Validation: `python scripts/statarea.py --check`, `tests/test_statarea.py`, the full
provider-free Python/Node suite, all five sealed diary checks, schedule archive,
research snapshot, audit, manifest and the existing mobile/browser checks.
