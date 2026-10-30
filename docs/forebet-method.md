# Forebet: supplemental calendar and results

The owner authorized Forebet as a second source on 30 October 2026. Statarea
remains the primary calendar; Football-Data supplies historical statistics and
quotes. This adapter does not use Forebet predictions, probabilities, odds or
generated score forecasts.

## Public source and clocks

The ordinary dated page's More control uses the anonymous public
`https://www.forebet.com/scripts/getrs.php` listing. The adapter requests that
same JSON listing with its date and UTC window; it does not stop at the first
40 HTML rows. There is no account, paid API, proxy or browser bypass. Requests
use an identifying user agent, two workers, a 25-second timeout and a 20 MB
response bound. HTTP 401/403/429/503 stops further requests in that batch.

The public site's `changeDate` formatter in `/scripts/all.js?v=619` establishes
`DATE_BAH` as a fixed UTC+01 source clock. Subtract one hour for UTC, then use
`Europe/Sofia` for the compatible view. Select the requested day only after
UTC conversion: the response's request window overlaps adjacent days. On
30 October, all 190 common upcoming fixtures in the six-day live sample agreed
with the published Statarea Sofia times. Tests also cover summer conversion,
midnight and the repeated Sofia autumn hour. A future source clock/schema
change must be investigated; a conflicting primary kickoff is quarantined.
The wider live rehearsal found one-hour differences on some already played
matches, including six Scottish fixtures on 28 October. These observations
were rejected against the independently retained primary kickoff. Do not infer
a new seasonal offset or rewrite historical times merely to make sources agree.
The six-day upcoming agreement does not establish historical clock accuracy.

The independent target interval is two hours (five minutes of queue tolerance).
After at least 25 minutes, primary errors, quarantined identities, a missing
known fixture or an unresolved recent result can request an earlier check.
Normal collection covers two UTC dates back plus one boundary date through two
ahead. Initial/daily wider collection covers seven dates
back plus the boundary through seven ahead. Current dates are requested first.
GitHub can delay scheduled starts; these are eligibility intervals, not an
assurance that the runner starts at an exact time. Ordinary code pushes/CI
make no sports-provider requests.

## Identity and acceptance

Competition matching uses exact country/name tuples for the 24 domestic
leagues. Unverified competitions are ignored; women/youth/lower divisions never
match by prefix. UEFA, where an exact supported label is supplied, remains
calendar-only here: official UEFA remains the separate regulation archive.

`data/forebet_clubs.json` contains 49 separately reviewed ingestion name links.
Each has three distinct Forebet match IDs and exact archived dates, home/away
clubs and scores against at least two opponents. Public match-detail history
rows supplied the evidence. The source URL, response SHA-256 and individual
match URL are retained; provider-free validation rechecks every canonical
identity/score against our archive. No fuzzy match, prediction or frozen model
alias is used to create these links. Other unknown/ambiguous names remain in
source evidence and cannot create fixtures or results.

Only explicit `FT`, two observed integer goals, a confirmed kickoff at least
two hours earlier and no extra-time/shootout field can add a domestic result.
Live, awarded, extra-time and shootout totals cannot become regulation scores.
Missing shots, corners, cards and xG remain missing. An agreeing result retains
richer existing statistics; a disagreement records a conflict and preserves
the published score. Source absence alone is not a cancellation.

Both sources can confirm the same exact fixture without duplicating it. Forebet
can add an absent fixture/result when its identity and clock pass the gates.
A fresh conflicting Statarea kickoff/status takes priority and the secondary
observation stays quarantined. A possible reschedule across dates requires an
already linked provider ID; similar clubs/dates alone cannot join it.

## Durable evidence and operational health

`data/forebet/index.json` and monthly shards permanently retain sanitized
observations, stable IDs, correction variants, URL/hash and actual observation
times, including rejected records. Identical variants deduplicate. Old replayed
patches cannot regress current clocks/views, and corrupt indexed shards block
publication. Apply/check/stage remain inside the latest-main retry loop.

`status.json` retains separate Forebet attempt, successful data, complete-success,
wide-check and per-day receipts with the actual GitHub event/run/attempt.
Publishing code cannot renew them. The existing Data and update panel displays
the independent source status, errors and quarantine count. The combined
calendar can use fresh successful days from either source; its health does not
erase a failed source's own warning or claim complete fixture coverage.

Run `python scripts/forebet.py --check`, the full Python/Node suites, all five
diary checks, frozen research/archive checks and existing browser acceptances.
The model, scanner, registered candidates, diary configurations and previously
published forecasts are unchanged.
