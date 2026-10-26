# Prospective forecast diary

`forecasts/YYYY-MM.jsonl` stores the first pre-match snapshot for each eligible
fixture. Existing lines are immutable. The snapshot contains the confirmed
Sofia/UTC kickoff, capture time, model probabilities, league baselines, original
scanner selection, sample sizes, input hashes and source-code versions.

`events/YYYY-MM.jsonl` appends outcome and schedule revisions for forecasts in
that fixture month. Both paths use the original fixture date's month, including
forecasts captured just before a month boundary. Original snapshots and earlier revisions are retained.
Only the latest revision is used by `../diary_report.json` and the website.

The existing GitHub refresh job runs the recorder immediately before its data
commit, after reading the latest `main`. Rejected pushes retry from that latest
ledger, so concurrent updates cannot overwrite published diary lines. CI checks
record hashes, sequences and byte-for-byte prefixes against `origin/main`.

Capture covers the current Sofia day and next two days, requires a confirmed,
unambiguous kickoff at least 30 minutes away, and never backfills played games.
Settlement requires a recorded final score at least three hours after kickoff.
Awarded scores are excluded; missing supplementary statistics stay pending.
Scores and statistics may be corrected through new events without changing a
forecast. Results follow the historical refresh schedule, not a live-score feed.
Different fixture dates are never guessed to be the same match. A missing result
is marked for review once the same league's archive advances at least seven days
beyond it. A later exact result can still settle that original snapshot.

This diary contains new prospective observations only. Historical model audits
and the browser's private personal picks remain separate.
