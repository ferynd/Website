# CalorieTracker — Backlog

Single source of truth for ongoing work on `public/tools/CalorieTracker/`.

All items from the original 46-point review punch list have been completed and merged.
See `backlogs/calorie-tracker-completed.md` for the full archive with resolution details.

## CalorieTracker invariants

Preserve these unless the user explicitly asks to change them:

- `getTrueUpCandidates` uses centered windows `[D-preDays, D+postDays]`; do not revert to end-anchored windows.
- True-up TDEE reference should come from blocks outside the candidate interval when available to avoid circularity.
- `computeWeekdayAverages` uses `trimmedMean(arr, 0.1)`; do not revert to a plain arithmetic mean.
- `buildBlankDayEstimateEntry` spreads historical micronutrient averages onto both the entry and its synthetic food item, falling back to baseline targets.
- `computeProteinTarget` auto basis priority is lean mass, then target weight, then current weight.
- `getBlankDaysForPopulation` and `getPartialDaysForAdjustment` are legacy compatibility paths unless a live caller is reintroduced.

## Resuming work across sessions

Start (or resume) a session with any of these — exact wording is **not** required:
**"start working on the backlog"**, **"continue working on the CalorieTracker backlog"**,
**"work on the calorie tracker backlog"**, **"pick up the backlog"**, or a close paraphrase.

When invoked that way, follow this protocol automatically, without needing further instruction:

1. `git fetch origin`.
2. Switch to the stable working branch: `git switch working/calorie-tracker-backlog`. If it
   doesn't exist locally or on origin, create it from `origin/main`:
   `git switch -c working/calorie-tracker-backlog origin/main`. In web/remote sessions the harness
   may pin you to an auto-generated `claude/<adjective>-<noun>-<id>` branch you cannot switch off —
   that is fine to work on; completion is detected from commits merged to `main`, not the branch
   name.
3. `git pull --ff-only origin working/calorie-tracker-backlog` (skip if just created).
4. **Reconcile completed items (auto-mark `[x]`).** `git fetch origin main`. For every `[p]` item
   whose note records a commit SHA, test whether it has merged to main:
   `git merge-base --is-ancestor <sha> origin/main` (exit 0 = merged). Cross-check the backlog PR
   via the GitHub MCP (`mcp__github__pull_request_read`). For each `[p]` item whose commit is on
   `origin/main`, flip it to `[x]` and rewrite its note to `> Resolved: <summary>; merged <sha>`.
   Move newly completed items to `backlogs/calorie-tracker-completed.md` in the appropriate
   priority section. Leave pushed-but-unmerged items `[p]` here. **This is the only way items
   reach `[x]`** — hands-off, but never before the user has actually merged the PR.
5. Read this file end-to-end. Identify (a) any `[p]` items needing follow-up from review or a
   prior session, then (b) the highest-priority `[ ]` items, in section order
   (CRITICAL → HIGH → MEDIUM → LOW).
6. Pick the next reasonable batch — usually one to three related items.
7. Implement. Mark each touched item `[p]` with a one-line note (see status legend below).
8. Run tests according to the Test command section below. CalorieTracker code changes must keep the relevant suite green.
9. Commit with a **descriptive** Conventional-Commit message. Format:
   `type(calorie-tracker): #N short description of the change`
   The message must include: (a) the Conventional Commit type (`feat`, `fix`, `refactor`, etc.),
   (b) the `(calorie-tracker)` scope so it's clear which part of the site changed, (c) the
   backlog item number(s) (`#N`), and (d) a plain-English summary of what the commit does — not
   just the item title.
   Examples:
   - `feat(calorie-tracker): #47 add weekly meal-prep summary view`
   - `fix(calorie-tracker): #48 correct rounding in macro percentage display`
   One commit per logical change. Multi-item commits list all numbers: `#47 #48 ...`.
10. Push: `git push -u origin working/calorie-tracker-backlog` (or the pinned `claude/*` branch in
    a web session).
11. **Record the commit SHA** on every item you pushed (`commit: <short-sha>` in its `[p]` note,
    plus the PR number when known). The next session's reconcile step keys off this SHA — an item
    with no recorded SHA can never be auto-completed.
12. **PR title and body must be descriptive.** If no open PR exists for the branch, create one
    via the GitHub MCP tools. Format:
    - **Title:** `CalorieTracker: <short summary of batch> (#N, #N, …)`
      Example: `CalorieTracker: weekly meal-prep view, macro rounding fix (#47, #48)`
    - **Body:** list every item addressed with its number and one-line summary, plus a pointer to
      this file. Update the body on subsequent pushes when new items are added to the batch.
    All subsequent pushes auto-update the same PR.

