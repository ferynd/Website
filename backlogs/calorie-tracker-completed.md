# CalorieTracker — Completed Backlog

Archived record of completed improvement items for `public/tools/CalorieTracker/`.
Items started as a 45-point review punch list plus one follow-up feature request (#46).
All items have been merged to `main`.

For the active backlog (new items, protocol, invariants), see `backlogs/calorie-tracker.md`.

---

## CRITICAL — fix before broader rollout

- [x] **#1 — XSS via user-named foods**
  > Resolved: escapeHtml helper in utils/ui.js; applied to data.js, manager.js, save.js, analysisUI.js; dropdown.js rebuilt with DOM construction + addEventListener; merged 9fbc6d1

- [x] **#2 — No max bounds on nutrient inputs**
  > Resolved: HTML max attrs on actual-* and target-* inputs + NUTRIENT_MAX_BOUNDS in constants.js + clampNutrient in getStagedValues, wireSettingsEvents, collectManualOverrides; override grid inputs bounded; merged 716326e

- [x] **#3 — Date-change race condition**
  > Resolved: monotonic _dateChangeToken counter in wire.js; stale handlers bail before rendering; merged 9fbc6d1

- [x] **#4 — Silent Firestore fetch failures default to empty `{}`**
  > Resolved: all five initial-load fetches now throw on error; loadUserData retries 3× with backoff and shows persistent load-error-banner; merged 716326e

- [x] **#5 — Tab bar overflows ≤ 360 px with no scroll affordance**
  > Resolved: tab-bar-wrap with CSS gradient pseudo-element scroll shadows; JS scroll/resize listener toggles scroll-left/scroll-right classes; compact tab padding at ≤480 px; merged ca9a264

- [x] **#6 — TDEE plausibility floor is physiologically impossible; impute floor also low**
  > Resolved: TDEE_PLAUSIBLE_MIN 1200→1400, IMPUTE_CAL_MIN 600→800; vacation calorie bounds now use config constants; merged ca9a264

---

## HIGH — math / accuracy

- [x] **#7 — EWMA span = 10 under-smooths noisy daily weigh-ins**
  > Resolved: block comment explaining span 10 trade-off vs Hacker's Diet span 20, and how OLS water-correction compensates; merged 6ec05bd

- [x] **#8 — PAL grid ranges are empirically tuned with no documented rationale**
  > Resolved: block comment citing WHO/FAO/UNU 2001 and IOM DRI 2005, explaining 1.85 ceiling avoids double-counting for recreational exercisers; merged 6ec05bd

- [x] **#9 — `MIN_DAYS_FOR_WATER_REGRESSION = 20` silently excludes most users**
  > Resolved: lowered threshold from 20→14 (sufficient degrees of freedom for 2–3 predictor OLS); water correction method was already surfaced in Energy tab confidence card; merged 6ec05bd

- [x] **#10 — True-up fallback to inside-interval blocks is not user-visible**
  > Resolved: tdeeRefSource field added to each interval; analysisUI interval-math detail shows ref source with warning labels for inside-interval and hardcoded fallback; merged 6ec05bd

- [x] **#11 — Sodium "UL" is the CDRR target, not a Tolerable Upper Intake Level**
  > Resolved: CDRR comment block on sodium entry; null-UL entries annotated with NASEM rationale; target warning + Nutrients tab row/summary badges distinguish CDRR from UL for sodium; merged 6ec05bd

- [x] **#12 — Body-fat % outside realistic bounds accepted without warning**
  > Resolved: hidden warning element in HTML; validateBodyFatInput() in targetUI.js shows tiered warnings for <5%, <8%, >50%, >60%; Cunningham bounds now inclusive (>=5, <=60); merged 6ec05bd

- [x] **#13 — Carb-clamp-to-zero in auto-generated targets has no user warning**
  > Resolved: protein+fat vs calorie check after computeCarbsTarget in generateTargets; warning mirrors the manual-override path format; merged 6ec05bd

---

## HIGH — functionality

- [x] **#14 — No duplicate detection in paste-and-parse staging**
  > Resolved: findDailyDuplicate checks name+calories before addStagedNutrientsToDailyLog; confirmation modal on match; 7 new tests; merged dc02f4f

- [x] **#15 — No realtime sync / no offline note**
  > Resolved: dismissible sync-notice banner above food list after data load; localStorage remembers dismissal; merged dc02f4f

- [x] **#16 — Deleting a food item or exercise session is irreversible**
  > Resolved: showUndoToast + exported flushPendingUndo in utils/ui.js; removeFoodItem and removeExerciseSessionById defer Firestore write until 5s undo window closes; rollback on save error; merged dc02f4f

- [x] **#46 — "Current weight required" nag fires regardless of weigh-in age**
  > Resolved: energy-balance current-weight estimate via projectWeightForward; hard notice only when no weight data at all; soft notice when last weigh-in older than 21 days; merged be6d028

---

## HIGH — code structure

- [x] **#17 — `ui/dashboard.js` (~1 873 lines) mixes banking math with rendering**
  > Resolved: bankingEngine.js with calcBankingCore(); dashboard.js delegates; banking.test.js tests directly; merged c4661db

- [x] **#18 — Two `@legacy` functions with no live callers**
  > Resolved: estimateEWMAFromSinglePoint and classifyWaterNoiseLevel removed; remaining @legacy functions preserved per invariants; merged c4661db

- [x] **#19 — Import triangle between dashboard, analysisUI, and targetEngine**
  > Resolved: imports form a one-directional DAG; no circular dependency exists; merged c4661db

- [x] **#20 — Duplicate quantity coercion in three places**
  > Resolved: food/manager.js imports coerceQuantity from store.js; merged c4661db

- [x] **#21 — Firestore snake_case leaks into UI layer alongside camelCase**
  > Resolved: normalizeWeightEntry/denormalizeWeightEntry in schema.js; firebase.js boundary; all UI uses camelCase; merged c4661db

---

## HIGH — accessibility

- [x] **#22 — Tab keyboard navigation missing arrow-key support**
  > Resolved: arrow-key handler with tabindex roving (active=0, inactive=-1) per WAI-ARIA APG; merged ea11d84

- [x] **#23 — Muted text contrast borderline in dark theme**
  > Resolved: --text-3 lightness increased from 46% to 52% in dark theme; merged ea11d84

- [x] **#24 — Nutrient status conveyed by color only**
  > Resolved: text status badges (low/near/ok) on each nutrient row via nt-status-bad/warn/good classes; merged ea11d84

- [x] **#25 — No `aria-describedby` linking form errors to inputs**
  > Resolved: aria-describedby on login (email/password), exercise (duration), body-fat inputs; inline .form-error elements with role=alert; merged ea11d84

---

## HIGH — mobile / visual

- [x] **#26 — Today's calorie KPI is buried below the input column on mobile**
  > Resolved: macro values bumped to .875rem; calories cell shows prominent "X left" remaining figure with .macro-remaining class at 1rem; merged 5f8d8a0

- [x] **#27 — Fixed pixel chart height (400 px desktop / 280 px mobile)**
  > Resolved: chart-container uses clamp(220px, 50vw, 420px); mobile override removed; Chart.js already had responsive:true, maintainAspectRatio:false; merged 5f8d8a0

- [x] **#28 — Modals not safe at 320 px**
  > Resolved: modal-content min-width:280px; ≤360px media query reduces padding to 1rem and drops min-width; merged 5f8d8a0

- [x] **#29 — Nutrient form `max-h-[45vh]` clips on small phones**
  > Resolved: max-h-[45vh] raised to 65vh at ≤480px viewport; merged 5f8d8a0

- [x] **#30 — No empty states**
  > Resolved: exercise empty state enhanced with icon and CTA; food list and nutrients tab already had empty states; merged 5f8d8a0

- [x] **#31 — No save confirmation feedback**
  > Resolved: flashSaveConfirmation() in utils/ui.js; applied to add-to-log, save-food, save-profile, apply-targets buttons; .btn-saved CSS class; merged 5f8d8a0

---

## HIGH — UI/UX & information architecture

- [x] **#47 — Today macro summary bar redesign**
  > Resolved: redesigned sticky macro header and dashboard hero card with prominent remaining-calorie readout, compact P/F/C grid, stripped inline formula text; merged 2de2407

- [x] **#48 — Clickable target → expandable financial-statement breakdown**
  > Resolved: clickable details target with financial-statement breakdown panel (TDEE → Base → Exercise → Banking → Goal deficit → Final Target plus macro targets); merged bcb139b, fix dbd2509

---

## MEDIUM — polish & hygiene

- [x] **#32 — Chart.js 3.9.1 is two majors behind**
  > Resolved: upgraded CDN from 3.9.1 to 4.5.0 (chart.umd.min.js); added explicit type:'linear' to y2 scale per v4 migration; merged via PR #131 (29c2c2f)

- [x] **#33 — Chart tooltip colors hardcoded, ignoring theme tokens**
  > Resolved: getTooltipConfig() reads --surface-1/--text/--border at render time; applied to chart.js and both analysisUI.js charts; merged 635a289

- [x] **#34 — Auto-target → Apply is a two-step flow with long scroll on mobile**
  > Resolved: Apply button moved above explanation; explanation and manual overrides in collapsible details; scroll targets preview section; merged 13bc5d5

- [x] **#35 — Exercise modal has too many visible fields for quick logging**
  > Resolved: RPE, wearable cal, manual cal, and notes wrapped in collapsible details "More options"; auto-opens on edit when advanced fields populated; merged 13bc5d5

- [x] **#36 — Food search has no inline quantity input**
  > Resolved: food-inline-qty input between search and +Add; syncs with actual-quantity via bidirectional input listeners + programmatic sync on saved-food select; merged c979880

- [x] **#37 — No skeleton loaders during initial data fetch**
  > Resolved: spinner replaced with skeleton-loader: header, tabs, macro bar, and card placeholders with pulse animation; merged 13bc5d5

- [x] **#38 — Native number-input spinners are visually noisy**
  > Resolved: webkit inner/outer spin-button hidden + moz-appearance:textfield in styles.css; merged 635a289

- [x] **#39 — Activity level radio buttons are text-heavy**
  > Resolved: inline SVG icons per activity level (monitor, walking, jogging, running, flame); .activity-icon styled with theme color; merged 635a289

- [x] **#40 — Null UL entries lack explanatory comments**
  > Resolved: already resolved by #11; all null UL entries have NASEM-citing inline comments; no code change needed; merged 635a289

---

## LOW / NICE-TO-HAVE

- [x] **#41 — Fluid typography is half-applied**
  > Resolved: body font-size uses clamp(); all .text-xs through .text-3xl utilities use clamp() for fluid scaling; merged d2aeb0a

- [x] **#42 — No PWA / Add to Home Screen support**
  > Resolved: manifest.json + SVG/PNG icons (192/512); service worker with stale-while-revalidate for same-origin shell assets; external runtime deps (Chart.js 4.5.0, Firebase ESM) precached at install for offline first launch; Firebase/Google APIs network-only; merged via PR #131 (29c2c2f)

- [x] **#43 — No CSV bulk-import for saved foods**
  > Resolved: importSavedFoodsCsv in exporters.js; RFC 4180 CSV parsing with BOM stripping and header normalization; quantity column preserved on export and import round-trip; nutrient values clamped to NUTRIENT_MAX_BOUNDS with clamped-count summary; wired via hidden file input + button in Settings; merged via PR #131 (29c2c2f)

- [x] **#44 — `<details>` expand arrow is a pseudo-content character**
  > Resolved: replaced unicode triangle with CSS border chevron; scales cleanly on hidpi; rotates 45deg on open; literal marker removed from micronutrient summary; merged d2aeb0a

- [x] **#45 — Documentation update checklist not enforced**
  > Resolved: added doc-update confirmation line to PR checklist in CONTRIBUTING.md; BACKLOG added to docs list; merged d2aeb0a

## UI/UX & information-architecture review (#47+)

- [x] **#47 — Today macro summary bar redesign**
  > Resolved: redesigned sticky macro header and dashboard hero card with prominent remaining-calorie readout, compact P/F/C grid, condensed warnings; merged via PR #135 (2de2407)

- [x] **#48 — Clickable target → expandable financial-statement breakdown**
  > Resolved: target number expands to financial-statement breakdown (TDEE → Base → Exercise → Banking → Floor → Final); includes goal deficit row and capped bank context; merged via PR #135 (bcb139b)

- [x] **#49 — Zero-log vacation / low-log quick button**
  > Resolved: vacation quick-estimate panel with 4 presets (Rest/Light/Moderate/Active) + custom; rest key added to VACATION_TYPE_CONFIG; isDayEmpty guards non-null dayActivityLevel; merged via PR #136 (200a37b)

- [x] **#50 — Shared chart date-range control**
  > Resolved: new ui/dateRange.js with chip presets (7d/30d/90d/YTD/1yr/All) + custom From/To; applied to nutrient, weight, and eating charts; analysis charts anchor to today; rolling avg computed from full history; merged via PR #136 (df2b0af)

- [x] **#51 — New "Corrections & Gaps" tab (split from Energy)**
  > Resolved: new Corrections tab with renderCorrectionsSection/initCorrectionsEvents; moved imputation table, missing calories, vacation editor, estimate management from Energy; updateDashboard refreshes Corrections when active; candidates recomputed on each render; merged via PR #137 (f52dd1d)

- [x] **#54 — Collapse long-form explanations**
  > Resolved: eating pattern notes, energy detail card, TDEE horizons, PAL table, vacation/imputation explanations, info boxes all wrapped in collapsible details elements; merged via PR #137 (ffe15a9)

---

## What was already verified as correct (do not regress)

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
