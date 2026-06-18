# CalorieTracker — Backlog

Single source of truth for ongoing work on `public/tools/CalorieTracker/`. Items started life as
a 45-point review punch list; new feature requests and bug reports are added here as they come
up.

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
   Leave pushed-but-unmerged items `[p]`. **This is the only way items reach `[x]`** — hands-off,
   but never before the user has actually merged the PR.
5. Read this file end-to-end. Identify (a) any `[p]` items needing follow-up from review or a
   prior session, then (b) the highest-priority `[ ]` items, in section order
   (CRITICAL → HIGH → MEDIUM → LOW).
6. Pick the next reasonable batch — usually one suggested session group (A–I) or one to three
   related items.
7. Implement. Mark each touched item `[p]` with a one-line note (see status legend below).
8. Run the Vitest suite from this directory: `npm test`. Keep it green.
9. Commit with a **descriptive** Conventional-Commit message. Format:
   `type(calorie-tracker): #N short description of the change`
   The message must include: (a) the Conventional Commit type (`feat`, `fix`, `refactor`, etc.),
   (b) the `(calorie-tracker)` scope so it's clear which part of the site changed, (c) the
   backlog item number(s) (`#N`), and (d) a plain-English summary of what the commit does — not
   just the item title.
   Examples:
   - `feat(calorie-tracker): #46 estimate current weight via energy balance when weigh-in data is stale`
   - `fix(calorie-tracker): #6 raise TDEE plausibility floor from 1200 to 1400 kcal`
   - `refactor(calorie-tracker): #17 split dashboard.js into focused modules`
   One commit per logical change. Multi-item commits list all numbers: `#1 #2 ...`.
10. Push: `git push -u origin working/calorie-tracker-backlog` (or the pinned `claude/*` branch in
    a web session).
11. **Record the commit SHA** on every item you pushed (`commit: <short-sha>` in its `[p]` note,
    plus the PR number when known). The next session's reconcile step keys off this SHA — an item
    with no recorded SHA can never be auto-completed.
12. **PR title and body must be descriptive.** If no open PR exists for the branch, create one
    via the GitHub MCP tools. Format:
    - **Title:** `CalorieTracker: <short summary of batch> (#N, #N, …)`
      Example: `CalorieTracker: weight estimation fix, TDEE floor adjustment (#46, #6)`
    - **Body:** list every item addressed with its number and one-line summary, plus a pointer to
      this file. Update the body on subsequent pushes when new items are added to the batch.
    All subsequent pushes auto-update the same PR.

## Status legend

| Mark | Meaning |
|------|---------|
| `[ ]` | Not started. |
| `[p]` | In progress / pushed / awaiting merge / blocked / needs follow-up. **Default state once code has been touched.** Records a `commit: <short-sha>` once pushed. |
| `[x]` | Complete — the item's commit has merged to `main` (the user accepted the PR). Set automatically by the reconcile step (step 4); never set for merely-pushed code. |

The note line under a `[p]` item begins with one of these sub-labels so the state is scannable:

- `> pushed — <one-line summary>; tests: <pass/notes>; commit: <short-sha>` (awaiting merge)
- `> in progress — <what's left>`
- `> blocked — <reason>`
- `> needs follow-up — <what the reviewer said>; commit: <short-sha>`

When the item's commit merges to `main`, the next session's reconcile step flips the box and
collapses the note to a single line:

- `> Resolved: <one-line summary>; tests: <pass/notes>; merged <short-sha>`

## Editing rules

- **Mark `[p]` when you push; let the reconcile step (step 4) flip `[p]`→`[x]` once the commit is
  merged to `main`.** Never mark `[x]` for code that is only pushed, and never flip it manually
  mid-session — merge to `main` is the single signal that an item is done.
- A not-started `[ ]` item carries the placeholder note `> Resolved in: _pending_`. Replace it
  with a `[p]` sub-label when you start the item; the reconcile step replaces it with
  `> Resolved: …; merged <sha>` once merged.
- Keep notes to **one line** per item. No pasted diffs, no multi-paragraph rationale — reference
  the commit hash and let the diff speak.
