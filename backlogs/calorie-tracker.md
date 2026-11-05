# CalorieTracker: active backlog

Single source of truth for work on `public/tools/CalorieTracker/` and the shared ingredient-nutrition integration with Recipe Standardizer. Items through #58 are merged and archived. New work starts at #59.

## Purpose and scope

Create a reusable ingredient database and save meals as versioned ingredient quantities. Expand nutrient detail, populate a comprehensive catalog, preserve known labels while estimating recipe quantities, and reuse approved data with minimal AI. Extend the current recipe integration.

The current request establishes the plan, catalog, population instructions, and future chat workflow. #59 delivers those planning artifacts. #60 onward implements and releases the site in separate stages. Do not describe the catalog as populated or the website as changed by #59.

## Parameters

- **Branch/PR:** one focused branch/PR per item or bounded #63 population batch from current `main`; `working/calorie-tracker-<ID>-<topic>` where possible.
- **Commit scope:** `calorie-tracker`; stable IDs `#N`; next unused ID after this plan: **#69**. Population batches use `#63-<wave>-<sequence>`; never reuse IDs.
- **Archive:** `backlogs/calorie-tracker-completed.md`.
- **Checks:** tracker behavior: `cd public/tools/CalorieTracker && npm test`; recipe/shared logic: root `npm test`; React pages/shared config: `npm run lint` and `npm run build`; auth/rules/data-model changes: relevant tests plus `npm run test:rules`.
- **Docs/data-only:** validate JSON, unique IDs, links, dispatch, cross-file contracts, and source-of-truth consistency. No app tests required for #59.
- **Release:** follow [Firebase release](../docs/firebase-release.md) for rules/private-data changes. Record actual deployment/manual evidence. No historical rewrite or namespace cutover is bundled into this feature.
- **Contract:** [overview](../docs/nutrition/README.md), [workflow](../docs/nutrition/workflow.md), [population playbook](../docs/nutrition/population-playbook.md), [catalog](../docs/nutrition/ingredient-catalog.json).

## Verified current state

Baseline: `main` `4dd9b927ec993d7e26c1d97d833a07b9f222efab`, inspected 2026-11-05.

- Tracker: 24 keys, word-matching paste parser, missing staged values become zero, name-slug food IDs, fixed-shape food saves, and diary snapshots. Expanded fat/fiber lines are unsafe for the current parser.
- Recipe Standardizer: confirmed links, gram bases, revision fingerprints, manual per-100-g research import, totals, and create/update export transactions already exist. Extend them.
- Exported foods flatten composition and zero-fill gaps after partial-coverage confirmation. Their recipe back-reference does not make the saved tracker food an ingredient recipe.
- Data remains under `default-app-id`; source-namespace migration stays owned by F-141. Production records and authenticated sessions have not been inspected for this plan.

## Invariants

- `getTrueUpCandidates` retains centered windows `[D-preDays, D+postDays]`; TDEE reference comes from outside the candidate interval when available.
- Preserve `computeWeekdayAverages` using `trimmedMean(arr, 0.1)`, synthetic-entry micronutrients, protein-basis order (lean mass, target weight, current weight), and dormant legacy gap helpers.
- Retain every existing nutrient and historical log. Keep unknown distinct from measured zero; preserve legacy fiber meaning.
- Match exact state/form and source revision. Display names are aliases, not IDs.
- Reuse profiles across meals. Never fit ingredient nutrient values to force a meal's macro match.
- Known labels stay separately attributable. Inferred quantities and missing micros stay estimates.
- Save composition, versioned references, and a frozen snapshot. Ingredient updates never silently change old diary totals.
- Prompt for missing ingredients before research. Preserve manual input and zero-AI recalculation of resolved meals.
- Keep private meals/profiles owner-authorized; public reference data contains no private inputs.

## Active items

### #59: Define the contract and comprehensive research queue

- [p] **Record the requested workflow and population plan.** Depends: none.
  > pushed: workflow contract, 1,114-entry research queue, and population plan prepared; checks: JSON/IDs/enums/links/dispatch, diff check, and independent review pass; commit: 7f1900a; PR: #179. Runtime implementation and population remain #60-#68.
  - **Surfaces:** this backlog, routing, nutrition docs/catalog, concise tool-documentation links.
  - **Accept:** expanded nutrient meanings, standard/custom fiber, source/quality model, versioned reuse, constrained quantities, missing-data choices, history, and AI boundary are explicit. Catalog covers broad food families, preparation variants, common components, and additives. All entries start queued without fabricated nutrition. Population has bounded repeatable jobs and an executable selection rule.
  - **Checks:** docs/data-only checks and independent review. **Migration/deploy:** none. The installed chat skill is a separate instruction update, not site implementation.

