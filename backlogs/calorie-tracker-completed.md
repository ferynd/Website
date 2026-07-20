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