## Status legend

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started. |
| `[p]` | In progress / pushed / awaiting merge / blocked / needs follow-up. **Default state once code has been touched.** Records a `commit: <short-sha>` once pushed. |
| `[x]` | Complete — the item's commit has merged to `main` (the user accepted the PR). Set automatically by the reconcile step (step 4); never set for merely-pushed code. Completed items are moved to `backlogs/calorie-tracker-completed.md`. |

The note line under a `[p]` item begins with one of these sub-labels so the state is scannable:

- `> pushed — <one-line summary>; tests: <pass/notes>; commit: <short-sha>` (awaiting merge)
- `> in progress — <what's left>`
- `> blocked — <reason>`
- `> needs follow-up — <what the reviewer said>; commit: <short-sha>`

When the item's commit merges to `main`, the next session's reconcile step moves it to the
completed log with a single line:

- `> Resolved: <one-line summary>; merged <short-sha>`

## Editing rules

- **Mark `[p]` when you push; let the reconcile step (step 4) flip `[p]`→`[x]` and move to the
  completed log once the commit is merged to `main`.** Never mark `[x]` for code that is only
  pushed, and never flip it manually mid-session — merge to `main` is the single signal that an
  item is done.
- Keep notes to **one line** per item. No pasted diffs, no multi-paragraph rationale — reference
  the commit hash and let the diff speak.