### #60: Expand nutrient contracts and make parsing lossless

- [ ] **Implement a versioned registry and quality-aware imports/exports.** Depends: #59.
  - **Surfaces:** tracker constants/parser/staging/save/display/export/targets; recipe `trackerFoods`, `nutritionIntake`, calculation/export formats and parity tests.
  - **Accept:** saturated/trans/mono/poly fat and planned groups supported; exact labels cannot overwrite parent totals; null/rounded-zero/measured/estimated states survive round trips. EPA/DHA cannot overwrite total omega-3. Unknown keys warn; conflicting duplicate keys require review. Units/carbohydrate conventions explicit. Per-100-g bounds accommodate salt/additives. Legacy fiber preserved and classified only with evidence. New fields are not all minimum targets.
  - **Checks:** tracker/root suites; lint/build for UI; regression cases for subtype collisions, unknowns, unit conversion, fiber ambiguity, and parity.
  - **Migration/deploy:** version readers before writers, preserve v1, and declare capabilities. Verify cached/PWA clients cannot erase v2 fields before enabling writes.
  - **Fingerprint compatibility:** version the quantity/nutrient hash and retain v1 verification for existing confirmed links and export references. Test that dictionary expansion neither silently trusts a changed source nor invalidates unchanged legacy links.

### #61: Add versioned ingredient storage and identity matching

- [ ] **Implement ingredient identities, variants, sources, and revisions.** Depends: #60.
  - **Surfaces:** shared nutrition modules, tracker manager/services, recipe links/types/database, canonical rules and emulator tests.
  - **Accept:** stable IDs; raw/cooked/drained/fat/fortification/brand variants; per-100-g basis and sourced conversions; field provenance; immutable revisions; private overrides over curated data. Exact confirmed IDs reuse without research; ambiguous aliases require review. Cross-user/public-catalog client writes fail at the boundary. Concurrent creates deduplicate; failed saves are recoverable.
  - **Checks:** tracker/root/rules suites; identity, revision, collision, concurrency, ownership tests; lint/build for UI.
  - **Lookup contract:** indexed/paginated search and bounded caches; do not load the whole catalog on tool open. The current matcher strips raw/cooked/salt descriptors, so it remains suggestion-only; exact automatic reuse requires variant compatibility.
  - **Migration/deploy:** legacy foods retain unknown basis/meaning where necessary. Preserve the current namespace contract/constants; any resolver is explicit work coordinated with F-141. Stage rules release; require dry-run report, backup, and rollback before live copies.

### #62: Build source ingestion and resumable research jobs

- [ ] **Implement deterministic imports and evidence review.** Depends: #60, #61.
  - **Surfaces:** configured scripts/adapters, source cache, manifest reader, validator, review workflow, coverage reports.
  - **Accept:** pinned FDC bulk/API plus official-brand/manual adapters; exact match table; normalized units/definitions; field gaps; license metadata; checkpoints/retries/idempotency; reviewed revision diffs. Follow the playbook. Models are unnecessary for scaling or copying structured data.
  - **Checks:** source fixtures, malformed data, retry/idempotency, unknown/LOQ, concentrated additives, raw/cooked mismatches; applicable root/tracker/UI/rules checks.
  - **Migration/deploy:** stage curated data without private inputs; secrets remain server-side. Record concrete access dependencies.

### #63: Populate every catalog ingredient and audit gaps

- [ ] **Execute all population waves in bounded batches.** Depends: #62.
  - **Surfaces:** catalog, reviewed matches, versioned profiles, gap reports, progress records.
  - **Execution:** follow [the population playbook](../docs/nutrition/population-playbook.md) and its execution prompt. Derive at most 25-ID jobs by priority/category/ID. Waves A-E cover every manifest ID; newly discovered ingredients join the same queue.
  - **Accept per batch:** every field has a sourced value/derivation or explicit unknown; identity/basis verified; source IDs/dates retained; flags reviewed; imported revisions/coverage reported; reruns create no duplicates. No blank-to-zero completion. Missing branded labels remain actionable blocked work.
  - **Accept overall:** all IDs attempted, resolvable profiles reviewed/imported, blocked IDs/fields enumerated. Distinguish full research coverage from unavailable analytical data. Do not claim every micronutrient is measured.
  - **Checks:** validator, category/priority reconciliation, source/basis/unit review, documented sample plus all flagged cases. App tests only for code changes.
  - **Migration/deploy:** bounded public-data releases; release runbook for private imports. No historical meal modification.

### #64: Save ingredient graphs with reproducible meal snapshots

