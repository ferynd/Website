# Ingredient-based nutrition

Status: planned. The research manifest and execution contract are prepared under CalorieTracker item #59. Database population, schema changes, calculations, and website screens remain separate backlog work. This document does not describe deployed behavior.

## Goal

Research an ingredient once, keep its evidence, and reuse its versioned nutrition profile in every applicable meal. Store meals as ingredient references and quantities, with known meal facts preserved separately. Recalculate portions and repeated meals with ordinary code. Use AI only where image interpretation, difficult identification, or unresolved research benefits from it.

The Nutrition Tracker is the target primary analysis interface, not only a place to import completed ChatGPT estimates. Planned surfaces:

- **Analyze meal** (#70): accepts photos, nutrition labels, ingredient lists, recipes, barcodes, and saved meals. It extracts evidence, matches ingredients, resolves gaps, recalculates, fits quantities, reviews differences, and saves a reusable composition. See [staged meal analysis](workflow.md#staged-meal-analysis).
- **Ingredient Library** (#69): search, add, edit, review, import, and research ingredients, including missing nutrient fields and unit conversions.

Recipe Standardizer uses the same profiles, calculation modules, and research workflow. The legacy paste parser remains as a secondary path.

## Entry points

- [Active backlog](../../backlogs/calorie-tracker.md): dependency order, acceptance criteria, checks, and release steps.
- [Workflow and data contract](workflow.md): staged analysis, ingredient identity, expanded nutrients, inference, saving, AI/offline boundaries, and website behavior.
- [Population playbook](population-playbook.md): how to research, review, and populate every manifest entry accurately.
- [Ingredient research catalog](ingredient-catalog.json): executable research queue. It contains identities and requested forms, not nutrition values.

## Verified starting point

Inspected against `main` commit `4dd9b927ec993d7e26c1d97d833a07b9f222efab` on 2026-11-05:

| Existing capability | Source | Consequence for this work |
| --- | --- | --- |
| The tracker has 24 canonical nutrient keys | [constants.js](../../public/tools/CalorieTracker/constants.js) | Expand the registry and all consumers together. |
| The paste parser matches nutrient words inside a line | [staging/parser.js](../../public/tools/CalorieTracker/staging/parser.js) | An unsupported `Saturated Fat` line can match `fat`. Anchor exact labels and aliases before enabling expanded copy blocks. |
| Blank staged inputs become numeric zero on save | [staging/parser.js](../../public/tools/CalorieTracker/staging/parser.js) | Preserve unknown values and quality metadata through staging, saving, totals, and exports. |
| Food IDs come from normalized names; saves reconstruct a fixed nutrient shape | [food/save.js](../../public/tools/CalorieTracker/food/save.js) | Display names cannot be the identity of the new ingredient database. New metadata needs a compatible save path. |
| Recipe ingredients already have confirmed links, gram bases, and target fingerprints | [nutritionLink.ts](../../app/tools/recipe-standardizer/lib/nutritionLink.ts), [trackerFoods.ts](../../app/tools/recipe-standardizer/lib/trackerFoods.ts) | Extend the existing integration instead of building an unrelated ingredient editor. |
| Current fingerprints hash the ordered 24-key set, and current fuzzy matching removes state words | [trackerFoods.ts](../../app/tools/recipe-standardizer/lib/trackerFoods.ts), [nutritionMatch.ts](../../app/tools/recipe-standardizer/lib/nutritionMatch.ts) | Version fingerprint verification and use a variant-aware resolver. Array expansion and fuzzy name matching alone cannot safely migrate links. |
| Missing ingredient nutrition has a manual ChatGPT paste-back intake | [nutritionIntake.ts](../../app/tools/recipe-standardizer/lib/nutritionIntake.ts) | Retain a manual import route. Its current contract requires all 24 values as numbers and needs a new version for provenance and unknowns. |
| Recipe totals already report incomplete coverage | [nutritionCalc.ts](../../app/tools/recipe-standardizer/lib/nutritionCalc.ts) | Carry quality through to the saved food and diary instead of discarding it. |
| Tracker exports flatten a recipe and zero-fill missing nutrients after explicit partial-coverage confirmation | [nutritionExport.ts](../../app/tools/recipe-standardizer/lib/nutritionExport.ts) | Keep an ingredient graph and a saved nutrition snapshot in the replacement export contract. |
| Daily food entries contain snapshots rather than food references | [staging/parser.js](../../public/tools/CalorieTracker/staging/parser.js) | Preserve historical totals; add versioned references without recalculating old diary entries automatically. |

## Product defaults

1. Match exact ingredient variants. Treat automatic name matches as suggestions until their physical basis and food state are verified.
2. Keep standard total dietary fiber and the existing weighted-fiber estimate as separate concepts.
3. Keep unknown, label-rounded, measured, and estimated values distinguishable.
4. Prompt once for a batch of missing ingredients. Offer existing match, manual entry, official-source research, AI research, incomplete draft, and cancel. Recalculate after resolution.
5. Save ingredient versions and meal composition together, or report a recoverable partial result. Never claim a save based only on a generated calculation.
6. Preserve known restaurant or package facts. Use ingredient calculations to supply missing facts and show disagreement.
7. Keep private meal data outside the public research catalog.
8. Keep the existing manual ChatGPT flow while introducing deterministic imports and calculations. A provider-backed AI route is an optional input adapter, not the calculation engine. It runs server-side behind authentication, returns schema-validated JSON, and never exposes keys to the client.
9. Calculate offline from a local cache of approved profiles when the needed records are present.

## Completion boundary

A catalog entry is a research task until its exact source match, nutrient status for every supported field, evidence, and review outcome have been recorded. A completed ingredient can still contain explicitly unknown fields. A complete-looking row of invented numbers does not count as population.

A website rollout is complete only after its code, migrations, rules, manual checks, and deployment are verified under the backlog protocol. A planning PR or a catalog alone does not provide database access to ChatGPT.
