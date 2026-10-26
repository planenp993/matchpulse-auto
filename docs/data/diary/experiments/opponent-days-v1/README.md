# Frozen prospective comparison: opponent-days-v1

This experiment records the current model and the opponent/day/calibrated
candidate at the same instant, from the same archived inputs, before kickoff.
It does not activate a different model in the match analysis.

`config.json` is immutable once published. It freezes the candidate source
fingerprints, the original historical calibration coefficient and its training
period, the fitting settings, and the review policy. Neither later historical
backtests nor prospective outcomes retune this configuration.

`forecasts/YYYY-MM.jsonl` and `events/YYYY-MM.jsonl` are append-only. These are
new paired records, separate from the original diary. Do not add a candidate to
the original 40 forecasts or compare it with their earlier capture times. Both
forecasts in a pair share a timestamp, fixture, input hashes and final result.

Capture uses the current Sofia day and next two days, only fresh successful
calendar feeds and confirmed kickoffs at least 60 minutes away. The weekly
training cutoff is the ISO Monday of the **capture date**, even when a future
fixture belongs to the next week. Only strictly earlier league scores enter the
fit. The frozen calibration is mixed with the league goal matrix from the same
captured baseline context. If a fitted estimate is unavailable, the candidate
uses the current model unchanged and is explicitly marked as a fallback.

Selection, score corrections, awarded results, postponed dates, clock guards
and missing-result handling reuse `forecast_diary.cjs`. Model source changes
pause new capture until an explicit new experiment is registered; existing
records still settle. Published config and record bytes are protected in CI
and inside the main workflow's reset/retry loop.

`../../../paired_model_report.json` evaluates only these paired future
forecasts. The original diary report embeds its summary in the existing quality
table. The historical 25,617 matches never enter prospective scores.

The fixed engineering review rule requires at least 500 settled pairs and
12 calendar-week clusters, >=90% fitted coverage, a positive paired interval
for the predeclared three-market Brier objective, and no material regression
in its main markets/log loss. This is not a general statistical guarantee and
never activates a model automatically. Small samples remain labelled collecting.