- [ ] **Connect recipes, ingredient profiles, saved foods, and diary versions.** Depends: #61; sample #63 data useful, full population non-blocking.
  - **Surfaces:** recipe link/calculation/export/save, tracker food/diary services, parsers, storage/rules, import/export.
  - **Accept:** casserole/burger share applicable profile revisions with different quantities; nested recipes are acyclic and counted once. Save references/grams, known facts, yield, assumptions, snapshot. Create new approved profiles once; reuse existing IDs. Retry/concurrency/failure preserves integrity. Profile updates offer recalculation; old diary totals remain fixed. Flat foods still load.
  - **Checks:** tracker/root/rules suites; reuse/version/deletion/conflict/export, immutable-history, and partial-save tests; lint/build for views.
  - **Diary ownership:** use tracker-owned logging with references/snapshots; no new recipe-side whole-day writer or implicit P6 implementation. Test another tab editing the day between recipe export and tracker logging.
  - **Migration/deploy:** additive schema, legacy adapters, verified export/import round trips. No automatic reconstruction of old meals from totals.

### #65: Fit ingredient quantities to known evidence

- [ ] **Implement deterministic constrained meal reconstruction.** Depends: #60, #61, #64.
  - **Surfaces:** pure inference/calculation module, evidence model, quantity review, uncertainty display.
  - **Accept:** nonnegative weights, exact/bounded amounts, nested order and low-percentage exceptions, formulation/cooked mass distinctions, recipe priors, rounded nutrient intervals. Show residuals, non-unique solutions, infeasibility. Never silently change pinned facts or canonical nutrition. Save algorithm/assumptions. Corrected quantities recalculate without AI.
  - **Checks:** [required solver cases](../docs/nutrition/workflow.md#required-solver-cases), withheld exact recipes, deterministic repetition, rounding/yield tests; root/tracker/UI checks as applicable.
  - **Migration/deploy:** estimates on new/draft meals first; preserve measured recipes and history.

### #66: Build missing-ingredient and nutrition review screens

- [ ] **Make database reuse clear in both tools.** Depends: #62, #64; #65 for inferred-quantity review.
  - **Surfaces:** intake, manager, nutrition panel, staging, missing-data dialog, mobile detail views.
  - **Accept:** batched missing/ambiguous ingredients and field gaps; existing match/substitute, selected lookup, manual entry, incomplete draft, cancel. Research follows the user's selected action and result review. Retry/cancel clear; no ingredient disappears. Show source/quality/grams and editable quantities. Coverage visible per nutrient. Matched inputs calculate/save without models.
  - **Checks:** each choice, offline/error/retry, repeat ingredients, accessibility/mobile and both-tool round trips; tracker/root suites, lint/build, relevant rules tests.
  - **Migration/deploy:** capability-aware flow; verify signed-in use with the same account in both tools and record outcomes.

### #67: Add photo, label, list, and recipe input adapters

- [ ] **Support convenient ingestion with optional AI.** Depends: #65, #66.
  - **Surfaces:** structured/manual inputs, barcode/local matching, OCR/photo review, optional authenticated research/vision API.
  - **Accept:** saved meals/structured recipes use deterministic paths; photos can use reviewed recognition/portion suggestions. Unknowns enter #66. Provider routes require user action, auth, request/cost bounds, cancellation, and the same strict review/save contract. Select current provider/model at implementation time.
  - **Overlap:** absorbs Recipe Standardizer P7 nutrition enrichment; do not build a second route there. Direct diary logging P6 remains separate.
  - **Checks:** fixture imports, malformed/OCR input, corrections, duplicate saves, zero-model assertions for reuse/scaling, API auth/rate-limit tests if routes exist; applicable tracker/root/lint/build/rules commands.
  - **Migration/deploy:** manual ChatGPT paste remains supported. Verify credentials and any photo Storage deployment before calling the route live.

### #68: Verify accuracy, reuse, migration, and release

- [ ] **Complete staged rollout and operating documentation.** Depends: #60-#67, with an explicit #63 gap report.
  - **Surfaces:** both tools, rules/migration, source refresh, backup/recovery, help and project prompts.
  - **Accept:** exercise bowls, pasta, soups, baking, cocktails, and burger/casserole reuse; compare exact recipes with withheld totals; distinguish source data from uncertain portions. Verify history unchanged, versioned refresh, zero AI for repeats, and every missing-data choice. Publish capabilities and coverage.
  - **Checks:** relevant complete suites, recorded signed-in production smoke, migration count/hash checks, restore/retry exercise, source-license review.
  - **Migration/deploy:** readers then rules/data then writers; refresh cached clients; staged enablement/rollback. Archive after actual deployment and verified acceptance.

## Decisions and dependencies

No product decision blocks #59. Defaults: custom weighted fiber under details, standard fiber for standard comparisons, versioned snapshots, and a manual zero-API path. The recipe rollout retains its priority. Production access, missing brand labels, and provider setup are dependencies of later jobs, not blockers for this plan.
