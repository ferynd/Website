# Population batch A3: import report (#63-A-3)

Prepared: 2026-11-11. Base: `main` at `b8105bc` (PR #224, the A3 preparation report). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports; his batch ladder (A3 stays at 25 per issue #215 ANSWER Q-013); and issue #215 ANSWER Q-015 Part 2, which adjudicated the 18 flagged A3 cases and authorized specific reviewed identity/source pairings, subject to deterministic pinned-record verification at import time. Q-015 is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

This import adds **16 completed profiles** to the curated catalog (29 published before, 45 after). Nine ids stay unresolved. Proposed matches from the [A3 preparation report](population-batch-a3-report.md) are not imports; only the profiles listed under [Imported profiles](#imported-profiles-completed-imports) are. Both write flags stay false. There was no live call, no FDC API key, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Related: [A3 preparation report](population-batch-a3-report.md) · [A2 import report](population-batch-a2-import.md) · [A1 import report](population-batch-a1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Contents

1. [Outcome summary](#outcome-summary)
2. [Exact-set gate](#exact-set-gate)
3. [Pipeline run and validation](#pipeline-run-and-validation)
4. [Field coverage of the imported profiles](#field-coverage-of-the-imported-profiles)
5. [Imported profiles (completed imports)](#imported-profiles-completed-imports)
6. [Per-item source verification](#per-item-source-verification)
7. [V4 cumulative proof](#v4-cumulative-proof)
8. [Idempotency](#idempotency)
9. [Rejected to unresolved](#rejected-to-unresolved)
10. [Still unresolved (9)](#still-unresolved-9)
11. [Blocking issues](#blocking-issues)
12. [Re-run instructions](#re-run-instructions)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch A3) | 25 |
| Candidate matches checked against the pinned record | 16 |
| Reviewed match entries written | 16 |
| Profiles validated, approved, staged, and imported | **16** |
| from Foundation 2026-10-29 | 0 |
| from SR Legacy 2018-04 | 16 |
| Candidates rejected to unresolved at import | 0 |
| Unresolved (no reviewed entry; blocked at matching, fail closed) | 9 |
| Catalog profile count after this import | 45 (was 29) |

Parent batch id `rb-90e0df60cb523abc78291263`, pass `rp-b7f1fe8ab86ddfe3db6b1bbb` (pass release `2018-04`, because every reviewed A3 entry is SR Legacy). The pass id differs from the one in the preparation run (`rp-f18929822a14a3a5f8d740e4`) only because the pass id includes the release, which was `unconfigured` before this PR wrote the reviewed entries. The parent batch id is source-independent and is the same.

All 16 profiles come from SR Legacy. Q-015 switched the four Foundation proposals that it approved (whole egg, applesauce, raw blueberry, raw pineapple) to their SR Legacy near-duplicates. The two remaining Foundation proposals (oat flour and ripe banana) are held as unresolved.

Pinned files: the reader checked each against its extracted-file SHA-256 pin on every load (SR Legacy 2018-04 `70d4235a…0129`, Foundation 2026-10-29 `990e7731…58a1`; the same pins as A1 and A2).

## Exact-set gate

ANSWER Q-015 requires an exactly-25 plan proved against both the published catalog and the local job store, because `selectNextBatch` skips ids with jobs in the store, not ids that are already published. On a fresh store at `~/workspace/private-data/a3store-import/cli` (never `/tmp`):

1. The first `plan --wave A --max 25 --write` seeded A1 and reproduced its parent batch id `rb-de5702452450983345068f40`.
2. The second `plan` seeded A2 and reproduced `rb-c61cabe465685a29a02ff753` with the 25 A2 ids (pass `rp-6749592086a40f3177d9f0c4`, the same as the A2 import).
3. The third `plan` selected exactly the 25 A3 ids of the brief and the preparation report, in (priority, category, id) order, with parent batch id **`rb-90e0df60cb523abc78291263`**: 2 eggs, 4 flours-starches, and 19 fruits.
4. Against the published catalog: the 29 published variant ids are the 14 A1 and 15 A2 profiles, and none of the 25 A3 ids was already published.

## Pipeline run and validation

The run used the merged pipeline through [researchCli.ts](../../scripts/nutrition/researchCli.ts): `index` (both releases, `--write`), `run --source fdc-bulk --batch rb-90e0df60cb523abc78291263`, `validate`, `review` with `--verify-source`, hash-bound `review --decide approve`, and `stage --write` into a fresh directory.

- **index:** SR Legacy 7,793 of 7,793 records indexed. Foundation 414 of 424, with the known 10 records skipped for non-numeric amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). None of them is an A3 candidate.
- **run:** 16 jobs reached `needs_review`, each matched to exactly its reviewed entry's fdcId and release. The 9 unresolved ids were `blocked` with `match_not_found`. That is the fail-closed behavior: no reviewed entry, no match.
- **validate:** all 16 proposals were valid with **0 errors**. Two had one warning each; both were reviewed individually and acknowledged at approval (see below). The 9 blocked jobs failed with `Job proposal is missing revisionDraft`, as expected. No job failed validation for any other reason, so no candidate had to be rejected at this step.
- **review --verify-source:** the command refused all 16 with `Deterministic FDC verification required`. This is by design and documented in the [research pipeline](research-pipeline.md) and the [A2 import report](population-batch-a2-import.md#pipeline-run-and-validation): `verifySource` re-verifies an assistant-cited source and needs an assistant result, which a deterministic bulk proposal does not have. For deterministic proposals the record is re-checked by `assertCuratedMatchTable` instead, when the review packet is built, at approval, and again at staging. It requires the record to equal the reviewed entry on fdcId, verbatim description, release, and dataType. All 16 passed that check at all three points. An independent check of each proposal's source record against the pinned file also matched on all four attributes. No packet showed an identity mismatch.
- **approve:** all 16 were approved by their review content hash under reviewer handle `claude-a3-import`.
- **stage:** `stage --write` wrote 16 profiles (11 variant shards, 19 search shards, manifest; 31 files) into a fresh directory outside the checkout. stageCatalog re-checked the match table and the private-text rules.

**Acknowledged warnings (2).**

1. `applesauce-pureed-unsweetened`: "Target food state is unspecified". The catalog state `pureed-unsweetened` maps, through the variant vocabulary, to preparation `pureed` and sweetening `unsweetened`, with no `state` dimension. The warning comes from that mapping. It is not an identity doubt: the record states canned, unsweetened applesauce, and applesauce is a purée. The published dims are the vocabulary's own.
2. `pear-european-with-skin-raw`: the fat-class sum (saturated + trans + mono + poly) exceeds total fat by more than 5%. Each of those five fields in the draft was compared with its pinned SR row (nutrient ids 1004, 1258, 1257, 1292, 1293) and equals it, with the same derivation code. So the inconsistency is in the source record's own rows, at a very low total fat level, and no value was adjusted. As with the A1 cocoa Atwater warnings, it is documented, not presented as explained.

**Unknown and assumed-zero review.** Before approval, every one of the 16 drafts was compared field by field against its raw pinned record, through the nutrient id and derivation code recorded in provenance. For each field directly mapped to a pinned FDC nutrient row, the normalized per-100 g amount and the USDA derivation code were checked against that exact row, with **0 mismatches** across 1,072 cells. Two deterministic representations are identified separately in field-level provenance: `fiber` aliases the source's `fiberTotal` on all 16 (`same_as:fiberTotal`), and `omega3` sums ALA+EPA+DHA on the 2 profiles where all components exist (whole egg and avocado; `sum:ALA+EPA+DHA`). These are not independent laboratory observations. No values from alternate FDC records were blended, and in particular no Foundation field was grafted onto the four switched SR bases. Where a component is missing, the field stays unknown with `partial_components`. Every staged profile uses the record's classic energy row (1008). Type fidelity holds: every resolved value is a finite non-negative number, and every unknown is null with a gap reason. All 66 `assumed_zero` cells hold the numeric 0 with derivation code Z. Status mapping follows Q-004: A → measured, NC → calculated, Z → assumed_zero, and every other code or no code → source_reported (in this batch: BD, BFFN, BFPN, BFSN, BFZN, CAZN, DA, FLC, LC, NR, O, T, and none). The 66 zeros are the SR Legacy records' own Z rows, spread over all 16 profiles: caffeine on 15, vitamin B12 on 13, vitamin D on 13, cholesterol on 13, trans fat on 11, and alcohol on 1 (dried sweetened blueberries). No zero was invented.

## Field coverage of the imported profiles

Across the 16 head revisions: 1,072 quality-tracked field cells (67 per profile), **649 resolved, 423 explicit unknowns, 0 not checked (unexamined)**. Quality statuses under the Q-004 derivation policy: **measured 225, calculated 70, source_reported 288, assumed_zero 66, unknown 423**. All 16 profiles resolve energy, protein, carbohydrate, total fat, and sodium. The staged nutrient maps also carry the legacy key `fiberWeightedLegacy`, null on every profile. It has no quality entry and is excluded from the cell counts, on the same basis as A1 and A2.

Unknown cells by gap reason: not_reported_by_source 379, definition_mismatch 30 (vitamin K on all 16 and omega3ALA on 14), partial_components 14 (omega3). An unknown means the source was checked and has no usable value. It does not mean the field was unexamined, and unexamined is 0.

Per-field counts across the 16 profiles (fields with identical counts are grouped):

| Fields | Resolved | Unknown | Not checked | Resolved by status |
| --- | ---: | ---: | ---: | --- |
| calories, folate | 16 | 0 | 0 | calculated 16 |
| protein, fat, potassium, magnesium, calcium, phosphorus, iron, zinc, copper, vitaminB1, vitaminB2, vitaminB3, vitaminB6, water | 16 | 0 | 0 | measured 9, source_reported 7 |
| carbs | 16 | 0 | 0 | calculated 15, source_reported 1 |
| fiber, fiberTotal, sugarsTotal | 16 | 0 | 0 | measured 8, source_reported 8 |
| sodium, vitaminC | 16 | 0 | 0 | measured 7, source_reported 9 |
| choline | 16 | 0 | 0 | source_reported 16 |
| vitaminA | 16 | 0 | 0 | calculated 4, measured 2, source_reported 10 |
| vitaminE, selenium | 16 | 0 | 0 | measured 10, source_reported 6 |
| fatSaturated, fatPolyunsaturated | 16 | 0 | 0 | calculated 5, source_reported 11 |
| fatMonounsaturated | 16 | 0 | 0 | calculated 6, source_reported 10 |
| vitaminB12 | 16 | 0 | 0 | assumed_zero 13, measured 2, source_reported 1 |
| vitaminD | 16 | 0 | 0 | assumed_zero 13, source_reported 3 |
| cholesterol | 16 | 0 | 0 | assumed_zero 13, measured 1, source_reported 2 |
| omega3EPA, omega3DHA, omega3DPA | 15 | 1 | 0 | measured 2, source_reported 13 |
| alcohol | 15 | 1 | 0 | assumed_zero 1, source_reported 14 |
| caffeine | 15 | 1 | 0 | assumed_zero 15 |
| vitaminB5, manganese | 14 | 2 | 0 | measured 9, source_reported 5 |
| fatTrans | 13 | 3 | 0 | assumed_zero 11, calculated 1, source_reported 1 |
| lactose | 12 | 4 | 0 | measured 5, source_reported 7 |
| starch | 5 | 11 | 0 | measured 5 |
| omega3 | 2 | 14 | 0 | calculated 2 |
| omega3ALA | 2 | 14 | 0 | measured 2 |
| vitaminK, iodine, omega6, sugarsAdded, allulose, sugarAlcoholsTotal, erythritol, sorbitol, mannitol, isomalt, xylitol, glycerol, maltitol, fiberSoluble, fiberInsoluble, resistantStarch, biotin, chromium, molybdenum, chloride, fructans, gos, excessFructose | 0 | 16 | 0 | - |

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description | Resolved |
| --- | --- | --- | --- | ---: |
| apple-with-skin-raw | SR Legacy 2018-04 | 171688 | Apples, raw, with skin (Includes foods for USDA's Food Distribution Program) | 42/67 |
| applesauce-pureed-unsweetened | SR Legacy 2018-04 | 167772 | Applesauce, canned, unsweetened, with added ascorbic acid | 37/67 |
| avocado-raw | SR Legacy 2018-04 | 171705 | Avocados, raw, all commercial varieties | 44/67 |
| blueberry-dried-sweetened | SR Legacy 2018-04 | 168158 | Blueberries, dried, sweetened | 38/67 |
| blueberry-frozen-unsweetened | SR Legacy 2018-04 | 173950 | Blueberries, frozen, unsweetened (Includes foods for USDA's Food Distribution Program) | 41/67 |
| blueberry-raw | SR Legacy 2018-04 | 171711 | Blueberries, raw | 42/67 |
| chicken-egg-whole-raw | SR Legacy 2018-04 | 171287 | Egg, whole, raw, fresh | 43/67 |
| chicken-egg-yolk-raw | SR Legacy 2018-04 | 172184 | Egg, yolk, raw, fresh | 40/67 |
| cornstarch-dry | SR Legacy 2018-04 | 169698 | Cornstarch | 40/67 |
| lemon-raw | SR Legacy 2018-04 | 167746 | Lemons, raw, without peel | 40/67 |
| lime-raw | SR Legacy 2018-04 | 168155 | Limes, raw | 40/67 |
| mango-raw | SR Legacy 2018-04 | 169910 | Mangos, raw | 41/67 |
| pear-european-with-skin-raw | SR Legacy 2018-04 | 169118 | Pears, raw | 41/67 |
| pineapple-canned-in-juice-drained | SR Legacy 2018-04 | 167767 | Pineapple, canned, juice pack, drained | 38/67 |
| pineapple-raw | SR Legacy 2018-04 | 169124 | Pineapple, raw, all varieties | 42/67 |
| wheat-flour-bread-enriched-dry | SR Legacy 2018-04 | 168896 | Wheat flour, white, bread, enriched | 40/67 |

Validation outcome for this batch: 16 of 16 staged profiles passed the pipeline validator with 0 errors (2 reviewed warnings acknowledged), and staging re-checked each against the match table.

## Per-item source verification

Each of the 16 candidates was checked against the actual pinned record through the audit path. For each, the fdcId exists and parses, the dataType equals the entry's dataset (SR Legacy), the description is copied verbatim, the release is the pin's release (2018-04), and all five core rows are present. "Q-015" marks a case adjudicated in ANSWER Q-015 Part 2. "Routine" marks one of the five unflagged proposals. These got the standard checks plus a keyword search of both pinned datasets for a nearer competing record.

| Manifest id | Basis | Verification notes | Verdict |
| --- | --- | --- | --- |
| chicken-egg-whole-raw | Q-015 case 1 | **Base switched** to SR 171287 as directed (NDB 1123; 134 rows; cup and five egg-size portions). Foundation 748967 (same NDB) is not independent corroboration, and none of its fields was grafted in. | Pass |
| chicken-egg-yolk-raw | Q-015 case 2 | SR 172184 (NDB 1125; 111 rows, sodium row present; large and cup portions). Frozen, sugared, salted, and dried yolk are excluded. | Pass |
| wheat-flour-bread-enriched-dry | Q-015 case 5 | SR 168896 (NDB 20083; 96 rows with folic acid and folate DFE rows; cup portion). The record does not state bleaching, and none is inferred. | Pass |
| apple-with-skin-raw | Q-015 case 6 | SR 171688 (NDB 9003; *Malus domestica*; 104 rows; seven household portions). With skin and raw stated; not tied to a variety. | Pass |
| applesauce-pureed-unsweetened | Q-015 case 7 | **Base switched** to SR 167772 as directed (NDB 9401; 83 rows; cup portion). **Fortification disclosure** carried in the entry: canned applesauce with added vitamin C. Its vitamin C value does not describe unfortified applesauce (SR 171695), and the profile is not homemade or unfortified applesauce. No Foundation 2346414 field was blended in. | Pass |
| avocado-raw | Q-015 case 8 | SR 171705 (NDB 9037; *Persea americana*; 122 rows). All commercial varieties stated. | Pass |
| blueberry-raw | Q-015 case 10 | **Base switched** to SR 171711 as directed (NDB 9050; *Vaccinium spp.*; 106 rows with a fiber row; cup and berry portions). Wild blueberries remain a distinct variant. No Foundation 2346411 field was blended in. | Pass |
| lemon-raw | Q-015 case 11 | SR 167746 (NDB 9150; *Citrus limon*; 72 rows). **Peel-excluded disclosure** carried in the entry: edible flesh without peel. Not a source for lemon zest, lemon peel (167749), or a whole unpeeled lemon. | Pass |
| mango-raw | Q-015 case 12 | SR 169910 (NDB 9176; *Mangifera indica*; 102 rows). Unqualified raw mango. | Pass |
| pear-european-with-skin-raw | Q-015 case 13 (pinned-basis check) | SR 169118 (NDB 9252; *Pyrus communis*; 107 rows; six household portions). **Pinned-basis check:** the pinned SR Legacy 2018-04 record carries the same NDB number (9252) and scientific name as the USDA SR28 pear that Q-015 cites, whose refuse is "10% Stem, core and seeds", not skin. Nothing in the pinned record contradicts that basis. The description has no peel or skin-removal qualifier, the portion labels name no peeled form, the food attributes are empty, and the release has no without-skin pear. The pinned JSON has no refuse field, so the refuse wording itself comes from the SR28 evidence cited in Q-015, not from the pinned file. The match is not held. | Pass |
| pineapple-raw | Q-015 case 14 | **Base switched** to SR 169124 as directed (NDB 9266; *Ananas comosus*; 107 rows; five household portions). No Foundation 2346398 field was grafted in. | Pass |
| cornstarch-dry | Routine | SR 169698 (NDB 20027; 96 rows; cup portion). The only cornstarch record in either dataset; the other keyword hits are gluten-free products made with corn starch. | Pass |
| blueberry-dried-sweetened | Routine | SR 168158 (NDB 9163; 70 rows; 0.25 cup portion). Dried and sweetened stated. The only dried blueberry record in either dataset. | Pass |
| blueberry-frozen-unsweetened | Routine | SR 173950 (NDB 9054; 90 rows; package and cup, unthawed). Frozen and unsweetened stated. The sweetened sibling (173951) and the wild frozen records (173949, 169799) are different variants. | Pass |
| lime-raw | Routine | SR 168155 (NDB 9159; *Citrus latifolia*; 75 rows; fruit and NLEA portions). The only raw lime record; lime juice records (168156, 168157) are different products, and Foundation has no lime. The record does not state the peel. The entry says the profile is the record's per-100 g edible-portion basis and is not a source for lime zest or peel. | Pass |
| pineapple-canned-in-juice-drained | Routine | SR 167767 (NDB 9354; 70 rows; four household portions). Juice pack and drained stated. The juice-pack solids-and-liquids record (169126) and the water and syrup packs are different states. | Pass |

The new table entries carry the verbatim description, dataset, release, and FDC id, plus the product, fortification, peel, and basis qualifiers that Q-015 requires. `validateMatchTable` accepts the table: 45 valid entries, 45 distinct FDC records, no shared record, so no `sharedJustification` is needed.

## V4 cumulative proof

Run before this import PR, as the [V4 rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches) requires. `published` is the catalog at `b8105bc`. `staged` is the `stageCatalog` output written by `stage --write`.

| Catalog | Profiles | Variant shards | Search shards | Search entries | Revisions | Defects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| published (`b8105bc`) | 29 | 17 | 51 | 97 | 29 | 0 |
| staged (A3) | 16 | 11 | 19 | 28 | 16 | 0 |
| `combineCatalogs(published, staged)` | **45** | 23 | 59 | 125 | 45 | **0** |

- `verifyCatalog(combined)`: **0 defects**.
- `verifyAppendOnly(published, combined)`: **0 defects, preserved = 29, added = 16**. The added ids are exactly the 16 approved ids listed above. No other id was added, and none of the 9 unresolved ids is present.
- `combineCatalogs(combined, staged)` (a rerun of the batch) reproduces the combined manifest and every shard exactly.
- The combined `{ manifest, files }`, and only that, was written to the curated catalog directory. Shards whose bucket gained an A3 record get a new content hash, so their old files are replaced: 16 old shard files were removed, and 30 shard files plus the manifest were written. For example, bucket `ch` now holds the raw whole egg and yolk next to the cheddar, chocolates, and cooked eggs. The append-only check confirms that every A1 and A2 record and search entry is unchanged.
- On the written files, `catalogIntegrityCli.ts -- --previous <published> --next public/shared/nutrition/catalog/nutrition-curated` reported added 16, preserved 29, and 0 defects on both sides. `--combine <published> <staged>` gave the same counts, and the default mode on the written catalog reported 45 profiles and 0 defects.

## Idempotency

- **Staging:** `stage --write` ran twice into separate fresh directories. Both produced 31 files with an identical tree SHA-256 (`c0898948…92fa`), computed over every file's bytes. The outputs are byte-identical.
- **Full-pass rerun:** `run --source fdc-bulk --batch rb-90e0df60cb523abc78291263 --write` ran again on the same store. The store held 75 jobs before and after (75 unique job keys and 75 unique manifest ids). A listing of every A3 job's state, match, validation, draft hash, review hash, and version was byte-identical before and after the rerun: the 16 approved jobs kept their state, draft hash, review hash, and version (approved jobs are never fetched again), and the 9 blocked jobs stayed blocked at `match_not_found`. A third staging after the rerun was byte-identical to the first two. A dry-run `plan --wave A` on the store selects none of the 25 A3 ids; it moves on to the next wave-A positions (`rb-084e72af05c1d15c589a5f74`). Re-combining the batch with the combined catalog adds nothing. The rerun created no duplicate profile.

## Rejected to unresolved

None. All 16 candidates passed pinned-record verification, the pear pinned-basis check, validation, and review, so no candidate was rejected at import.

## Still unresolved (9)

These ids have no reviewed match entry, and the deterministic pass blocked every one at matching with `match_not_found`. They are explicit blocked work, not permanent exclusions. Candidate records are kept as references only.

| Manifest id | Basis | Reason and cure |
| --- | --- | --- |
| oat-flour-dry | Q-015 case 3 | Foundation 2261421 "Flour, oat, whole grain" and SR 169741 "Oat flour, partially debranned" are different millings, and the unqualified catalog id selects neither. Cure: a reviewed catalog-wide whole-grain default with source-backed evidence plus a separate debranned variant, or a defined whole-grain catalog id. |
| wheat-flour-all-purpose-enriched-dry | Q-015 case 4 | SR 168894 (bleached) and SR 168936 (unbleached) are both enriched all-purpose flours; the catalog does not distinguish bleaching. Cure: bleached/unbleached variants, or an independently supported baseline default plus a separate alternative. |
| banana-ripe-raw | Q-015 case 9 | Foundation 1105314 is a 50/50 ripe and slightly-ripe composite; SR 173944 does not establish the ripe stage. Cure: a ripe-only record, or a reviewed widening/rename with the composite disclosed. |
| banana-pureed-unsweetened | Q-015 case 15 | SR 167732 is an infant-food formulation ("Babyfood, banana no tapioca, strained"). Cure: a reviewed 100%-banana purée label or an ingredient-controlled recipe transformation. |
| passion-fruit-pulp-pureed-unsweetened | Q-015 case 16 | SR 169108 is raw purple fruit, not documented puréed pulp. Cure: a verified pulp product (variety, form, extraction yield) or a validated recipe-time transformation. |
| pineapple-canned-in-heavy-syrup-drained | Q-015 case 17 | SR 169944 is heavy syrup solids and liquids; SR 167767 is juice pack. Neither matches both medium and drained state. Cure: a matching source or a reviewed soluble-sugar/yield mass balance. |
| mango-dried-unsweetened | Q-015 case 18 | Only sweetened dried mango (SR 169091) exists. Cure: specific source or label evidence. |
| mango-frozen-unsweetened | Q-015 case 18 | No frozen mango record; raw mango is a different state. Cure: specific source or label evidence, or a validated transformation. |
| mango-pureed-unsweetened | Q-015 case 18 | Mango nectar (SR 167785) and babyfood mango with tapioca (SR 171341) are different products. Cure: specific source or label evidence, or a validated transformation. |

None of these 9 ids has an entry in [source-match-table.json](source-match-table.json). That was checked with `validateMatchTable`: 45 valid entries, 45 distinct FDC records, and no entry for any of the 9.

## Blocking issues

None for this batch. Open, nonblocking items:

1. **Planner limitation (Q-010 Part 1, still open):** `selectNextBatch` still skips store jobs, not published ids. A3 handled this by seeding A1 and A2 first and checking the exact set against the published catalog. Before unattended later waves, implement skip-published or explicit eligible-id input.
2. **`--verify-source` and deterministic jobs:** the command still refuses deterministic bulk proposals by design (A2 blocking issue 2). The match-table re-check at packet, approval, and staging covers them.
3. **Vocabulary gap (new):** catalog states with only preparation and sweetening words (`pureed-unsweetened`) produce dims with no `state`, so the validator warns "Target food state is unspecified" on an identity that is not in doubt. Applesauce was acknowledged on that basis. The three unresolved puréed ids would hit the same warning once they have sources. A vocabulary entry that also sets the state would remove it.
4. **Source-row inconsistency:** SR 169118 (pear) has fat-class rows whose sum exceeds its total-fat row by more than 5%. The values are kept as published by USDA, and the warning is acknowledged, not explained.
5. **Operator-local audit caveat:** the job store, the pinned dataset files, and the staging outputs are operator-local and outside the repository, so a reviewer using only the GitHub connector cannot replay them. The [Re-run instructions](#re-run-instructions) reproduce them from the same pins.

## Re-run instructions

The store and staging output are disposable. They live outside the checkout under `~/workspace/private-data/a3store-import/` (never `/tmp`). From the repository root:

```sh
S=~/workspace/private-data/a3store-import/cli
D=~/workspace/private-data/fdc
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store $S   # A1 rb-de5702452450983345068f40 (seed)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store $S   # A2 rb-c61cabe465685a29a02ff753 (seed)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store $S   # A3 rb-90e0df60cb523abc78291263
npx --no-install vite-node scripts/nutrition/researchCli.ts -- index --dataset sr-legacy --file $D/FoodData_Central_sr_legacy_food_json_2018-04.json --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- index --dataset foundation --file $D/FoodData_Central_foundation_food_json_2026-10-29.json --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- run --source fdc-bulk --batch rb-90e0df60cb523abc78291263 --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- validate --batch rb-90e0df60cb523abc78291263 --write --store $S
# per job: review packet, then approve with the packet's Approval Content Hash
npx --no-install vite-node scripts/nutrition/researchCli.ts -- review --job <jobId> --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- review --job <jobId> --decide approve --hash <hash> --reviewer claude-a3-import --write --store $S
#   applesauce and pear: add --ack '<the job's exact validation warning>'
npx --no-install vite-node scripts/nutrition/researchCli.ts -- stage --batch rb-90e0df60cb523abc78291263 --write --out <fresh dir> --store $S
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts -- --combine <published dir> <fresh dir>
```

With the same pins and match table, the job ids, parent batch id, review hashes, and staged bytes are reproduced. An approved value can change only through a new reviewed pass.
