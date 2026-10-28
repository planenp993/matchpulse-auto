# Matchpulse project guidance

Read `PROJECT_STATE_BG.md` before changing the project. It records the verified
continuation point, branch differences, automation and remaining data gaps.
Use the current `README_BG.md` and `SCOUT_START_BG.md` for entry points.
Earlier milestones are preserved in `docs/archive/PROJECT_HISTORY_BG.md`.

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
two-season 42-source catch-up at least every four days, calendars about every eight
hours (7.5h minimum with queue tolerance), and quotes after Tuesday 13:10 / Friday 17:10 Europe/London. Failed jobs
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
(about eight hours after the last attempt; 7.5h tolerance); first initialization backfills all
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


## Published standings (fourth infrastructure package)

`scripts/standings.py` collects 27 current competition tables: 25 from ESPN and
POL/SWZ from the official league sites. Rank, points, goal difference and groups
are provider values. Never recreate an official table by sorting the archive;
head-to-head rules, deductions and split phases differ. Point adjustment versus
3 wins + draws is descriptive, not an assumed sanction. Swiss rankings do not
provide goals for/against: those remain null, while the official difference is kept.

`docs/data/standings.json` is a separate descriptive view; no model, scanner,
Elo, sealed forecast or candidate reads it. Exact source-ID/name links are in
`standings_clubs.json`, separate from frozen compiled aliases. Twenty-four use
three exact completed scores against two opponents; two newly observed UEFA
clubs additionally require both distinct opponents, their unique official club ID
and all seven full main-phase totals to agree, because only two games exist.
No unmatched or ambiguous name may be highlighted as a different club.

Use `python scripts/standings.py --check` in provider-free CI/publication. A failed
provider retains the last good table and its observation time; an older patch
cannot replace a newer one. Old-season tables are retained but labelled explicitly.
New results overtaking a comparable table produce an archive-ahead warning.
Manual `standings` refreshes only tables; it makes no Football-Data/history/calendar
requests. `full`, `results` and `europe` also refresh tables. Auto checks after at
least eight hours since the last attempt (two after a partial/error result), at the
three regular daily GitHub ticks (7.5h minimum with queue tolerance). Ordinary code pushes/CI remain provider-free.

The existing Program filters include a collapsed standings panel; match analysis
has its own collapsed table with the two reviewed club rows highlighted. There is
no new navigation screen. Tables load lazily, and the offline builder embeds them.
CSS, the table renderer and the UI use content versions to avoid stale phone assets.


## Descriptive match dossier

`docs/scout-analysis.js` is a separate presentation/readout module. It must not
feed model, Elo, scanner, frozen research or diary writers. Preserve the existing
model percentages and report pre-match historical frequencies as observations.
Team counts, opponent counts and match totals need explicit labels. xG and actual
goals are compared only on the same per-direction observation cohort. Missing
values remain missing; an absent newest statistic interrupts a streak. Match
result rows always retain actual home-away order, with names on both sides.

The rule-based introduction and copied Bulgarian dossier use the same description
object. Export the selected window, venue cohorts with dates, existing model,
per-match facts, source clocks, and current (not retrospectively pre-match) tables.
Never imply an unchecked lineup, injury, news item or current bookmaker price.
Version `scout-analysis.js`, `scout.js` and CSS by content, including the offline
builder. Browser checks cover touch/form inspection, expandable match facts,
clipboard export, small screens and unchanged saved picks.


## Recent-form refinement

The user explicitly requested UEFA matches in the last 5/10/20 displayed games.
Use `archive.recentProfile()` only for the descriptive dossier, not for scanner,
model, Elo or diary inputs. Preserve `archive.profile()` and its original scope.
The mixed view uses canonical clubs and known domestic countries; ambiguous
identities stay separate. It does not claim coverage of national cup fixtures.

The form curve is a signed cumulative result walk (+1 win, 0 draw, -1 loss),
starting at zero, with a shared scale. It is not Elo, league points or probability.
Descriptive tendencies use current per-club consecutive facts under the latest
curated v3 rules below, with common facts only for the same event in both clubs. Missing latest statistics or a newer
unresolved match block the affected claim. Actual dates and match evidence stay
available in expandable details; a short run alone is not sufficient.
Keep the intro and copied brief consistent with this same selected view, while
explicitly preserving the domestic model's separate input history.

## Selection view

The user authorized a fifth screen, `Селекции`, below the diary. Its two tabs
now contain same-game builders and cross-match columns. Single forecasts and
alternatives live in EVERY match dossier, with explicit abstention when no
supported choice exists. `scout-selections.js`
is a versioned heuristic ranking layer, not a new probability model. Its fixed
rules and limitations are in `docs/selections-method.md`. Standard model matrices
remain the only predictive probabilities. Fixed last-10 domestic descriptive
cohorts are separate from the dossier's 5/10/20 selection. Missing support yields
abstention or fewer alternatives, never fabricated picks.

Same-game joint probability sums the intersecting score cells. Reject identical,
contradictory and logically redundant builder conditions. Columns use one date,
unique fixtures and unique canonical clubs, with an explicit independence
approximation; columns can overlap each other. Do not label ranking as confidence
or present a model/price difference as validated profit. Existing frozen studies,
model/scanner code, personal picks and append-only diary records stay unchanged.

`selection_quotes.py` derives `docs/data/selection_quotes.json` solely from exact
fixture-date/club keys and saved `fixture_csv` observations. Ignore historical,
closing and handicap columns. Preserve the actual bookmaker/aggregate, source
column and CSV retrieval time; the bookmaker quote time is unknown. The refresh
retry loop rebuilds and stages this small view. `--check` is provider-free.
Manual comparison prices stay separately in browser local storage; they never
enter the model or the original saved-pick key. Old/future/invalid quote clocks
cannot create a positive-price ranking priority.

