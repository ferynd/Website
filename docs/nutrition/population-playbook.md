# Ingredient population playbook

Status: instructions for future CalorieTracker #62-#63 execution. [ingredient-catalog.json](ingredient-catalog.json) is the research queue. It is not a completed nutrition database.

Local code and CLI entry points: [shared research pipeline](research-pipeline.md). Live source pins and publication remain approval-gated under #62 Part B.

## Contents

1. [Scope and job selection](#scope-and-job-selection)
2. [Source hierarchy](#source-hierarchy)
3. [Per-ingredient procedure](#per-ingredient-procedure)
4. [Validation and review](#validation-and-review)
5. [Batch completion and retry](#batch-completion-and-retry)
6. [Cost-optimized research](#cost-optimized-research)
7. [Execution prompt](#execution-prompt)

## Scope and job selection

Populate every catalog entry with a resolved identity and a reviewed profile, or an explicit unresolved outcome. Research all supported fields in the [nutrition contract](workflow.md#expanded-nutrition), not just the macros. Distinguish an unavailable field from a field never checked. No task can be closed by filling every blank with zero.

The catalog is broad and expandable. It does not claim every cultivar, world food species, regional product, or commercial SKU. New entries discovered in meals join the same queue and reuse the same source rules.

Derive jobs from `(priority, category, id)` in that order. Start with priority 1 staples and frequently used recipe components. Within each category, process bounded batches of at most 25 unresolved identities by default. Batch size, retry limits, source endpoints, dataset versions, and target paths belong in a clearly labeled configuration block at the top of each importer/script.

Priority 1 must not block useful progress elsewhere if an item needs a package photo. Document that dependency and move to the next unblocked job. Do not substitute a vaguely similar brand just to increase completion counts.

### Population waves

| Wave | Scope | Required outcome |
| --- | --- | --- |
| A | All priority 1 generic ingredients, oils, salts, sweeteners, and common animal foods | A practical base for common meals; every field has a status. |
| B | Remaining produce, grains, legumes, nuts/seeds, meat/seafood, eggs/dairy, and alternatives | Broad generic coverage with explicit raw/cooked/dried/drained distinctions. |
| C | Condiments, sauces, herbs/spices, beverages, baking ingredients, fiber additives, and preservatives | Compound/brand dependencies and significant ions resolved without invented doses. |
| D | Branded and formulation-dependent entries | Exact product/market/label identified, label facts preserved, missing micros sourced or estimated with provenance. |
| E | Coverage audit and unresolved work | Every manifest ID has a terminal outcome or actionable blocked job; all field, identity, and source audits rerun. |

The waves are views over the same manifest, not duplicate ingredient lists. An additive in A is not researched again in C. Use stable manifest IDs and source revision hashes to deduplicate work.

## Source hierarchy

1. **Generic foods:** USDA FoodData Central, with the best applicable food/state match. Foundation, SR Legacy, and FNDDS are different data types, not independent confirmations of the same observation. Preserve the actual type and ID.
2. **Exact packaged or restaurant products:** the applicable official manufacturer/restaurant label and serving basis take precedence for known facts. FDC Branded data can help locate a product, but confirm formulation/date/market applicability.
3. **Missing fields:** one or two reputable supplemental composition sources or primary analytical sources. Record field-level source and comparability. Do not blend incompatible raw/cooked, fortified/plain, or drained/undrained profiles.
4. **Prepared foods without full data:** use a versioned ingredient recipe or identified comparable. Preserve official macro facts separately. A recipe-derived estimate is not laboratory data for the brand.
5. **FODMAP data:** prefer Monash or suitable primary/clinical sources. Respect access and reuse terms. A serving threshold is not an exact chemical quantity. If exact grams cannot be supported, retain a qualitative/threshold record or a labeled estimate with an explicit gap.
6. **Pure additives and preservatives:** use an official specification or authoritative composition reference. Verify chemical form, hydration, purity/concentration, and carrier. Calculate nutrient contributions from documented composition only, retaining the formula as evidence.

Use the [FDC API or bulk downloads](https://fdc.nal.usda.gov/data-documentation/) for numerical ingestion. Prefer a pinned dataset release and reviewed match table over asking a model to transcribe thousands of values. Reuse downloaded, licensed data by checksum. Store required API secrets server-side, never in the static website or repository.

## Per-ingredient procedure

### 1. Resolve identity

Read the manifest entry, aliases, food state, variant, and notes. Search existing curated and private profiles before external lookup. Confirm the exact edible form and identify unresolved choices.

For ambiguous branded entries, request an exact package/GTIN, formulation, and market as needed. The generic counterpart remains available as a user-approved estimated substitute. Never let a generic estimate masquerade as exact branded facts.

For meat, record lean/fat percentage and cooking/draining method. For grains/legumes, distinguish dry, cooked, canned, drained, and rinsed. For milk/alternatives, record fat, fortification, sweetening, and lactose-free status. For oils, distinguish culinary algae oil from DHA-rich supplemental algal oils. For juice and syrups, record concentration/dilution and sweetening.

### 2. Select and record the source

Store exact source food ID, source data type, title, official URL, date/version, retrieval date, original basis/unit, and why the match fits. Capture evidence within permitted reuse terms. Retain an immutable raw-source checksum and normalized result so refreshes are reproducible.

Rank candidates by physical/formulation match before nutrient completeness. Missing iodine in an exact match is not a reason to substitute an unrelated food with a fuller row.

### 3. Normalize quantities and nutrients

Normalize to 100 g edible ingredient in the stated form. Retain original basis and conversion factors. Volume conversion needs a food-specific density or household gram weight. Do not use 1 mL = 1 g for oils, flour, syrups, or all liquids by default.

Map nutrients by source ID and definition. Verify mg versus mcg, vitamin forms, DFE versus folic acid, and energy method. Record which carbohydrate convention includes fiber/polyols/allulose. Keep subtype observations without adding them again to parent totals.

Preserve quantification limits, rounding intervals, and source quality. Never replace null, an absent key, or a less-than qualifier with analytical zero.

### 4. Fill gaps transparently

Attempt every registry field, including micronutrients, through the defined source hierarchy. Each completed profile must include a status for every stored registry field. Derived metrics are not stored profile fields: `fiberWeightedLegacy` is computed by #64 and is excluded from this requirement and from research requests. Estimates are allowed only as `estimated_from_comparable` (or an explicit ingredient `calculated` derivation) with a named comparator/source revision, a reason the comparison transfers, and a range. No source found is a valid documented unknown; an unsupported exact-looking value is not.

Keep measured, label-reported, and estimated values distinct. Do not fill branded micronutrients by indiscriminately scaling a generic profile to label calories. Do not copy an estimated meal's residual into a canonical ingredient profile.

### 5. Handle additives and mixtures

Record identity and role for preservatives, emulsifiers, gums, acids, stabilizers, colors, and leaveners. Some contribute meaningful sodium, potassium, calcium, phosphorus, sugar, fiber, or energy even at small amounts.

An ingredient-list mention does not reveal dose. Use a stated recipe amount or documented bound; otherwise preserve uncertainty. A 2%-or-less statement gives a ceiling within the applicable list, not an exact amount. Natural flavors, proprietary seasoning, and unspecified oil blends remain unresolved mixtures unless composition is supplied.

### 6. Review and stage

Create a proposed profile revision with exact identity, normalized observations, sources, gap report, and differences from an existing version. Keep it outside the live collection until review passes. No broad overwrites or automatic replacement of user overrides.

## Validation and review

Use an executable validator built in #62. At minimum check:

- Stable IDs, valid enums, nonempty identity, correct form, and unique source matches or justified shared sources.
- Full field-status coverage; unknown stays null; values finite/nonnegative; no invented source IDs or URLs.
- Correct per-100-g edible basis and units. Profile bounds must be composition-aware, not copied from daily limits. Pure salt must not be rejected because the current tracker caps sodium at 23,000 mg per unit.
- No impossible unit-scale errors. Use source-aware mass/energy diagnostics rather than rigid equations across overlapping fields. Fatty-acid sums need not equal total lipid.
- Standard fiber, soluble/insoluble fiber, and resistant starch remain distinct and are not double-counted. Profiles store no weighted custom fiber; #64 derives it from these fields.
- Raw/cooked, hydrated/dry, drained/undrained, and fortified/plain identities remain distinct. Apply retention factors once.
- Added sugars are not inferred solely from total sugar. Review label rounding/definition discrepancies before rejection.
- Known meal facts stay observations; inferred recipe quantities do not become measured facts.
- Provenance, dataset version, retrieval date, per-field gap reason, and review outcome are present.
- Respect source access/reuse terms. Private labels, photos, and user records stay out of the public catalog.

Review all ambiguous mappings, cross-source estimates, pure additives, and flagged outliers. Review a documented sample of otherwise clean deterministic imports. Sampling does not excuse unresolved warnings on individual records. Record reviewer and checklist version.

## Batch completion and retry

Use resumable, idempotent jobs. Derive stable batch IDs from manifest IDs and source release. Check the current profile revision before writing. Retry transient failures within a bounded policy; retain a typed reason for permanent failures.

Jobs move through `queued`, `awaiting_response` (a research packet was issued and its response is pending; expiry or cancel returns the job to `queued`), `matched`, `needs_review`, `approved`, `imported`, or `blocked`. These are job states, separate from nutrient quality. A blocked item remains open with the missing information required.

For each batch, report:

- IDs attempted, resolved, imported, blocked, and remaining.
- Exact source releases, mappings, and profile revisions.
- Ingredient/nutrient coverage and measured/reported versus estimated/unknown observations.
- Validation results, manual review scope, and unresolved dependencies.
- Re-run instructions, idempotency outcome, and changed approved values.

Reconcile progress against the manifest, not an informal checklist. Do not declare population complete while some IDs were never attempted. Keep unresolvable fields explicit. Do not count duplicate source profiles as independent evidence.

Ship bounded category batches with reviewable diffs and license metadata. Production private-data imports use the project's release procedure, backups, and verification. Catalog preparation does not authorize rewriting historical meals. Each live import requires James's explicit approval, recorded in the batch PR (a standing approval may cover a named wave).

## Cost-optimized research

Bulk population, Ingredient Library research (#69), and missing-ingredient research (#66) use the same #62 research jobs, so cost controls apply to all of them.

1. **Deterministic first.** Import pinned FDC bulk releases and official labels by match table. Never spend model calls transcribing, scaling, or copying structured data.
2. **Cache and deduplicate.** Key source downloads by release/checksum. Deduplicate jobs by target key + requested fields + source release: catalog population uses the manifest ID; Ingredient Library and missing-meal research on owner-private or newly entered ingredients use namespace/owner plus stable ingredient/variant identity (never insert private input into the public manifest solely to obtain a key). A rerun reuses cached responses and approved revisions.
3. **Residual fields only.** Model-assisted research is limited to identities or fields still unresolved after deterministic sources. **Default:** emit #62 research request/response v1 packets ([contract](assistant-contracts.md)) with the CLI `packet` and `import-packet` commands, and run them through assistants or subscription CLIs James already pays for (Claude/Codex/`claude`/`codex` exec, ChatGPT project). Bulk residual passes and in-app research generate identical packets through the same pipeline. Do **not** use metered per-token site API batches by default.
4. **Structured output.** Packets and responses use a strict JSON schema with per-field value or `null`, unit, basis, status, and cited source. Reject invalid or uncited output; never import freeform nutrition text. Results enter normal review with evidence verification.
5. **Bounded and resumable.** Prefer free/subscription assistant runs. Always apply request/input/output size bounds and deterministic chunking for assistant packets and CLI batches (so a 25-ID residual job cannot produce an unparseable truncated response that blocks checkpoints). Spend/token limits apply only if the optional direct provider route (#71) is enabled (default cap **$0**); configure them at the top of the script. Checkpoint after each request group; a stopped batch resumes without repeating finished work. Record attempts, model/assistant, and any cost per batch.
6. **Pass IDs.** Each population unit has a source-independent parent batch ID (from priority/category/manifest set). Each deterministic or model-assisted attempt gets a distinct pass/attempt ID that includes the source, assistant, or model release, so a residual AI pass never collides with a completed deterministic checkpoint and retries stay unambiguous. Progress records link pass IDs back to the parent batch.
7. **Approval.** Live catalog imports still need James's explicit approval. Assistant-run residual batches on subscriptions he already pays for do not need a separate spend approval. Enabling the optional direct provider route (#71), provisioning a key, or raising the $0 spend cap **does** require explicit approval. Until #62 ships the packet adapter, residual fields stay explicit gaps for a later residual pass under a new pass ID on the same parent batch.

## Execution prompt

Use this after #60-#62 provide the schema, repository, and importer:

> Read root AGENTS.md, CalorieTracker backlog item #63, docs/nutrition/workflow.md, this playbook, and the current ingredient catalog. Reconcile completed batches. Select the next at most 25 unblocked IDs in priority/category/ID order. Reuse exact existing profiles. Retrieve applicable USDA or official manufacturer data, normalize to per 100 g edible weight, and populate every supported nutrient with a sourced value/derivation or explicit unknown status. Fill gaps only through the documented source hierarchy; use model-assisted research only for residual fields via #62 research packets (contract v1) run through assistants or subscription CLIs (not a paid site API by default), with structured output and review, within the playbook's cost limits and approvals. Preserve fat/fiber definitions, state, label rounding, and provenance. Validate, review uncertain matches, create versioned records idempotently, and record exact IDs, coverage, gaps, source versions, and checks. Do not infer proprietary ingredient doses, change historical entries, replace user overrides silently, or claim unperformed imports. Record an actionable blocked reason when access or product identity is missing, then continue other unblocked IDs. Follow the backlog's PR and deployment gates.

## Source references

- [USDA FDC documentation](https://fdc.nal.usda.gov/data-documentation/)
- [USDA Foundation Foods definitions](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)
- [FDA dietary-fiber definitions](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/questions-and-answers-dietary-fiber)
- [21 CFR 101.4 ingredient declarations](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.4)
- [USDA nutrient-retention factors](https://www.ars.usda.gov/ARSUserFiles/80400530/pdf/retn06.pdf)

Full field definitions and further references are in [workflow.md](workflow.md#sources).
