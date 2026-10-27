# Matchpulse project guidance

Read `PROJECT_STATE_BG.md` before changing the project. It records the verified
continuation point, branch differences, automation and remaining data gaps.
`README_BG.md` and `SCOUT_START_BG.md` describe earlier releases and have stale
counts and branch instructions.

## Structure

- Static GitHub Pages app: `docs/scout.html`, `docs/scout*.js`, `docs/scout.css`.
- Existing goal model: `docs/model-core.js`; Match Lab: `docs/lab.html`.
- Published snapshots: `docs/data/*.json`.
- Python import, calendar and audit scripts: `scripts/`; regression tests: `tests/`.
- Automation: `.github/workflows/update.yml`; provider-free CI: `scout-verify.yml`.

## Data invariants

- Keep the stable 13 match-array indices. Optional finished-match statistics are
  a dictionary at index 13; fixture source metadata at that index may be a string.
- Missing shots, corners, cards and xG remain missing. Never convert them to zero
  or infer them from goals. Preserve richer optional observations on updates.
- Match analysis and Elo must use data strictly before the fixture date; matches
  on the same date must not influence each other's pre-match ratings.
- Preserve provenance, reject conflicting scores and ambiguous team identities,
  and keep archive completeness separate from structural integrity.
- Review JSON merges semantically. Preserve imported history and newer calendar
  data together; do not choose all of one branch's JSON files blindly.
- Keep personal seed CSVs, tokens and credentials out of the public repository.
- The prospective diary in `docs/data/diary/{forecasts,events}` is append-only.
  Never edit or delete published JSONL lines. Forecasts stay frozen; score and
  schedule corrections append events. Keep the recorder inside the refresh
  workflow's post-reset retry loop so concurrent pushes cannot lose snapshots.
- The paired model experiment under `docs/data/diary/experiments` is also
  append-only; published `config.json` files are immutable. It captures both
  forecasts at one instant from the same inputs, separately from the original
  diary. Keep its frozen calibration and capture-week fit cutoff. Changed
  candidate code pauses new captures; it never rewrites existing pairs. Keep
  this recorder after the ordinary diary writer, inside the same retry loop.
- `scout.html` versions the UI script with the first 12 SHA-256 digits of
  `docs/scout.js`. Update that query when the UI changes; a regression test
  protects existing browsers from stale JavaScript. The offline builder accepts
  versioned script URLs and still embeds every script locally.

## Validation

Run from the repository root:

```sh
python -m unittest discover -s tests -v
node --test tests/*.cjs
python scripts/audit_scout.py
node scripts/smoke_scout.cjs
node scripts/forecast_diary.cjs --check
python scripts/check_research.py
node scripts/paired_model_diary.cjs --check
```

These checks do not download sports-provider data. The audit writes its report;
structural integrity failures block publishing, while missing coverage is reported
as a warning. UI changes also need the browser checks in
`scripts/test_scout_browser.cjs`.

The registered offline comparison is `docs/model-comparison-protocol.md`. Keep
its fixed candidates, fitting/calibration cutoffs and paired-cohort evaluation
explicit. Do not tune settings on its later periods or activate a model from
retrospective results alone. Changed comparison code/history requires
`node scripts/compare_goal_models.cjs --write --progress`; calendar-only runs
reuse the exact matching report. This experiment does not change live formulas.

The separate shot contribution study is registered in
`docs/shot-model-protocol.md`. Its two fixed volume components, chronological
cutoffs and coherent mixtures must stay explicit. Use the common available
cohort and its equally calibrated goal-only control to assess incremental value;
improvement against current alone is not evidence that shots help. Never turn
aggregate shot counts into event-level xG or modify the frozen prospective
candidate for this study. Regenerate with
`node scripts/compare_shot_models.cjs --write --progress` after changing its exact
inputs/code; calendar-only runs reuse the matching report.

The scanner ranking study is registered in `docs/scanner-validation-protocol.md`.
Keep the current, league-frequency and fixed prior-6 candidates on the same
daily eligible pools. Selection happens before target-statistics settlement;
missing outcomes never trigger replacements. The primary analysis is top 10 on
competitive days under the fixed 10-match / 3-streak setting. Other windows,
streaks, top 20 and single markets are diagnostics. A rank is not a probability.
Use league-adjusted outcomes, weekly paired uncertainty and missing-outcome
bounds; raw hit rate alone does not establish ranking value. Regenerate with
`node scripts/evaluate_scanner.cjs --write --progress` when its exact inputs or
code change. Never mix retrospective results into the prospective diary.

## Operational data refresh (27 October 2026)

The user has paused changes to model/scanner algorithms. The four registered
reports and their exact code/history are pinned by `docs/data/research_snapshot.json`.
Use `python scripts/check_research.py`; it checks the registered reports against
the pinned Git history blob, while live history can advance. Do not rerun research
on every data update or promote a candidate. Earlier regeneration commands above
apply only to a separately authorized research change.