- If the same item is revised after review, **replace** the existing note line (don't append) so
  the file doesn't grow.
- New items the user asks to add get slotted into the most appropriate existing priority section
  (CRITICAL → HIGH → MEDIUM → LOW) based on severity, dependencies, and impact — not appended at
  the bottom.
- Renumbering is not required when adding items; pick the next free number (#47, #48, …).

## Branch and PR strategy

- **Working branch:** `working/calorie-tracker-backlog`, long-lived, branched from `main`. One
  PR is open against `main` at any time and is updated by every push. Preferred over the
  ephemeral `claude/*` per-session branches when the environment lets you switch.
- **Web/remote sessions:** the harness may pin a per-session `claude/*` branch you cannot switch
  off. That is fine — open or append to a PR against `main` from it. Because completion is
  detected from commits merged to `main` (step 4), the workflow does not depend on the branch
  name being stable.
- **Merging:** The user merges the PR when they want to lock in a batch of items. On the next
  session, the reconcile step auto-marks the merged items `[x]`. After merge, the working branch
  is reset/rebased onto the new `main` (or deleted and recreated) for the next round.
- **Why this shape:** stable name → stable PR URL → continuity across sessions, with git as the
  hand-off rather than chat history.

## Suggested session groupings

Run in order when starting from a clean backlog. Each group is scoped to minimize cross-cutting
risk.

| Session | Items | Focus |
|---------|-------|-------|
| **A** | #1–4 | Security & data integrity (XSS, input bounds, race condition, silent errors) |
| **B** | #5–6 | Critical UX + math floors (tab overflow, TDEE/impute floor) |
| **C** | #7–13 | Math/accuracy annotations (EWMA note, PAL docs, regression threshold, UL label, BF% validation, carb-clamp warning) |
| **D** | #14–16 | Functionality gaps (duplicate detection, delete undo, offline note) |
| **E** | #17–21 | Code structure (dashboard split, legacy cleanup, import triangle, naming) |
| **F** | #22–25 | Accessibility (keyboard nav, contrast, color-only status, aria-describedby) |
| **G** | #26–31 | Mobile UX (KPI prominence, chart height, modal width, form scroll, empty states, save feedback) |
| **H** | #32–40 | Polish (Chart.js upgrade, tooltip tokens, auto-target UX, exercise modal, food search, skeletons, spinner, activity icons, UL null comments) |
| **I** | #41–45 | Nice-to-have (fluid type, PWA, CSV food import, details arrow, doc checklist) |

## Test command

From `public/tools/CalorieTracker/`:

```
npm test
```

Baseline: **568 tests, 9 files, all passing.** Any session that changes logic must keep this
green and add tests for new validators or pure functions.

---

## CRITICAL — fix before broader rollout

- [x] **#1 — XSS via user-named foods**
  `food/save.js:141-162`, `food/manager.js:99` — food names are user-controlled and rendered via template-literal `innerHTML`. Replace with `textContent` / DOM construction at every point where `f.name` or `d.nutrient` enters the DOM.
  > Resolved: escapeHtml helper in utils/ui.js; applied to data.js, manager.js, save.js, analysisUI.js; dropdown.js rebuilt with DOM construction + addEventListener; tests: 568 pass; merged 9fbc6d1

- [x] **#2 — No max bounds on nutrient inputs**
  `index.html:166-202`, `events/wire.js:132` — user can save `99999999` kcal, breaking all downstream calculations. Add per-nutrient `max` HTML attributes and a JS validation gate before any Firestore write (kcal ≤ 10 000, macros ≤ 1 000 g, micros at 10× UL).
  > Resolved: HTML max attrs on actual-* and target-* inputs + NUTRIENT_MAX_BOUNDS in constants.js + clampNutrient in getStagedValues, wireSettingsEvents, collectManualOverrides; override grid inputs bounded; tests: 568 pass; merged 716326e

- [x] **#3 — Date-change race condition**
  `services/data.js:142`, `ui/dashboard.js:148` — changing the date mid-fetch lets a stale response overwrite the UI with the wrong day's food items. Tag each in-flight request with the requested date string and discard any response that doesn't match the current selection.
  > Resolved: monotonic _dateChangeToken counter in wire.js; stale handlers bail before rendering; tests: 568 pass; merged 9fbc6d1

- [x] **#4 — Silent Firestore fetch failures default to empty `{}`**
  `services/firebase.js:121` — a network blip reads as "no saved targets," so users unknowingly run on system defaults with no indication. Surface a visible banner, retry with exponential backoff, and distinguish "load error" from "empty."
  > Resolved: all five initial-load fetches (targets, entries, weight, profile, goals) now throw on error; loadUserData retries 3× with backoff and shows persistent load-error-banner; tests: 568 pass; merged 716326e

- [x] **#5 — Tab bar overflows ≤ 360 px with no scroll affordance**
  `styles.css:326-334` — five tabs at `flex: 0 0 auto` total ~450 px, silently clipping Profile & Settings on iPhone SE / small Android. The scrollbar is hidden with no visual indicator. Add scroll-shadow edge fades at both ends, or convert to a "more" overflow menu under 640 px.
  > Resolved: tab-bar-wrap with CSS gradient pseudo-element scroll shadows; JS scroll/resize listener toggles scroll-left/scroll-right classes; compact tab padding at ≤480 px; tests: 568 pass; merged ca9a264

- [x] **#6 — TDEE plausibility floor is physiologically impossible; impute floor also low**
  `analysis/engine.js:30` `TDEE_PLAUSIBLE_MIN: 1200` — below BMR for any adult with any activity. Raise to 1 400 kcal.
  `analysis/engine.js:48` `IMPUTE_CAL_MIN: 600` — below basal for most users. Raise to 800 kcal.
  Both are single constant changes with an existing test that must be updated.
  > Resolved: TDEE_PLAUSIBLE_MIN 1200→1400, IMPUTE_CAL_MIN 600→800; vacation calorie bounds now use config constants; test updated; tests: 568 pass; merged ca9a264

---

## HIGH — math / accuracy

- [p] **#7 — EWMA span = 10 (α ≈ 0.182) under-smooths noisy daily weigh-ins**
  `analysis/engine.js:20` — a 2 lb water spike at this alpha persists ~5 days in the trend line. Hacker's Diet uses α ≈ 0.1 (span ≈ 20). Consider raising span to 14 (α ≈ 0.133) or exposing as a user preference. At minimum, add a comment in `ANALYSIS_CONFIG` explaining the trade-off (faster response vs. more noise).
  > pushed — block comment explaining span 10 trade-off vs Hacker's Diet span 20, and how OLS water-correction compensates; tests: 568 pass; commit: 6ec05bd

- [p] **#8 — PAL grid ranges are empirically tuned with no documented rationale**
  `analysis/engine.js:36-43` — the upper bound of 1.85 at 400 kcal/day exercise could double-count activity if the user's baseline already reflects training. Add a block comment explaining the empirical origin (or basis in literature), and reconsider whether 1.75 is a safer maximum.
  > pushed — block comment citing WHO/FAO/UNU 2001 and IOM DRI 2005, explaining 1.85 ceiling avoids double-counting for recreational exercisers; tests: 568 pass; commit: 6ec05bd

- [p] **#9 — `MIN_DAYS_FOR_WATER_REGRESSION = 20` silently excludes most users**
  `analysis/engine.js:26` — most users won't have 20 days of complete sodium + carbs + weight data; they fall back to the bucket method with no notice. Consider lowering the threshold to 14 days (if sodium/carb coverage ≥ 70%) and surface which correction method is active in the Energy tab UI.
  > pushed — lowered threshold from 20→14 (sufficient degrees of freedom for 2–3 predictor OLS); water correction method was already surfaced in Energy tab confidence card; tests: 568 pass; commit: 6ec05bd

- [p] **#10 — True-up fallback to inside-interval blocks is not user-visible**
  `analysis/engine.js:1761-1772` — when outside-interval TDEE blocks are scarce, the engine silently falls back to inside-interval data (which can be distorted by the very missing days being estimated). Add a caveat in the Energy tab when fallback mode is active ("estimate uses weeks that contain gaps").
  > pushed — tdeeRefSource field added to each interval; analysisUI interval-math detail shows ref source with warning labels for inside-interval and hardcoded fallback; tests: 568 pass; commit: 6ec05bd

- [p] **#11 — Sodium "UL" is the CDRR target, not a Tolerable Upper Intake Level**
  `targets/nutritionReferences.js:185-206` — NASEM did not establish a true UL for sodium; 2 300 mg is the Chronic Disease Risk Reduction target. Mislabeling it "UL" causes users to see "over UL" warnings at moderate sodium intakes. Add a comment: `// CDRR target — no established UL per NASEM`. Consider whether the warning copy in the UI should reflect this distinction.
  > pushed — CDRR comment block on sodium entry; null-UL entries annotated with NASEM rationale; target warning text distinguishes CDRR from UL for sodium; tests: 568 pass; commit: 6ec05bd

- [p] **#12 — Body-fat % outside realistic bounds accepted without warning**
  `analysis/engine.js:647`, `targets/targetEngine.js:141` — the valid range is `[5, 60]` but no validation message is shown if a user enters 3% or 70%. Add an inline warning (not a hard block) in the Profile & Goals form for out-of-range values.
  > pushed — hidden warning element in HTML; validateBodyFatInput() in targetUI.js shows tiered warnings for <5%, <8%, >50%, >60%; tests: 568 pass; commit: 6ec05bd

- [p] **#13 — Carb-clamp-to-zero in auto-generated targets has no user warning**
  `targets/targetEngine.js:566-569` — when protein + fat exceed the calorie total, carbs silently clamp to 0. The override path already has a warning at lines 758-782; apply the same warning to the auto-generated path so users know their goal macro split is infeasible.
  > pushed — protein+fat vs calorie check after computeCarbsTarget in generateTargets; warning mirrors the manual-override path format; tests: 568 pass; commit: 6ec05bd

---

## HIGH — functionality

- [ ] **#14 — No duplicate detection in paste-and-parse staging**
  Pasting the same nutrition label twice yields two food entries with identical names and values. Hash on `name + kcal` (or similar fingerprint) and prompt the user to confirm before adding an apparent duplicate.
  > Resolved in: _pending_

- [ ] **#15 — No realtime sync / no offline note**
  Only one-shot `getDoc`/`getDocs` calls — a second device's edits never appear without a page reload. Either migrate `dailyEntries/{today}` to `onSnapshot()` for live sync, or document the single-device limitation prominently in the UI (currently only in README Known Limitations).
  > Resolved in: _pending_

- [ ] **#16 — Deleting a food item or exercise session is irreversible**
  There is no undo path after confirmation. Add a 5-second undo toast that re-adds the item before it is written to Firestore, giving users a quick recovery window.
  > Resolved in: _pending_

- [x] **#46 — "Current weight required" nag fires regardless of weigh-in age**
  `targets/targetEngine.js`, `analysis/engine.js`, `targets/targetUI.js`, `constants.js` — the notice showed unconditionally, on a debounced auto-calc that runs before data loads. Now the current weight is estimated forward from the last weigh-in via energy balance (`projectWeightForward`: calories-in − TDEE since the last weigh-in, water-corrected smoothed baseline, drift-capped); the hard "Current weight is required" notice shows only on an explicit Auto-Calculate when there is no weight data at all; and a soft, non-blocking notice appears only when the last weigh-in is older than `WEIGHT_FRESHNESS_THRESHOLD_DAYS` (21).
  > Resolved: energy-balance current-weight estimate + 21-day freshness gate; tests: 554 pass; merged be6d028

---

## HIGH — code structure

- [ ] **#17 — `ui/dashboard.js` (~1 873 lines) mixes banking math with rendering**
  Extract pure banking calculation logic into `ui/bankingEngine.js`. `ui/banking.test.js:33-68` already re-implements the same math to enable testing — the duplication disappears once the module is separated. Dashboard imports and renders; engine calculates.
  > Resolved in: _pending_

- [ ] **#18 — Two `@legacy` functions with no live callers**
  `analysis/engine.js:1105` `estimateEWMAFromSinglePoint` and `engine.js:1538` `classifyWaterNoiseLevel` — grep confirms zero references outside the file itself. Delete them or move to `analysis/legacy.js` with a note that they are kept for backward compatibility only.
  > Resolved in: _pending_

- [ ] **#19 — Import triangle between dashboard, analysisUI, and targetEngine**
  `ui/dashboard.js:30` ↔ `ui/analysisUI.js:31` ↔ `targets/targetEngine.js` — shared leaf helpers should be extracted to a neutral module to break the cycle.
  > Resolved in: _pending_

- [ ] **#20 — Duplicate quantity coercion in three places**
  `state/store.js:115-120` (`coerceQuantity`), `food/manager.js:69`, `services/data.js:206` — consolidate to a single import from `store.js`.
  > Resolved in: _pending_

- [ ] **#21 — Firestore snake_case leaks into UI layer alongside camelCase**
  `weight_lb`, `time_min` (Firestore shape) appear alongside `dailyEntries`, `trainingBump` (camelCase) throughout UI code. `state/schema.js` already normalizes some fields — make it the single boundary; no raw Firestore key names should appear outside `services/`.
  > Resolved in: _pending_

---

## HIGH — accessibility

- [ ] **#22 — Tab keyboard navigation missing arrow-key support**
  `index.html:52-58` — ARIA roles are present but no Left/Right key handler exists. WAI-ARIA Authoring Practices requires arrow-key navigation within a tablist. Add a `keydown` listener on the tab bar.
  > Resolved in: _pending_

- [ ] **#23 — Muted text contrast borderline in dark theme**
  `shared-styles.css:42-43` — `--text-3: 220 9% 46%` on `--bg: 220 43% 8%` computes to roughly 5.2:1 (passes AA large text, fails WCAG AA for body text). Increase lightness by ~6 points.
  > Resolved in: _pending_

- [ ] **#24 — Nutrient status conveyed by color only**
  Red/amber/green tags have no text label or icon fallback for colorblind users. Add a short text indicator (e.g., "low", "ok", "over") or a distinct icon per state.
  > Resolved in: _pending_

- [ ] **#25 — No `aria-describedby` linking form errors to inputs**
  Error messages render in modals or adjacent divs with no programmatic link to the field that caused them, so screen readers don't associate the two.
  > Resolved in: _pending_

---

## HIGH — mobile / visual

- [ ] **#26 — Today's calorie KPI is buried below the input column on mobile**
  The macro summary bar (`index.html:61`) has 0.75 rem values (`styles.css:385`), is easy to miss, and doesn't show "remaining" prominently. Bump value font to 0.875–0.95 rem and make the remaining-calories figure the largest item in the bar — it's the question users open the app to answer.
  > Resolved in: _pending_

- [ ] **#27 — Fixed pixel chart height (400 px desktop / 280 px mobile)**
  `styles.css:535` — use `clamp(220px, 50vw, 420px)` and ensure Chart.js is initialized with `responsive: true, maintainAspectRatio: false` so the chart fills its container fluidly.
  > Resolved in: _pending_

- [ ] **#28 — Modals not safe at 320 px**
  Food Manager (`index.html:650`) and Exercise (`index.html:692`) modals use `max-w-4xl` and `p-4` outer padding. Add `min-width: 280px` and test at 320–360 px viewports.
  > Resolved in: _pending_

- [ ] **#29 — Nutrient form `max-h-[45vh]` clips on small phones**
  The collapsible nutrient input section uses a fixed viewport-height cap that leaves bottom inputs behind a tiny scroll area on 360 px phones. Remove or raise the cap conditionally on narrow viewports.
  > Resolved in: _pending_

- [ ] **#30 — No empty states**
  Food items list, Nutrients tab, and Exercise session list all render as blank divs when empty. Add a one-line placeholder with an icon and a CTA (e.g., "No foods logged yet — add your first item above").
  > Resolved in: _pending_

- [ ] **#31 — No save confirmation feedback**
  Save buttons show no "Saved ✓" state. Users tap repeatedly because there is no signal that the write succeeded. Add a 1.5-second transient checkmark or toast per save action.
  > Resolved in: _pending_

---

## MEDIUM — polish & hygiene

- [ ] **#32 — Chart.js 3.9.1 is two majors behind**
  `index.html:11` loads Chart.js 3.9.1 from CDN; current stable is v4.x with better mobile defaults and a smaller bundle. Pin a regression baseline with the existing smoke-test checklist before upgrading.
  > Resolved in: _pending_

- [ ] **#33 — Chart tooltip colors hardcoded, ignoring theme tokens**
  `ui/chart.js:27-38` — tooltip background and text colors are hardcoded dark values. Read `--surface-2` and `--text` CSS variables so tooltips adapt if the theme ever changes.
  > Resolved in: _pending_

- [ ] **#34 — Auto-target → Apply is a two-step flow with long scroll on mobile**
  "Auto-Calculate" and "Apply to Baseline Targets" are far apart vertically on mobile. Combine into a single confirm-and-apply action with a collapsible diff view showing what changed.
  > Resolved in: _pending_

- [ ] **#35 — Exercise modal has too many visible fields for quick logging**
  `index.html:691-790` — RPE, distance, steps, wearable calories, and manual calories are all visible at once. Default to duration + intensity only; progressively disclose the rest.
  > Resolved in: _pending_

- [ ] **#36 — Food search has no inline quantity input**
  Users must select from the dropdown and then click +Add. Add a quantity field inline with the search row so the action collapses to one step.
  > Resolved in: _pending_

- [ ] **#37 — No skeleton loaders during initial data fetch**
  Five Firestore reads run in parallel on load behind a full-screen spinner with no incremental feedback. Replace or supplement with per-section skeleton cards.
  > Resolved in: _pending_

- [ ] **#38 — Native number-input spinners are visually noisy**
  Hide with `::-webkit-outer-spin-button { -webkit-appearance: none; }` across all `input[type="number"]` fields in `styles.css`, or provide custom ± buttons on mobile.
  > Resolved in: _pending_

- [ ] **#39 — Activity level radio buttons are text-heavy**
  `index.html:341-376` — no visual differentiation between levels. Add a small icon (e.g., walking, jogging, lifting) at the left of each row.
  > Resolved in: _pending_

- [ ] **#40 — Null UL entries lack explanatory comments**
  `targets/nutritionReferences.js:199-206` — potassium, dietary magnesium, vitamin B12, and vitamin K have no UL because NASEM found no toxicity threshold, not because the values are missing or unknown. Add a short comment so future maintainers don't "fix" them.
  > Resolved in: _pending_

---

## LOW / NICE-TO-HAVE

- [ ] **#41 — Fluid typography is half-applied**
  Only the app title uses `clamp()` (`styles.css:308`). Extend to body, label, and value text for smoother cross-device scaling.
  > Resolved in: _pending_

- [ ] **#42 — No PWA / Add to Home Screen support**
  A daily-use nutrition app benefits enormously from a web app manifest + service worker. Install prompt and offline-first loading would meaningfully improve the mobile experience.
  > Resolved in: _pending_

- [ ] **#43 — No CSV bulk-import for saved foods**
  Export exists; import does not. Mirror the Date Night Roulette batch-upload pattern to allow users to seed or migrate their food database from a spreadsheet.
  > Resolved in: _pending_

- [ ] **#44 — `<details>` expand arrow is a pseudo-content character**
  `styles.css:460` uses `content: '▶'` on `summary::before`. Replace with an SVG icon or Font Awesome caret for better scaling on hidpi displays.
  > Resolved in: _pending_

- [ ] **#45 — Documentation update checklist not enforced**
  The project rules in `AI_AGENTS.md` require docs updates in the same PR as fundamental changes, but there is no checklist item in `CONTRIBUTING.md` (or this README's smoke-test list) to verify it. Add a doc-update line to the PR checklist in `CONTRIBUTING.md`.
  > Resolved in: _pending_

---

## What was already verified as correct (do not regress)

The following were audited and confirmed accurate — do not change these without a corresponding test update and reference citation:

- **Energy density constant** `7 700 kcal/kg` (`engine.js:17`) — matches the standard 3 500 kcal/lb.
- **Mifflin-St Jeor formula** (`nutritionReferences.js:266-269`) — exact match to Mifflin et al. 1990.
- **Cunningham RMR formula** (`nutritionReferences.js:276-278`) — `500 + 22 × FFM_kg`, exact match to Cunningham 1991.
- **PAL multipliers** (`nutritionReferences.js:238-244`) — within ±0.05 of WHO/IOM standards.
- **DRI tables** — spot-checked iron, vitamin D, magnesium, sodium, calcium against NASEM 2019–2023; all correct.
- **2024 Compendium MET values** — walking 3.5, running ~9.8, cycling 7.5, lifting 5.0, HIIT 8.0 all verified.
- **OLS with ridge = 0.01** (`engine.js:168`) — numerically stable, not a meaningful bias term; correct.
- **Trimmed mean (10%)** (`engine.js:90-96`) — symmetric, falls back to median for N < 4; correct.
- **Centered-window true-up** (`engine.js:1657-1661`) — intervals bracket the candidate day; avoids end-anchored distortion; correct.
- **Protein basis priority chain** for fat loss — lean mass → target weight → current weight; matches ISSN guidance.
- **TDEE confidence thresholds** — rough 14 d / moderate 28 d / high 42 d — defensible against published variance estimates.
- **Fat floor** `max(40 g, 0.5 g/kg, 20% kcal)` (`targetEngine.js:537-553`) — matches metabolic health and hormonal guidelines.

---

## Test suite baseline

Run from `public/tools/CalorieTracker/`:

```
node_modules/.bin/vitest run
```

Baseline: **568 tests, 9 files, all passing.** Any session that changes logic files must keep this green. Add tests for new validators, the date-change cancellation token, and any new pure functions introduced.
