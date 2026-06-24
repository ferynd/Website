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
- [p] **#52 Recorded vs. corrected/imputed chart + trend** — *[quick win; depends on #50,
  #51]* Single Chart.js line chart on the Corrections tab showing, for the selected range:
  recorded/logged calories, model-corrected/imputed calories, and a trend line — so the user
  can visually evaluate whether the model's recommendation makes sense. Use `runAnalysis` rows
  + `getTrueUpCandidates` for corrected/imputed values, but reconstruct recorded calories from
  `dailyEntries.foodItems` excluding synthetic `est-` / `adj-` items (or another persisted
  original-log source) so previously corrected days do not collapse recorded and corrected lines.
  Uses the #50 date-range control. Files:
  new `ui/correctionsChart.js` (or `analysis/analysisUI.js`).
  > pushed — corrections chart with recorded/corrected/trend lines using date-range control; tests: 575 pass; commit: 04f625f
- [ ] **#53 Dynamic micronutrient upper+lower bounds** — *[larger refactor]* Show both the
  lower bound (DRI/RDA) and the upper bound (`UL_TABLE`) where evidence exists, with a
  position indicator (**Low / Within range / Near upper / Over**). Extend `renderNutrientRow`
  (`ui/dashboard.js:1668`) and `calculateMicronutrientMetrics` (`ui/dashboard.js:485`).
  Lower-bound selection is already profile-driven via age/sex bands (`getDRI`), but upper
  bounds currently come from a nutrient-wide `UL_TABLE`; add profile-specific UL lookup data
  where evidence exists, or narrow the UI/copy so only lower bounds are described as dynamic.
  Preserve evidence-based scaling (protein g/kg, electrolyte sweat scaling) and confirm recompute
  is reactive on profile change (debounced path in `targets/targetUI.js`). Note: DRI/UL
  magnitudes are fixed scientific constants — "dynamic" means profile-driven selection and
  scaling, not invented values. Files: `ui/dashboard.js`, `targets/nutritionReferences.js`,
  `targets/targetEngine.js`, `styles.css`.
_(#54 completed — moved to `backlogs/calorie-tracker-completed.md`)_
- [ ] **#55 Larger-gap imputation with min-data-on-each-side rigor** — *[larger refactor]*
  `getTrueUpCandidates` (`analysis/engine.js:1644`) already uses centered windows
  `[-7,+6]/[-14,+13]/[-21,+20]` with ≥50% coverage + minimum future weights. Parameterize and
  document the minimum pre/post day counts and weight-point counts so wider gaps impute only
  when **both** sides are well-supported, and surface the chosen interval + confidence drivers.
  Preserve centered windows. Strengthen the TDEE-reference invariant by requiring outside-
  interval blocks for correction by default; remove or explicitly gate the current
  `inside_interval` fallback for sparse histories so circular evidence cannot silently drive
  wider-gap corrections. Add tests. Files: `analysis/engine.js`, `analysis/engine.test.js`.
- [ ] **#56 Vacation days eligible for later weight-based correction** — *[larger refactor]*
  The one genuine model change: treat vacation/low-log quick-estimates (#49) as
  low-confidence priors that the centered-window true-up may later refine (respecting
  `manualLock` / `estimateMeta.locked`). Add the no-circularity exclusion in the TDEE/block
  pipeline itself: saved estimate/vacation days (for example entries with estimate/vacation
  metadata or synthetic estimate items) must be excluded from `estimateTDEE` regression blocks
  even if they have top-level `calories`, so low-confidence priors cannot train the model they
  are later corrected against. Add tests for the no-circularity guarantee. Files:
  `analysis/engine.js`, `analysis/engine.test.js`.

### LOW / NICE-TO-HAVE

- [ ] **#57 Mobile narrow-viewport pass** — *[quick win]* Validate the 6-tab bar scroll
  affordance, macro-bar wrapping, expandable target rows, and the date-range control at
  ~390px (no horizontal scroll, usable touch targets). Files: `styles.css`, `index.html`.
- [ ] **#58 Large-import performance check** — *[quick win]* Verify chart slicing and render
  budget with multi-year weight/log imports; cap series length / decimate if needed. Files:
  `ui/chart.js`, `analysis/analysisUI.js`.
