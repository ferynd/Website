# CalorieTracker — Completed Archive

Compact merged history for `public/tools/CalorieTracker/`. Read only for reconciliation, regression investigation, or historical review. Detailed rationale remains in the implementation commits/PRs.

## Completed items

- [x] **#1 XSS via user-named foods** — escaped/DOM-safe rendering; merged `9fbc6d1`.
- [x] **#2 Nutrient input maximum bounds** — HTML and runtime clamps; merged `716326e`.
- [x] **#3 Date-change race** — stale handler token guard; merged `9fbc6d1`.
- [x] **#4 Silent Firestore load failures** — retry and persistent error state; merged `716326e`.
- [x] **#5 Narrow tab overflow** — scroll affordance and compact spacing; merged `ca9a264`.
- [x] **#6 TDEE/imputation plausibility floors** — raised and centralized; merged `ca9a264`.
- [x] **#7 EWMA smoothing rationale** — documented trade-off; merged `6ec05bd`.
- [x] **#8 PAL range rationale** — WHO/IOM basis documented; merged `6ec05bd`.
- [x] **#9 Water-regression minimum days** — reduced to 14; merged `6ec05bd`.
- [x] **#10 True-up reference source visibility** — surfaced fallback source; merged `6ec05bd`.
- [x] **#11 Sodium CDRR versus UL** — corrected labels and warnings; merged `6ec05bd`.
- [x] **#12 Body-fat plausibility warnings** — tiered validation; merged `6ec05bd`.
- [x] **#13 Carb-floor warning** — surfaced infeasible macro state; merged `6ec05bd`.
- [x] **#14 Paste-staging duplicates** — confirmation guard and tests; merged `dc02f4f`.
- [x] **#15 Sync/offline expectation** — dismissible notice; merged `dc02f4f`.
- [x] **#16 Delete undo** — deferred write with rollback; merged `dc02f4f`.
- [x] **#17 Banking math extraction** — pure engine and tests; merged `c4661db`.
- [x] **#18 Dead legacy functions** — removed; merged `c4661db`.
- [x] **#19 Import-cycle review** — one-directional dependency graph verified; merged `c4661db`.
- [x] **#20 Quantity coercion duplication** — shared helper; merged `c4661db`.
- [x] **#21 Firestore/UI naming boundary** — normalized camelCase UI model; merged `c4661db`.
- [x] **#22 Tab arrow-key navigation** — roving tabindex; merged `ea11d84`.
- [x] **#23 Dark-theme muted contrast** — token raised; merged `ea11d84`.
- [x] **#24 Nutrient status color-only issue** — text badges; merged `ea11d84`.
- [x] **#25 Form error descriptions** — `aria-describedby`/alerts; merged `ea11d84`.
- [x] **#26 Mobile calorie KPI prominence** — remaining-calorie summary; merged `5f8d8a0`.
- [x] **#27 Responsive chart height** — fluid clamp; merged `5f8d8a0`.
- [x] **#28 320px modal safety** — responsive sizing; merged `5f8d8a0`.
- [x] **#29 Mobile nutrient-form height** — expanded viewport allowance; merged `5f8d8a0`.
- [x] **#30 Empty states** — improved guidance; merged `5f8d8a0`.
- [x] **#31 Save confirmation** — reusable feedback state; merged `5f8d8a0`.
- [x] **#32 Chart.js upgrade** — moved to 4.5.0; merged `29c2c2f`.
- [x] **#33 Theme-aware chart tooltips** — tokenized; merged `635a289`.
- [x] **#34 Auto-target apply flow** — action moved before detail; merged `13bc5d5`.
- [x] **#35 Exercise advanced fields** — progressive disclosure; merged `13bc5d5`.
- [x] **#36 Inline food quantity** — synchronized input; merged `c979880`.
- [x] **#37 Initial-load skeletons** — replaced spinner; merged `13bc5d5`.
- [x] **#38 Number-input spinners** — visually removed; merged `635a289`.
- [x] **#39 Activity-level icons** — compact visual choices; merged `635a289`.
- [x] **#40 Null-UL explanations** — documented with #11; merged `635a289`.
- [x] **#41 Fluid typography** — responsive type utilities; merged `d2aeb0a`.
- [x] **#42 PWA support** — manifest, icons, service worker; merged `29c2c2f`.
- [x] **#43 Saved-food CSV import** — RFC 4180 parser and clamps; merged `29c2c2f`.
- [x] **#44 Details chevrons** — CSS marker; merged `d2aeb0a`.
- [x] **#45 Documentation checklist** — contribution gate; merged `d2aeb0a`.
- [x] **#46 Stale current-weight notice** — projected estimate and age-aware messaging; merged `be6d028`.
- [x] **#47 Today macro summary redesign** — compact sticky overview; merged `2de2407`.
- [x] **#48 Expandable target statement** — TDEE-to-target breakdown; merged `bcb139b`, follow-up `dbd2509`.
- [x] **#49 Vacation/low-log quick estimate** — presets and custom mode; merged `200a37b`.
- [x] **#50 Shared chart date range** — presets/custom across charts; merged `df2b0af`.
- [x] **#51 Corrections & Gaps tab** — separated from Energy; merged `ffe15a9`.
- [x] **#52 Recorded/corrected/trend chart** — range-aware and corrected; merged `9520e8d`.
- [x] **#53 Dynamic nutrient bounds** — lower/upper positions and UL marker; merged `9520e8d`.
- [x] **#54 Long-form explanation disclosures** — collapsed by default; merged `ffe15a9`.
- [x] **#55 Larger-gap imputation rigor** — pre/post evidence and reference isolation; merged `e3eed75`, follow-up `11a2a37`.
- [x] **#56 Vacation-day true-up eligibility** — estimate-safe correction flow; merged `e3eed75`, follow-up `11a2a37`.
- [x] **#57 Mobile narrow-viewport pass** — six-tab, macro, target, date-range, and settings wrapping fixes; 584 tests; merged `649bf26`.
- [x] **#58 Large-import performance** — map-based averages, allocation reduction, table cap, chart density limits; 584 tests; merged `649bf26`.