- If the same item is revised after review, **replace** the existing note line (don't append) so
  the file doesn't grow.
- New items the user asks to add get slotted into the most appropriate existing priority section
  (CRITICAL → HIGH → MEDIUM → LOW) based on severity, dependencies, and impact — not appended at
  the bottom.
- Item numbering continues from #47. Do not reuse completed item numbers.

## Branch and PR strategy

- **Working branch:** `working/calorie-tracker-backlog`, long-lived, branched from `main`. One
  PR is open against `main` at any time and is updated by every push. Preferred over the
  ephemeral `claude/*` per-session branches when the environment lets you switch.
- **Web/remote sessions:** the harness may pin a per-session `claude/*` branch you cannot switch
  off. That is fine — open or append to a PR against `main` from it. Because completion is
  detected from commits merged to `main` (step 4), the workflow does not depend on the branch
  name being stable.
- **Merging:** The user merges the PR when they want to lock in a batch of items. On the next
  session, the reconcile step auto-marks the merged items `[x]` and moves them to the completed
  log. After merge, the working branch is reset/rebased onto the new `main` (or deleted and
  recreated) for the next round.

## Test command

For CalorieTracker code changes, run from repo root:

```bash
cd public/tools/CalorieTracker
npm test
```

Baseline: **575 tests, 9 files, all passing.**

Use targeted testing judgment:

- Logic, validation, state, parser, target, analysis, or UI behavior changes must keep the CalorieTracker test suite green.
- Pure documentation, backlog bookkeeping, or pointer-file changes do not require the CalorieTracker test suite.
- If only one pure module changed, run the nearest focused test first when useful, then run the full CalorieTracker suite before marking the backlog item pushed.
- Add or update tests for new validators, pure functions, regression fixes, or behavior that could silently break calculations.

---

## Active items

UI/UX and information-architecture review backlog added from the June 24, 2026 CalorieTracker review plan. The main objective is to keep Today light and scannable, move correction and gap logic into a dedicated tab, standardize chart date controls, and make nutrient targets profile-driven with clear lower and upper bounds.

### CRITICAL

_(empty)_

### HIGH

- [ ] #47 Today macro summary bar redesign [quick win]
  - Clean, prominent Today summary bar with Calories and remaining calories highlighted, Protein/Fat/Carbs, and the current daily target number. Refine `renderTodayMacroHeader` / `renderTodayCompact`; remove the inline target formula from the main view and move it into #48. Files: `public/tools/CalorieTracker/ui/dashboard.js`, `public/tools/CalorieTracker/styles.css`, `public/tools/CalorieTracker/index.html`.

- [ ] #48 Clickable target expands into financial-statement breakdown [quick win]
  - Make the target number clickable or tappable and expand it into vertical rows: base target, exercise impact, bridge to best-guess TDEE with the final best-guess TDEE line bolded, banking adjustments, goal-based reductions, and Final Target. Final Target must drive Remaining calories. Include protein, fat, and carb targets in the same row-based format. Reuse or adapt `renderCalcDetailsPanel`; expose bridge fields from `resolveDailyPlanningTargets` / `computeTDEE` if needed. Files: `public/tools/CalorieTracker/ui/dashboard.js`, `public/tools/CalorieTracker/targets/dailyTargetResolver.js`, `public/tools/CalorieTracker/styles.css`.

- [ ] #49 Zero-log vacation / low-log quick button [quick win]
  - Show a vacation / low-log button only when the current day has zero food items, directly above food entry. Present Rest (~0-2k steps), Light (~5k steps), Moderate (~8-10k steps), Active (~12k+ steps), plus Custom / manual entry. Selection creates an estimate day through the existing vacation estimate engine. Files: `public/tools/CalorieTracker/index.html`, `public/tools/CalorieTracker/events/wire.js`, `public/tools/CalorieTracker/ui/dashboard.js`, `public/tools/CalorieTracker/analysis/engine.js`.

- [ ] #50 Shared chart date-range control [quick win]
  - Add a reusable per-chart date-range control with Last 7 days, Last 30 days, Last 90 days, YTD, 1 Year, Since goal start, and custom From / To pickers. Generalize existing `_chartState.timeframe` wiring and apply it to all existing charts. Files: `public/tools/CalorieTracker/ui/chart.js`, `public/tools/CalorieTracker/analysis/analysisUI.js`, new helper such as `public/tools/CalorieTracker/ui/dateRange.js`, `public/tools/CalorieTracker/index.html`, `public/tools/CalorieTracker/styles.css`.

### MEDIUM

- [ ] #51 New Corrections & Gaps tab split from Energy [larger refactor]
  - Add a dedicated Corrections & Gaps tab for missing-day fill, vacation editor, estimate management, imputation table, prior-day corrections, and gap handling. Energy should retain weight chart, TDEE/BMR/PAL model detail, KPI cards, and confidence detail without duplicating correction tools. Files: `public/tools/CalorieTracker/index.html`, `public/tools/CalorieTracker/ui/dashboard.js`, `public/tools/CalorieTracker/events/wire.js`, `public/tools/CalorieTracker/analysis/analysisUI.js`.

- [ ] #52 Recorded vs corrected/imputed calories chart with trend [quick win; depends on #50 and #51]
  - Add one clear Chart.js line chart to Corrections & Gaps showing recorded/logged calories, corrected or imputed calories recommended by the model, and a trend line across the selected date range. The chart should make model recommendations visually auditable. Files: `public/tools/CalorieTracker/analysis/analysisUI.js` or a new `public/tools/CalorieTracker/ui/correctionsChart.js`.

- [ ] #53 Dynamic micronutrient upper and lower bounds [larger refactor]
  - Upgrade nutrient rows to show lower bounds and upper bounds where evidence-based values exist, plus a position label such as Low, Within range, Near upper, or Over. Bounds and targets must be selected and scaled from profile data, including age, sex, weight, activity, and goal where applicable, and update immediately when the profile changes. Avoid hard-coded static display values beyond the underlying scientific reference tables. Files: `public/tools/CalorieTracker/ui/dashboard.js`, `public/tools/CalorieTracker/targets/nutritionReferences.js`, `public/tools/CalorieTracker/targets/targetEngine.js`, `public/tools/CalorieTracker/styles.css`.

- [ ] #54 Collapse long-form explanations and methodology notes [quick win]
  - Move long-form descriptions, methodology explanations, and statistical notes behind collapsible `details.collapsible` sections labelled More detail or How this is calculated across Energy, Nutrients, and Corrections. Main daily logging should remain focused on entry and current status. Files: `public/tools/CalorieTracker/analysis/analysisUI.js`, `public/tools/CalorieTracker/ui/dashboard.js`, `public/tools/CalorieTracker/styles.css`.

- [ ] #55 Larger-gap imputation with minimum data on each side [larger refactor]
  - Parameterize and document minimum pre-gap and post-gap day counts plus weight-point counts in `getTrueUpCandidates` so larger gaps are imputed only when both sides are well-supported. Surface chosen interval and confidence drivers in collapsible methodology blocks. Preserve centered-window behavior and outside-interval TDEE reference invariants. Add tests. Files: `public/tools/CalorieTracker/analysis/engine.js`, `public/tools/CalorieTracker/analysis/engine.test.js`.

- [ ] #56 Vacation days eligible for later weight-based correction [larger refactor]
  - Treat vacation quick-estimates as low-confidence priors that the centered-window true-up can refine later, while respecting `manualLock` / `estimateMeta.locked` and keeping estimated/vacation days excluded from TDEE regression to avoid circularity. Add tests for the no-circularity guarantee. Files: `public/tools/CalorieTracker/analysis/engine.js`, `public/tools/CalorieTracker/analysis/engine.test.js`.

### LOW / NICE-TO-HAVE

- [ ] #57 Mobile narrow-viewport pass [quick win]
  - Review the expanded six-tab navigation, macro bar wrapping, expandable target rows, vacation quick-choice interface, date-range controls, and Corrections & Gaps tab at approximately 390px width. Avoid horizontal page scroll and keep expansions usable. Files: `public/tools/CalorieTracker/styles.css`, `public/tools/CalorieTracker/index.html`.

- [ ] #58 Large historical import performance check [quick win]
  - Verify chart slicing, render budget, and corrections-tab performance with multi-year weight and food-log imports. Cap or decimate chart series if needed while preserving statistical calculations. Files: `public/tools/CalorieTracker/ui/chart.js`, `public/tools/CalorieTracker/analysis/analysisUI.js`.
