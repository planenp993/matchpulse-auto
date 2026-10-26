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
node scripts/compare_goal_models.cjs --check
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

Keep historical CSV refresh separate from calendar-only updates. Tests and code
pushes must not add provider downloads. Record changed measured results and
unfinished work in `PROJECT_STATE_BG.md` so a new conversation can continue.
