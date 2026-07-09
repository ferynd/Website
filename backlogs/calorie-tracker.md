# CalorieTracker — Backlog

Single source of truth for ongoing work on `public/tools/CalorieTracker/`.

All items from the original 46-point review punch list have been completed and merged.
See `backlogs/calorie-tracker-completed.md` for the full archive with resolution details.

## Parameters (for `backlogs/protocol.md`)

- **Working branch:** `working/calorie-tracker-backlog`
- **Commit scope:** `calorie-tracker`; item ids `#N` (next new id: **#59**; never reuse ids)
- **Archive:** `backlogs/calorie-tracker-completed.md`
- **Tests:** for CalorieTracker code changes run `cd public/tools/CalorieTracker && npm test`
  (584 tests as of the last pushed batch; the full suite must pass). Logic, validation,
  state, parser, target, analysis, or UI behavior changes must keep the suite green;
  pure docs/backlog/pointer changes need no suite run. If only one pure module changed,
  run the nearest focused test first when useful, then the full suite before marking an
  item pushed. Add or update tests for new validators, pure functions, regression
  fixes, or behavior that could silently break calculations.

## Session protocol

Follow `backlogs/protocol.md` with the parameters above.

## CalorieTracker invariants

Preserve these unless the user explicitly asks to change them:

- `getTrueUpCandidates` uses centered windows `[D-preDays, D+postDays]`; do not revert to end-anchored windows.
- True-up TDEE reference should come from blocks outside the candidate interval when available to avoid circularity.
- `computeWeekdayAverages` uses `trimmedMean(arr, 0.1)`; do not revert to a plain arithmetic mean.
- `buildBlankDayEstimateEntry` spreads historical micronutrient averages onto both the entry and its synthetic food item, falling back to baseline targets.
- `computeProteinTarget` auto basis priority is lean mass, then target weight, then current weight.
- `getBlankDaysForPopulation` and `getPartialDaysForAdjustment` are legacy compatibility paths unless a live caller is reintroduced.

---

## Active items

UI/UX & information-architecture review (#47–#58). Goal: make the Today view light and
scannable with a progressively-disclosed target breakdown, move correction/gap logic into
its own **Corrections & Gaps** tab, give every chart a uniform date-range control, and
upgrade the micronutrient section to dynamic upper+lower bounds. Each item is tagged
**[quick win]** or **[larger refactor]**. Full rationale and current-vs-desired assessment
live in the approved review plan; the per-item summaries below are the source of truth for
execution. Reuse existing code wherever noted — most of the infrastructure already exists.

### CRITICAL

_(empty)_

### HIGH

_(#47–#50 completed — moved to `backlogs/calorie-tracker-completed.md`)_

### MEDIUM

_(#51 completed — moved to `backlogs/calorie-tracker-completed.md`)_
_(#52–#56 completed — moved to `backlogs/calorie-tracker-completed.md`)_

### LOW / NICE-TO-HAVE

- [p] **#57 Mobile narrow-viewport pass** — *[quick win]* Validate the 6-tab bar scroll
  affordance, macro-bar wrapping, expandable target rows, and the date-range control at
  ~390px (no horizontal scroll, usable touch targets). Files: `styles.css`, `index.html`.
  > pushed — ≤390px breakpoint with tighter padding, compact tabs/macro bar, viewport-constrained target breakdown, date-range custom row wrapping, settings button wrapping; tests: 584 pass; commit: 649bf26
- [p] **#58 Large-import performance check** — *[quick win]* Verify chart slicing and render
  budget with multi-year weight/log imports; cap series length / decimate if needed. Files:
  `ui/chart.js`, `analysis/analysisUI.js`.
  > pushed — O(n²) indexOf replaced with Map lookup in chart averages, rolling avg loops avoid slice allocations, data table capped at 60 columns, weight chart point radius reduced for >365 days, x-axis maxTicksLimit added; tests: 584 pass; commit: 649bf26
