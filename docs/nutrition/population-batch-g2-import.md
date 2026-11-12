# Population batch G2: import report (#63, Gemini batch G2)

Prepared: 2026-11-12. Base: `main` at `d2f221d` (PR #229, the G1 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and issue #215 ANSWER Q-018, recorded in [q018-gemini-200-verdicts.json](adjudications/q018-gemini-200-verdicts.json). Q-018 APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

G2 is the next 25 Q-018-APPROVED pairings in bundle order, APPROVED positions 26 to 50 (`gemini-bundle-2026-11-11-f5d496273016`). This import adds **25 completed profiles** to the curated catalog (69 published before, 94 after). No id was rejected at import. Two Foundation profiles, unsalted butter and extra virgin olive oil, are imported with their core energy and macro fields as explicit unknowns, because their pinned records carry no such rows. They are listed for a reviewer decision under [Blocking issues](#blocking-issues). Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Run note: the first G2 run was stopped by a service restart (SIGTERM) after about 11 minutes, before it committed. It left the appended match table and a partial job store. The retry re-verified every match-table entry against the verdicts and the pinned records and kept the table unchanged. The partial store had no job file, held 5,500 of 8,207 source records, and had a stale lock from the stopped process, so it was deleted and recreated fresh. Every number in this report comes from the retry.

Related: [G1 import report](population-batch-g1-import.md) · [Q-018 review](adjudications/q018-gemini-200-review.md) · [A3 import report](population-batch-a3-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [Gemini research prompt](gemini-research-prompt.md)

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
| Ids attempted (batch G2) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Reviewed match entries written | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from Foundation 2026-10-29 | 6 |
| from SR Legacy 2018-04 | 19 |
| Catalog profile count after this import | 94 (was 69) |

Store and batch identifiers: store `~/workspace/private-data/g2store-import/store` (fresh, never `/tmp`), parent batch id **`rb-c5f80ed8b9e6ca77b870d3cd`**, pass id `rp-156ec6b472447f83ed53f2b2`, pass release `2018-04+2026-10-29` (the sorted, `+`-joined set of the batch's match-entry releases, as `planReleaseFor` computes it for a mixed batch). The parent batch id is `parentBatchIdFor` over the 25 ids in bundle order, with the first entry's priority and category, as `plan` would derive it.

Pinned files: the reader checked each against its extracted-file SHA-256 pin on every load (SR Legacy 2018-04 `70d4235a…0129`, Foundation 2026-10-29 `990e7731…58a1`; the same pins as A1 to G1).

## Exact-set gate

The 25 ids are exactly APPROVED entries 26 to 50 of the bundle's target list, in bundle order (bundle positions 39, 43, 44, 49, 51, 53, 55, 57, 60, 62, 63, 65, 67-69, 71, 73, 78-80, 83, 86, 87, 90, 91). That was checked mechanically against the bundle file and the verdict file. The first 25 APPROVED entries are the G1 ids (PR #229). Each G2 id has exactly one Q-018 decision (APPROVED) and exactly one candidate entry in the validator output.

`plan` was not used. `selectNextBatch` selects by wave order rather than by Q-018 approval, and it would have pulled HELD, REJECTED, UNRESOLVED, and not-yet-batched APPROVED ids. The jobs were created directly through the research service layer instead (see [Pipeline run](#pipeline-run-and-validation)). The store holds exactly 25 jobs, one per G2 id, and no other. None of the 25 ids was already published: the 69 published variant ids are the A1, A2, A3, and G1 profiles.

Only the 25 G2 ids got match-table entries. No HELD, REJECTED, UNRESOLVED, or later APPROVED id got an entry or a job, and nothing came from Bundle 2 or the third-pass package.

## Join and pinned-record verification

For each id, the Q-018 decision (`targetId`, `fdcId`, `reason`) was joined to its original candidate entry in the validator output (`candidate-match-entries.json`: `dataType`, `fdcId`, `release`, verbatim `description`). Nothing about dataset, release, or title was taken from the verdict file, as its import rules require. Then each candidate was re-verified against the pinned dataset files:

- the verdict's fdcId equals the candidate's fdcId (25 of 25);
- the record exists in the named pinned dataset, at the candidate's release (25 of 25);
- the record's `dataType` equals the candidate's (25 of 25);
- the record's description equals the candidate description verbatim (25 of 25);
- the fdcId was one of the bundle's own candidates for that target (25 of 25).

All 25 joins and record checks passed. Each qualifying condition in a verdict reason can be confirmed from the pinned files. Pinto beans, not rinsed: the rinsed sibling SR 173797 exists in the same pinned file as "drained solids, rinsed in tap water". White tuna: "canned in water, without salt, drained solids" is in the description. Dry pasta: "enriched, spaghetti" is in the description. Tortellini: "fresh-refrigerated, as purchased" is in the description. Cooked pasta: "cooked, enriched, without added salt" is in the description. Unsalted butter: "stick, unsalted" is in the description. Unlike the G1 pomegranate case, no condition needed evidence the pinned record does not carry.

The 25 new table entries carry the verbatim description, dataset, release, and FDC id, reviewer `pumpkin-g2-import`, reviewedAt `2026-11-11`, and checklistVersion 1. `stateEvidence` states what the pinned record says (NDB number, scientific name where present, input foods, portions), carries every qualifying boundary in the Q-018 reason, and names the nearer competing records it excludes. Every cited competing fdcId was checked to exist in the pinned files with the stated description. `rationale` quotes the Q-018 reason verbatim and then gives the provenance line: Gemini proposal for bundle `gemini-bundle-2026-11-11-f5d496273016` (with Gemini's category), validator classification (CLEAN for 22, ADJUDICATION for pinto not rinsed, cooked pasta, and white tuna), adjudicated APPROVED in ANSWER Q-018 (issue #215). The table was only appended to. The existing 69 entries are byte-unchanged (the old file without its closing bracket is a byte prefix of the new one), and the top-level keys are unchanged. `validateMatchTable` accepts the table: 94 valid entries, 94 distinct FDC records, no shared record, so no `sharedJustification` is needed.

## Pipeline run and validation

The run used the research service layer the CLI uses, through an operator-local driver (`~/workspace/private-data/g2-scripts/g2Pipeline.ts`, outside the checkout). It is the G1 driver with only the id list, store path, and reviewer handle changed. It calls `createFileResearchStore` and `createFileSourceCache` ([fileResearchStore.ts](../../scripts/nutrition/fileResearchStore.ts)), `createResearchService` ([researchService.js](../../public/shared/nutrition/research/researchService.js)) with the same adapters as the CLI, `indexBulk` and `createFdcBulkAdapter`, `validateProposal`, `buildReviewPacket`, `assertCuratedMatchTable`, and `stageCatalog`. Each step does what the matching CLI command does. The only difference is that jobs are enqueued for an explicit id list rather than by `plan`.

- **index:** both pinned datasets indexed once into the fresh store. SR Legacy 7,793 of 7,793 records. Foundation 414 of 424, with the known 10 records skipped for non-numeric amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). None of them is a G2 candidate.
- **enqueue and run (`fdc_bulk`):** 25 jobs. All 25 reached `needs_review`, each matched to exactly its reviewed entry's fdcId and release (19 SR Legacy 2018-04, 6 Foundation 2026-10-29).
- **validate:** all 25 proposals were valid with **0 errors**. One had one warning. It was reviewed individually and acknowledged at approval with a documented reason (see below).
- **review packets:** `buildReviewPacket` (which runs `assertCuratedMatchTable`) was built for all 25 and showed no identity mismatch. For deterministic bulk proposals the record is re-checked against the reviewed entry (fdcId, verbatim description, release, dataType) when the packet is built, at approval, and again at staging. All 25 passed at all three points. `verifySource` was not used: it re-verifies an assistant-cited source and does not apply to deterministic bulk proposals (see the [A2](population-batch-a2-import.md#pipeline-run-and-validation) and [A3](population-batch-a3-import.md#pipeline-run-and-validation) reports).
- **approve:** all 25 were approved by their review content hash under reviewer handle `pumpkin-g2-import`. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. Each acknowledged warning and its reason are stored in the job's review notes.
- **stage:** `stageCatalog` wrote 25 profiles (11 variant shards, 45 search shards, manifest; 57 files) into a fresh directory outside the checkout, and re-checked the match table and the private-text rules.

**Acknowledged warning (1).**

1. `flaxseed-ground`: "Target food state is unspecified". The catalog state `ground` maps, through the variant vocabulary, to preparation `ground` with no `state` dimension, so the job's dims have `state: unspecified` and `preparation: ground`. The warning comes from that mapping. It is the same vocabulary gap acknowledged for `applesauce-pureed-unsweetened` in [A3](population-batch-a3-import.md). It is not an identity doubt: pinned Foundation 2262075 states "Flaxseed, ground", and its input foods are ground flaxseed meal samples. Whole flaxseed (SR 169414) and flaxseed oil (SR 167702) are different products. The published dims are the vocabulary's own, and no value was adjusted.

**Unknown and assumed-zero review.** After staging and before the combined catalog was written, every staged profile was compared field by field against its raw pinned record, through the nutrient id and derivation code recorded in provenance. For each field directly mapped to a pinned FDC nutrient row, the normalized per-100 g amount (through the registry's unit conversion) and the USDA derivation code were checked against that exact row, with **0 mismatches** across 855 resolved cells. The other 34 resolved cells are deterministic representations, identified separately in field-level provenance. `fiber` aliases the source's `fiberTotal` on 20 profiles (`same_as:fiberTotal`). `omega3` sums ALA+EPA+DHA on the 13 profiles where all components exist (`sum:ALA+EPA+DHA`). The dry pasta's energy is the record's general-factor Atwater row, described below. These are not independent laboratory observations. No values from alternate FDC records were blended. Where a component is missing, the field stays unknown with `partial_components`.

Energy rows: the 19 SR Legacy profiles use the record's classic energy row (1008). Three Foundation profiles have no 1008 row and use the record's Atwater specific-factor energy row (2048), labeled `atwater_specific_factors` (ground flaxseed, chicken thigh, sockeye salmon). Foundation dry pasta 2758998 has neither 1008 nor 2048, so it uses the general-factor Atwater row (2047, code NC), labeled `atwater_general_factors`. Its value was checked by hand against that pinned row and matches. Foundation unsalted butter 789828 and extra virgin olive oil 748608 have no energy row at all, so their energy is unknown (see [Blocking issues](#blocking-issues)).

Type fidelity holds: every resolved value is a finite non-negative number, and every unknown is null with a gap reason. All 99 `assumed_zero` cells hold the numeric 0. 88 of them are the records' own Z rows, and 11 are `fiber` cells that alias a Z `fiberTotal`. Status mapping follows Q-004: A → measured, NC → calculated, Z → assumed_zero, and every other code or no code → source_reported (in this batch: AI, AR, AS, BFAN, BFFN, BFSN, BFZN, FLA, FLC, JA, JO, LC, NR, RA, T, and none). The 99 zeros by field: caffeine 15, fiber 11, fiberTotal 11, alcohol 11, sugarsTotal 9, carbs 8 (meats, fish, and oils), vitamin C 8, vitamin D 6, vitamin B12 4, cholesterol 4, trans fat 3, EPA 3, DHA 3, DPA 3. No zero was invented.

## Field coverage of the imported profiles

Across the 25 head revisions: 1,675 quality-tracked field cells (67 per profile), **889 resolved, 786 explicit unknowns, 0 not checked (unexamined)**. Quality statuses under the Q-004 derivation policy: **measured 327, calculated 130, source_reported 333, assumed_zero 99, unknown 786**. 23 of the 25 profiles resolve energy, protein, carbohydrate, total fat, and sodium. The two exceptions are unsalted butter (energy, protein, carbohydrate unknown; fat and sodium resolved) and extra virgin olive oil (all five unknown). The staged nutrient maps also carry the legacy key `fiberWeightedLegacy`, null on every profile. It has no quality entry and is excluded from the cell counts, on the same basis as A1 to G1.

Unknown cells by gap reason: not_reported_by_source 748, definition_mismatch 26 (vitamin K on 17, omega3ALA on 7, folate on 2), partial_components 12 (omega3). An unknown means the source was checked and has no usable value. It does not mean the field was unexamined, and unexamined is 0.

The Foundation profiles are sparse to varying degrees: chicken thigh 19/67, ground flaxseed 27/67, sockeye salmon 26/67, dry pasta 31/67, unsalted butter 13/67, and extra virgin olive oil 4/67. Their unknowns are explicit `not_reported_by_source` gaps, not substitutions from other records.

Per-field counts across the 25 profiles (fields with identical counts are grouped):

| Fields | Resolved | Unknown | Not checked | Resolved by status |
| --- | ---: | ---: | ---: | --- |
| fat, sodium, water | 24 | 1 | 0 | measured 14, source_reported 10 |
| potassium, magnesium, calcium, phosphorus, iron, zinc, copper | 24 | 1 | 0 | measured 15, source_reported 9 |
| calories | 23 | 2 | 0 | calculated 21, source_reported 2 |
| protein | 23 | 2 | 0 | calculated 4, measured 9, source_reported 10 |
| carbs | 23 | 2 | 0 | assumed_zero 8, calculated 12, source_reported 3 |
| fatSaturated, fatPolyunsaturated | 23 | 2 | 0 | calculated 14, measured 5, source_reported 4 |
| fatMonounsaturated | 23 | 2 | 0 | calculated 13, measured 5, source_reported 5 |
| manganese | 23 | 2 | 0 | measured 15, source_reported 8 |
| cholesterol | 22 | 3 | 0 | assumed_zero 4, measured 9, source_reported 9 |
| vitaminB1, vitaminB3 | 21 | 4 | 0 | measured 11, source_reported 10 |
| fiber, fiberTotal | 20 | 5 | 0 | assumed_zero 11, measured 3, source_reported 6 |
| vitaminB12 | 20 | 5 | 0 | assumed_zero 4, measured 6, source_reported 10 |
| vitaminB2 | 20 | 5 | 0 | measured 10, source_reported 10 |
| lactose | 20 | 5 | 0 | measured 11, source_reported 9 |
| folate | 19 | 6 | 0 | calculated 19 |
| vitaminC | 19 | 6 | 0 | assumed_zero 8, measured 3, source_reported 8 |
| vitaminB6 | 19 | 6 | 0 | measured 8, source_reported 11 |
| vitaminD | 19 | 6 | 0 | assumed_zero 6, calculated 1, source_reported 12 |
| omega3EPA, omega3DHA, omega3DPA | 19 | 6 | 0 | assumed_zero 3, measured 8, source_reported 8 |
| alcohol | 19 | 6 | 0 | assumed_zero 11, source_reported 8 |
| vitaminE | 18 | 7 | 0 | measured 7, source_reported 11 |
| selenium | 18 | 7 | 0 | measured 10, source_reported 8 |
| caffeine | 18 | 7 | 0 | assumed_zero 15, source_reported 3 |
| vitaminA | 17 | 8 | 0 | calculated 8, source_reported 9 |
| fatTrans | 17 | 8 | 0 | assumed_zero 3, calculated 11, measured 2, source_reported 1 |
| sugarsTotal | 17 | 8 | 0 | assumed_zero 9, measured 1, source_reported 7 |
| choline | 16 | 9 | 0 | source_reported 16 |
| vitaminB5 | 16 | 9 | 0 | measured 6, source_reported 10 |
| omega3ALA | 15 | 10 | 0 | measured 10, source_reported 5 |
| omega3 | 13 | 12 | 0 | calculated 13 |
| starch | 3 | 22 | 0 | measured 2, source_reported 1 |
| iodine, biotin | 2 | 23 | 0 | measured 2 |
| vitaminK, omega6, sugarsAdded, allulose, sugarAlcoholsTotal, erythritol, sorbitol, mannitol, isomalt, xylitol, glycerol, maltitol, fiberSoluble, fiberInsoluble, resistantStarch, chromium, molybdenum, chloride, fructans, gos, excessFructose | 0 | 25 | 0 | - |

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description | Resolved |
| --- | --- | --- | --- | ---: |
| kidney-bean-canned-drained-rinsed | SR Legacy 2018-04 | 175243 | Beans, kidney, red, mature seeds, canned, drained solids, rinsed in tap water | 38/67 |
| pinto-bean-canned-drained-not-rinsed | SR Legacy 2018-04 | 174286 | Beans, pinto, canned, drained solids | 36/67 |
| pinto-bean-canned-drained-rinsed | SR Legacy 2018-04 | 173797 | Beans, pinto, mature seeds, canned, drained solids, rinsed in tap water | 26/67 |
| ground-beef-80-percent-lean-20-percent-fat-raw-raw-formulation-80-20 | SR Legacy 2018-04 | 174036 | Beef, ground, 80% lean meat / 20% fat, raw | 43/67 |
| ground-beef-85-percent-lean-15-percent-fat-raw-raw-formulation-85-15 | SR Legacy 2018-04 | 171796 | Beef, ground, 85% lean meat / 15% fat, raw (Includes foods for USDA's Food Distribution Program) | 43/67 |
| ground-beef-90-percent-lean-10-percent-fat-raw-raw-formulation-90-10 | SR Legacy 2018-04 | 174030 | Beef, ground, 90% lean meat / 10% fat, raw | 43/67 |
| ground-beef-93-percent-lean-7-percent-fat-raw-raw-formulation-93-7 | SR Legacy 2018-04 | 173110 | Beef, ground, 93% lean meat / 7% fat, raw | 43/67 |
| ground-beef-95-percent-lean-5-percent-fat-raw-raw-formulation-95-5 | SR Legacy 2018-04 | 171790 | Beef, ground, 95% lean meat / 5% fat, raw | 43/67 |
| flaxseed-ground | Foundation 2026-10-29 | 2262075 | Flaxseed, ground | 27/67 |
| butter-salted-as-sold | SR Legacy 2018-04 | 173410 | Butter, salted | 43/67 |
| butter-unsalted-as-sold | Foundation 2026-10-29 | 789828 | Butter, stick, unsalted | 13/67 |
| olive-oil-extra-virgin-as-sold | Foundation 2026-10-29 | 748608 | Oil, olive, extra virgin | 4/67 |
| cheese-tortellini-fresh-as-sold | SR Legacy 2018-04 | 172094 | Tortellini, pasta with cheese filling, fresh-refrigerated, as purchased | 37/67 |
| pasta-wheat-enriched-cooked-drained-without-added-salt | SR Legacy 2018-04 | 169737 | Pasta, cooked, enriched, without added salt | 44/67 |
| pasta-wheat-enriched-dry | Foundation 2026-10-29 | 2758998 | Pasta, dry, enriched, spaghetti | 31/67 |
| chicken-breast-skinless-raw | SR Legacy 2018-04 | 171077 | Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw | 43/67 |
| chicken-thigh-skinless-raw | Foundation 2026-10-29 | 2646171 | Chicken, thigh, boneless, skinless, raw | 19/67 |
| ground-turkey-93-percent-lean-7-percent-fat-raw-raw-formulation-93-7 | SR Legacy 2018-04 | 172850 | Turkey, ground, 93% lean, 7% fat, raw | 43/67 |
| salmon-atlantic-farmed-cooked-dry-heat-without-added-fat | SR Legacy 2018-04 | 175168 | Fish, salmon, Atlantic, farmed, cooked, dry heat | 40/67 |
| salmon-atlantic-farmed-raw | SR Legacy 2018-04 | 175167 | Fish, salmon, Atlantic, farmed, raw | 42/67 |
| salmon-sockeye-wild-raw | Foundation 2026-10-29 | 2684440 | Fish, salmon, sockeye, wild caught, raw | 26/67 |
| trout-rainbow-farmed-cooked-dry-heat-without-added-fat | SR Legacy 2018-04 | 173718 | Fish, trout, rainbow, farmed, cooked, dry heat | 41/67 |
| trout-rainbow-farmed-raw | SR Legacy 2018-04 | 173717 | Fish, trout, rainbow, farmed, raw | 43/67 |
| tuna-albacore-canned-water-packed-drained | SR Legacy 2018-04 | 171988 | Fish, tuna, white, canned in water, without salt, drained solids | 35/67 |
| tuna-light-canned-water-packed-drained | SR Legacy 2018-04 | 173709 | Fish, tuna, light, canned in water, drained solids (Includes foods for USDA's Food Distribution Program) | 43/67 |

Validation outcome for this batch: 25 of 25 staged profiles passed the pipeline validator with 0 errors (1 reviewed warning acknowledged), and staging re-checked each against the match table.

## Per-item verdicts

All 25 G2 ids, in bundle order. "Generic" marks a Q-018 reason with no qualifying boundary beyond the standard identity and state match ("Source description matches the stated target food identity and preparation state; the chosen record has no contrary material qualifiers in the supplied candidate evidence."). Every row passed the join and pinned-record checks above.

| # | Manifest id | FDC id | Validator | Q-018 boundary carried into the entry | Outcome |
| ---: | --- | --- | --- | --- | --- |
| 1 | kidney-bean-canned-drained-rinsed | 175243 | CLEAN | Red kidney beans, canned drained and rinsed edible solids; the pack salt is not separately claimed | Imported |
| 2 | pinto-bean-canned-drained-not-rinsed | 174286 | ADJUDICATION | Not rinsed rests on the separately identified rinsed sibling SR 173797, not on the description text | Imported |
| 3 | pinto-bean-canned-drained-rinsed | 173797 | CLEAN | Generic | Imported |
| 4 | ground-beef-80-percent-lean-20-percent-fat-raw-raw-formulation-80-20 | 174036 | CLEAN | Generic (raw formulation; cooked records excluded) | Imported |
| 5 | ground-beef-85-percent-lean-15-percent-fat-raw-raw-formulation-85-15 | 171796 | CLEAN | Generic (raw formulation; cooked and imported grass-fed records excluded) | Imported |
| 6 | ground-beef-90-percent-lean-10-percent-fat-raw-raw-formulation-90-10 | 174030 | CLEAN | Generic (raw formulation; cooked records excluded) | Imported |
| 7 | ground-beef-93-percent-lean-7-percent-fat-raw-raw-formulation-93-7 | 173110 | CLEAN | Generic (raw formulation; cooked records excluded) | Imported |
| 8 | ground-beef-95-percent-lean-5-percent-fat-raw-raw-formulation-95-5 | 171790 | CLEAN | Generic (raw formulation; cooked records excluded) | Imported |
| 9 | flaxseed-ground | 2262075 | CLEAN | Generic | Imported (state-vocabulary warning acknowledged) |
| 10 | butter-salted-as-sold | 173410 | CLEAN | Generic | Imported |
| 11 | butter-unsalted-as-sold | 789828 | CLEAN | USDA unsalted butter stick as the baseline; not a cultured butter or a spread | Imported (core energy, protein, carbohydrate unknown; see Blocking issues) |
| 12 | olive-oil-extra-virgin-as-sold | 748608 | CLEAN | Generic | Imported (core energy, macros, sodium unknown; see Blocking issues) |
| 13 | cheese-tortellini-fresh-as-sold | 172094 | CLEAN | Fresh-refrigerated as purchased only; cooked and frozen variants remain separate | Imported |
| 14 | pasta-wheat-enriched-cooked-drained-without-added-salt | 169737 | ADJUDICATION | Cooked pasta solids baseline without added salt; not soup or pasta in sauce | Imported |
| 15 | pasta-wheat-enriched-dry | 2758998 | CLEAN | Enriched dry spaghetti specifically, an explicit default for dry enriched wheat pasta; not egg, whole-wheat, fresh, or other shape-specific | Imported |
| 16 | chicken-breast-skinless-raw | 171077 | CLEAN | Generic | Imported |
| 17 | chicken-thigh-skinless-raw | 2646171 | CLEAN | Generic | Imported |
| 18 | ground-turkey-93-percent-lean-7-percent-fat-raw-raw-formulation-93-7 | 172850 | CLEAN | Generic (raw formulation; cooked records excluded) | Imported |
| 19 | salmon-atlantic-farmed-cooked-dry-heat-without-added-fat | 175168 | CLEAN | Generic | Imported |
| 20 | salmon-atlantic-farmed-raw | 175167 | CLEAN | Generic | Imported |
| 21 | salmon-sockeye-wild-raw | 2684440 | CLEAN | Generic | Imported |
| 22 | trout-rainbow-farmed-cooked-dry-heat-without-added-fat | 173718 | CLEAN | Generic | Imported |
| 23 | trout-rainbow-farmed-raw | 173717 | CLEAN | Generic | Imported |
| 24 | tuna-albacore-canned-water-packed-drained | 171988 | ADJUDICATION | US white tuna is albacore; water-packed drained solids without salt; covers the unsalted canned white-tuna default only | Imported |
| 25 | tuna-light-canned-water-packed-drained | 173709 | CLEAN | Generic | Imported |

## V4 cumulative proof

Run before this import PR, as the [V4 rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches) requires. `published` is the catalog at `d2f221d`. `staged` is the `stageCatalog` output written by the driver.

| Catalog | Profiles | Variant shards | Search shards | Search entries | Revisions | Defects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| published (`d2f221d`) | 69 | 35 | 72 | 172 | 69 | 0 |
| staged (G2) | 25 | 11 | 45 | 93 | 25 | 0 |
| `combineCatalogs(published, staged)` | **94** | 42 | 92 | 265 | 94 | **0** |

- `verifyCatalog(combined)`: **0 defects**.
- `verifyAppendOnly(published, combined)`: **0 defects, preserved = 69, added = 25**. The added ids are exactly the 25 G2 ids listed above, and no other id was added.
- `combineCatalogs(combined, staged)` (a rerun of the batch) reproduces the combined manifest and every shard exactly.
- The combined `{ manifest, files }`, and only that, was written to the curated catalog directory. Shards whose bucket gained a G2 record get a new content hash, so their old files are replaced: 29 old shard files were removed, 56 shard files plus the manifest were written, and 78 shard files were already byte-identical and left in place. Re-reading the written directory reproduces the combined catalog exactly (135 files on disk). Nothing else under `public/` changed except the `ingredientCatalog.test.js` count pin.
- On the written files, `catalogIntegrityCli.ts -- --previous <published> --next public/shared/nutrition/catalog/nutrition-curated` reported added 25, preserved 69, and 0 defects on both sides. `--combine <published> <staged>` gave the same counts, and the default mode on the written catalog reported 94 profiles and 0 defects.
- The shipped-catalog count pins move from 69 to 94: `shipped.profileCount` in `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js`, and the shipped-catalog and CLI default-mode assertions in `scripts/nutrition/catalogIntegrity.test.ts`.

## Idempotency

- **Staging:** the stage step ran twice into separate fresh directories. Both produced 57 files with an identical tree SHA-256 (`2c4af25c…4687`), computed over every file's bytes. The outputs are byte-identical.
- **Full-pass rerun:** enqueue plus `runJob(fdc_bulk)` for all 25 ids ran again on the same store. The store held 25 jobs before and after (25 unique job keys and 25 unique manifest ids), so enqueue returned the existing jobs and created no duplicate. A listing of every G2 job's state, match, validation, draft hash, review hash, and version was byte-identical before and after the rerun (SHA-256 `8ceabd3b…ab33`): the 25 approved jobs kept their state, draft hash, review hash, and version. A third staging after the rerun was byte-identical to the first two and was then deleted, so only the two determinism stage directories remain. Re-combining the batch with the combined catalog adds nothing. The rerun created no duplicate profile.

## Pipeline rejections

None. All 25 ids passed the join, the pinned-record checks, and every qualifying condition in their Q-018 reasons.

## Blocking issues

None blocks the pipeline. One item needs a reviewer decision before merge:

1. **Decision needed: two Foundation profiles without core energy rows.** `olive-oil-extra-virgin-as-sold` (Foundation 748608) carries 30 rows, all fatty acids and sterols plus "Total fat (NLEA)". It has no energy, protein, carbohydrate, total lipid (1004), sodium, or water row, so its profile resolves 4 of 67 fields (saturated, monounsaturated, and polyunsaturated fat, and ALA) and leaves calories, protein, carbs, fat, and sodium unknown. `butter-unsalted-as-sold` (Foundation 789828) carries 13 rows: total lipid, sodium, cholesterol, water, and minerals. It has no energy, protein, or carbohydrate row, so its calories, protein, and carbs are unknown. Both are faithful to their pinned records: nothing was invented, blended, or computed from another record, and Q-018 approved them as source identity only. But in a calorie tracker, a profile with unknown energy cannot count calories. Precedent: ANSWER Q-002 switched the A1 mayonnaise from a hollow Foundation record without core macros to the complete SR Legacy record, with James's approval, and A1 kept pomegranate juice unresolved partly because its Foundation record lacked core macros. Neither verdict was changed here, because the brief allows a stop only for a failed join, a failed verification, or an unconfirmable qualifying condition, and none applies. Options for the reviewer: (a) accept both as imported; (b) drop both before merge (94 to 92; a follow-up batch could use an adjudicated SR Legacy alternative, which this report does not propose); or (c) keep them and adjudicate an SR Legacy switch in a later revision. Candidate SR records exist in the pinned 2018-04 file for butter ("Butter, without salt", 173430, 111 rows). The SR olive oil record is "Oil, olive, salad or cooking" (171413, 101 rows), which is not labeled extra virgin, so any switch needs its own adjudication.

Open, nonblocking items:

2. **Planner limitation (Q-010 Part 1, still open):** `selectNextBatch` selects by wave and skips store jobs, not published ids, and it has no explicit eligible-id input. G2, like G1, bypassed `plan` and enqueued the exact Q-018 list through the service layer.
3. **State vocabulary gap (A3 item 3, still open):** catalog states made only of preparation words (`ground`, as with `pureed-unsweetened`) produce dims with no `state`, so the validator warns "Target food state is unspecified" on an identity that is not in doubt.
4. **Sparse Foundation profiles:** chicken thigh (19/67), sockeye salmon (26/67), ground flaxseed (27/67), and dry pasta (31/67) are thin but core-complete. Q-018 approved them as source identity, and their gaps are explicit.
5. **Operator-local audit caveat:** the job store, the driver, the pinned dataset files, and the staging outputs are operator-local and outside the repository, so a reviewer using only the GitHub connector cannot replay them. The [Re-run instructions](#re-run-instructions) reproduce them from the same pins.

Ladder: per ANSWER Q-020, G1 was not a clean 25/25, so batches stay at 25. No ladder raise is recorded here.

## Re-run instructions

The store and staging output are disposable. They live outside the checkout under `~/workspace/private-data/g2store-import/` (never `/tmp`). The driver lives in `~/workspace/private-data/g2-scripts/` and only composes the merged modules named above. From the repository root:

```sh
P=../private-data/g2-scripts/g2Pipeline.ts
npx --no-install vite-node $P -- g2-prepare   # fresh store; index both pins; enqueue the 25 G2 ids; run fdc_bulk; validate; review packets
#   write acks.json: { "<manifestId>": { "<exact validation warning>": "<documented reason>" } }
npx --no-install vite-node $P -- g2-approve   # approve by review content hash; refuses any warning without a documented reason
npx --no-install vite-node $P -- g2-stage ../private-data/g2store-import/stage-1
npx --no-install vite-node $P -- g2-stage ../private-data/g2store-import/stage-2
npx --no-install vite-node $P -- g2-rerun     # idempotency: re-enqueue and re-run on the same store
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts -- --combine <published dir> ../private-data/g2store-import/stage-1
```

With the same pins and match table, the job ids, parent batch id, review hashes, and staged bytes are reproduced. An approved value can change only through a new reviewed pass.