`scripts/data_sync.py` is the production orchestrator. Collection produces a
patch; apply merges it into the latest main with per-record base fingerprints.
Never restore stale whole JSON files after a retry. Source score conflicts go to
`data/match_registry.json`, preserving the existing published score. IDs and old
schedule keys persist beyond the 30-day calendar. Public `match_links.json`
allows both append-only diaries to settle rescheduled matches without rewriting
forecasts. Provider absence alone is neither a cancellation nor a final score.

Auto mode checks successful receipts: current 24 history sources daily (20h),
two-season 42-source catch-up at least every four days, calendars every eight
hours, and quotes after Tuesday 13:10 / Friday 17:10 Europe/London. Failed jobs
are retried by a later tick, with a two-hour history/quote cooldown. No same-day
result is promised before the upstream provider publishes it. Manual modes are
`auto`, `full`, `history`, `calendar`, and `publish`. Calendar mode has no
Football-Data requests. Full mode requests the 42 historical sources, calendars
and the short-term quote CSV.

Tests and ordinary code pushes never download provider data. The explicit
operational push exception changes **only** `ops/sync_request.json`, has a
`[data-sync] ` commit title and a new request ID. The workflow validates the
commit paths/title and records the processed ID. This is a data request, not a
code deployment. Do not commit personal seeds or credentials. Record changed measured results and
unfinished work in `PROJECT_STATE_BG.md` so a new conversation can continue.

## Calendar and market coverage (second infrastructure package)

The calendar has 27 configured streams: the existing 21 plus NOR/SWE/DNK/AUT
from ESPN and POL/SWZ from the official league sites. ESPN's Polish request
failed and its Swiss feed returned an expired season. Never count an expired
season as a successful empty current calendar. Official Polish rounds use
structured Next Flight data; Swiss public calendar metadata selects its current
season and the anonymous site calendar service. The public SFL account header
is a site identifier, not a user token. No sign-in or paid API is involved.

`docs/data/provider_clubs.json` is an ingestion-only source-ID crosswalk. All 86
initial entries have at least three matching archived scores against at least
two opponents. `scripts/provider_clubs.py` scopes IDs by provider and division
and refuses unexpected renamed IDs. Do not edit the compiled model aliases or
frozen candidate merely to normalize an ingestion label.

`scripts/market_archive.py` saves supported Football-Data 1X2, O/U 2.5 and Asian
handicap columns, keeping starting/closing names and both handicap lines. Dense
per-season shards under `data/markets/<division>/<season>.json` are outside the
Pages payload. Different observations append; identical values deduplicate.
`observed_at_utc` records CSV retrieval, never a bookmaker timestamp. Historical
prices cannot count as pre-match diary evidence. The app's 13-column views and
model/scanner formulas remain unchanged. `docs/data/market_coverage.json` is a
small operational summary. Corrupt market shards must block, never reset.

The manual `fixtures` mode refreshes calendars and the quote CSV without history
requests; `calendar` still makes zero Football-Data requests. If a publication
window's CSV has no applicable future quotes while known matches are scheduled,
record `empty_for_upcoming` and retry on a later tick with the two-hour cooldown.
A successful HTTP download alone must not close that publication window.


## UEFA and recent domestic results (third infrastructure package)

Manual `results` refreshes six recent domestic result feeds and the current UEFA
season without Football-Data requests. Manual `europe` additionally checks UEFA
2021/22 through the current season. Auto retries both at the next eligible tick
(at least eight hours after the last attempt); first initialization backfills all
six seasons. Normal code pushes and CI remain provider-free.

The recent result bridge uses ESPN for NOR/SWE/DNK/AUT and official Polish/Swiss
league feeds for POL/SWZ. Only explicit completed regulation matches enter history;
no aggregate score, live placeholder or extra-time result is accepted. Primary
CSV statistics can enrich these goal-only rows later. Existing scores never change
silently. Evidence is retained in `data/result_provenance.json`.

UEFA's official public match service supplies stable FAME club and match IDs.
Rich per-season shards under `data/europe` preserve 90-minute, after-play,
shootout, aggregate and administrative outcomes separately. Complete balanced
official goal timelines arbitrate contradictory 90-minute fields; every such
resolution retains the originally reported value. The public regulation view
`docs/data/europe_history.json` excludes administrative matches. Validate it with
`python scripts/europe_archive.py --check`. Corrupt archives block publication.

Keep UEFA separate from `history.json`, the domestic model/scanner index and the
frozen paired experiment. `scout-archive.js` wires the UEFA view only into European
dossiers/direct meetings and personal pick settlement. Exact official date and
both club labels connect calendar names to official IDs; the one reviewed
FixtureDownload abbreviation is documented in `data/europe_calendar_aliases.json`.
Missing statistics remain missing. Standings are a later package.
