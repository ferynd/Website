# CalorieTracker: active backlog

Single source of truth for work on `public/tools/CalorieTracker/` and the shared ingredient-nutrition integration with Recipe Standardizer. Items through #58 are merged and archived. New work starts at #59.

## Purpose and scope

Create a reusable ingredient database and save meals as versioned ingredient quantities. Expand nutrient detail, populate a comprehensive catalog, preserve known labels while estimating recipe quantities, and reuse approved data with minimal AI. Extend the current recipe integration.

The Nutrition Tracker becomes the primary meal-analysis interface, not only a sink for completed ChatGPT estimates. It gains an Ingredient Library tab (#69) and a staged meal-analysis workspace (#70) that accept photos, labels, ingredient lists, recipes, and saved meals; match them against the shared database; resolve gaps by the user's chosen action; fit quantities deterministically; and save reusable compositions. Recipe Standardizer uses the same profiles, calculation modules, and research workflow. The legacy paste parser remains a supported secondary path; structured ingredient-level data is the primary future interface. Model help defaults to cost-free assistant packets rather than a paid site API.

The current request establishes the plan, catalog, population instructions, and future chat workflow. #59 delivers those planning artifacts. #60 onward implements and releases the site in separate stages. Do not describe the catalog as populated or the website as changed by #59.

**Non-goals:** client-side provider keys, AI as the calculation engine, a second Recipe Standardizer enrichment route (P7), recipe-side whole-day diary writes (P6), automatic rewriting of historical meals, and namespace cutover (F-141).

## Parameters

- **Branch/PR:** one focused branch/PR per item or bounded #63 population batch from current `main`; `working/calorie-tracker-<ID>-<topic>` where possible.
- **Commit scope:** `calorie-tracker`; stable IDs `#N`; next unused ID: **#71**. Population batches use `#63-<wave>-<sequence>`; never reuse IDs.
- **Archive:** `backlogs/calorie-tracker-completed.md`.
- **Checks:** tracker behavior: `cd public/tools/CalorieTracker && npm test`; recipe/shared logic: root `npm test`; React pages/shared config: `npm run lint` and `npm run build`; auth/rules/data-model changes: relevant tests plus `npm run test:rules`.
- **Docs/data-only:** validate JSON, unique IDs, links, dispatch, cross-file contracts, and source-of-truth consistency. No app tests required for #59.
- **Release:** follow [Firebase release](../docs/firebase-release.md) for rules/private-data changes. Record actual deployment/manual evidence. No historical rewrite or namespace cutover is bundled into this feature.
- **Approval gate:** steps marked **Requires James's explicit approval** (Firestore rules deploys, production or private-data writes/migrations, live catalog population imports, provisioning or enabling live credentials such as FDC keys, and enabling the optional paid OpenAI route or raising its $0 spend cap) wait for that approval, recorded in the item note or PR. Code, tests, fixtures, emulator runs, dry-run reports, and staged review artifacts may proceed without it. No approval is implied by this backlog.
- **Contract:** [overview](../docs/nutrition/README.md), [workflow](../docs/nutrition/workflow.md), [population playbook](../docs/nutrition/population-playbook.md), [catalog](../docs/nutrition/ingredient-catalog.json).

## Verified current state

Baseline: `main` `4dd9b927ec993d7e26c1d97d833a07b9f222efab`, inspected 2026-11-05.

- Tracker: 24 keys, word-matching paste parser, missing staged values become zero, name-slug food IDs, fixed-shape food saves, and diary snapshots. Expanded fat/fiber lines are unsafe for the current parser.
- Recipe Standardizer: confirmed links, gram bases, revision fingerprints, manual per-100-g research import, totals, and create/update export transactions already exist. Extend them.
- Exported foods flatten composition and zero-fill gaps after partial-coverage confirmation. Their recipe back-reference does not make the saved tracker food an ingredient recipe.
- Data remains under `default-app-id`; source-namespace migration stays owned by F-141. Production records and authenticated sessions have not been inspected for this plan.
- There is no local ingredient-profile cache, Ingredient Library tab, or nutrition AI route. Existing `app/api` routes do not serve nutrition. The tracker's service worker (`public/tools/CalorieTracker/sw.js`) precaches the app shell but also cache-matches/stores successful same-origin responses outside its network-only Firebase patterns; private same-origin API responses are therefore at risk of Cache Storage persistence across account switches unless #67 (and related work) marks nutrition/API routes network-only and clears legacy entries on sign-out.

## Invariants

- `getTrueUpCandidates` retains centered windows `[D-preDays, D+postDays]`; TDEE reference comes from outside the candidate interval when available.
- Preserve `computeWeekdayAverages` using `trimmedMean(arr, 0.1)`, synthetic-entry micronutrients, protein-basis order (lean mass, target weight, current weight), and dormant legacy gap helpers.
- Retain every existing nutrient and historical log. Keep unknown distinct from measured zero; preserve legacy fiber meaning.
- Match exact state/form and source revision. Display names are aliases, not IDs.
- Reuse profiles across meals. Never fit ingredient nutrient values to force a meal's macro match.
- Known labels stay separately attributable. Inferred quantities and missing micros stay estimates.
- Save composition, versioned references, and a frozen snapshot. Ingredient updates never silently change old diary totals.
- Prompt for missing ingredients before research. Preserve manual input and zero-AI recalculation of resolved meals.
- Calculate without AI whenever structured information suffices. Deterministic parsing/OCR runs before optional AI vision; models never compute totals, scale portions, or match confirmed IDs.
- The default model path is cost-free: the site emits a structured assistant request packet (copyable JSON plus needed images) and imports a schema-validated JSON result from James's already-paid assistant bots (Claude/Codex/ChatGPT) or ChatGPT project instructions. A server-side OpenAI route is optional, off by default, feature-flagged, and capped at $0 spend until James explicitly raises it. Keys never reach the client, static site, or repository. Freeform model nutrition text is never imported. Models never overwrite known facts.
- The solver never silently changes known facts, treats label rounding as intervals, and reports non-unique or infeasible fits instead of claiming a unique recipe.
- One set of ingredient profiles, nutrient registry, calculation/solver modules, and research workflow serves both tools. Do not duplicate data models or research flows per tool.
- The legacy paste parser stays supported; structured ingredient-level data is the primary interface.
- Keep private meals/profiles owner-authorized; public reference data contains no private inputs.

## Active items

Dependency order: #59 → #60 → #61 → #62 → #63 (batches) → #69 → #64 → #65 → #66 → #67 → #70 → #68. IDs are stable, so #69/#70 appear by dependency rather than number. After #62, #63 and #69 are both unblocked and may run in parallel (population batches vs library UI); ordinary single-item dispatch prefers #63 first so catalog population is not blocked behind the library. #63 does not depend on #69; #64 onward do not wait for full #63 completion.

### #59: Define the contract and comprehensive research queue

- [p] **Record the requested workflow and population plan.** Depends: none.
  > pushed: workflow contract, 1,114-entry research queue, and population plan prepared; checks: JSON/IDs/enums/links/dispatch, diff check, and independent review pass; commit: 7f1900a; PR: #179. Runtime implementation and population remain #60-#70.
  - **Surfaces:** this backlog, routing, nutrition docs/catalog, concise tool-documentation links.
  - **Accept:** expanded nutrient meanings, standard/custom fiber, source/quality model, versioned reuse, constrained quantities, missing-data choices, history, and AI boundary are explicit. Catalog covers broad food families, preparation variants, common components, and additives. All entries start queued without fabricated nutrition. Population has bounded repeatable jobs and an executable selection rule.
  - **Checks:** docs/data-only checks and independent review. **Migration/deploy:** none. The installed chat skill is a separate instruction update, not site implementation.

### #60: Expand nutrient contracts and make parsing lossless

- [ ] **Implement a versioned registry and quality-aware imports/exports.** Depends: #59.
  - **Surfaces:** tracker constants/parser/staging/save/display/export/targets; recipe `trackerFoods`, `nutritionIntake`, calculation/export formats and parity tests.
  - **Accept:** saturated/trans/mono/poly fat and planned groups supported; exact labels cannot overwrite parent totals; null/rounded-zero/measured/estimated states survive round trips. EPA/DHA cannot overwrite total omega-3. Unknown keys warn; conflicting duplicate keys require review. Units/carbohydrate conventions explicit. Per-100-g bounds accommodate salt/additives. Legacy fiber preserved and classified only with evidence. New fields are not all minimum targets.
  - **Shared module:** one registry module is consumed by the Vite tracker and the React tool (shared source or build artifact, chosen and documented here); no per-tool copies. Parity tests guard any generated artifact.
  - **Legacy paste:** the existing paste parser keeps accepting the 24-field block with anchored labels; it becomes a secondary adapter onto the same staged record, not a separate data model.
  - **Checks:** tracker/root suites; lint/build for UI; regression cases for subtype collisions, unknowns, unit conversion, fiber ambiguity, and parity.
  - **Migration/deploy:** version readers before writers, preserve v1, and declare capabilities. Verify cached/PWA clients cannot erase v2 fields before enabling writes. **Requires James's explicit approval** before enabling v2 writes against production data.
  - **Fingerprint compatibility:** version the quantity/nutrient hash and retain v1 verification for existing confirmed links and export references. Test that dictionary expansion neither silently trusts a changed source nor invalidates unchanged legacy links.

### #61: Add versioned ingredient storage and identity matching

- [ ] **Implement ingredient identities, variants, sources, and revisions.** Depends: #60.
  - **Surfaces:** shared nutrition modules, tracker manager/services, recipe links/types/database, local profile cache, canonical rules and emulator tests.
  - **Accept:** stable IDs; raw/cooked/drained/fat/fortification/brand variants; per-100-g basis and sourced unit conversions (household measures, densities, piece weights) as records; field provenance; immutable revisions; private overrides over curated data. Exact confirmed IDs reuse without research; ambiguous aliases require review. Cross-user/public-catalog client writes fail at the boundary. Concurrent creates deduplicate; failed saves are recoverable. Both tools read and write through the same identity/profile/conversion services; Recipe Standardizer links resolve to these IDs rather than a parallel store.
  - **Checks:** tracker/root/rules suites; identity, revision, collision, concurrency, ownership tests; cache staleness/eviction/sign-out tests; lint/build for UI.
  - **Lookup contract:** indexed/paginated search and bounded caches; do not load the whole catalog on tool open. The current matcher strips raw/cooked/salt descriptors, so it remains suggestion-only; exact automatic reuse requires variant compatibility.
  - **Offline cache:** a versioned local cache (for example IndexedDB) of used/approved profile revisions and conversions lets matching and calculation run offline. Entries are keyed by namespace/catalog + profile ID + revision, revalidated on reconnect, bounded, scoped to the signed-in owner, and cleared on sign-out. A stale or missing entry is reported, never treated as zero.
  - **Migration/deploy:** legacy foods retain unknown basis/meaning where necessary. Preserve the current namespace contract/constants; any resolver is explicit work coordinated with F-141. Stage rules release; require dry-run report, backup, and rollback before live copies. **Requires James's explicit approval** for the Firestore rules deploy and any live data copy.

### #62: Build source ingestion and resumable research jobs

- [ ] **Implement deterministic imports and evidence review.** Depends: #60, #61.
  - **Surfaces:** configured scripts/adapters, source cache, manifest reader, validator, review workflow, coverage reports, shared research-job service.
  - **Accept:** pinned FDC bulk/API plus official-brand/manual adapters; exact match table; normalized units/definitions and unit conversions; field gaps; license metadata; checkpoints/retries/idempotency; reviewed revision diffs. Follow the playbook. Models are unnecessary for scaling or copying structured data.
  - **One research workflow:** bulk population, Ingredient Library research (#69), and missing-ingredient research (#66) create the same research-job records and pass the same validator and review step. Single-item jobs use the same adapters with a one-ID batch. #67 later adds a model-assisted research adapter to this pipeline; it is not a separate flow.
  - **Cost optimization:** deterministic sources first; source responses cached by dataset release/checksum; jobs deduplicated by target key (catalog: manifest ID; non-catalog: namespace/owner + stable ingredient/variant identity) + requested fields + source release; model-assisted research limited to residual fields after deterministic sources and run as bounded, resumable assistant-packet batches (subscription CLIs / ChatGPT project) or, only if explicitly enabled, the optional paid route—per the [playbook](../docs/nutrition/population-playbook.md#cost-optimized-research).
  - **Checks:** source fixtures, malformed data, retry/idempotency, unknown/LOQ, concentrated additives, raw/cooked mismatches; applicable root/tracker/UI/rules checks.
  - **Migration/deploy:** stage curated data without private inputs; secrets remain server-side. Record concrete access dependencies. **Requires James's explicit approval** to provision or use live credentials (for example an FDC API key) and to write staged data to production.

### #63: Populate every catalog ingredient and audit gaps

- [ ] **Execute all population waves in bounded batches.** Depends: #62. Uses #69's review views once available; does not wait for them.
  - **Surfaces:** catalog, reviewed matches, versioned profiles, gap reports, progress records.
  - **Execution:** follow [the population playbook](../docs/nutrition/population-playbook.md) and its execution prompt. Derive at most 25-ID jobs by priority/category/ID. Waves A-E cover every manifest ID; newly discovered ingredients join the same queue. Batches are resumable and cost-optimized: bulk deterministic import first, cached source releases, then residual-field-only model assistance via the default cost-free assistant-packet path (or subscription CLI batches James already pays for)—not paid per-token API batches. Optional paid OpenAI batches stay off unless explicitly enabled. Before #67 provides the packet/import adapters, residual fields remain explicit gaps queued for a later residual pass; that pass uses a new pass/attempt ID under the same parent batch ID and creates no duplicate profiles.
  - **Accept per batch:** every field has a sourced value/derivation or explicit unknown; identity/basis verified; source IDs/dates retained; flags reviewed; imported revisions/coverage reported; reruns create no duplicates. No blank-to-zero completion. Missing branded labels remain actionable blocked work.
  - **Accept overall:** all IDs attempted, resolvable profiles reviewed/imported, blocked IDs/fields enumerated. Distinguish full research coverage from unavailable analytical data. Do not claim every micronutrient is measured.
  - **Checks:** validator, category/priority reconciliation, source/basis/unit review, documented sample plus all flagged cases. App tests only for code changes.
  - **Migration/deploy:** bounded public-data releases; release runbook for private imports. No historical meal modification. **Requires James's explicit approval** before each live catalog import (or a recorded standing approval for a named wave) and before any paid (metered API) model-assisted batch. Assistant-run residual batches on subscriptions James already pays for do not need a separate spend approval; live import of their reviewed results still follows the catalog-import gate.

### #69: Add the Ingredient Library tab

- [ ] **Give the tracker a dedicated tab for managing shared ingredient profiles.** Depends: #61, #62. The model-assisted research action (assistant-packet export/import by default) appears once #67 ships (capability-gated).
  - **Surfaces:** new tracker tab and mobile layout, shared profile/conversion/research-job services from #61/#62, local cache, Recipe Standardizer link editor entry point.
  - **Accept:** search (indexed, paginated, alias- and variant-aware); add and edit private profiles as new revisions with source and basis; review identity, variants, per-field status/provenance, missing nutrient fields, unit conversions, and revision history; import a label, manual facts, or a reviewed research result; research selected ingredients or selected missing fields through official sources via #62 jobs. Missing-field and missing-conversion lists are distinct and filterable. Edits never change curated/public records or other users' data and never rewrite saved diary snapshots. Research results stay staged until reviewed. Recipe Standardizer opens the same library views; it builds no second editor.
  - **Affected meals (deferred):** an "affected recipes/meals" view requires ingredient-graph references from #64. Ship #69 without that view; enable it as a capability-gated follow-on once #64 (and ideally #70) is available, rather than pulling meal-graph storage into this item.
  - **Checks:** tracker suite; root suite for shared modules; search/pagination, revision-on-edit, override precedence, conversion validation, staged-research review/cancel, offline read from cache, accessibility/mobile; lint/build if React surfaces change; rules tests if rules change.
  - **Migration/deploy:** reads curated data and writes only owner-private profiles under #61 rules. Curated/public catalog writes stay in reviewed #63 batches, not this tab. **Requires James's explicit approval** for any rules change or production data write enabled by this item.

### #64: Save ingredient graphs with reproducible meal snapshots

- [ ] **Connect recipes, ingredient profiles, saved foods, and diary versions.** Depends: #61; sample #63 data useful, full population non-blocking.
  - **Surfaces:** shared calculation module, recipe link/calculation/export/save, tracker food/diary services, parsers, storage/rules, import/export.
  - **Accept:** casserole/burger share applicable profile revisions with different quantities; nested recipes are acyclic and counted once. Save ingredient composition, references with exact profile revisions, grams (measured or estimated), known facts, yield, assumptions, and the complete nutrition snapshot. Create new approved profiles once; reuse existing IDs. A saved meal or recipe can be loaded as the input to a new meal and rescaled without research or models. Expose ingredient→meal references so the Ingredient Library can enable its deferred affected-meals view. Retry/concurrency/failure preserves integrity. Profile updates offer recalculation; old diary totals remain fixed. Flat foods still load.
  - **Shared calculation:** one pure aggregation/scaling module serves both tools and runs offline from the #61 cache; Recipe Standardizer's `nutritionCalc` is extended or replaced by it, not duplicated.
  - **Checks:** tracker/root/rules suites; reuse/version/deletion/conflict/export, immutable-history, offline-recalculation, and partial-save tests; lint/build for views.
  - **Diary ownership:** use tracker-owned logging with references/snapshots; no new recipe-side whole-day writer or implicit P6 implementation. Test another tab editing the day between recipe export and tracker logging.
  - **Migration/deploy:** additive schema, legacy adapters, verified export/import round trips. No automatic reconstruction of old meals from totals. Offline saves are queued or fail visibly; success is reported only after commit. **Requires James's explicit approval** for any rules deploy or production schema change.

### #65: Fit ingredient quantities to known evidence

- [ ] **Implement deterministic constrained meal reconstruction.** Depends: #60, #61, #64.
  - **Surfaces:** pure inference/calculation module shared by both tools, evidence model, quantity review data, uncertainty and label-comparison outputs.
  - **Accept:** constraints from known label calories, macros, sodium, fiber, serving weights, ingredient order, preparation states, and plausible recipe ratios; nonnegative weights, exact/bounded amounts, nested order and low-percentage exceptions, formulation/cooked mass distinctions, recipe priors, rounded nutrient intervals and stated uncertainty. Output per-nutrient label-versus-calculated differences, estimated quantities with ranges, residuals, and flags for non-unique solutions and infeasibility. Never silently change known facts, pinned quantities, or canonical nutrition, and never present one fit as the unique recipe when alternatives fit. Save algorithm version, bounds, weights, and assumptions. Deterministic: same inputs give the same result. Corrected quantities recalculate without AI.
  - **Checks:** [required solver cases](../docs/nutrition/workflow.md#required-solver-cases), withheld exact recipes, deterministic repetition, rounding/yield tests; root/tracker/UI checks as applicable.
  - **Migration/deploy:** estimates on new/draft meals first; preserve measured recipes and history.

### #66: Build missing-ingredient and nutrition review screens

- [ ] **Make database reuse clear in both tools.** Depends: #62, #64, #69; #65 for inferred-quantity review.
  - **Surfaces:** shared resolution and review components used by the tracker (#70) and Recipe Standardizer: missing-data dialog, ingredient/quantity review, nutrition panel, staging, mobile detail views. Ingredient-level editing and research open #69 views rather than reimplementing them.
  - **Accept:** batched missing/ambiguous ingredients and field gaps, with missing profiles distinct from missing fields. Per item, choose: existing profile (or recorded substitute), manual entry, official-source research of selected items (#62 job), model-assisted research via the #67 assistant-packet export/import (default) or the optional paid route if enabled (shown only after a recorded official-source attempt left the selected identity or fields unresolved—or an explicit user override of that gate), save incomplete draft, or cancel. Research follows the user's selected action and result review. After any resolution, the meal recalculates automatically through the shared module without re-running resolved research. Retry/cancel clear; no ingredient disappears. Review shows label-versus-calculated differences, estimated vs. measured quantities with ranges, non-unique/infeasible flags from #65, and source/quality per ingredient and per nutrient; quantities stay editable. Matched inputs calculate/save without models.
  - **Checks:** each choice, recalculation after resolve, offline/error/retry, repeat ingredients, accessibility/mobile and both-tool round trips; tracker/root suites, lint/build, relevant rules tests.
  - **Migration/deploy:** capability-aware flow; verify signed-in use with the same account in both tools and record outcomes.

### #67: Add photo, label, list, and recipe input adapters

- [ ] **Extract meal evidence deterministically first; default AI via cost-free assistant packets.** Depends: #65, #66.
  - **Surfaces:** evidence-extraction adapters producing one structured evidence record: saved meals, structured recipes, ingredient lists, nutrition-label text/photos, barcodes, free text, legacy paste; local OCR; assistant request/response packet export+import for vision, difficult identification, and residual research; optional feature-flagged server-side OpenAI route (off by default); #62 research-adapter hook.
  - **Accept:** saved meals, structured recipes, and parseable lists/labels use deterministic parsers and local matching with zero model calls. Label/list photos try on-device OCR first. When OCR/parsing cannot supply needed evidence, or when residual research/hard identification is chosen after official lookup, the default path does **not** call a paid API: it builds a structured **assistant request packet** (copyable JSON plus the needed images/attachments) that James can send to his already-paid assistant bots (Claude/Codex/ChatGPT) or ChatGPT project instructions—the same screenshot-and-return flow he already uses. A matching **import** accepts the returned JSON, validates it against a strict schema, rejects freeform nutrition text, and stages it for the same review as any other research. Photos can use reviewed recognition/portion suggestions. All extracted evidence (label facts with serving basis and rounding, ingredient order, quantities, states) is shown for correction before matching. Unknowns enter #66. Deterministic calculation remains the primary path; models never compute totals, scale portions, match confirmed IDs, or overwrite known facts.
  - **Default AI path (cost-free):** packet types cover at least image/label extraction, difficult ingredient identification, and unresolved residual research. Each packet records purpose, draft/meal IDs, selected targets/fields, constraints (do not invent sources; preserve known facts; schema version), and attached image references. Returned results must cite sources; citations are evidence-verified before approval; unverified output stays marked unverified and ineligible for a profile revision. Provenance labels the assistant/provider used. Results become #62 research jobs and pass the same review before any profile revision is saved.
  - **Optional paid route:** an authenticated Next.js OpenAI route may exist later for the same packet schemas, but it is **off by default**, behind a feature flag, with a **$0 default spend cap**. Enabling it, provisioning a key, or raising the cap **Requires James's explicit approval**. If enabled: verify a non-anonymous Firebase user (reject `signInAnonymously` guests); keys stay server-side; requests are user-initiated, rate/cost/size-bounded (per verified account plus global/IP or App Check quota), cancellable, and logged without private payloads. Select the model at enablement time and record it in the PR.
  - **Overlap:** absorbs Recipe Standardizer P7 nutrition enrichment; do not build a second route there. Direct diary logging P6 remains separate.
  - **Checks:** fixture packet export/import round trips, malformed/OCR input, corrections, duplicate saves, zero-model assertions for reuse/scaling and for structured inputs whose identities and required profiles are already resolved, schema-rejection tests, flag-off default (no paid calls), optional-route auth (including anonymous rejection)/rate-limit/cancellation/$0-cap tests when the route exists; applicable tracker/root/lint/build/rules commands. Update `SECURITY.md` and `ARCHITECTURE.md` for the packet contract and any optional route.
  - **Migration/deploy:** legacy ChatGPT paste remains supported alongside the structured packet import. Packet path needs no OpenAI key. **Requires James's explicit approval** only to enable the paid route, provision a key, raise the $0 cap, or deploy photo Storage rules used by that route; verify credentials and Storage before calling it live. Make any nutrition/API routes network-only in the tracker service worker (and clear legacy Cache Storage entries on sign-out) so authenticated responses are never owner-independent cached.


### #70: Make staged meal analysis the tracker's primary workflow

- [ ] **Orchestrate evidence → match → resolve → recalculate → fit → review → save in the tracker.** Depends: #64, #65, #66, #67, #69.
  - **Surfaces:** tracker meal-entry workspace (primary "Analyze meal" entry), stage navigation and draft state, offline/capability indicators, legacy paste entry as a secondary option.
  - **Accept:** one entry point accepts a photo, nutrition label, ingredient list, recipe, barcode, free text, saved meal, or legacy paste. Stages run in order and are resumable: (1) extract evidence via #67; (2) match against local/shared profiles via #61; (3) resolve missing/ambiguous items via #66; (4) recalculate automatically after resolution; (5) fit quantities via #65 when quantities are not known; (6) review label-versus-calculated differences, estimated quantities, and quality/source; (7) save composition, quantities, profile revisions, and snapshot via #64, then log through tracker-owned diary writes. Each stage shows what was deterministic, user-entered, or model-assisted (assistant-packet vs optional paid). With sufficient structured information the whole flow uses zero model calls. When AI help is needed, the default UI offers copy/export of the assistant request packet and import of the schema-validated result—no paid site API. Matching, calculation, and fitting work offline from the #61 cache; offline, packet export still works from local draft/evidence, while optional paid calls stay disabled with a clear reason. Reloadable drafts are keyed to the authenticated owner, cleared on sign-out or account switch, and never shown across users on a shared browser. Cancel prevents the meal/diary commit; any research jobs or approved profiles already created in stage 3 are preserved and reported accurately (they are not rolled back by cancel). Saved results appear as reusable meals; the Ingredient Library's affected-meals view (gated on #64) lists them when available.
  - **Checks:** tracker suite; end-to-end fixture flows per modality (including barcode and free text), assistant-packet export/import through stages 1 and 3, zero-model assertions for sufficiently resolved structured inputs, offline stage behavior (packet export offline OK), draft resume/cancel with owner-scoping and sign-out/account-switch cleanup, cancel reporting of already-created research records, legacy paste parity, accessibility/mobile; root suite and lint/build where shared or React code changes.
  - **Migration/deploy:** ships behind a capability flag; legacy paste remains available. Uses rules and routes already released by #61/#64/#67; no new production enablement without the approvals recorded there.

### #68: Verify accuracy, reuse, migration, and release

- [ ] **Complete staged rollout and operating documentation.** Depends: #60-#67, #69, #70, with an explicit #63 gap report.
  - **Surfaces:** both tools, rules/migration, source refresh, backup/recovery, help and project prompts.
  - **Accept:** exercise bowls, pasta, soups, baking, cocktails, and burger/casserole reuse through the #70 workflow and Recipe Standardizer; compare exact recipes with withheld totals; distinguish source data from uncertain portions. Verify history unchanged, versioned refresh, zero AI for repeats and for structured inputs whose identities and required profiles are already sufficient/resolved (assistant-packet AI remains a permitted #66/#67 choice when required fields are unresolved after official lookup; paid route stays off by default), offline calculation, packet import honesty, and every missing-data choice. Publish capabilities and coverage.
  - **Checks:** relevant complete suites, recorded signed-in production smoke, migration count/hash checks, restore/retry exercise, source-license review.
  - **Migration/deploy:** readers then rules/data then writers; refresh cached clients; staged enablement/rollback. **Requires James's explicit approval** for the production smoke, migrations, and each enablement step. Archive after actual deployment and verified acceptance.

## Decisions and dependencies

No product decision blocks #59. Defaults: custom weighted fiber under details, standard fiber for standard comparisons, versioned snapshots, and a manual zero-API path. The recipe rollout retains its priority. Production access, missing brand labels, and provider setup are dependencies of later jobs, not blockers for this plan.

UI phase decision (2026-11-05): the Ingredient Library (#69) and the staged meal-analysis workspace (#70) are separate items. #66 owns shared resolution/review components, #67 owns evidence extraction plus the default cost-free assistant-packet AI path (optional paid OpenAI route off by default), and #69/#70 own the tracker surfaces that compose them. This keeps each PR reviewable and lets the library ship before the solver and AI work. After the immediate recipe rollout work, proceed through this backlog in the dependency order above, including #63 bulk research and population.

Cost decision (2026-11-05, James): do not spend metered API money for routine food calcs. Keep the screenshot → assistant/project-instruction → structured-result flow. Default AI is assistant packets on subscriptions already paid; paid site OpenAI is optional, flagged off, $0 cap.
