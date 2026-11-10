# CalorieTracker: active backlog

Single source of truth for work on `public/tools/CalorieTracker/` and the shared ingredient-nutrition integration with Recipe Standardizer. Items through #59, #60 Part A, #61 Part A, #72, #73, #74, #75, and #78 are merged and archived.

## Purpose and scope

Create a reusable ingredient database and save meals as versioned ingredient quantities. Expand nutrient detail, populate a comprehensive catalog, preserve known labels while estimating recipe quantities, and reuse approved data with minimal AI. Extend the current recipe integration.

External assistants (ChatGPT, Claude, Grok, Codex, or James's bots) interpret photos, recipes, labels, and meal descriptions and return a structured ingredient list ([assistant contracts](../docs/nutrition/assistant-contracts.md)). The Nutrition Tracker is the authoritative ingredient database, quantity-fitting engine, nutrition calculator, and store. It gains an Import workspace (#70) that imports assistant-prepared ingredient lists, saved meals, and recipes; matches them against the shared library; resolves missing ingredients through one research pipeline (deterministic sources, then copy/paste research packets); calculates every registry nutrient; fits quantities only against known facts with real provenance; and saves reusable recipes, foods, and diary entries. An Ingredient Library tab (#69) manages profiles. Recipe Standardizer uses the same profiles, calculation modules, and research pipeline. The legacy paste parser remains a supported secondary path. On-site photo/OCR/vision and any direct AI provider route are optional, deferred (#71), and never prerequisites.

#60 onward implements and releases the site in separate stages. Do not describe the catalog as populated or planned import/research behavior as shipped.

**Non-goals:** client-side provider keys, AI as the calculation engine, on-site meal interpretation in the primary path, a second Recipe Standardizer enrichment route (P7), recipe-side whole-day diary writes (P6), automatic rewriting of historical meals, and namespace cutover (F-141).

## Parameters

- **Branch/PR:** one focused branch/PR per item or bounded #63 population batch from current `main`; `working/calorie-tracker-<ID>-<topic>` where possible.
- **Commit scope:** `calorie-tracker`; stable IDs `#N`; next unused ID: **#81**. Population batches use `#63-<wave>-<sequence>`; never reuse IDs.
- **Archive:** `backlogs/calorie-tracker-completed.md`.
- **Checks:** tracker behavior: `cd public/tools/CalorieTracker && npm test`; recipe/shared logic: root `npm test`; React pages/shared config: `npm run lint` and `npm run build`; auth/rules/data-model changes: relevant tests plus `npm run test:rules`.
- **Docs/data-only:** validate JSON (including contract examples), unique IDs, links/anchors, dispatch, cross-file contracts, and source-of-truth consistency. No app tests required.
- **Release:** follow [Firebase release](../docs/firebase-release.md) for rules/private-data changes. Record actual deployment/manual evidence. No historical rewrite or namespace cutover is bundled into this feature.
- **Approval gate:** steps marked **Requires James's explicit approval** (Firestore rules deploys, production or private-data writes/migrations, live catalog population imports, provisioning or enabling live credentials such as FDC keys, and enabling the optional direct AI provider route (#71) or raising its $0 spend cap) wait for that approval, recorded in the item note or PR. Code, tests, fixtures, emulator runs, dry-run reports, and staged review artifacts may proceed without it. No approval is implied by this backlog.
- **Contract:** [overview](../docs/nutrition/README.md), [workflow](../docs/nutrition/workflow.md), [assistant contracts](../docs/nutrition/assistant-contracts.md), [population playbook](../docs/nutrition/population-playbook.md), [catalog](../docs/nutrition/ingredient-catalog.json), [2026-11-09 requirements review](../docs/nutrition/REQUIREMENTS_REVIEW_2026-11-09.md).

## Verified current state

Baseline: `main` `91e10ad` (#62 / PR #189), inspected 2026-11-08.

- Tracker: shared v2 nutrient registry/readers and anchored detail parsing are merged. Food/day writes still use the 24-key v1 shape while `NUTRIENT_V2_WRITES_ENABLED` is false; name-slug food IDs and diary snapshots remain.
- #61 Part A is merged: versioned identities, variants, revisions, conversions, `matchIngredient`, an empty curated catalog, and an owner-scoped IndexedDB profile cache. `INGREDIENT_STORE_WRITES_ENABLED` is false and the ingredient rules are repository source, not deployed. `VariantDims.state`/`preparation` are free text; only drained/salt/fortification have enums.
- Recipe Standardizer: confirmed links, gram bases, revision fingerprints, manual per-100-g research import (24 numeric keys, `MAX_INTAKE_ITEMS = 100`), totals, and create/update export transactions already exist. Extend them.
- Exported foods flatten composition and zero-fill gaps after partial-coverage confirmation. Their recipe back-reference does not make the saved tracker food an ingredient recipe.
- Data remains under `default-app-id`; source-namespace migration stays owned by F-141. Production records and authenticated sessions have not been inspected for this plan.
- #62 is merged: shared state/preparation vocabulary (`VOCABULARY_VERSION = 1`), research request/response v1, two-phase adapters, verification, an owner-scoped IndexedDB job store, and the dry-run CLI. No live source, key, catalog population, or production write is enabled. `fiberWeightedLegacy` stays a #64 calculation and is not a stored or requested profile field.
- As of `497f941`: #64 Part A calculation, #65 fitting, #66 resolution, #67 import, #70 Import workspace, and the #69 search/review Library tab are on `main`. Both write flags are false. The repository service worker is `nutritrack-v5`. The curated catalog has 0 profiles. The 1,114-entry queue is all `queued` (253 priority 1). There is no nutrition API route. #71 still owns any future private API cache risk. Do not describe this code as a rules deploy, a write enablement, or a populated catalog.

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

## Release phases (James, 2026-11-09)

1. Read-only census and backup (#60 Part B). The parent completed the count on 2026-11-09: 191 v1 foods, 0 v2 foods, 417 daily entries. The REST backup is not a migration copy. Writers stay off. Agents do not query production. Script bugs are #80.
2. Technical corrections and branch implementations with both write flags false, in this order: #72 (merged), #73 (merged), #74 lookup honesty (merged), #78 (merged), #75 (merged), then #69 Part B (pushed, branch only) and #64 Part B using emulator or fixture tests. #69 Part B and #64 Part B depended on #72, #73, and #74; all three are merged.
3. Beta validation (#79) in an isolated Firebase test project. Not production. #68 depends on a recorded #79 result.
4. Priority-1 dry-run pilot (#76) on pinned local fixtures, and the #77 aggregate counts from a foods-only extract kept outside the checkout. No names, ids, paths, or nutrient values are committed.
5. Controlled enablement, one gate at a time, each with backup and rollback. Live FDC, catalog import, rules, and writer flags stay unapproved. Do not flip `NUTRIENT_V2_WRITES_ENABLED` for the beta; legacy food and diary writes stay v1.
6. #68 acceptance after those gates and a #63 gap report. #71 stays deferred.

## Active items

Dependency order: #59, #61 Part A, #62, #64 Part A, #65, #66, #67, #70, #72, #73, #74, #75, #78, and the #69 search/review slice are archived. Selection skips a `[p]` item whose note says `blocked`. #69 Part B is a pushed branch implementation awaiting review; #64 Part B is next. #75 merged as `7700351` (PR #204). #78 merged as `e93190e` (PR #203). #74 merged as `bd6d56f` (PR #202), so #69 Part B and #64 Part B no longer wait on #74 (#72, #73, and #74 are merged). #60 Part B's writer step, #61 Part B, #62 Part B, #63, production saves, #68, and #79 stay approval-gated or sequenced behind phase 2. #71 is deferred.

### #62 Part B: Pin live sources and publish staged curated data

- [p] **Enable live FDC data and publish reviewed curated output.** Depends: #62. Scheduled together with the first #63 batch.
  > blocked — live credentials and curated publication need James's approval. Do not start.
  - **Surfaces:** pinned FDC release configuration, server-side/CLI credential handling, staged curated catalog publication.
  - **Accept:** a real FDC release is pinned by checksum; any live key stays server-side or CLI-only and never reaches the repository or client; staged curated data contains no private inputs and publishes only after review.
  - **Checks:** dry-run reports, source-license review, root/tracker suites for any config change.
  - **Migration/deploy:** **Requires James's explicit approval** to provision or use live credentials (for example an FDC API key) and to publish staged data to production.

### #60 Part B: Enable nutrient v2 food/day writes

- [p] **Complete the approval-gated nutrient storage rollout.** Depends: #60 Part A (merged `326a748`, PR #185). Gate for v2 detail in diary snapshots.
  > blocked — The parent finished the read-only census on 2026-11-09. Production food documents in that count are all v1 (191 foods, 0 v2). Enabling `NUTRIENT_V2_WRITES_ENABLED` and any writer deploy remain unapproved. A global v2 flag must not change legacy food or diary writes; beta detail belongs on #64 Part B snapshots. Saved-food writes refuse `nutrientSchemaVersion >= 2`. `saveDailyEntry()` and `saveDailyEntrySnapshot()` replace the day with `setDoc` and do not check schema. A transactional diary guard is required before any claim that a cached client cannot drop newer diary fields. The REST backup does not keep integer versus double. Take a fresh Admin SDK backup before any migration. Agents must not run another production census.
  - **Surfaces:** [Firebase release](../docs/firebase-release.md), read-only census/backup, food/day shape flag, deployment and compatibility verification.
  - **Accept:** perform the separately approved census and backup, deploy readers before writers, verify cached/PWA clients cannot erase v2 fields, then enable the food/day shape flag in a separate reviewed release. Preserve all historical logs and fingerprint compatibility.
  - **Checks:** the release runbook, tracker/root/rules suites and lint/build; record actual manual/deployment evidence.
  - **Migration/deploy:** **Requires James's explicit approval** for production inspection/census/backup, enabling v2 writes, and deployment. `NUTRIENT_V2_WRITES_ENABLED` remains false until then.

### #61 Part B: Deploy ingredient rules and enable ingredient-store writes

- [p] **Release the #61 ingredient store to production.** Depends: #61 Part A (merged `3843254`, PR #186). Blocks live saving.
  > blocked — rules deploy, live smoke, and the write flag need three separate approvals. Do not start.
  - **Surfaces:** [ingredient release runbook](../docs/nutrition/ingredient-store-release.md), Firestore rules, `INGREDIENT_STORE_WRITES_ENABLED`, service-worker cache bump.
  - **Accept:** follow the runbook's B1–B5: read-only inspection and census (0 docs), dry-run compile, rules deploy, live smoke with throwaway accounts and cleanup, then a separate PR enabling writes. Record ruleset names, SHAs, and outcomes.
  - **Checks:** the runbook, tracker/root/rules suites; recorded live smoke.
  - **Migration/deploy:** no data copy or backfill. **Requires James's explicit approval** for the rules deploy, live fixtures, and enabling writes (three separate approvals).

### #69 Part B: Save private library profiles

- [p] **Add, edit, and save owner-private ingredient profiles.** Depends: #72, #73, and #74 before branch implementation. Production save also depends on #61 Part B and #79. The search/review library merged in #196 (`497f941`). Do not start the branch before those three corrections. Do not deploy rules or write production.
  > pushed - branch implementation with both write flags false: `buildLibraryDraft()` builds a validated revision draft from a staged manual, label, or applied research edit (unpatched fields keep value, quality, and provenance; per-field source, unit, status, uncertainty, confidence, comparator, derivation, source version, and dates are kept; anything unrepresentable is reported in `unrepresented`); `commitLibraryEdit()` saves the next revision or a private override through the ingredient store, maps conflicts to `revision_conflict` with the draft kept in the pending-save outbox, and stays `writes_disabled` with the flag off; Research passes the reviewed ref, revision, and missing fields; one "Save to my library" button says writes are off and keeps the staged result; tests use the mocked flag and fake port only; no rules change, no production write, no diary write; checks: nutrition 543, tracker 1159, root 2015, `tsc` on `library.d.ts`, ci:docs; commit: d721070; PR: pending
  - **Surfaces:** library add/edit actions, `commitLibraryEdit`, and `researchLibraryFields`. The merged tab searches, reviews, and stages research only. The research button passes the name and owner, not the selected ref, revision, and field list. `commitLibraryEdit()` returns `writes_disabled`.
  - **Accept:** add a private profile; an edit creates the next revision; import a label or manual verified values; review and save a research result without dropping per-field source, unit, status, uncertainty, confidence, comparator, derivation, source version, or retrieval date; choose specific missing fields and pass that ref, revision, and field list into the research request; show evidence and revision history; private overrides replace the owner's view; curated records stay immutable. Saved edits never change another user's data and never rewrite saved diary snapshots. Affected meals stay deferred until #64 Part B.
  - **Checks:** tracker and root suites; revision-on-edit, override precedence, field selection, and staged-research save or cancel. Rules tests if rules change. Emulator only until #61 Part B is approved.
  - **Migration/deploy:** production save **requires James's explicit approval** together with #61 Part B. `INGREDIENT_STORE_WRITES_ENABLED` stays false until then.

### #64 Part B: Save ingredient graphs with reproducible meal snapshots

- [ ] **Persist meal/recipe versions and connect them to saved foods and diary entries.** Depends: #64 Part A, #72, #73, and #74 before branch implementation. Production save also depends on #61 Part B and #79. Legacy food and diary documents stay v1; do not wait on flipping `NUTRIENT_V2_WRITES_ENABLED`. Branch code keeps both write flags false and does not start before #72, #73, and #74.
  - **Surfaces:** meal and recipe version records, recipe link/export/save, tracker food/diary services, storage/rules, import/export.
  - **Accept:** save as reusable recipe, food item, and/or diary entry. Saving a meal does not add it to the diary; diary add is a separate explicit action. Casserole/burger share applicable profile revisions with different quantities; nested recipes are acyclic and counted once. Save ingredient identities pinned to profile revision and hash, quantities with units, bases, and ranges, known facts separate from calculated values, preparation and yield assumptions from #72, sources, assumptions, fit parameters, import provenance, calculation and fit versions, and the complete nutrition snapshot. Create new approved profiles once; reuse existing IDs. Re-portioning a saved meal uses ordinary code and no AI call. Diary entries hold a `mealRef` and a frozen snapshot; newer profile data only shows a "new data available" notice with explicit recalculation. Expose ingredient→meal references for #69's affected-meals view. Transaction failure, retry, dedupe, concurrent edits, and an interrupted save leave a visible result and no partial diary write. Flat foods still load.
  - **Checks:** tracker/root/rules suites; reuse/version/deletion/conflict/export, immutable-history, offline-recalculation, partial-save, retry, dedupe, concurrent-edit, and interrupted-save tests; lint/build for views.
  - **Diary ownership:** tracker-owned logging with references/snapshots; no recipe-side whole-day writer or implicit P6. Test another tab editing the day between recipe export and tracker logging.
  - **Migration/deploy:** additive schema, legacy adapters, verified export/import round trips. No automatic reconstruction of old meals from totals. Offline saves are queued or fail visibly; success is reported only after commit. **Requires James's explicit approval** for any rules deploy or production schema change.

### #63: Populate every catalog ingredient and audit gaps

- [p] **Execute all population waves in bounded batches.** Depends: #62; #62 Part B for live work; #76 for the priority-1 dry-run report. Uses #69's review views once available; does not wait for them.
  > blocked — each live catalog import and any paid API batch need James's approval. The local-fixture dry-run is #76, not this item.
  - **Surfaces:** catalog, reviewed matches, versioned profiles, gap reports, progress records.
  - **Execution:** follow [the population playbook](../docs/nutrition/population-playbook.md) and its execution prompt. Derive at most 25-ID jobs by priority/category/ID. Waves A-E cover every manifest ID; newly discovered ingredients join the same queue. Bulk deterministic import first, cached source releases, then residual-field passes using #62 CLI research packets (the same schema as in-app research) run through assistants or subscription CLIs James already pays for—not paid per-token API batches. Make a thorough, source-backed effort on every stored registry field including micronutrients (derived `fiberWeightedLegacy` excluded); estimates are labeled with comparator and range. Residual passes use a new pass ID under the same parent batch ID and create no duplicate profiles.
  - **Accept per batch:** every field has a sourced value/derivation or explicit unknown; identity/basis verified; source IDs/dates retained; flags reviewed; imported revisions/coverage reported; reruns create no duplicates. No blank-to-zero completion. Missing branded labels remain actionable blocked work.
  - **Accept overall:** all IDs attempted, resolvable profiles reviewed/imported, blocked IDs/fields enumerated. Distinguish full research coverage from unavailable analytical data. Do not claim every micronutrient is measured.
  - **Checks:** validator, category/priority reconciliation, source/basis/unit review, documented sample plus all flagged cases. App tests only for code changes.
  - **Migration/deploy:** bounded public-data releases; release runbook for private imports. No historical meal modification. **Requires James's explicit approval** before each live catalog import (or a recorded standing approval for a named wave) and before any paid (metered API) model-assisted batch. Assistant-run residual batches on subscriptions James already pays for do not need a separate spend approval; live import of their reviewed results still follows the catalog-import gate.

### #68: Verify accuracy, reuse, migration, and release

- [p] **Complete staged rollout and operating documentation.** Depends: #60 Part B writer decision, #61 Part B, #62, #62 Part B, an explicit #63 gap report, #64 Part A, #64 Part B, #65, #66, #67, the #69 search/review slice, #69 Part B for private saves, #70, #72, #73, #74, and a recorded #79 isolated-project result. #71 is not required. The read-only census does not by itself satisfy this item.
  > blocked — production smoke, migrations, and enablement need James's approval, and phase 2 plus #79 come first.
  - **Surfaces:** both tools, rules/migration, source refresh, backup/recovery, help, project prompts, and assistant instructions.
  - **Accept:** exercise bowls, pasta, soups, baking, cocktails, and burger/casserole reuse through the #70 Import workspace with assistant-prepared lists and through Recipe Standardizer; research-packet round trips; zero re-research of matched ingredients; compare exact recipes with withheld totals; distinguish source data from uncertain portions. Verify diary immutability, versioned refresh, zero AI for repeats and matched inputs, offline calculation, packet import honesty, and every missing-data choice. Publish capabilities and coverage.
  - **Checks:** relevant complete suites, recorded signed-in production smoke, migration count/hash checks, restore/retry exercise, source-license review.
  - **Migration/deploy:** readers then rules/data then writers; refresh cached clients; staged enablement/rollback. **Requires James's explicit approval** for the production smoke, migrations, and each enablement step. Archive after actual deployment and verified acceptance.

### #71: Optional direct AI provider route (deferred)

- [p] **Add a provider-agnostic server transport for the #62 research contract.** Depends: #62, #67. Deferred; off the critical path; nothing depends on it.
  > blocked — building or enabling the route, a key, a cap above $0, or Storage rules need James's approval. Do not start.
  - **Surfaces:** an authenticated Next.js route acting as a #62 two-phase adapter transport for research request/response v1; optionally a future extraction endpoint that outputs ingredient-list v1 (the only place on-site photo/OCR extraction may ever live); tracker service worker.
  - **Accept:** off by default, feature-flagged, $0 budget cap; a durable server-side budget reservation before every provider call (concurrent/duplicate requests cannot exceed the cap; reconciled with actual usage); non-anonymous Firebase users only (reject `signInAnonymously` guests); keys server-side only; user-initiated, rate/size-bounded (per verified account plus global/IP or App Check quota), cancellable, and logged without private payloads. The UI learns whether the route is enabled and has budget. Outputs pass the same #62/#67 validators as copy/paste. The service worker treats the route as network-only and clears legacy Cache Storage entries on sign-out. Select the provider/model at enablement time and record it in the PR.
  - **Checks:** flag-off default (no provider calls), auth including anonymous rejection, rate-limit, cancellation, $0-cap and concurrent budget-reservation tests, service-worker network-only test, `npm run test:api`; update `SECURITY.md` and `ARCHITECTURE.md` when built.
  - **Migration/deploy:** **Requires James's explicit approval** to build or enable the route, provision a key, raise the $0 cap, or deploy any Storage rules it needs.

### #76: Dry-run the priority-1 population pilot

- [ ] **Report a priority-1 pilot without importing it.** Depends: #62, #72, #73, and #74. Live retrieval stays #62 Part B. Catalog import stays #63.
  - **Surfaces:** pinned local fixtures, the 253 priority-1 ids in `docs/nutrition/ingredient-catalog.json`, and a written report.
  - **Accept:** the report counts matches, coverage, uncertainty, unresolved fields, validation failures, and the production changes a later import would make. It performs none of those changes. Basis is per 100 g edible form, with raw, cooked, drained, fortified, and branded records kept apart. Unknown stays explicit. Estimates carry a comparator, rationale, and range. Subscription assistants remain the residual path. Metered APIs stay at $0.
  - **Checks:** validator and the report's reconciliation against the 253 ids. App tests only if code changes.
  - **Migration/deploy:** no live pull and no catalog write. **Requires James's explicit approval** before any live FDC or manufacturer request, even for a dry-run that leaves the repository.

### #77: Estimate lossless conversion of flat saved foods

- [ ] **Count flat foods that can convert without loss or invention.** Depends: a foods-only extract supplied by the parent. Not a production query.
  - **Surfaces:** a protected foods-only file outside the checkout. A nutrient census backup also contains diary entries and recipes, so that backup is not the report input and is not committed.
  - **Accept:** a committed report contains aggregate counts only: how many flat foods can convert without losing a stored value and without inventing a zero or a gram basis, and how many cannot. It contains no document path, food name, id, or nutrient value. No document is rewritten.
  - **Checks:** the aggregates reconcile to the private extract's counts without copying a row into the repository.
  - **Migration/deploy:** none. Agents do not run the production census.


### #79: Validate the beta in an isolated Firebase project

- [p] **Exercise save behavior away from production.** Depends: #69 Part B and #64 Part B branch implementations, plus #72, #73, #74, and #78. #68 depends on this item.
  > blocked — phase 3. Do not start during phase 2, and do not point the project at production.
  - **Surfaces:** a written isolated-project runbook and a recorded test log. No production Firestore project.
  - **Accept:** import, match, research, fit, calculate, review, private-profile save, and meal save are exercised in a Firebase project that is not production. Failure is visible. Abandoning the beta leaves the test diary unchanged until an explicit diary add. Legacy food and diary shapes are not given v2 writes. The log records the project id, ruleset, flags, and cleanup. Production is not contacted.
  - **Checks:** the runbook and the recorded log. Emulator evidence can prepare the runbook; it does not replace the isolated-project log.
  - **Migration/deploy:** none to production. Creating or using the isolated project waits until phase 2 has merged and James confirms which Firebase project is the sandbox.

### #80: Fix the read-only census script

- [ ] **Make `nutrientCensus.ts` runnable and retryable without printing private data.** Depends: none. No production run in this item.
  - **Surfaces:** `scripts/firebase/nutrientCensus.ts` and `scripts/firebase/nutrientCensusLogic.ts`.
  - **Accept:** authentication can use an already approved local credential path without requiring Application Default Credentials to be the only option. The output directory is created only after auth succeeds, so a failed auth does not leave a directory that `refuseUnsafeRun` treats as an existing run. `vite-node` reaches `main()`. A retry after a failed auth is not blocked by the directory the failed run created. Tests cover those three cases with fixtures. The script still prints aggregates only and still refuses to write inside the checkout.
  - **Checks:** the census unit tests. Do not run the script against production.
  - **Migration/deploy:** none. The 2026-11-09 REST backup remains ineligible as a migration copy.

## Decisions and dependencies

No product decision blocks #62. Defaults: custom weighted fiber under details, standard fiber for standard comparisons, versioned snapshots, and a manual zero-API path. The recipe rollout retains its priority. Production access, missing brand labels, and provider setup are dependencies of later jobs, not blockers for this plan.

UI phase decision (2026-11-05): the Ingredient Library (#69) and the Import workspace (#70) are separate items. #66 owns shared resolution/review components and #69/#70 own the tracker surfaces that compose them, keeping each PR reviewable.

Cost decision (2026-11-05, James): do not spend metered API money for routine food calcs. Keep the screenshot → assistant/project-instruction → structured-result flow. Default AI is copy/paste on subscriptions already paid; any direct provider route is optional, flagged off, $0 cap.

Architecture decision (2026-11-06, James): external-assistant ingredient import is primary. External assistants interpret photos, recipes, labels, and descriptions and return a structured ingredient list; the site imports, matches, researches missing profiles, calculates, fits, reviews, and saves. #67 becomes the ingredient-list import contract and #70 the Import workspace; research packets move into #62 as one adapter of the shared pipeline used by bulk population and in-app research; on-site vision/OCR and any direct provider route are deferred to #71, which is never a prerequisite.

Resolved for #67 (2026-11-08): `schemaVersion` gates acceptance. A newer version returns "site update required" and is not guessed. `instructionsVersion` is producer provenance only and is not a schema gate. Prose may wrap exactly one fenced JSON block; any other fence count is rejected. State and preparation come from `variantVocabulary.js`. `confirmMatch` records an explicit choice. A raw/cooked or drained/undrained conflict is not selected unless the caller passes `acknowledgeConflict`. That override is labeled and writes nothing. Bulk confirmation and curated-versus-private alias storage stay with #66/#69/#61 Part B.

James, 2026-11-09: keep Today and the ingredient beta side by side permanently. The beta tab is Ingredient Import (Beta). Saving a meal does not log it. Do not flip the global nutrient write flag to expose legacy foods or diary entries to v2 writes. Beta saves, when later approved, use meal snapshots. Finished serving weight is not a raw-ingredient sum, and water loss does not scale nutrients. Official `not_found` requires a lookup that ran. Population stays a dry-run until a later import approval. The read-only census and backup are the only new production approval, and the parent runs them.

Open design questions (resolve in the owning item; none blocks #67):
- #64 Part A: status aggregation, interval propagation, uncertainty ranking; weighted fiber per ingredient (recommended) vs per meal.
- #64 Part B: the v1 diary projection is selected. Remaining detail is how facts apply to the portion eaten, owned by #64 Part B and #72.
- #65: residual weights, non-uniqueness, tie-breaking, and weighting `user_stated` facts. Yield is now #72, not a single cooked/raw ratio.
- #62: in-app jobs live in IndexedDB and are lost on sign-out; packets must be self-contained enough to re-attach, or a Firestore job store needs its own rules and approval.
- #71: where the budget lives, how the UI learns route/budget state, and per-packet cost estimates.
