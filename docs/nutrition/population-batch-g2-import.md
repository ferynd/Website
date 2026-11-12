# Population batch G2: import report (#63, Gemini batch G2)

Prepared: 2026-11-12. Corrected the same day by the Q-021 fix round. Base: `main` at `d2f221d` (PR #229, the G1 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports; issue #215 ANSWER Q-018, recorded in [q018-gemini-200-verdicts.json](adjudications/q018-gemini-200-verdicts.json); and issue #215 ANSWER Q-021 (CHANGES REQUIRED at `0d1ed87`), which authorized the unsalted butter source switch and held extra virgin olive oil. Q-018 APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

G2 is the next 25 Q-018-APPROVED pairings in bundle order, APPROVED positions 26 to 50 (`gemini-bundle-2026-11-11-f5d496273016`). **25 were attempted and 24 are published**: the curated catalog goes from 69 to **93** profiles. Per ANSWER Q-021, `butter-unsalted-as-sold` was switched from Foundation 789828 (no energy, protein, or carbohydrate rows) to SR Legacy 173430 "Butter, without salt", after that record passed every pinned identity, core-completeness, and provenance check (see [SR 173430 audit](#sr-legacy-173430-audit)). `olive-oil-extra-virgin-as-sold` is **held**: it has no match entry, no job, no profile, no search entry, and no placeholder revision. All 24 published profiles resolve energy, protein, total fat, carbohydrate, and sodium. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job stores, and the staging runs stayed outside the checkout. This report holds no nutrient values except the SR 173430 core audit that Q-021 requires, plus aggregate coverage counts.

Run notes: the first G2 run was stopped by a service restart (SIGTERM) after about 11 minutes, before it committed. Its appended match table was re-verified and kept, and its partial store was recreated fresh for the retry that produced PR #230 at `0d1ed87`. The Q-021 fix round then corrected the match table and re-ran the whole pipeline for the 24 published ids on another fresh store. Every number below comes from the fix round, unless it is labeled as the original run.

Related: [G1 import report](population-batch-g1-import.md) · [Q-018 review](adjudications/q018-gemini-200-review.md) · [A3 import report](population-batch-a3-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [Gemini research prompt](gemini-research-prompt.md)

## Contents

1. [Outcome summary](#outcome-summary)
2. [Q-021 fix round](#q-021-fix-round)
3. [SR Legacy 173430 audit](#sr-legacy-173430-audit)
4. [Exact-set gate](#exact-set-gate)
5. [Join and pinned-record verification](#join-and-pinned-record-verification)
6. [Pipeline run and validation](#pipeline-run-and-validation)
7. [Field coverage of the imported profiles](#field-coverage-of-the-imported-profiles)
8. [Core-field checklist](#core-field-checklist)
9. [Imported profiles (completed imports)](#imported-profiles-completed-imports)
10. [Per-item verdicts](#per-item-verdicts)
11. [V4 cumulative proof](#v4-cumulative-proof)
12. [Idempotency](#idempotency)
13. [Pipeline rejections and holds](#pipeline-rejections-and-holds)
14. [Blocking issues](#blocking-issues)
15. [Re-run instructions](#re-run-instructions)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch G2) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Held by reviewer decision (ANSWER Q-021) | 1 (`olive-oil-extra-virgin-as-sold`) |
| Source switched by reviewer decision (ANSWER Q-021) | 1 (`butter-unsalted-as-sold`, Foundation 789828 to SR Legacy 173430) |
| Reviewed match entries for G2 in the table | 24 |
| Profiles validated, approved, staged, and imported | **24** |
| from Foundation 2026-10-29 | 4 |
| from SR Legacy 2018-04 | 20 |
| Source-match table entries after this import | 93 (was 69) |
| Catalog profile count after this import | **93** (was 69) |

Store and batch identifiers: store `~/workspace/private-data/g2fix-store-import/store` (fresh, never `/tmp`), parent batch id **`rb-c5f80ed8b9e6ca77b870d3cd`**, pass id `rp-156ec6b472447f83ed53f2b2`, pass release `2018-04+2026-10-29`. These are the same identifiers as the original run, by design. The batch identity is `parentBatchIdFor` over the **25 attempted** ids (Q-021: "G2 keeps 25 attempted IDs but publishes 24"), with the first entry's priority and category, as `plan` would derive it. The pass release is `planReleaseFor` over the 24 published ids, which is still the mixed `2018-04+2026-10-29`. Because the job ids, pass id, and reviewer handles of the 23 unchanged ids are reproduced, their published records are byte-identical to the ones at `0d1ed87` (see [V4](#v4-cumulative-proof)).

Pinned files: the reader checked each against its extracted-file SHA-256 pin on every load (SR Legacy 2018-04 `70d4235a…0129`, Foundation 2026-10-29 `990e7731…58a1`; the same pins as A1 to G1).

## Q-021 fix round

ANSWER Q-021 (issue #215, 2026-11-12) returned CHANGES REQUIRED / DO NOT MERGE at `0d1ed870e1d2202a45564df13120f21feaad15f4`. Its independent checks of the 25 entries, provenance, quality counts, and the 69 preserved records passed. The blockers were the two core-hollow Foundation profiles:

- **Unsalted butter: source switch.** "The approved Q-018 *identity* of Foundation 789828 is insufficient as a nutrient base: energy, protein, carbs are null." Q-002 mayonnaise precedent. Q-021 named SR Legacy 173430 "Butter, without salt" (2018-04) as an identity-suitable replacement, a new reviewer-authorized decision and not a silent edit of Q-018, on the condition that it be confirmed against the locally SHA-pinned SR Legacy bytes. The original Foundation source and its rationale are recorded as superseded for the nutrient base, and no Foundation nutrients are blended in.
- **Extra virgin olive oil: hold.** Foundation 748608 supplies fatty acids and sterols but no mapped energy, protein, carbohydrate, total fat, or sodium, so it would be "a nonfunctional calorie-tracking ingredient". It is held out of this static import. It is **not** replaced with SR 171413 "Oil, olive, salad or cooking", because that record does not establish extra virgin grade, and no calories or lipid values are inferred. It can come back through an exact-EVOO core-complete primary source or a reviewed field-level composite later.

What changed, mechanically:

1. **Match table.** The `butter-unsalted-as-sold` entry now names SR Legacy 173430 (adapter `fdc_bulk`, dataType `SR Legacy`, release `2018-04`, description "Butter, without salt" verbatim), reviewer `pumpkin-g2-fix-q021`, reviewedAt `2026-11-12`. Its rationale records the Q-018 Foundation 789828 approval on identity, the Q-021 supersession as nutrient base, the pinned-byte confirmation, and that no Foundation nutrients are blended. Its stateEvidence carries the Q-018 boundary (not a cultured butter or a spread) and names the excluded siblings. The `olive-oil-extra-virgin-as-sold` entry was deleted. The table went from 94 to **93** entries. The 69 pre-G2 entries are byte-unchanged (the `d2f221d` file without its closing bracket is a byte prefix of the new one), the top-level keys are unchanged, and the other 23 G2 entries are unchanged. `validateMatchTable` accepts the table: 93 valid entries, 93 distinct FDC records.
2. **Pipeline.** The whole pipeline was re-run on a fresh store for the 24 published ids: index, enqueue, `runJob(fdc_bulk)`, validate, review packets, hash-bound approval, and staging. Butter went through normal approval, with the review content hash taken from the packet built against its new match entry. No nutrient value was patched by hand.
3. **Catalog.** The combined catalog (`d2f221d` published plus the new staging) replaced the curated directory. Compared with `0d1ed87`, only the butter bucket's variant shard, the search shards that carried butter or olive oil tokens, and the manifest changed (8 shard files removed, 5 written plus the manifest, 126 files byte-identical and left in place; 132 files on disk). The three olive-oil-only shards (`variants/ol`, `search/ol`, `search/oi`) are gone, and `search/ex` returned to its `d2f221d` bytes.
4. **Count pins** 94 to 93 (see [V4](#v4-cumulative-proof)).

## SR Legacy 173430 audit

A read-only script (`~/workspace/private-data/g2fix-scripts/audit173430.mjs`) loaded the pinned SR Legacy file, checked its SHA-256 against the pin, and printed the record. This is the audit of record:

| Check | Result (raw, verbatim from the pinned bytes) |
| --- | --- |
| File | `FoodData_Central_sr_legacy_food_json_2018-04.json`, SHA-256 `sha256:70d4235ae3a2bdf48a7b9eaa1286a83fa67b6f3270436c9ce8b008213f500129`, **matches the pin** in `researchConfig.ts` |
| Records with fdcId 173430 | exactly 1 |
| `description` | "Butter, without salt" |
| `dataType` | SR Legacy |
| Dataset release (pin) | 2018-04 |
| `ndbNumber` | 1145 |
| `publicationDate` | 4/1/2019 |
| `foodClass` / `foodCategory` | FinalFood / Dairy and Egg Products |
| Nutrient rows | 111 |
| Portions | 1 pat (1" sq, 1/3" high) 5 g; 1 tbsp 14.2 g; 1 stick 113 g; 1 cup 227 g |

Core rows per 100 g, raw:

| Nutrient (id, number) | Unit | Amount | Derivation code |
| --- | --- | ---: | --- |
| Energy (1008, 208) | kcal | 717 | NC |
| Energy (1062, 268) | kJ | 3000 | NC |
| Protein (1003, 203) | g | 0.85 | none |
| Total lipid (fat) (1004, 204) | g | 81.1 | none |
| Carbohydrate, by difference (1005, 205) | g | 0.06 | NC |
| Sodium, Na (1093, 307) | mg | 11 | none |

These agree with the orchestrator's spot check (Energy 717, Total lipid 81.1, Carbohydrate 0.060, Protein 0.850, Sodium 11.0) and with the values Q-021 cited from external USDA-derived material (717 kcal, protein 0.85 g, fat about 81.11 g, carbohydrate 0.06 g, sodium about 11 mg). The pinned total lipid is 81.1. The NDB number 1145 is the SR28 code 01145 cited in Q-021, and the same NDB number the Foundation 789828 record carries.

Sibling butter records in the same pinned file, all different products: 173410 "Butter, salted" (the separate G2 salted profile), 173411 "Butter, whipped, with salt", 172344 "Butter, light, stick, without salt", 173581 "Butter, light, stick, with salt", 171314 "Butter, Clarified butter (ghee)", 173412 "Butter oil, anhydrous", 169894 "Butter replacement, without fat, powder".

Published result: the staged butter revision cites one source, `fdc:173430` (SR Legacy, version 2018-04, publishedAt 4/1/2019), and its five core fields are calories 717 (row 1008, NC, calculated), protein 0.85 (row 1003, source_reported), fat 81.1 (row 1004, source_reported), carbs 0.06 (row 1005, NC, calculated), and sodium 11 (row 1093, source_reported). 42 of its 67 fields resolve, up from 13 on Foundation 789828. The [raw-row replay](#pipeline-run-and-validation) matched every one of its directly mapped cells against the pinned rows. **SR 173430 passes every pinned identity, core-completeness, and provenance gate, so butter is published and the 23-profile fallback does not apply.**

## Exact-set gate

The 25 attempted ids are exactly APPROVED entries 26 to 50 of the bundle's target list, in bundle order (bundle positions 39, 43, 44, 49, 51, 53, 55, 57, 60, 62, 63, 65, 67-69, 71, 73, 78-80, 83, 86, 87, 90, 91). That was checked mechanically against the bundle file and the verdict file. The first 25 APPROVED entries are the G1 ids (PR #229). Each G2 id has exactly one Q-018 decision (APPROVED) and exactly one candidate entry in the validator output.

`plan` was not used. `selectNextBatch` selects by wave order rather than by Q-018 approval, and it would have pulled HELD, REJECTED, UNRESOLVED, and not-yet-batched APPROVED ids. The jobs were created directly through the research service layer instead (see [Pipeline run](#pipeline-run-and-validation)). The fix-round store holds exactly 24 jobs, one per published G2 id, and no other. The held olive oil id has no job. None of the 24 ids was already published: the 69 published variant ids are the A1, A2, A3, and G1 profiles.

Only the 24 published G2 ids have match-table entries. No HELD, REJECTED, UNRESOLVED, or later APPROVED id has an entry or a job, and nothing came from Bundle 2 or the third-pass package.

## Join and pinned-record verification

For each attempted id, the Q-018 decision (`targetId`, `fdcId`, `reason`) was joined to its original candidate entry in the validator output (`candidate-match-entries.json`: `dataType`, `fdcId`, `release`, verbatim `description`). Nothing about dataset, release, or title was taken from the verdict file, as its import rules require. Then each candidate was re-verified against the pinned dataset files (original run):

- the verdict's fdcId equals the candidate's fdcId (25 of 25);
- the record exists in the named pinned dataset, at the candidate's release (25 of 25);
- the record's `dataType` equals the candidate's (25 of 25);
- the record's description equals the candidate description verbatim (25 of 25);
- the fdcId was one of the bundle's own candidates for that target (25 of 25).

All 25 joins and record checks passed. Each qualifying condition in a verdict reason can be confirmed from the pinned files. Pinto beans, not rinsed: the rinsed sibling SR 173797 exists in the same pinned file as "drained solids, rinsed in tap water". White tuna: "canned in water, without salt, drained solids" is in the description. Dry pasta: "enriched, spaghetti" is in the description. Tortellini: "fresh-refrigerated, as purchased" is in the description. Cooked pasta: "cooked, enriched, without added salt" is in the description. Unsalted butter: "without salt" is in the SR 173430 description (and "stick, unsalted" was in the superseded Foundation 789828 description).

Unsalted butter is the one entry not joined to a Q-018 candidate. Its source comes from ANSWER Q-021, which named SR 173430 directly, and it was verified against the pinned SR Legacy bytes as described in the [SR 173430 audit](#sr-legacy-173430-audit). Q-018 had approved Foundation 789828 for this target on identity only, and that verdict is recorded in the entry's rationale as superseded for the nutrient base.

The 23 unchanged G2 table entries carry the verbatim description, dataset, release, and FDC id, reviewer `pumpkin-g2-import`, reviewedAt `2026-11-11`, and checklistVersion 1. `stateEvidence` states what the pinned record says (NDB number, scientific name where present, input foods, portions), carries every qualifying boundary in the Q-018 reason, and names the nearer competing records it excludes. Every cited competing fdcId was checked to exist in the pinned files with the stated description. `rationale` quotes the Q-018 reason verbatim and then gives the provenance line: Gemini proposal for bundle `gemini-bundle-2026-11-11-f5d496273016` (with Gemini's category), validator classification (CLEAN for 20, ADJUDICATION for pinto not rinsed, cooked pasta, and white tuna), adjudicated APPROVED in ANSWER Q-018 (issue #215). The butter entry is described in the [Q-021 fix round](#q-021-fix-round).

## Pipeline run and validation

The fix round used the research service layer the CLI uses, through an operator-local driver (`~/workspace/private-data/g2fix-scripts/g2FixPipeline.ts`, outside the checkout). It is the G2 driver with four changes: the attempted list stays the 25 G2 ids for the batch identity; only the 24 published ids are enqueued, and it refuses to run if the held id has a match entry; butter is approved under reviewer handle `pumpkin-g2-fix-q021` and the other 23 under `pumpkin-g2-import`; and it uses a fresh store root. It calls `createFileResearchStore` and `createFileSourceCache` ([fileResearchStore.ts](../../scripts/nutrition/fileResearchStore.ts)), `createResearchService` ([researchService.js](../../public/shared/nutrition/research/researchService.js)) with the same adapters as the CLI, `indexBulk` and `createFdcBulkAdapter`, `validateProposal`, `buildReviewPacket`, `assertCuratedMatchTable`, and `stageCatalog`. Each step does what the matching CLI command does. The only difference is that jobs are enqueued for an explicit id list rather than by `plan`.

- **index:** both pinned datasets indexed once into the fresh store. SR Legacy 7,793 of 7,793 records. Foundation 414 of 424, with the known 10 records skipped for non-numeric amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). None of them is a G2 candidate.
- **enqueue and run (`fdc_bulk`):** 24 jobs. All 24 reached `needs_review`, each matched to exactly its reviewed entry's fdcId and release (20 SR Legacy 2018-04, including butter on 173430; 4 Foundation 2026-10-29).
- **validate:** all 24 proposals were valid with **0 errors**. One had one warning, the same flaxseed warning as the original run. It was acknowledged at approval with the same documented reason (see below).
- **review packets:** `buildReviewPacket` (which runs `assertCuratedMatchTable`) was built for all 24 and showed no identity mismatch. For deterministic bulk proposals the record is re-checked against the reviewed entry (fdcId, verbatim description, release, dataType) when the packet is built, at approval, and again at staging. All 24 passed at all three points, including butter against its new SR 173430 entry. `verifySource` was not used: it re-verifies an assistant-cited source and does not apply to deterministic bulk proposals (see the [A2](population-batch-a2-import.md#pipeline-run-and-validation) and [A3](population-batch-a3-import.md#pipeline-run-and-validation) reports).
- **approve:** all 24 were approved by their review content hash. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. Each acknowledged warning and its reason are stored in the job's review notes.
- **stage:** `stageCatalog` wrote 24 profiles (10 variant shards, 41 search shards, manifest; 52 files) into a fresh directory outside the checkout, and re-checked the match table and the private-text rules.

**Acknowledged warning (1).**

1. `flaxseed-ground`: "Target food state is unspecified". The catalog state `ground` maps, through the variant vocabulary, to preparation `ground` with no `state` dimension, so the job's dims have `state: unspecified` and `preparation: ground`. The warning comes from that mapping. It is the same vocabulary gap acknowledged for `applesauce-pureed-unsweetened` in [A3](population-batch-a3-import.md). It is not an identity doubt: pinned Foundation 2262075 states "Flaxseed, ground", and its input foods are ground flaxseed meal samples. Whole flaxseed (SR 169414) and flaxseed oil (SR 167702) are different products. The published dims are the vocabulary's own, and no value was adjusted.

**Unknown and assumed-zero review.** After staging and before the combined catalog was written, every staged profile was compared field by field against its raw pinned record, through the nutrient id and derivation code recorded in provenance. For each field directly mapped to a pinned FDC nutrient row, the normalized per-100 g amount (through the registry's unit conversion) and the USDA derivation code were checked against that exact row, with **0 mismatches** across 878 resolved cells. The other 36 resolved cells are deterministic representations, identified separately in field-level provenance. `fiber` aliases the source's `fiberTotal` on 21 profiles (`same_as:fiberTotal`). `omega3` sums ALA+EPA+DHA on the 14 profiles where all components exist (`sum:ALA+EPA+DHA`). The dry pasta's energy is the record's general-factor Atwater row, described below. These are not independent laboratory observations. No values from alternate FDC records were blended. Where a component is missing, the field stays unknown with `partial_components`.

Energy rows: the 20 SR Legacy profiles, butter included, use the record's classic energy row (1008). Three Foundation profiles have no 1008 row and use the record's Atwater specific-factor energy row (2048), labeled `atwater_specific_factors` (ground flaxseed, chicken thigh, sockeye salmon). Foundation dry pasta 2758998 has neither 1008 nor 2048, so it uses the general-factor Atwater row (2047, code NC), labeled `atwater_general_factors`. Its value was checked by hand against that pinned row and matches.

Type fidelity holds (0 faults): every resolved value is a finite non-negative number, and every unknown is null with a gap reason. All 100 `assumed_zero` cells hold the numeric 0. 89 of them are the records' own Z rows, and 11 are `fiber` cells that alias a Z `fiberTotal`. Status mapping follows Q-004: A → measured, NC → calculated, Z → assumed_zero, and every other code or no code → source_reported (in this batch: AI, AR, AS, BFAN, BFFN, BFSN, BFZN, FLA, FLC, JA, JO, LC, NR, RA, T, and none). The 100 zeros by field: caffeine 16, fiber 11, fiberTotal 11, alcohol 11, sugarsTotal 9, carbs 8 (meats, fish, and oils), vitamin C 8, vitamin D 6, vitamin B12 4, cholesterol 4, trans fat 3, EPA 3, DHA 3, DPA 3. No zero was invented.

## Field coverage of the imported profiles

Across the 24 head revisions: **1,608** quality-tracked field cells (24 × 67), **914 resolved, 694 explicit unknowns, 0 not checked (unexamined)**. Quality statuses under the Q-004 derivation policy: **measured 323, calculated 135, source_reported 356, assumed_zero 100, unknown 694**. **All 24 profiles resolve energy, protein, carbohydrate, total fat, and sodium** (see the [checklist](#core-field-checklist)). The staged nutrient maps also carry the legacy key `fiberWeightedLegacy`, null on every profile. It has no quality entry and is excluded from the cell counts, on the same basis as A1 to G1.

For comparison, the original run's 25 profiles at `0d1ed87` had 1,675 cells, 889 resolved, and 786 unknown (measured 327, calculated 130, source_reported 333, assumed_zero 99). The change is exactly the held olive oil (4 resolved) and the butter swap (13 resolved on Foundation 789828, 42 on SR 173430): 889 − 4 − 13 + 42 = 914.

Unknown cells by gap reason: not_reported_by_source 657, definition_mismatch 27 (vitamin K on 18, omega3ALA on 7, folate on 2), partial_components 10 (omega3). An unknown means the source was checked and has no usable value. It does not mean the field was unexamined, and unexamined is 0.

The four Foundation profiles are sparse but core-complete: chicken thigh 19/67, sockeye salmon 26/67, ground flaxseed 27/67, and dry pasta 31/67. Their unknowns are explicit `not_reported_by_source` gaps, not substitutions from other records.

Per-field counts across the 24 profiles (fields with identical counts are grouped):

| Fields | Resolved | Unknown | Not checked | Resolved by status |
| --- | ---: | ---: | ---: | --- |
| calories | 24 | 0 | 0 | calculated 22, source_reported 2 |
| protein | 24 | 0 | 0 | calculated 4, measured 9, source_reported 11 |
| carbs | 24 | 0 | 0 | assumed_zero 8, calculated 13, source_reported 3 |
| fat, sodium | 24 | 0 | 0 | measured 13, source_reported 11 |
| potassium, magnesium, calcium, phosphorus, iron, zinc | 24 | 0 | 0 | measured 15, source_reported 9 |
| copper, water | 24 | 0 | 0 | measured 14, source_reported 10 |
| fatSaturated, fatPolyunsaturated | 23 | 1 | 0 | calculated 14, measured 4, source_reported 5 |
| fatMonounsaturated | 23 | 1 | 0 | calculated 13, measured 4, source_reported 6 |
| manganese | 23 | 1 | 0 | measured 14, source_reported 9 |
| vitaminB1, vitaminB3 | 22 | 2 | 0 | measured 11, source_reported 11 |
| cholesterol | 22 | 2 | 0 | assumed_zero 4, measured 9, source_reported 9 |
| fiber, fiberTotal | 21 | 3 | 0 | assumed_zero 11, measured 3, source_reported 7 |
| vitaminB12 | 21 | 3 | 0 | assumed_zero 4, measured 6, source_reported 11 |
| vitaminB2 | 21 | 3 | 0 | measured 10, source_reported 11 |
| lactose | 21 | 3 | 0 | measured 11, source_reported 10 |
| folate | 20 | 4 | 0 | calculated 20 |
| vitaminC | 20 | 4 | 0 | assumed_zero 8, measured 3, source_reported 9 |
| vitaminB6 | 20 | 4 | 0 | measured 8, source_reported 12 |
| vitaminD | 20 | 4 | 0 | assumed_zero 6, calculated 1, source_reported 13 |
| omega3EPA, omega3DHA, omega3DPA | 20 | 4 | 0 | assumed_zero 3, measured 9, source_reported 8 |
| alcohol | 20 | 4 | 0 | assumed_zero 11, source_reported 9 |
| vitaminE | 19 | 5 | 0 | measured 7, source_reported 12 |
| selenium | 19 | 5 | 0 | measured 11, source_reported 8 |
| caffeine | 19 | 5 | 0 | assumed_zero 16, source_reported 3 |
| vitaminA | 18 | 6 | 0 | calculated 9, source_reported 9 |
| sugarsTotal | 18 | 6 | 0 | assumed_zero 9, measured 1, source_reported 8 |
| choline | 17 | 7 | 0 | source_reported 17 |
| fatTrans | 17 | 7 | 0 | assumed_zero 3, calculated 11, measured 2, source_reported 1 |
| vitaminB5 | 17 | 7 | 0 | measured 6, source_reported 11 |
| omega3ALA | 15 | 9 | 0 | measured 10, source_reported 5 |
| omega3 | 14 | 10 | 0 | calculated 14 |
| starch | 3 | 21 | 0 | measured 2, source_reported 1 |
| biotin | 2 | 22 | 0 | measured 2 |
| iodine | 1 | 23 | 0 | measured 1 |
| vitaminK, omega6, sugarsAdded, allulose, sugarAlcoholsTotal, erythritol, sorbitol, mannitol, isomalt, xylitol, glycerol, maltitol, fiberSoluble, fiberInsoluble, resistantStarch, chromium, molybdenum, chloride, fructans, gos, excessFructose | 0 | 24 | 0 | - |

## Core-field checklist

Taken from the staged head revisions. "Present" means the field resolves to a pinned-row value with field-level `fdc:<id>` provenance. No core field is unknown on any published profile.

| Manifest id | Source | Energy | Protein | Total fat | Carbohydrate | Sodium |
| --- | --- | --- | --- | --- | --- | --- |
| kidney-bean-canned-drained-rinsed | fdc:175243 | present | present | present | present | present |
| pinto-bean-canned-drained-not-rinsed | fdc:174286 | present | present | present | present | present |
| pinto-bean-canned-drained-rinsed | fdc:173797 | present | present | present | present | present |
| ground-beef-80-percent-lean-20-percent-fat-raw-raw-formulation-80-20 | fdc:174036 | present | present | present | present | present |
| ground-beef-85-percent-lean-15-percent-fat-raw-raw-formulation-85-15 | fdc:171796 | present | present | present | present | present |
| ground-beef-90-percent-lean-10-percent-fat-raw-raw-formulation-90-10 | fdc:174030 | present | present | present | present | present |
| ground-beef-93-percent-lean-7-percent-fat-raw-raw-formulation-93-7 | fdc:173110 | present | present | present | present | present |
| ground-beef-95-percent-lean-5-percent-fat-raw-raw-formulation-95-5 | fdc:171790 | present | present | present | present | present |
| flaxseed-ground | fdc:2262075 | present | present | present | present | present |
| butter-salted-as-sold | fdc:173410 | present | present | present | present | present |
| butter-unsalted-as-sold | fdc:173430 | present | present | present | present | present |
| cheese-tortellini-fresh-as-sold | fdc:172094 | present | present | present | present | present |
| pasta-wheat-enriched-cooked-drained-without-added-salt | fdc:169737 | present | present | present | present | present |
| pasta-wheat-enriched-dry | fdc:2758998 | present | present | present | present | present |
| chicken-breast-skinless-raw | fdc:171077 | present | present | present | present | present |
| chicken-thigh-skinless-raw | fdc:2646171 | present | present | present | present | present |
| ground-turkey-93-percent-lean-7-percent-fat-raw-raw-formulation-93-7 | fdc:172850 | present | present | present | present | present |
| salmon-atlantic-farmed-cooked-dry-heat-without-added-fat | fdc:175168 | present | present | present | present | present |
| salmon-atlantic-farmed-raw | fdc:175167 | present | present | present | present | present |
| salmon-sockeye-wild-raw | fdc:2684440 | present | present | present | present | present |
| trout-rainbow-farmed-cooked-dry-heat-without-added-fat | fdc:173718 | present | present | present | present | present |
| trout-rainbow-farmed-raw | fdc:173717 | present | present | present | present | present |
| tuna-albacore-canned-water-packed-drained | fdc:171988 | present | present | present | present | present |
| tuna-light-canned-water-packed-drained | fdc:173709 | present | present | present | present | present |

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
| butter-unsalted-as-sold | SR Legacy 2018-04 | 173430 | Butter, without salt | 42/67 |
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

Validation outcome for this batch: 24 of 24 staged profiles passed the pipeline validator with 0 errors (1 reviewed warning acknowledged), and staging re-checked each against the match table.

## Per-item verdicts

All 25 attempted G2 ids, in bundle order. "Generic" marks a Q-018 reason with no qualifying boundary beyond the standard identity and state match ("Source description matches the stated target food identity and preparation state; the chosen record has no contrary material qualifiers in the supplied candidate evidence."). Every row passed the join and pinned-record checks above.

| # | Manifest id | FDC id | Validator | Boundary carried into the entry | Outcome |
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
| 11 | butter-unsalted-as-sold | 173430 (Q-021; was Foundation 789828 under Q-018) | CLEAN (Q-018 candidate) | Q-018: USDA unsalted butter as the baseline; not a cultured butter or a spread. Q-021: switched to SR 173430 for core completeness; no Foundation nutrients blended | **Imported on SR 173430** (source switch per Q-021) |
| 12 | olive-oil-extra-virgin-as-sold | none (Q-018 Foundation 748608) | CLEAN (Q-018 candidate) | Q-021: SR 171413 does not establish extra virgin grade; no inferred values | **Held per Q-021** (no entry, no job, no profile) |
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

Run before the catalog was written, as the [V4 rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches) requires. `published` is the catalog at `d2f221d` (main), extracted from git into an operator-local directory. `staged` is the fix-round `stageCatalog` output.

| Catalog | Profiles | Variant shards | Search shards | Search entries | Revisions | Defects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| published (`d2f221d`) | 69 | 35 | 72 | 172 | 69 | 0 |
| staged (G2, Q-021 fix) | 24 | 10 | 41 | 89 | 24 | 0 |
| `combineCatalogs(published, staged)` | **93** | 41 | 90 | 261 | 93 | **0** |

- `verifyCatalog(combined)`: **0 defects**.
- `verifyAppendOnly(published, combined)`: **0 defects, preserved = 69, added = 24**. The added ids are exactly the 24 published G2 ids listed above, and no other id was added.
- `combineCatalogs(combined, staged)` (a rerun of the batch) reproduces the combined manifest and every shard exactly.
- **The 23 unchanged G2 records** in the combined catalog are byte-identical, record by record, to their records at `0d1ed87`. The 69 published records are byte-identical to `d2f221d`. Only butter's record differs from `0d1ed87`.
- **No trace of the held olive oil:** the serialized combined catalog (manifest, variant shards, search shards) contains neither `olive-oil-extra-virgin-as-sold` nor `748608`, and no `fdc:789828` either. A grep of the written catalog directory for those strings finds nothing.
- The combined `{ manifest, files }`, and only that, was written to the curated catalog directory. Against `0d1ed87`: 8 shard files removed, 5 shard files plus the manifest written, 126 files already byte-identical and left in place; 132 files on disk. Re-reading the written directory reproduces the combined catalog exactly.
- On the written files, `catalogIntegrityCli.ts -- --previous <published d2f221d> --next public/shared/nutrition/catalog/nutrition-curated` reported added 24, preserved 69, and 0 defects on both sides. The default mode on the written catalog reported 93 profiles, 41 variant shards, 90 search shards, 261 search entries, and 0 defects.
- The shipped-catalog count pins move from 94 to **93**: `shipped.profileCount` in `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js`, and the shipped-catalog (`profileCount`, `variantIds` length, `verifyAppendOnly` preserved) and CLI default-mode assertions in `scripts/nutrition/catalogIntegrity.test.ts`.

## Idempotency

- **Staging:** the stage step ran twice into separate fresh directories. Both produced 52 files with an identical tree SHA-256 (`69bde9e4…106b`, the same per-file hash method as the original run), computed over every file's bytes. The outputs are byte-identical.
- **Full-pass rerun:** enqueue plus `runJob(fdc_bulk)` for all 24 ids ran again on the same store. The store held 24 jobs before and after (24 unique job keys and 24 unique manifest ids), so enqueue returned the existing jobs and created no duplicate. A listing of every G2 job's state, match, validation, draft hash, review hash, reviewer, and version was byte-identical before and after the rerun (SHA-256 `477c1516…aae5`). A third staging after the rerun was byte-identical to the first two and was then deleted, so only the two determinism stage directories remain. Re-combining the batch with the combined catalog adds nothing. The rerun created no duplicate profile.

## Pipeline rejections and holds

No pipeline rejection: all 25 attempted ids passed the join, the pinned-record checks, and every qualifying condition in their Q-018 reasons.

One reviewer hold: `olive-oil-extra-virgin-as-sold` (Foundation 748608), held by ANSWER Q-021 because its pinned record has no energy, protein, carbohydrate, total lipid (1004), or sodium row, so all five core fields would be unknown. It was not replaced with SR 171413 "Oil, olive, salad or cooking", because that record is not labeled extra virgin, and no value was inferred. It can return only through an exact-EVOO core-complete primary source or a separately reviewed field-level composite, in a later batch with its own Q-### review.

## Blocking issues

None. The core-hollow decision flagged in the original run was resolved by ANSWER Q-021: butter switched to SR 173430, olive oil held. This head still needs the Q-021 HEAD UPDATE, fresh full CI at the new head, and an independent final review before merge.

Open, nonblocking items:

1. **Planner limitation (Q-010 Part 1, still open):** `selectNextBatch` selects by wave and skips store jobs, not published ids, and it has no explicit eligible-id input. G2, like G1, bypassed `plan` and enqueued the exact Q-018 list through the service layer.
2. **State vocabulary gap (A3 item 3, still open):** catalog states made only of preparation words (`ground`, as with `pureed-unsweetened`) produce dims with no `state`, so the validator warns "Target food state is unspecified" on an identity that is not in doubt.
3. **Sparse Foundation profiles:** chicken thigh (19/67), sockeye salmon (26/67), ground flaxseed (27/67), and dry pasta (31/67) are thin but core-complete. Q-018 approved them as source identity, and their gaps are explicit. Per Q-021's third-pass note, Foundation records in later batches get a core-completeness preflight before staging.
4. **Operator-local audit caveat:** the job stores, the drivers, the pinned dataset files, and the staging outputs are operator-local and outside the repository, so a reviewer using only the GitHub connector cannot replay them. The [Re-run instructions](#re-run-instructions) reproduce them from the same pins.

Ladder: per ANSWER Q-020, G1 was not a clean 25/25, so batches stay at 25. G2 also was not a clean 25/25 (one hold, one source switch). No ladder raise is recorded here.

## Re-run instructions

The stores and staging outputs are disposable. They live outside the checkout under `~/workspace/private-data/g2fix-store-import/` (never `/tmp`). The fix-round scripts live in `~/workspace/private-data/g2fix-scripts/` and only compose the merged modules named above. From the repository root:

```sh
S=../private-data/g2fix-scripts
node $S/audit173430.mjs                                  # pinned SR Legacy hash check + 173430 identity and core rows
node $S/extractCatalog.mjs d2f221d ../private-data/g2fix-store-import/published-d2f221d
node $S/extractCatalog.mjs 0d1ed87 ../private-data/g2fix-store-import/prior-0d1ed87
npx --no-install vite-node $S/g2FixPipeline.ts -- g2-prepare   # fresh store; index both pins; enqueue the 24; run fdc_bulk; validate; review packets
#   write acks.json: { "<manifestId>": { "<exact validation warning>": "<documented reason>" } }
npx --no-install vite-node $S/g2FixPipeline.ts -- g2-approve   # approve by review content hash; refuses any warning without a documented reason
npx --no-install vite-node $S/g2FixPipeline.ts -- g2-stage ../private-data/g2fix-store-import/stage-1
npx --no-install vite-node $S/g2FixPipeline.ts -- g2-stage ../private-data/g2fix-store-import/stage-2
npx --no-install vite-node $S/g2FixVerify.ts -- verify <published d2f221d> <stage-1> <stage-2> <prior 0d1ed87>   # V4, byte identity of the 23, held-id trace, core checklist
npx --no-install vite-node $S/g2FixVerifyFull.ts -- g2-verify [--write-catalog]   # raw-row replay, coverage; optionally writes the combined catalog
npx --no-install vite-node $S/g2FixPipeline.ts -- g2-rerun     # idempotency: re-enqueue and re-run on the same store
```

With the same pins and match table, the job ids, parent batch id, review hashes, and staged bytes are reproduced. An approved value can change only through a new reviewed pass.
