# Population batch G1: import report (#63, Gemini batch G1)

Prepared: 2026-11-11. Base: `main` at `c34b56f` (PR #228, the Q-018 verdict artifact). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and issue #215 ANSWER Q-018, recorded in [q018-gemini-200-verdicts.json](adjudications/q018-gemini-200-verdicts.json). Q-018 APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

G1 is the first 25 Q-018-APPROVED pairings in bundle order (`gemini-bundle-2026-11-11-f5d496273016`). This import adds **24 completed profiles** to the curated catalog (45 published before, 69 after). One id, `pomegranate-arils-raw`, was rejected at import because a Q-018 qualifying condition could not be verified from the pinned record. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Related: [Q-018 review](adjudications/q018-gemini-200-review.md) · [A3 import report](population-batch-a3-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [Gemini research prompt](gemini-research-prompt.md)

## Contents

1. [Outcome summary](#outcome-summary)
2. [Exact-set gate](#exact-set-gate)
3. [Join and pinned-record verification](#join-and-pinned-record-verification)
4. [Pipeline run and validation](#pipeline-run-and-validation)
5. [Field coverage of the imported profiles](#field-coverage-of-the-imported-profiles)
6. [Imported profiles (completed imports)](#imported-profiles-completed-imports)
7. [Per-item verdicts](#per-item-verdicts)
8. [V4 cumulative proof](#v4-cumulative-proof)
9. [Idempotency](#idempotency)
10. [Pipeline rejections](#pipeline-rejections)
11. [Blocking issues](#blocking-issues)
12. [Re-run instructions](#re-run-instructions)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch G1) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Rejected at import (pipeline rejection) | 1 |
| Reviewed match entries written | 24 |
| Profiles validated, approved, staged, and imported | **24** |
| from Foundation 2026-10-29 | 3 |
| from SR Legacy 2018-04 | 21 |
| Catalog profile count after this import | 69 (was 45) |

Store and batch identifiers: store `~/workspace/private-data/g1store-import/store` (fresh, never `/tmp`), parent batch id **`rb-f8d414e437d81ba9f3be205b`**, pass id `rp-259971002e88c6d9c12bf6e9`, pass release `2018-04+2026-10-29` (the sorted, `+`-joined set of the batch's match-entry releases, as `planReleaseFor` computes it for a mixed batch). The parent batch id is `parentBatchIdFor` over the 25 ids in bundle order, with the first entry's priority (1) and category (`fruits`), as `plan` would derive it.

Pinned files: the reader checked each against its extracted-file SHA-256 pin on every load (SR Legacy 2018-04 `70d4235a…0129`, Foundation 2026-10-29 `990e7731…58a1`; the same pins as A1 to A3).

## Exact-set gate

The 25 ids are exactly the first 25 entries of the bundle's target list whose Q-018 decision is APPROVED, in bundle order (bundle positions 0, 2, 3, 4, 6, 8, 12, 14, 18-21, 23-29, 32-34, 36-38). That was checked mechanically against the bundle file and the verdict file. Each id has exactly one Q-018 decision (APPROVED) and exactly one candidate entry in the validator output.

`plan` was not used. `selectNextBatch` would have selected by wave order rather than by Q-018 approval, and pulled HELD, REJECTED, UNRESOLVED, and not-yet-batched APPROVED ids. The jobs were created directly through the research service layer instead (see [Pipeline run](#pipeline-run-and-validation)). The store holds exactly 25 jobs, one per G1 id, and no other. None of the 25 ids was already published: the 45 published variant ids are the A1, A2, and A3 profiles.

Only the 24 verified ids got match-table entries. No HELD, REJECTED, UNRESOLVED, or later APPROVED id got an entry or a job.

## Join and pinned-record verification

For each id, the Q-018 decision (`targetId`, `fdcId`, `reason`) was joined to its original candidate entry in the validator output (`candidate-match-entries.json`: `dataType`, `fdcId`, `release`, verbatim `description`). Nothing about dataset, release, or title was taken from the verdict file, as its import rules require. Then each candidate was re-verified against the pinned dataset files:

- the verdict's fdcId equals the candidate's fdcId (25 of 25);
- the record exists in the named pinned dataset, at the candidate's release (25 of 25);
- the record's `dataType` equals the candidate's (25 of 25);
- the record's description equals the candidate description verbatim (25 of 25);
- the fdcId was one of the bundle's own candidates for that target (25 of 25).

All 25 joins and record checks passed. One id still failed verification of a qualifying condition in its verdict reason, and that id stopped there (see [Pipeline rejections](#pipeline-rejections)).

The 24 new table entries carry the verbatim description, dataset, release, and FDC id, reviewer `pumpkin-g1-import`, reviewedAt `2026-11-11`, and checklistVersion 1. `stateEvidence` states what the pinned record says, and it carries every qualifying boundary in the Q-018 reason (old-fashioned oats only; the sodium-added basis of both canned bean records; the not-rinsed basis of drained chickpeas). `rationale` quotes the Q-018 reason verbatim and then gives the provenance line: Gemini proposal for bundle `gemini-bundle-2026-11-11-f5d496273016` (with Gemini's category), validator classification (CLEAN for 22, ADJUDICATION for oats and not-rinsed chickpeas), adjudicated APPROVED in ANSWER Q-018 (issue #215). The table was appended to only. The existing 45 entries are byte-unchanged (the old file without its closing bracket is a byte prefix of the new one). `validateMatchTable` accepts the table: 69 valid entries, 69 distinct FDC records, no shared record, so no `sharedJustification` is needed.

## Pipeline run and validation

The run used the research service layer the CLI uses, through an operator-local driver (`~/workspace/private-data/g1-scripts/g1Pipeline.ts`, outside the checkout). It calls `createFileResearchStore` and `createFileSourceCache` ([fileResearchStore.ts](../../scripts/nutrition/fileResearchStore.ts)), `createResearchService` ([researchService.js](../../public/shared/nutrition/research/researchService.js)) with the same adapters as the CLI, `indexBulk` and `createFdcBulkAdapter`, `validateProposal`, `buildReviewPacket`, `assertCuratedMatchTable`, and `stageCatalog`. Each step does what the matching CLI command does. The only difference is that jobs are enqueued for an explicit id list rather than by `plan`.

- **index:** SR Legacy 7,793 of 7,793 records indexed. Foundation 414 of 424, with the known 10 records skipped for non-numeric amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). None of them is a G1 candidate.
- **enqueue and run (`fdc_bulk`):** 25 jobs. 24 reached `needs_review`, each matched to exactly its reviewed entry's fdcId and release (21 SR Legacy 2018-04, 3 Foundation 2026-10-29). `pomegranate-arils-raw` has no reviewed entry and was `blocked` with `match_not_found`, which is the fail-closed behavior.
- **validate:** all 24 proposals were valid with **0 errors**. Two had one warning each; both were reviewed individually and acknowledged at approval, with a documented reason (see below). The blocked pomegranate job failed with `Job proposal is missing revisionDraft`, as expected.
- **review packets:** `buildReviewPacket` (which runs `assertCuratedMatchTable`) was built for all 24 and showed no identity mismatch. For deterministic bulk proposals the record is re-checked against the reviewed entry (fdcId, verbatim description, release, dataType) when the packet is built, at approval, and again at staging. All 24 passed at all three points. `verifySource` was not used: it re-verifies an assistant-cited source and does not apply to deterministic bulk proposals (see the [A2](population-batch-a2-import.md#pipeline-run-and-validation) and [A3](population-batch-a3-import.md#pipeline-run-and-validation) reports).
- **approve:** all 24 were approved by their review content hash under reviewer handle `pumpkin-g1-import`. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. Each acknowledged warning and its reason are stored in the job's review notes.
- **stage:** `stageCatalog` wrote 24 profiles (15 variant shards, 26 search shards, manifest; 42 files) into a fresh directory outside the checkout, and re-checked the match table and the private-text rules.

**Acknowledged warnings (2).** Both are the validator's general-factor Atwater check (4/4/9 kcal per g), and both are explained by the record's own specific factors:

1. `dill-dried`: "Atwater energy inconsistency: reported 253 kcal differs from calculated 342 kcal by >86". Pinned SR 171322 carries a CalorieConversionFactor of protein 2.44, fat 8.37, carbohydrate 3.0. Applied to the record's own protein, fat, and carbohydrate rows, those factors give 252.7 kcal, which reproduces the reported energy row (253 kcal, code NC).
2. `thyme-fresh`: "Atwater energy inconsistency: reported 101 kcal differs from calculated 135 kcal by >34". Pinned SR 173470 carries the same factors (2.44, 8.37, 3.0), which give 100.8 kcal and reproduce the reported energy row (101 kcal, code NC).

In both cases the draft's energy, protein, fat, and carbohydrate equal the pinned rows, and no value was adjusted. Unlike the A1 cocoa warnings, these are explained, not only documented.

**Unknown and assumed-zero review.** After staging and before the combined catalog was written, every staged profile was compared field by field against its raw pinned record, through the nutrient id and derivation code recorded in provenance. For each field directly mapped to a pinned FDC nutrient row, the normalized per-100 g amount (through the registry's unit conversion) and the USDA derivation code were checked against that exact row, with **0 mismatches** across 838 resolved cells. The other 25 resolved cells are deterministic representations, identified separately in field-level provenance: `fiber` aliases the source's `fiberTotal` on 21 profiles (`same_as:fiberTotal`), and `omega3` sums ALA+EPA+DHA on the 4 profiles where all components exist (garlic powder, onion powder, dried parsley, brown rice; `sum:ALA+EPA+DHA`). These are not independent laboratory observations. No values from alternate FDC records were blended. Where a component is missing, the field stays unknown with `partial_components`. The 21 SR Legacy profiles use the record's classic energy row (1008). The 3 Foundation profiles (rolled oats, both canned beans) have no 1008 row and use the record's Atwater specific-factor energy row (2048), the pipeline's second energy preference, labeled `atwater_specific_factors` in provenance. Type fidelity holds: every resolved value is a finite non-negative number, and every unknown is null with a gap reason. All 99 `assumed_zero` cells hold the numeric 0 with derivation code Z. Status mapping follows Q-004: A → measured, NC → calculated, Z → assumed_zero, and every other code or no code → source_reported (in this batch: BFFN, BFSN, BFZN, CAZN, DA, JO, NR, O, T, and none). The 99 zeros are the records' own Z rows: vitamin D 21, vitamin B12 20, cholesterol 19, trans fat 15, caffeine 15, alcohol 4, and one each of selenium, vitamin E, EPA, DHA, and DPA. No zero was invented.

## Field coverage of the imported profiles

Across the 24 head revisions: 1,608 quality-tracked field cells (67 per profile), **863 resolved, 745 explicit unknowns, 0 not checked (unexamined)**. Quality statuses under the Q-004 derivation policy: **measured 277, calculated 113, source_reported 374, assumed_zero 99, unknown 745**. All 24 profiles resolve energy, protein, carbohydrate, total fat, and sodium. The staged nutrient maps also carry the legacy key `fiberWeightedLegacy`, null on every profile. It has no quality entry and is excluded from the cell counts, on the same basis as A1 to A3.

Unknown cells by gap reason: not_reported_by_source 692, definition_mismatch 33 (vitamin K on 16, omega3ALA on 16, folate on 1), partial_components 20 (omega3). An unknown means the source was checked and has no usable value. It does not mean the field was unexamined, and unexamined is 0.

The three Foundation profiles are sparse (rolled oats 21/67, both canned beans 16/67), as the Gemini proposals and Q-018 recorded. Their unknowns are explicit `not_reported_by_source` gaps, not substitutions from other records.

Per-field counts across the 24 profiles (fields with identical counts are grouped):

| Fields | Resolved | Unknown | Not checked | Resolved by status |
| --- | ---: | ---: | ---: | --- |
| calories, carbs | 24 | 0 | 0 | calculated 24 |
| protein | 24 | 0 | 0 | calculated 3, measured 10, source_reported 11 |
| fat, sodium | 24 | 0 | 0 | measured 11, source_reported 13 |
| potassium, magnesium, calcium, phosphorus, iron, copper, manganese, water | 24 | 0 | 0 | measured 13, source_reported 11 |
| zinc | 24 | 0 | 0 | measured 12, source_reported 12 |
| vitaminB6 | 22 | 2 | 0 | measured 11, source_reported 11 |
| vitaminB1, vitaminB3 | 22 | 2 | 0 | measured 10, source_reported 12 |
| fiber, fiberTotal | 21 | 3 | 0 | measured 7, source_reported 14 |
| vitaminB12 | 21 | 3 | 0 | assumed_zero 20, source_reported 1 |
| vitaminA | 21 | 3 | 0 | calculated 7, measured 6, source_reported 8 |
| vitaminD | 21 | 3 | 0 | assumed_zero 21 |
| fatSaturated | 21 | 3 | 0 | calculated 9, measured 1, source_reported 11 |
| vitaminB2 | 21 | 3 | 0 | measured 9, source_reported 12 |
| cholesterol | 21 | 3 | 0 | assumed_zero 19, source_reported 2 |
| folate | 20 | 4 | 0 | calculated 20 |
| vitaminC | 20 | 4 | 0 | measured 4, source_reported 16 |
| fatMonounsaturated, fatPolyunsaturated | 20 | 4 | 0 | calculated 9, measured 1, source_reported 10 |
| selenium | 18 | 6 | 0 | assumed_zero 1, measured 10, source_reported 7 |
| fatTrans | 18 | 6 | 0 | assumed_zero 15, calculated 3 |
| omega3EPA, omega3DHA | 17 | 7 | 0 | assumed_zero 1, measured 5, source_reported 11 |
| omega3DPA | 17 | 7 | 0 | assumed_zero 1, measured 3, source_reported 13 |
| lactose | 17 | 7 | 0 | measured 7, source_reported 10 |
| vitaminE | 16 | 8 | 0 | assumed_zero 1, measured 6, source_reported 9 |
| vitaminB5 | 16 | 8 | 0 | measured 7, source_reported 9 |
| alcohol | 16 | 8 | 0 | assumed_zero 4, source_reported 12 |
| sugarsTotal | 15 | 9 | 0 | calculated 1, measured 4, source_reported 10 |
| caffeine | 15 | 9 | 0 | assumed_zero 15 |
| choline | 13 | 11 | 0 | measured 1, source_reported 12 |
| starch | 6 | 18 | 0 | measured 6 |
| omega3 | 4 | 20 | 0 | calculated 4 |
| omega3ALA | 4 | 20 | 0 | measured 4 |
| resistantStarch | 2 | 22 | 0 | measured 2 |
| biotin, molybdenum | 1 | 23 | 0 | measured 1 |
| vitaminK, iodine, omega6, sugarsAdded, allulose, sugarAlcoholsTotal, erythritol, sorbitol, mannitol, isomalt, xylitol, glycerol, maltitol, fiberSoluble, fiberInsoluble, chromium, chloride, fructans, gos, excessFructose | 0 | 24 | 0 | - |

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description | Resolved |
| --- | --- | --- | --- | ---: |
| strawberry-frozen-unsweetened | SR Legacy 2018-04 | 168173 | Strawberries, frozen, unsweetened (Includes foods for USDA's Food Distribution Program) | 41/67 |
| strawberry-raw | SR Legacy 2018-04 | 167762 | Strawberries, raw | 42/67 |
| oats-rolled-dry | Foundation 2026-10-29 | 2346396 | Oats, whole grain, rolled, old fashioned | 21/67 |
| quinoa-dry | SR Legacy 2018-04 | 168874 | Quinoa, uncooked | 37/67 |
| rice-brown-long-grain-dry | SR Legacy 2018-04 | 169703 | Rice, brown, long-grain, raw (Includes foods for USDA's Food Distribution Program) | 44/67 |
| rice-white-long-grain-enriched-dry | SR Legacy 2018-04 | 168877 | Rice, white, long-grain, regular, raw, enriched | 40/67 |
| cilantro-fresh | SR Legacy 2018-04 | 169997 | Coriander (cilantro) leaves, raw | 40/67 |
| dill-dried | SR Legacy 2018-04 | 171322 | Spices, dill weed, dried | 27/67 |
| dill-fresh | SR Legacy 2018-04 | 172233 | Dill weed, fresh | 32/67 |
| garlic-powder-dry-ground-or-powdered | SR Legacy 2018-04 | 171325 | Spices, garlic powder | 43/67 |
| onion-powder-dry-ground-or-powdered | SR Legacy 2018-04 | 171327 | Spices, onion powder | 43/67 |
| parsley-dried | SR Legacy 2018-04 | 170930 | Spices, parsley, dried | 43/67 |
| parsley-fresh | SR Legacy 2018-04 | 170416 | Parsley, fresh | 41/67 |
| rosemary-dried | SR Legacy 2018-04 | 171333 | Spices, rosemary, dried | 34/67 |
| rosemary-fresh | SR Legacy 2018-04 | 173473 | Rosemary, fresh | 32/67 |
| thyme-dried | SR Legacy 2018-04 | 170938 | Spices, thyme, dried | 40/67 |
| thyme-fresh | SR Legacy 2018-04 | 173470 | Thyme, fresh | 32/67 |
| vanilla-extract-as-sold | SR Legacy 2018-04 | 173471 | Vanilla extract | 39/67 |
| black-bean-canned-drained-rinsed | Foundation 2026-10-29 | 2644285 | Beans, black, canned, sodium added, drained and rinsed | 16/67 |
| black-bean-dry | SR Legacy 2018-04 | 173734 | Beans, black, mature seeds, raw | 41/67 |
| cannellini-bean-canned-drained-rinsed | Foundation 2026-10-29 | 2644287 | Beans, cannellini, canned, sodium added, drained and rinsed | 16/67 |
| chickpea-canned-drained-not-rinsed | SR Legacy 2018-04 | 173800 | Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids | 39/67 |
| chickpea-canned-drained-rinsed | SR Legacy 2018-04 | 173801 | Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water | 39/67 |
| chickpea-dry | SR Legacy 2018-04 | 173756 | Chickpeas (garbanzo beans, bengal gram), mature seeds, raw | 41/67 |

Validation outcome for this batch: 24 of 24 staged profiles passed the pipeline validator with 0 errors (2 reviewed warnings acknowledged), and staging re-checked each against the match table.

## Per-item verdicts

All 25 G1 ids, in bundle order. "Generic" marks a Q-018 reason with no qualifying boundary beyond the standard identity and state match ("Source description matches the stated target food identity and preparation state; the chosen record has no contrary material qualifiers in the supplied candidate evidence."). Every verified row passed the join and pinned-record checks above.

| # | Manifest id | FDC id | Validator | Q-018 boundary carried into the entry | Outcome |
| ---: | --- | --- | --- | --- | --- |
| 1 | pomegranate-arils-raw | 169134 | CLEAN | Confirm at import that the per-100 g edible basis is the arils (skin and membranes excluded) | **Rejected at import** (see below) |
| 2 | strawberry-frozen-unsweetened | 168173 | CLEAN | Generic | Imported |
| 3 | strawberry-raw | 167762 | CLEAN | Generic | Imported |
| 4 | oats-rolled-dry | 2346396 | ADJUDICATION | Old-fashioned rolled oats only, not instant or flavored oats | Imported |
| 5 | quinoa-dry | 168874 | CLEAN | Generic | Imported |
| 6 | rice-brown-long-grain-dry | 169703 | CLEAN | Generic | Imported |
| 7 | rice-white-long-grain-enriched-dry | 168877 | CLEAN | Generic (enrichment disclosed) | Imported |
| 8 | cilantro-fresh | 169997 | CLEAN | Generic | Imported |
| 9 | dill-dried | 171322 | CLEAN | Generic | Imported (Atwater warning acknowledged) |
| 10 | dill-fresh | 172233 | CLEAN | Generic | Imported |
| 11 | garlic-powder-dry-ground-or-powdered | 171325 | CLEAN | Generic | Imported |
| 12 | onion-powder-dry-ground-or-powdered | 171327 | CLEAN | Generic | Imported |
| 13 | parsley-dried | 170930 | CLEAN | Generic (conventional dried, not freeze-dried 170486) | Imported |
| 14 | parsley-fresh | 170416 | CLEAN | Generic | Imported |
| 15 | rosemary-dried | 171333 | CLEAN | Generic | Imported |
| 16 | rosemary-fresh | 173473 | CLEAN | Generic | Imported |
| 17 | thyme-dried | 170938 | CLEAN | Generic | Imported |
| 18 | thyme-fresh | 173470 | CLEAN | Generic | Imported (Atwater warning acknowledged) |
| 19 | vanilla-extract-as-sold | 173471 | CLEAN | Generic (imitation extracts 172235, 172236 excluded) | Imported |
| 20 | black-bean-canned-drained-rinsed | 2644285 | CLEAN | Sodium-added canned source, drained and rinsed; values are not the no-sodium-added product | Imported |
| 21 | black-bean-dry | 173734 | CLEAN | Generic | Imported |
| 22 | cannellini-bean-canned-drained-rinsed | 2644287 | CLEAN | Sodium-added canned source, drained and rinsed; not a salt-free canned product | Imported |
| 23 | chickpea-canned-drained-not-rinsed | 173800 | ADJUDICATION | Not-rinsed rests on the separately named rinsed sibling SR 173801, not on the description text | Imported |
| 24 | chickpea-canned-drained-rinsed | 173801 | CLEAN | Generic | Imported |
| 25 | chickpea-dry | 173756 | CLEAN | Generic | Imported |

## V4 cumulative proof

Run before this import PR, as the [V4 rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches) requires. `published` is the catalog at `c34b56f`. `staged` is the `stageCatalog` output written by the driver.

| Catalog | Profiles | Variant shards | Search shards | Search entries | Revisions | Defects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| published (`c34b56f`) | 45 | 23 | 59 | 125 | 45 | 0 |
| staged (G1) | 24 | 15 | 26 | 47 | 24 | 0 |
| `combineCatalogs(published, staged)` | **69** | 35 | 72 | 172 | 69 | **0** |

- `verifyCatalog(combined)`: **0 defects**.
- `verifyAppendOnly(published, combined)`: **0 defects, preserved = 45, added = 24**. The added ids are exactly the 24 approved ids listed above. No other id was added, and `pomegranate-arils-raw` is not present.
- `combineCatalogs(combined, staged)` (a rerun of the batch) reproduces the combined manifest and every shard exactly.
- The combined `{ manifest, files }`, and only that, was written to the curated catalog directory. Shards whose bucket gained a G1 record get a new content hash, so their old files are replaced: 16 old shard files were removed, 41 shard files plus the manifest were written, and 66 shard files were already byte-identical and left in place. Re-reading the written directory reproduces the combined catalog exactly. Nothing else under `public/` changed.
- On the written files, `catalogIntegrityCli.ts -- --previous <published> --next public/shared/nutrition/catalog/nutrition-curated` reported added 24, preserved 45, and 0 defects on both sides. `--combine <published> <staged>` gave the same counts, and the default mode on the written catalog reported 69 profiles and 0 defects.

## Idempotency

- **Staging:** the stage step ran twice into separate fresh directories. Both produced 42 files with an identical tree SHA-256 (`a0ffcc92…5d8a`), computed over every file's bytes. The outputs are byte-identical.
- **Full-pass rerun:** enqueue plus `runJob(fdc_bulk)` for all 25 ids ran again on the same store. The store held 25 jobs before and after (25 unique job keys and 25 unique manifest ids), so enqueue returned the existing jobs and created no duplicate. A listing of every G1 job's state, match, validation, draft hash, review hash, and version was byte-identical before and after the rerun (SHA-256 `f07f50fa…82be`): the 24 approved jobs kept their state, draft hash, review hash, and version (approved jobs are never fetched again), and the pomegranate job stayed blocked at `match_not_found`. A third staging after the rerun was byte-identical to the first two. Re-combining the batch with the combined catalog adds nothing. The rerun created no duplicate profile.

## Pipeline rejections

| Manifest id | Stopped at | Reason and cure |
| --- | --- | --- |
| pomegranate-arils-raw | Verification of the Q-018 qualifying condition | The Q-018 reason approves SR 169134 "Pomegranates, raw" only if import confirms that its per-100 g edible portion is the arils, with skin and membranes excluded, "as the source description alone does not prove the aril mass basis". The join and record checks passed (fdcId, dataset, release, and the verbatim description all match). But the pinned SR Legacy 2018-04 record has no refuse field. Its food attributes and input foods are empty, and its only aril evidence is a household portion labeled "cup arils (seed/juice sacs)" next to a whole-fruit portion. A portion label does not establish the edible-portion mass basis, so the condition cannot be confirmed from the pinned files. Following the brief, the id was stopped, not imported on an inference, and no other record was substituted. No match entry was written, and its job is blocked at `match_not_found`. Cure: an adjudication that accepts specific evidence for the refuse basis (for example the USDA SR28 refuse statement for NDB 9286, as Q-015 accepted SR28 evidence for the A3 pear), after which a reviewed entry can be written in a later batch. |

## Blocking issues

None for this batch. Open, nonblocking items:

1. **Planner limitation (Q-010 Part 1, still open):** `selectNextBatch` selects by wave and skips store jobs, not published ids, and it has no explicit eligible-id input. G1 therefore bypassed `plan` and enqueued the exact Q-018 list through the service layer. Later Gemini batches need the same approach, or an explicit eligible-id input for `plan`.
2. **`--verify-source` and deterministic jobs:** still refused by design for deterministic bulk proposals (A2 blocking issue 2). The match-table re-check at packet, approval, and staging covers them.
3. **Validator Atwater check uses general factors:** records with specific calorie factors well below 4/4/9 (herbs and spices here; cocoa in A1) trigger the warning even when the record is self-consistent. The two G1 warnings were explained with the record's own factors. A check that uses a record's `CalorieConversionFactor` when present would remove the false alarm.
4. **Sparse Foundation profiles:** rolled oats (21/67) and the two canned beans (16/67) are thin. Q-018 approved them as source identity, and their gaps are explicit. Richer coverage would need a reviewed additional source, not a blend.
5. **Operator-local audit caveat:** the job store, the driver, the pinned dataset files, and the staging outputs are operator-local and outside the repository, so a reviewer using only the GitHub connector cannot replay them. The [Re-run instructions](#re-run-instructions) reproduce them from the same pins.

## Re-run instructions

The store and staging output are disposable. They live outside the checkout under `~/workspace/private-data/g1store-import/` (never `/tmp`). The driver lives in `~/workspace/private-data/g1-scripts/` and only composes the merged modules named above. From the repository root:

```sh
P=../private-data/g1-scripts/g1Pipeline.ts
npx --no-install vite-node $P -- g1-prepare   # fresh store; index both pins; enqueue the 25 G1 ids; run fdc_bulk; validate; review packets
#   write acks.json: { "<manifestId>": { "<exact validation warning>": "<documented reason>" } }
npx --no-install vite-node $P -- g1-approve   # approve by review content hash; refuses any warning without a documented reason
npx --no-install vite-node $P -- g1-stage ../private-data/g1store-import/stage-1
npx --no-install vite-node $P -- g1-stage ../private-data/g1store-import/stage-2
npx --no-install vite-node $P -- g1-rerun     # idempotency: re-enqueue and re-run on the same store
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts -- --combine <published dir> ../private-data/g1store-import/stage-1
```

With the same pins and match table, the job ids, parent batch id, review hashes, and staged bytes are reproduced. An approved value can change only through a new reviewed pass.
