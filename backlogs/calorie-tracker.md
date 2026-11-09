# CalorieTracker: active backlog

Single source of truth for work on `public/tools/CalorieTracker/` and the shared ingredient-nutrition integration with Recipe Standardizer. Items through #59, #60 Part A, and #61 Part A are merged and archived.

## Purpose and scope

Create a reusable ingredient database and save meals as versioned ingredient quantities. Expand nutrient detail, populate a comprehensive catalog, preserve known labels while estimating recipe quantities, and reuse approved data with minimal AI. Extend the current recipe integration.

External assistants (ChatGPT, Claude, Grok, Codex, or James's bots) interpret photos, recipes, labels, and meal descriptions and return a structured ingredient list ([assistant contracts](../docs/nutrition/assistant-contracts.md)). The Nutrition Tracker is the authoritative ingredient database, quantity-fitting engine, nutrition calculator, and store. It gains an Import workspace (#70) that imports assistant-prepared ingredient lists, saved meals, and recipes; matches them against the shared library; resolves missing ingredients through one research pipeline (deterministic sources, then copy/paste research packets); calculates every registry nutrient; fits quantities only against known facts with real provenance; and saves reusable recipes, foods, and diary entries. An Ingredient Library tab (#69) manages profiles. Recipe Standardizer uses the same profiles, calculation modules, and research pipeline. The legacy paste parser remains a supported secondary path. On-site photo/OCR/vision and any direct AI provider route are optional, deferred (#71), and never prerequisites.

#60 onward implements and releases the site in separate stages. Do not describe the catalog as populated or planned import/research behavior as shipped.

**Non-goals:** client-side provider keys, AI as the calculation engine, on-site meal interpretation in the primary path, a second Recipe Standardizer enrichment route (P7), recipe-side whole-day diary writes (P6), automatic rewriting of historical meals, and namespace cutover (F-141).

## Parameters

- **Branch/PR:** one focused branch/PR per item or bounded #63 population batch from current `main`; `working/calorie-tracker-<ID>-<topic>` where possible.
- **Commit scope:** `calorie-tracker`; stable IDs `#N`; next unused ID: **#72**. Population batches use `#63-<wave>-<sequence>`; never reuse IDs.
- **Archive:** `backlogs/calorie-tracker-completed.md`.
- **Checks:** tracker behavior: `cd public/tools/CalorieTracker && npm test`; recipe/shared logic: root `npm test`; React pages/shared config: `npm run lint` and `npm run build`; auth/rules/data-model changes: relevant tests plus `npm run test:rules`.
- **Docs/data-only:** validate JSON (including contract examples), unique IDs, links/anchors, dispatch, cross-file contracts, and source-of-truth consistency. No app tests required.
- **Release:** follow [Firebase release](../docs/firebase-release.md) for rules/private-data changes. Record actual deployment/manual evidence. No historical rewrite or namespace cutover is bundled into this feature.
- **Approval gate:** steps marked **Requires James's explicit approval** (Firestore rules deploys, production or private-data writes/migrations, live catalog population imports, provisioning or enabling live credentials such as FDC keys, and enabling the optional direct AI provider route (#71) or raising its $0 spend cap) wait for that approval, recorded in the item note or PR. Code, tests, fixtures, emulator runs, dry-run reports, and staged review artifacts may proceed without it. No approval is implied by this backlog.
- **Contract:** [overview](../docs/nutrition/README.md), [workflow](../docs/nutrition/workflow.md), [assistant contracts](../docs/nutrition/assistant-contracts.md), [population playbook](../docs/nutrition/population-playbook.md), [catalog](../docs/nutrition/ingredient-catalog.json).

## Verified current state

Baseline: `main` `91e10ad` (#62 / PR #189), inspected 2026-11-08.

- Tracker: shared v2 nutrient registry/readers and anchored detail parsing are merged. Food/day writes still use the 24-key v1 shape while `NUTRIENT_V2_WRITES_ENABLED` is false; name-slug food IDs and diary snapshots remain.
- #61 Part A is merged: versioned identities, variants, revisions, conversions, `matchIngredient`, an empty curated catalog, and an owner-scoped IndexedDB profile cache. `INGREDIENT_STORE_WRITES_ENABLED` is false and the ingredient rules are repository source, not deployed. `VariantDims.state`/`preparation` are free text; only drained/salt/fortification have enums.
- Recipe Standardizer: confirmed links, gram bases, revision fingerprints, manual per-100-g research import (24 numeric keys, `MAX_INTAKE_ITEMS = 100`), totals, and create/update export transactions already exist. Extend them.
- Exported foods flatten composition and zero-fill gaps after partial-coverage confirmation. Their recipe back-reference does not make the saved tracker food an ingredient recipe.
- Data remains under `default-app-id`; source-namespace migration stays owned by F-141. Production records and authenticated sessions have not been inspected for this plan.
- #62 is merged: shared state/preparation vocabulary (`VOCABULARY_VERSION = 1`), research request/response v1, two-phase adapters, verification, an owner-scoped IndexedDB job store, and the dry-run CLI. No live source, key, catalog population, or production write is enabled. `fiberWeightedLegacy` stays a #64 calculation and is not a stored or requested profile field.
- Ingredient-list import is the active #67 item: shared pure modules validate ingredient-list v1 and the paste format, keep corrections off the frozen import, adapt saved meals/recipes and legacy paste, and reconcile through #61. There is still no Import workspace, Ingredient Library tab, calculation module, or nutrition AI route. Existing `app/api` routes do not serve nutrition. The tracker service worker's same-origin caching risk for any future private API route is owned by #71, the only item that adds one.

## Invariants

- `getTrueUpCandidates` retains centered windows `[D-preDays, D+postDays]`; TDEE reference comes from outside the candidate interval when available.
- Preserve `computeWeekdayAverages` using `trimmedMean(arr, 0.1)`, synthetic-entry micronutrients, protein-basis order (lean mass, target weight, current weight), and dormant legacy gap helpers.
- Retain every existing nutrient and historical log. Keep unknown distinct from measured zero; preserve legacy fiber meaning.
- Match exact state/form and source revision. Display names are aliases, not IDs.
- Reuse profiles across meals. Matched lines are never researched again. Never fit ingredient nutrient values to force a meal's macro match.
- Known facts need real provenance (official label, restaurant, manufacturer, user-measured, user-stated). The site never invents fit targets; totals an assistant inferred are not facts. Known labels stay separately attributable. Inferred quantities and missing micros stay estimates.
- Save composition, versioned references, and a frozen snapshot. Ingredient updates never silently change old diary totals.
- Prompt for missing ingredients before research. Preserve manual input and zero-AI recalculation of resolved meals.
- Calculate without AI. External assistants interpret; input arrives as a validated ingredient list. There is no required OCR or vision step. Models never compute totals, scale portions, match confirmed IDs, or overwrite known facts.
- The default model help is the text-only #62 research packet, copied to and pasted back from assistants James already pays for (Claude/Codex/ChatGPT or ChatGPT project instructions). The optional #71 direct route is off, flagged, has a $0 cap, is provider-agnostic, and uses the same schemas. Keys never reach the client, static site, or repository. Freeform model nutrition text is never imported.
- The solver never silently changes known facts or measured quantities, treats label rounding as intervals, and reports non-unique or infeasible fits instead of claiming a unique recipe.
- One set of ingredient profiles, nutrient registry, calculation/solver modules, and research pipeline serves both tools and both bulk population and in-app research. Do not duplicate stores, calculation engines, or research flows.
- The legacy paste parser stays supported; structured ingredient-level data is the primary interface.
- Keep private meals/profiles owner-authorized; public reference data contains no private inputs.

## Active items

Dependency order: #59, #61 Part A, #62, #64 Part A, #66, and #67 are archived. Critical path: **#70 → #65 → #69**. In parallel: #60 Part B, #61 Part B, and #64 Part B are approval-gated and must be done before live saving; #63 batches run after #62 (plus #62 Part B for live work). #68 is last. #71 is deferred and off the critical path. IDs are stable, so items appear in dependency order rather than by number. #69 may run in parallel with #65 once #66 exists.

### #62 Part B: Pin live sources and publish staged curated data

- [ ] **Enable live FDC data and publish reviewed curated output.** Depends: #62. Scheduled together with the first #63 batch.
  - **Surfaces:** pinned FDC release configuration, server-side/CLI credential handling, staged curated catalog publication.
  - **Accept:** a real FDC release is pinned by checksum; any live key stays server-side or CLI-only and never reaches the repository or client; staged curated data contains no private inputs and publishes only after review.
  - **Checks:** dry-run reports, source-license review, root/tracker suites for any config change.
  - **Migration/deploy:** **Requires James's explicit approval** to provision or use live credentials (for example an FDC API key) and to publish staged data to production.

### #70: Build the tracker's Import workspace

- [p] **Orchestrate paste → validate → match → resolve → calculate → [fit] → review → save in the tracker.** Depends: #67, #66, #64 Part A; #65 for the fit stage (capability-gated); #64 Part B for saving (capability-gated).
  > pushed — tracker Import tab reuses #61/#62/#64/#66/#67; fit and production save stay off; checks: tracker 1098, root 2015, API 43, lint, build, ci:contract, ci:docs; commit: d6e4056; PR: #194
  - **Surfaces:** tracker primary "Import ingredient list" entry, stage navigation and draft state, "Copy assistant instructions," offline/capability indicators, legacy paste entry as a secondary option.
  - **Accept:** one entry point accepts ingredient-list JSON or paste, a saved meal or recipe, or legacy paste; no photo, barcode, or OCR input. Stages run in order and are resumable per the [workflow](../docs/nutrition/workflow.md#staged-meal-analysis). Each value shows whether it came from deterministic data, the user, or an assistant. With matched ingredients the whole flow uses zero model calls. Fitting runs only when eligible known facts exist. Until #61 Part B and #64 Part B are released, the workspace runs through review and offers export/copy only. Matching and calculation work offline from the #61 cache; packet copy works offline. Drafts are keyed to the authenticated owner, cleared on sign-out or account switch, and never shown across users. Cancel prevents the meal/diary commit; research jobs or approved profiles already created are preserved and reported accurately.
  - **Checks:** tracker suite; end-to-end fixtures for assistant-prepared lists (with and without known facts), saved meals, recipes, and legacy paste; packet round trip through resolve; zero-model assertions for matched inputs; zero re-research of matched lines; draft resume/cancel with owner scoping; legacy paste parity; accessibility/mobile; root suite and lint/build where shared or React code changes.
  - **Migration/deploy:** ships behind a capability flag; legacy paste remains available. Uses rules released by #61/#64; no new production enablement without the approvals recorded there.

### #65: Fit ingredient quantities to known evidence

- [ ] **Implement deterministic constrained meal reconstruction.** Depends: #64 Part A, #67.
  - **Surfaces:** pure inference module shared by both tools, evidence model, quantity review data, uncertainty and known-versus-calculated outputs.
  - **Accept:** targets are only known facts with real provenance and an applicable basis; with none, fitting is skipped and no target is invented. Free variables are `estimated` lines bounded by `[gMin, gMax]`, starting from the assistant's estimate; `measured`/`label`/`recipe_stated`/`fixed` lines never change (their ranges feed uncertainty only). Constraints: serving weights, ingredient order, ratios, ≤2 % tails, preparation states and yield, rounded nutrient intervals and stated uncertainty. Output per-nutrient known-versus-calculated differences, estimated quantities with ranges, residuals, and flags for non-unique solutions and infeasibility. Never change known facts, measured quantities, or profile nutrition; never present one fit as the unique recipe. Save algorithm version, bounds, weights, and assumptions. Deterministic, dependency-free, and offline. Corrected quantities recalculate without AI.
  - **Checks:** [required solver cases](../docs/nutrition/workflow.md#required-solver-cases), photo-only no-fit case, withheld exact recipes, deterministic repetition, rounding/yield tests; root/tracker/UI checks as applicable.
  - **Migration/deploy:** estimates on new/draft meals first; preserve measured recipes and history.

### #69: Add the Ingredient Library tab

- [ ] **Give the tracker a dedicated tab for managing shared ingredient profiles.** Depends: #61 (Part B for writes), #62, #66 (shared review components). Research actions go through #62 jobs and packets. Not a prerequisite for the primary import flow.
  - **Surfaces:** new tracker tab and mobile layout, shared profile/conversion/research-job services from #61/#62, local cache, Recipe Standardizer link editor entry point.
  - **Accept:** search (indexed, paginated, alias- and variant-aware); add and edit private profiles as new revisions with source and basis; review identity, variants, per-field status/provenance, missing nutrient fields, unit conversions, and revision history; import a label, manual facts, or a reviewed research result; research selected ingredients or selected missing fields via #62 jobs (official sources, then research packets). Missing-field and missing-conversion lists are distinct and filterable. Edits never change curated/public records or other users' data and never rewrite saved diary snapshots. Research results stay staged until reviewed. Recipe Standardizer opens the same library views; it builds no second editor.
  - **Affected meals (deferred):** an "affected recipes/meals" view requires ingredient-graph references from #64 Part B. Ship #69 without that view and enable it as a capability-gated follow-on.
  - **Checks:** tracker suite; root suite for shared modules; search/pagination, revision-on-edit, override precedence, conversion validation, staged-research review/cancel, offline read from cache, accessibility/mobile; lint/build if React surfaces change; rules tests if rules change.
  - **Migration/deploy:** reads curated data and writes only owner-private profiles under #61 rules. Curated/public catalog writes stay in reviewed #63 batches. **Requires James's explicit approval** for any rules change or production data write enabled by this item.

### #60 Part B: Enable nutrient v2 food/day writes

- [ ] **Complete the approval-gated nutrient storage rollout.** Depends: #60 Part A (merged `326a748`, PR #185). Gate for v2 detail in diary snapshots.
  - **Surfaces:** [Firebase release](../docs/firebase-release.md), read-only census/backup, food/day shape flag, deployment and compatibility verification.
  - **Accept:** perform the separately approved census and backup, deploy readers before writers, verify cached/PWA clients cannot erase v2 fields, then enable the food/day shape flag in a separate reviewed release. Preserve all historical logs and fingerprint compatibility.
  - **Checks:** the release runbook, tracker/root/rules suites and lint/build; record actual manual/deployment evidence.
  - **Migration/deploy:** **Requires James's explicit approval** for production inspection/census/backup, enabling v2 writes, and deployment. `NUTRIENT_V2_WRITES_ENABLED` remains false until then.

### #61 Part B: Deploy ingredient rules and enable ingredient-store writes

- [ ] **Release the #61 ingredient store to production.** Depends: #61 Part A (merged `3843254`, PR #186). Blocks live saving.
  - **Surfaces:** [ingredient release runbook](../docs/nutrition/ingredient-store-release.md), Firestore rules, `INGREDIENT_STORE_WRITES_ENABLED`, service-worker cache bump.
  - **Accept:** follow the runbook's B1–B5: read-only inspection and census (0 docs), dry-run compile, rules deploy, live smoke with throwaway accounts and cleanup, then a separate PR enabling writes. Record ruleset names, SHAs, and outcomes.
  - **Checks:** the runbook, tracker/root/rules suites; recorded live smoke.
  - **Migration/deploy:** no data copy or backfill. **Requires James's explicit approval** for the rules deploy, live fixtures, and enabling writes (three separate approvals).

### #64 Part B: Save ingredient graphs with reproducible meal snapshots

- [ ] **Persist meal/recipe versions and connect them to saved foods and diary entries.** Depends: #64 Part A, #61 Part B; #60 Part B for detail fields.
  - **Surfaces:** meal and recipe version records, recipe link/export/save, tracker food/diary services, storage/rules, import/export.
  - **Accept:** save as reusable recipe, food item, and/or diary entry. Casserole/burger share applicable profile revisions with different quantities; nested recipes are acyclic and counted once. Save ingredient identities pinned to profile revision and hash, quantities with basis and ranges, known facts separate from calculated values, sources, assumptions, fit parameters, import provenance, and the complete nutrition snapshot. Create new approved profiles once; reuse existing IDs. Saved recipes rescale instantly without research or models. Diary entries hold a `mealRef` and a frozen snapshot; newer profile data only shows a "new data available" notice with explicit recalculation. Expose ingredient→meal references for #69's affected-meals view. Retry/concurrency/failure preserves integrity. Flat foods still load.
  - **Checks:** tracker/root/rules suites; reuse/version/deletion/conflict/export, immutable-history, offline-recalculation, and partial-save tests; lint/build for views.
  - **Diary ownership:** tracker-owned logging with references/snapshots; no recipe-side whole-day writer or implicit P6. Test another tab editing the day between recipe export and tracker logging.
  - **Migration/deploy:** additive schema, legacy adapters, verified export/import round trips. No automatic reconstruction of old meals from totals. Offline saves are queued or fail visibly; success is reported only after commit. **Requires James's explicit approval** for any rules deploy or production schema change.

### #63: Populate every catalog ingredient and audit gaps

- [ ] **Execute all population waves in bounded batches.** Depends: #62; #62 Part B for live work. Uses #69's review views once available; does not wait for them.
  - **Surfaces:** catalog, reviewed matches, versioned profiles, gap reports, progress records.
  - **Execution:** follow [the population playbook](../docs/nutrition/population-playbook.md) and its execution prompt. Derive at most 25-ID jobs by priority/category/ID. Waves A-E cover every manifest ID; newly discovered ingredients join the same queue. Bulk deterministic import first, cached source releases, then residual-field passes using #62 CLI research packets (the same schema as in-app research) run through assistants or subscription CLIs James already pays for—not paid per-token API batches. Make a thorough, source-backed effort on every stored registry field including micronutrients (derived `fiberWeightedLegacy` excluded); estimates are labeled with comparator and range. Residual passes use a new pass ID under the same parent batch ID and create no duplicate profiles.
  - **Accept per batch:** every field has a sourced value/derivation or explicit unknown; identity/basis verified; source IDs/dates retained; flags reviewed; imported revisions/coverage reported; reruns create no duplicates. No blank-to-zero completion. Missing branded labels remain actionable blocked work.
  - **Accept overall:** all IDs attempted, resolvable profiles reviewed/imported, blocked IDs/fields enumerated. Distinguish full research coverage from unavailable analytical data. Do not claim every micronutrient is measured.
  - **Checks:** validator, category/priority reconciliation, source/basis/unit review, documented sample plus all flagged cases. App tests only for code changes.
  - **Migration/deploy:** bounded public-data releases; release runbook for private imports. No historical meal modification. **Requires James's explicit approval** before each live catalog import (or a recorded standing approval for a named wave) and before any paid (metered API) model-assisted batch. Assistant-run residual batches on subscriptions James already pays for do not need a separate spend approval; live import of their reviewed results still follows the catalog-import gate.

### #68: Verify accuracy, reuse, migration, and release

- [ ] **Complete staged rollout and operating documentation.** Depends: #60 Part B, #61 Part B, #62, #62 Part B, an explicit #63 gap report, #64 Part A, #64 Part B, #65, #66, #67, #69, and #70. #71 is not required.
  - **Surfaces:** both tools, rules/migration, source refresh, backup/recovery, help, project prompts, and assistant instructions.
  - **Accept:** exercise bowls, pasta, soups, baking, cocktails, and burger/casserole reuse through the #70 Import workspace with assistant-prepared lists and through Recipe Standardizer; research-packet round trips; zero re-research of matched ingredients; compare exact recipes with withheld totals; distinguish source data from uncertain portions. Verify diary immutability, versioned refresh, zero AI for repeats and matched inputs, offline calculation, packet import honesty, and every missing-data choice. Publish capabilities and coverage.
  - **Checks:** relevant complete suites, recorded signed-in production smoke, migration count/hash checks, restore/retry exercise, source-license review.
  - **Migration/deploy:** readers then rules/data then writers; refresh cached clients; staged enablement/rollback. **Requires James's explicit approval** for the production smoke, migrations, and each enablement step. Archive after actual deployment and verified acceptance.

### #71: Optional direct AI provider route (deferred)

- [ ] **Add a provider-agnostic server transport for the #62 research contract.** Depends: #62, #67. Deferred; off the critical path; nothing depends on it.
  - **Surfaces:** an authenticated Next.js route acting as a #62 two-phase adapter transport for research request/response v1; optionally a future extraction endpoint that outputs ingredient-list v1 (the only place on-site photo/OCR extraction may ever live); tracker service worker.
  - **Accept:** off by default, feature-flagged, $0 budget cap; a durable server-side budget reservation before every provider call (concurrent/duplicate requests cannot exceed the cap; reconciled with actual usage); non-anonymous Firebase users only (reject `signInAnonymously` guests); keys server-side only; user-initiated, rate/size-bounded (per verified account plus global/IP or App Check quota), cancellable, and logged without private payloads. The UI learns whether the route is enabled and has budget. Outputs pass the same #62/#67 validators as copy/paste. The service worker treats the route as network-only and clears legacy Cache Storage entries on sign-out. Select the provider/model at enablement time and record it in the PR.
  - **Checks:** flag-off default (no provider calls), auth including anonymous rejection, rate-limit, cancellation, $0-cap and concurrent budget-reservation tests, service-worker network-only test, `npm run test:api`; update `SECURITY.md` and `ARCHITECTURE.md` when built.
  - **Migration/deploy:** **Requires James's explicit approval** to build or enable the route, provision a key, raise the $0 cap, or deploy any Storage rules it needs.

## Decisions and dependencies

No product decision blocks #62. Defaults: custom weighted fiber under details, standard fiber for standard comparisons, versioned snapshots, and a manual zero-API path. The recipe rollout retains its priority. Production access, missing brand labels, and provider setup are dependencies of later jobs, not blockers for this plan.

UI phase decision (2026-11-05): the Ingredient Library (#69) and the Import workspace (#70) are separate items. #66 owns shared resolution/review components and #69/#70 own the tracker surfaces that compose them, keeping each PR reviewable.

Cost decision (2026-11-05, James): do not spend metered API money for routine food calcs. Keep the screenshot → assistant/project-instruction → structured-result flow. Default AI is copy/paste on subscriptions already paid; any direct provider route is optional, flagged off, $0 cap.

Architecture decision (2026-11-06, James): external-assistant ingredient import is primary. External assistants interpret photos, recipes, labels, and descriptions and return a structured ingredient list; the site imports, matches, researches missing profiles, calculates, fits, reviews, and saves. #67 becomes the ingredient-list import contract and #70 the Import workspace; research packets move into #62 as one adapter of the shared pipeline used by bulk population and in-app research; on-site vision/OCR and any direct provider route are deferred to #71, which is never a prerequisite.

Resolved for #67 (2026-11-08): `schemaVersion` gates acceptance. A newer version returns "site update required" and is not guessed. `instructionsVersion` is producer provenance only and is not a schema gate. Prose may wrap exactly one fenced JSON block; any other fence count is rejected. State and preparation come from `variantVocabulary.js`. `confirmMatch` records an explicit choice. A raw/cooked or drained/undrained conflict is not selected unless the caller passes `acknowledgeConflict`. That override is labeled and writes nothing. Bulk confirmation and curated-versus-private alias storage stay with #66/#69/#61 Part B.

Open design questions (resolve in the owning item; none blocks #67):
- #64 Part A: status aggregation, interval propagation, uncertainty ranking; weighted fiber per ingredient (recommended) vs per meal.
- #64 Part B: diary v2 detail via a private meal-version record referenced by a v1 diary projection (recommended) vs waiting for #60 Part B; applying facts to portions consumed and raw vs cooked basis.
- #65: dependency-free bounded least-squares/LP design, residual weights from rounding intervals, non-uniqueness detection, yield, tie-breaking, and weighting `user_stated` facts.
- #62: in-app jobs live in IndexedDB and are lost on sign-out; packets must be self-contained enough to re-attach, or a Firestore job store needs its own rules and approval.
- #71: where the budget lives, how the UI learns route/budget state, and per-packet cost estimates.