Version both new scripts by content and include them and their quote data in the
offline builder. `test_selections.cjs`, `test_selection_quotes.py` and
`scripts/test_selections_browser.cjs` verify the probabilities, identity/time
gates, comparisons, duplicate prevention, responsive view and offline path.


## Post-audit maintenance (28 October 2026)

The existing concept, model and scanner formulas are preserved. Source health
is presentation-only (`scout-health.js`). Failed optional files must leave the
basic schedule usable, but disable dependent claims and settlement safely.

Three regular ticks run eight hours apart (05:47/13:47/21:47 UTC), with a Friday
17:47 quote catch-up. Automatic regular feeds allow 30 minutes of queue drift
(7.5h minimum); the Friday four-hour tick does not force regular feeds.

Market first-observation evidence is immutable. Only a matching retrieved CSV
row can advance `last_confirmed_at_utc`; late replayed patches cannot move it
backwards. A global CSV receipt cannot renew all prices.

The separate selection diary is `docs/data/diary/selections/selections-v1`. Its
config is immutable; forecasts/events are append-only. Check with
`node scripts/selection_diary.cjs --check --base-ref origin/main`. Run its writer
after both existing diaries inside the same post-reset retry loop. Do not import
old diary forecasts or browser/manual prices. Code drift pauses new captures.
See `docs/selections-diary-method.md` for the fixed first-capture/column cohort.

Legacy workflow files live outside the active Actions directory. Keep the full
provider-free CI on pull requests and manual dispatch without duplicate pushes.

Branch cleanup is a one-time reviewed request: only when the push introduces
changes to `ops/merged-branch-recovery.json`, after successful deployment. The
script checks exact heads, ancestry in current main and a push deletion lease.
Never remove an unlisted or changed head; preserve the recovery SHAs and PRs.


## Local personal backups

`scout-backup.js` exports/imports only personal picks and manual comparison
prices. Validate before writes, preview additions/conflicts, preserve existing
records on collision, and retain original probabilities and quote timestamps.
Use the recovery journal for partial storage failures. No automatic diary or
GitHub upload may include personal notes/prices. Refresh the selection UI manual
price cache after a successful import. Keep the module versioned and embedded
in the offline builder. Browser acceptance includes export, preview, duplicate
restore, corrupt input, reload, 390/320px, offline and blocked local storage.


## Progressive loading and public snapshot delivery

Keep `scout-data.js` separate from model/scanner and immutable diary code. The
fixture/status stage renders first; history loads after paint; UEFA, names and
links are requested for full analysis, selections or personal settlement. Never
show speculative model results while dependencies are pending. Keep async
match opening/cancellation and focus restoration correct.

Generate `docs/data/client_manifest.json` LAST after all public writers inside
the publication retry loop, and stage it with those exact files. CI checks an
existing manifest before audit timestamps change; initial branches without one
may generate it. The browser job generates its own matching checked-out version.
Only verified public raw archives may use Cache Storage. Recheck the manifest
on each online entry and SHA-256 on cache reads; unavailable manifest/cache must
fall back to direct downloads, never an unverified previous snapshot. Personal
data and computed predictions never enter this cache.

Run `scripts/test_loading_browser.cjs` with the existing browser acceptances. It
compares the pre-change published UI with identical current input rows under
explicit gzip/paced-reply conditions, verifies identical probabilities and
new-publication invalidation, and writes `scout-loading-browser.json`. Report
controlled measurements honestly; do not claim a benchmark as a user's device
time or change formulas to improve it. See `docs/loading-method.md`.

## Match plans and combinations v2 (28 October 2026)

`scout-combinations.js` wraps the byte-frozen v1 selection engine. Single
forecasts/alternatives stay identical; builders and columns diversify under the
same evidence gates. Never change registered v1 files merely to extend the UI.
The new prospective recorder is `scripts/match_plan_diary.cjs`, with its own
immutable `match-plans-v2` config/append-only ledger and separate public report.
Run both selection recorders/checks in the existing post-reset writer loop.
Never merge their scores, use browser prices in captures, or overwrite old
registrations. Check `node scripts/match_plan_diary.cjs --check --base-ref origin/main`.

The descriptive tendencies now compare full recent counts, last-five support,
venue context and disagreements. They do not feed model/scanner/diary decisions.
Dates and detailed match evidence remain expandable, without default tick tiles.
The copied readout and the displayed prose share one description. See
`docs/match-plans-method.md` for the exact registered engineering rules.


## Curated match view v3 (28 October 2026)

`scout-curated.js` wraps immutable v2, keeps all single forecasts/probabilities,
limits builders to two and groups both in one fixture card. Columns use model
fair-odds bands 3–6 / 6–12 / 12–24, with 2–8 unique matches, same evidence gates,
explicit independence and no invented market price. Never change a registered
v1/v2 engine or writer to implement these UI changes. The separately registered
writer is `scripts/curated_diary.cjs` with `match-plans-v3`; keep all prior
writers, configs and ledgers intact. Run its --check/--write inside the same
post-reset publication loop and keep its own report in the final client manifest.

Descriptive trends are current consecutive facts per canonical club. A common
trend requires the SAME semantic event in both histories, with separate lengths;
unbeaten vs winless is never a shared event. Missing latest stats/pending matches
block the affected claim. At least three consecutive known recent observations
can be shown as facts, never as validated predictions. Dates/proof stay expandable.
Rich match readouts should explain form, venue, goals, observed xG and limitations
in connected prose, without truncating them to a few sentences. The displayed and
copied paragraphs must agree. See `docs/curated-method.md` and run the curated
unit, diary and browser acceptances in addition to previous checks.
