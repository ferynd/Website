# CalorieTracker — Active Backlog

Single source of truth for future work on `public/tools/CalorieTracker/`.

All approved items through #58 are merged and archived. This backlog is dormant until the user requests new CalorieTracker work or a feature/remediation item explicitly targets it.

## Parameters

- **Working branch:** one focused branch/PR per new item or tightly coupled batch from current `main`.
- **Commit scope:** `calorie-tracker`; item IDs `#N`; next new ID: **#59**; never reuse IDs.
- **Archive:** `backlogs/calorie-tracker-completed.md`.
- **Checks:** `cd public/tools/CalorieTracker && npm test` for behavior changes; docs/backlog-only changes need no app tests.

## Invariants

- `getTrueUpCandidates` uses centered windows `[D-preDays, D+postDays]`.
- True-up TDEE reference should come from blocks outside the candidate interval when available.
- `computeWeekdayAverages` uses `trimmedMean(arr, 0.1)`.
- Blank-day estimates preserve historical micronutrient averages on the entry and synthetic food.
- Protein auto-basis priority is lean mass → target weight → current weight.
- Legacy gap helpers stay dormant unless a live caller is deliberately restored.

## Active items

_None._