## Preserved calculation invariants

Energy density, Mifflin-St Jeor, Cunningham, PAL ranges, DRI tables, Compendium METs, centered-window true-up, 10% trimmed mean, protein-basis priority, confidence thresholds, and fat floor were previously verified and should not regress without explicit product review.

## #59 — nutrition contract and research queue

- [x] **Record the requested workflow and population plan.**
  > Resolved: workflow contract, 1,114-entry research queue (all queued, no nutrition values), and population playbook; checks: JSON/IDs/enums/links/dispatch, diff check, independent review; merged: 49cabd2 (PR #179; the recorded branch commit 7f1900a was squash-merged), amended by 1a0f8bd (PR #181, cost-free assistant packets); residual risk: the AI/input plan was superseded on 2026-11-06 by the external-assistant ingredient-import architecture (see the active backlog's decisions and [assistant contracts](../docs/nutrition/assistant-contracts.md)); runtime work remains #60 onward.

## #60 Part A — nutrient contracts and lossless parsing

- [x] **Implement the versioned registry and quality-aware imports/exports, readers first.**
  > Resolved: shared nutrient registry, anchored parser, quality/null handling, fingerprint compatibility, v1-identical writes with v2 overwrite protection, recipe readers/detail, `nutritrack-v3`, and a built/unrun census; checks: baseline acceptance reverified in #61 tracker (664/19) and root (1947/99) suites, registry/parsing/golden/fingerprint tests; prior PR acceptance records lint/build/contract/docs and rules passes; merged: 326a748 (PR #185); residual risk: v2 food/day writes remain disabled and production census/backup/enablement/deploy remain open as #60 Part B. No historical rewrite or production data action was required for Part A.

## #64 Part A — full nutrient calculation

- [x] **Calculate every registry nutrient deterministically.**
  > Resolved: shared calculate.js scales stored nutrients, keeps unknown distinct from zero, and computes weighted fiber, adjusted carbs, and FODMAP equivalents; recipe scaling uses scalePerBasis; checks: tracker 1092, root 2014, API 43, lint, build, and all 10 GitHub CI checks; one Grok 4.7 review approved the final head; merged: df864e1 (PR #191); residual risk: fitting and snapshot saving remain #65 and #64 Part B. No production write.

## #69 — Ingredient Library

- [x] **Ship library search, review, and staged research.**
  > Resolved for this slice only: shared search and review, distinct field and conversion gaps, and research packets that stay staged. `commitLibraryEdit()` returns `writes_disabled`. The library tab has no add or edit action. Checks recorded on the PR: tracker 1105, root 2015, lint, build, and 10 GitHub CI checks; one Grok 4.7 review approved the final head; merged: 497f941 (PR #196). Add, edit, and save of private profiles are not closed; they remain active as #69 Part B and need James's approval with #61 Part B. Affected meals stay deferred until #64 Part B. An override variant with no identity is not discovered by private search without a new index. No production write.

## #65 — quantity fitting

- [x] **Fit estimated grams to eligible known facts.**
  > Resolved: shared fit.js moves only estimated quantities, calls calculateMeal, and flags non-unique or infeasible fits; Codex findings were fixed before the recorded head; checks recorded on the PR: tracker 1102, root 2015, lint, build, and 10 GitHub CI checks; one Grok 4.7 review approved the final head; merged: 8122694 (PR #195); residual risk: the search is deterministic and not a global-optimality proof. Production saving stayed off.

## #70 — tracker Import workspace

- [x] **Orchestrate import, match, resolve, calculate, and review in the tracker.**
  > Resolved: the Import tab reuses #61 matching, #62 packets, #64 calculation, #66 resolution, and #67 parsing; Codex findings on the first heads were fixed before merge; fitting was still off in that PR; checks recorded on the PR: tracker 1098, root 2015, API 43, lint, build, and 10 GitHub CI checks; one Grok 4.7 review approved the final head; merged: 91241f3 (PR #194); residual risk: official lookup does not contact a food database, and localStorage drafts are not an access-control boundary. Production saving stayed off.

## #66 — missing-ingredient resolution

- [x] **Make database reuse and the missing-ingredient ladder clear.**
  > Resolved: shared resolution ladder batches missing profiles separately from missing fields, pins field gaps to the matched revision, and builds one #62 packet; fit panel and library links stay off; checks recorded on the PR: tracker 1095, root 2015, API 43, lint, build, and all 10 GitHub CI checks; one Grok 4.7 review approved the final head; merged: 848d3ac (PR #192); residual risk: the tracker screen that hosts the ladder is #70, and production profile writes remain Part B. No production write.

## #67 — ingredient-list import

- [x] **Import assistant-prepared ingredient lists.**
  > Resolved: ingredient-list v1 and paste parsing, frozen corrections, saved-meal/recipe/legacy adapters, and #61 reconcile; Codex findings from the first review were fixed before merge; checks: tracker 1086, root 2013, API 43, lint, production build, and all 10 GitHub CI checks; one independent Grok 4.7 review approved the final head; merged: f3ff0c7 (PR #190); residual risk: semantic paste failures still report a JSON path, and a tail warning can miss a wide tail-line upper bound. No calculation, research, network, or production write.

## #62 — shared research pipeline

- [x] **Implement one research pipeline for bulk population, library research, and meal gaps.**
  > Resolved: shared state/preparation vocabulary plus research request/response v1, two-phase adapters, `awaiting_response`, verification, owner-scoped IndexedDB, curated/manual/label/FDC adapters with no live use, staging, coverage, and dry-run `packet`/`import-packet`; checks recorded on the PRs: tracker, root, API, lint, build, ci:contract, ci:docs, unchanged rules, empty curated manifest; merged: ffe83a6 (PR #188) and 91e10ad (PR #189); residual risk: live pins, credentials, and curated publication remain #62 Part B and require explicit approval. Both write flags stay false and the curated manifest stays at zero profiles. See [research-pipeline.md](../docs/nutrition/research-pipeline.md).

## #72 — yield without scaling nutrients by water

- [x] **Separate raw weight, cooked weight, water, fat, and retention.**
  > Resolved: water loss or gain no longer scales nutrients; the raw total still constrains the sum; serving-weight facts use cooked mass; absorbed or discarded fat and retention are explicit and counted once; `yieldRetention` above 1 is kept; a declared cooked total the fit cannot reach is flagged `cooked_total`; JSON export nests `line.yield`; `.d.ts` declare version 2. Two fix rounds (Grok, then Codex) were fixed before merge. Checks: nutrition 516, tracker 1132, root 2015, `tsc` on the changed `.d.ts`, ci:docs, ci:contract, and green CI; roasted-meat, boiled-pasta, baking, sauce-fat, and mixed-dish regressions pass on `main`. The final review was an orchestrator review disclosed on the PR. Merged: b66786c (PR #200, supersedes #199). Residual risk: none known. Both write flags stayed false; no production write.

## #73 — research evidence on the applied draft

- [x] **Stop dropping provenance when a research response is applied.**
  > Resolved: applied nutrients keep the full validated field plus `requestId`; each item keeps `researchEvidence` per request (sources with version, publishedAt, accessedAt; unresolved; assumptions; `unverified`); null stays unknown; revision-draft sources keep `publishedAt`; no profile is written. Checks: nutrition 522, tracker 1138, root 2015, ci:docs, and green CI; the #73 evidence tests pass on `main`. The final review was an orchestrator review disclosed on the PR because external reviewers were unavailable. Merged: 95f959e (PR #201). Residual risk: `researchEvidence` from an earlier request stays on the item after a later response replaces those fields, so stale evidence can remain until a follow-up (or #69 Part B review/save) prunes or marks it. Saving the revision stays #69 Part B.

## #74 — honest official lookup status

- [x] **Record an official result only after a lookup runs.**
  > Resolved: `lookupWorkspace()` and `researchLibraryFields()` record `not_performed` (adapter `none`, release null) instead of a fabricated `not_found`; a caller attempt cannot claim `not_found` or `resolved` through the workspace; `lookupOfficial()` keeps the pinned curated release only for genuine `resolved`/`not_found` attempts and rejects unknown outcomes; packet `triedSources` carry release null for `not_performed`; the research-packet ladder still opens; the Import button reads "Skip official lookup (not enabled)". Checks: nutrition 530, tracker 1146, root 2015, ci:docs, and green CI; the `not_performed` tests pass on `main`. The final review was an orchestrator review disclosed on the PR because the Codex connector reported its code review usage limit reached. Merged: bd6d56f (PR #202). Residual risk: none known. No live call; both write flags stayed false; no production write. A live USDA or manufacturer lookup stays #62 Part B.

## #78 — beta import tab and explicit diary add

- [x] **Make the new flow obviously separate from Today.**
  > Resolved: the tab button and panel heading read `Ingredient Import (Beta)` and Library stays its own tab; a cancel or failed import action shows "Your existing foods and diary were not changed." from the shared `WORKSPACE_UNCHANGED_NOTICE`; a `Return to Today` button calls `activateTab('today')`; the save reason says the meal was not logged to the diary (`logged: false`, `committed: false`, export unchanged); no cache bump because HTML and JS are network-first. Checks: nutrition 534, tracker 1150, root 2015, ci:docs, and green CI; the label, notice, and Return to Today button are on `main`. The final review was an orchestrator review disclosed on the PR because the Codex connector reported its code review usage limit reached. Merged: e93190e (PR #203). Residual risk: none known. Both write flags stayed false; no production write.

## #61 Part A — ingredient identities, revisions, and conversions

- [x] **Implement ingredient identities, variants, sources, and revisions (Part A).**
  > Resolved: versioned identities/variants/revisions/conversions, variant-aware matching, empty curated catalog, owner-scoped IndexedDB profile cache, recipe dual-read links, rules source (not deployed), census script (not run), docs; both write flags remain false; checks: tracker 755, root 1982, rules 215, lint/build/ci:contract/ci:docs/diff pass, as recorded in PR #186; merged: 3843254 (PR #186); residual risk: rules deploy, live smoke, and enabling `INGREDIENT_STORE_WRITES_ENABLED` remain open as #61 Part B (approval-gated); production index behavior unverified; state/preparation dimensions are free text until #62's shared vocabulary.
