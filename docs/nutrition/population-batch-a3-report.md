# Population batch A3: dry-run preparation report (#63)

Prepared: 2026-11-11. Base: `main` at `0599c41` (PR #222, the A2 import, which brought the published catalog to 29 profiles: 14 from A1 and 15 from A2). Authority: James's standing approval of 2026-11-10 for the #63 population waves, and his batch ladder as clarified by issue #215 ANSWER Q-013: the 25-target A2 batch did not by itself meet the requirement of two clean 25-item batches, so **A3 stays at 25**. The batch size does not go up to 50 here.

This batch is **preparation only**. Nothing was staged, imported, or published. The reviewed [match table](source-match-table.json) is byte-identical to `main` (the 29 A1 and A2 entries). The proposed matches below exist only in this report. There was no `--live` run, no FDC API key, and no Firestore access. Both write flags in [capabilities.js](../../public/shared/nutrition/capabilities.js) stay false, and nothing under `public/` changed. The report gives public FDC record ids, descriptions, scientific names, and input-food or portion labels. It gives no nutrient values. Wherever a nutrient level or the presence of a nutrient row was used as evidence, the report states only the comparison or the presence. No dataset file or record dump entered the repository.

Related: [A2 preparation report](population-batch-a2-report.md) · [A2 import report](population-batch-a2-import.md) · [A1 evidence matrix](a1-evidence-matrix.md) · [A2 evidence matrix](a2-evidence-matrix.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Contents

1. [Batch definition](#batch-definition)
2. [Method](#method)
3. [Aggregate counts](#aggregate-counts)
4. [Proposed matches](#proposed-matches)
5. [Unresolved](#unresolved)
6. [Deterministic pass outcome](#deterministic-pass-outcome)
7. [Sample review](#sample-review)
8. [Flagged cases](#flagged-cases)
9. [Pipeline gaps](#pipeline-gaps)
10. [Follow-ups: the import PR for this batch](#follow-ups-the-import-pr-for-this-batch)
11. [Re-run instructions](#re-run-instructions)

## Batch definition

Wave A, deterministic lane. The eligible set is the priority-1 entries of [ingredient-catalog.json](ingredient-catalog.json) with `kind: generic` and `sourceStrategy: usda-first`, ordered by (priority, category, id). This is the rule A1 and A2 used. There are 225 eligible ids. A1 took positions 1-25, A2 took positions 26-50, and A3 takes positions 51-75.

The batch was re-derived from the catalog JSON on this branch and **matches the brief's list exactly**, with no discrepancy:

| Category | Ids (count) |
| --- | --- |
| eggs | chicken-egg-whole-raw, chicken-egg-yolk-raw (2) |
| flours-starches | cornstarch-dry, oat-flour-dry, wheat-flour-all-purpose-enriched-dry, wheat-flour-bread-enriched-dry (4) |
| fruits | apple-with-skin-raw, applesauce-pureed-unsweetened, avocado-raw, banana-pureed-unsweetened, banana-ripe-raw, blueberry-dried-sweetened, blueberry-frozen-unsweetened, blueberry-raw, lemon-raw, lime-raw, mango-dried-unsweetened, mango-frozen-unsweetened, mango-pureed-unsweetened, mango-raw, passion-fruit-pulp-pureed-unsweetened, pear-european-with-skin-raw, pineapple-canned-in-heavy-syrup-drained, pineapple-canned-in-juice-drained, pineapple-raw (19) |

- **Not already covered:** the 29 published variant ids are the 14 A1 and 15 A2 profiles. None of the A3 ids has a published profile or a match-table entry.
- **The CLI's selection agrees.** In a fresh store, `plan --wave A --max 25` run three times reproduced A1 and then A2, and the third plan selected exactly these 25 ids in (priority, category, id) order. The planner fix from PR #220 holds: no manufacturer-first entry entered wave A.
- **Parent batch id: `rb-90e0df60cb523abc78291263`** (pass `rp-f18929822a14a3a5f8d740e4`, release `unconfigured`, because no A3 id has a reviewed entry yet). `parentBatchIdFor` hashes the sorted manifest ids, so this id covers exactly the A3 set. The import PR must reproduce it (see [Follow-ups](#follow-ups-the-import-pr-for-this-batch)).

## Method

**Datasets.** These are the two pinned bulk releases in [researchConfig.ts](../../scripts/nutrition/researchConfig.ts). The files sit in an operator-local directory outside the checkout. The reader checks each one against its extracted-file sha256 pin on every load.

| Dataset id | Data type | Release | Pin (extracted JSON) |
| --- | --- | --- | --- |
| `foundation` | Foundation | 2026-10-29 | `sha256:990e7731…58a1` |
| `sr-legacy` | SR Legacy | 2018-04 | `sha256:70d4235a…0129` |

**Foundation blocked set.** The audit path skipped the 10 Foundation records with non-numeric nutrient amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). Every Foundation `suggest` call reported `skippedRecords: 10` with exactly these ids. None of them was a candidate for any A3 id.

**Commands.** All were run from the repository root through [researchCli.ts](../../scripts/nutrition/researchCli.ts). `<dir>` is the operator-local dataset directory and `<store>` is `~/workspace/private-data/a3store/cli`. The store is outside the checkout and not under `/tmp`.

```sh
# 1. Candidate search, per manifest id and dataset (the audit path; read-only). 50 calls.
npx --no-install vite-node scripts/nutrition/researchCli.ts -- suggest --manifest-id <id> --dataset foundation --file <dir>/FoodData_Central_foundation_food_json_2026-10-29.json --max 25
npx --no-install vite-node scripts/nutrition/researchCli.ts -- suggest --manifest-id <id> --dataset sr-legacy --file <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json --max 25
# 2. Deterministic pass. Plans 1 and 2 seed A1 and A2, so plan 3 selects the next 25.
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store <store>   # rb-de5702452450983345068f40 (A1, reproduced)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store <store>   # rb-c61cabe465685a29a02ff753 (A2, reproduced)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store <store>   # rb-90e0df60cb523abc78291263 (A3)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- run --source fdc-bulk --dataset sr-legacy --batch rb-90e0df60cb523abc78291263 --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- validate --batch rb-90e0df60cb523abc78291263 --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- coverage --store <store>
```

The `suggest` ranking only orders candidates by word overlap. Where its top 25 was noisy, or missed the obvious record, the same pinned files were also searched read-only by description keyword. That search used an operator-local helper that prints only fdcId, description, food category, NDB number, publication date, portion labels, input-food labels, nutrient-row counts, and whether each core row is present. It is not committed. Five proposals (cornstarch, the three blueberry ids, and pear) were found only by keyword search, because `suggest` truncated or missed them (see [Pipeline gaps](#pipeline-gaps) items 1 and 2).

Every proposal is a manual decision under the consolidated matching policy James adopted on 2026-11-10 (the documented-attributes rubric in the [A1 evidence matrix](a1-evidence-matrix.md), applied as in the [A2 evidence matrix](a2-evidence-matrix.md)). For each proposal, the report records the attributes that support it, the attributes that contradict it, and the gaps. Candidates were ranked by physical and formulation match first (state, form, raw or frozen or dried, variety where the catalog distinguishes it, sweetened or unsweetened, drained packing medium for canned fruit, enrichment for flours) and by nutrient completeness second. Where the catalog id names no variety, a record for all varieties or an unqualified record was preferred to a single-variety record.

**Source choice between near-duplicates.** Two records in different data types that share an NDB number are a cross-type near-duplicate, never independent confirmation. Where such a pair matches equally on physical identity and the Foundation record has all five core rows (energy, protein, carbohydrate, total fat, sodium), Foundation is proposed under the preference rule, and its coverage against SR is flagged, so that issue #215 can apply the ANSWER Q-010 precedent (which switched tomato paste and whole-milk yogurt to SR) case by case. Two exceptions follow existing rulings or the catalog's own attributes. A Foundation record that lacks a core row loses to SR, as in A2 case 14. And for the enriched flours, the Foundation records lack the folic acid and DFE rows that express enrichment folate, so SR is proposed (cases 4 and 5).

Where a nutrient level was read from the pinned record as identity evidence, the report states the comparison only. "About equal" means within 5% of the reference. Under ANSWER Q-009, a nutrient comparison and an unqualified title never count as independent proof of identity. They are recorded as consistent or inconsistent evidence only. Any materially ambiguous identity goes to [Flagged cases](#flagged-cases) for adjudication through issue #215.

**Store.** `~/workspace/private-data/a3store/cli` holds the job store with 75 jobs: the 25 A1 and 25 A2 jobs reproduced by the seeding plans (queued, not run) and the 25 A3 jobs. No source cache was written: no job reached the fetch step, so no dataset content was copied there. The raw `suggest` outputs were reviewed in the session and were not saved or committed.

## Aggregate counts

| Measure | Count |
| --- | ---: |
| Ids attempted (identity resolution against both datasets) | 25 |
| Proposed matches | 19 |
| from Foundation 2026-10-29 | 6 |
| from SR Legacy 2018-04 | 13 |
| Proposed matches carrying a flag | 14 |
| Unresolved | 6 |
| Flagged cases (Flagged cases section) | 18 |
| Jobs planned in the store for the A3 batch | 25 |
| Jobs that reached a proposal through the CLI | 0 |
| Validated | 0 |
| Validation failures | 25 |
| Approved, staged, imported | 0 |

Validation failure categories:

| Category | Count |
| --- | ---: |
| `Job proposal is missing revisionDraft` (job blocked at match with `match_not_found`, because the reviewed match table has no A3 entries) | 25 |

Unresolved reason categories:

| Category | Count |
| --- | ---: |
| `no_source_record`: neither pinned dataset has the food in the catalog state | 2 |
| `different_product_only`: the closest record is a different product or preparation | 1 |
| `variant_not_distinguished`: the dataset has the food but not the catalog variant | 3 |

Per-field status summary: no job produced a revision, so **0** registry fields resolved, **0** were recorded as unknown, and every stored registry field is **not checked** for all 25 ids. A per-field summary needs the deterministic pass to run on reviewed match-table entries in the import PR.

## Proposed matches

These are proposals only, for entry into the reviewed match table in the import PR. They were not written to [source-match-table.json](source-match-table.json). Each listed record was returned by the audit-path reader and is not in the skipped set. Descriptions are verbatim. A ⚑ marks a proposal with a flagged case. "Core rows" means energy, protein, carbohydrate, total fat, and sodium. "Atwater energy only" means the record's energy comes from the Atwater rows (957/958), not the classic kcal row (208).

| Manifest id | Dataset | FDC id | Verbatim description | Supporting attributes | Contradictions | Gaps |
| --- | --- | --- | --- | --- | --- | --- |
| chicken-egg-whole-raw ⚑ | foundation | 748967 | Eggs, Grade A, Large, egg whole | Whole egg. 26 of 27 inputs are "EGG, GRADE A, LARGE, WHOLE, RAW, FRESH" (the other is "Eggs, whole"). All core rows (classic energy row). Portions: 1 egg whole without shell; RACC. | None | 95 rows against 134 in SR 171287 "Egg, whole, raw, fresh", which is the same food code (NDB 1123). |
| chicken-egg-yolk-raw ⚑ | sr-legacy | 172184 | Egg, yolk, raw, fresh | Yolk, raw, fresh stated. 111 rows, all core rows. Portions: large; cup. | None | Foundation 748236 (same food code, NDB 1125; inputs raw, fresh) has **no sodium row**. |
| cornstarch-dry | sr-legacy | 169698 | Cornstarch | Exact product. The only cornstarch record in either dataset. 96 rows, all core rows. Portion: cup. | None | Found by keyword search only (`suggest` truncated it). |
| oat-flour-dry ⚑ | foundation | 2261421 | Flour, oat, whole grain | Oat flour. 8 inputs "Flour, whole grain oat". All core rows. | None | 31 rows, Atwater energy only, RACC only. "Whole grain" is a default: the catalog id does not name the milling. SR 169741 "Oat flour, partially debranned" is a different milling. |
| wheat-flour-all-purpose-enriched-dry ⚑ | sr-legacy | 168894 | Wheat flour, white, all-purpose, enriched, bleached | All-purpose and enriched stated. 97 rows, all core rows, including folic acid and folate DFE rows. Portion: cup. | None | Bleached is a default: the catalog id does not name bleaching. Unbleached SR 168936 and Foundation 789890/789951 (24 rows, no folic acid or DFE row) are alternatives. |
| wheat-flour-bread-enriched-dry ⚑ | sr-legacy | 168896 | Wheat flour, white, bread, enriched | Bread flour and enriched stated. 96 rows, all core rows, including folic acid and folate DFE rows. Portion: cup. | None | Foundation 790146 "Flour, bread, white, enriched, unbleached" (same food code, NDB 20083) has 24 rows and no folic acid or DFE row. |
| apple-with-skin-raw ⚑ | sr-legacy | 171688 | Apples, raw, with skin (Includes foods for USDA's Food Distribution Program) | Raw and with skin stated. Not tied to a variety. The without-skin sibling 171689 is separately qualified. 104 rows, all core rows, household portions. | None | Foundation has only single-variety apples (red delicious, fuji, gala, granny smith, honeycrisp). |
| applesauce-pureed-unsweetened ⚑ | foundation | 2346414 | Applesauce, unsweetened, with added vitamin C | Applesauce and unsweetened stated. 8 inputs "applesauce, unsweetened, with vit C added". All core rows. | None | Added vitamin C is not in the catalog id. 31 rows, Atwater energy only, RACC only. SR 167772 is the same food code (NDB 9401). SR 171695 is the unfortified form. |
| avocado-raw ⚑ | sr-legacy | 171705 | Avocados, raw, all commercial varieties | Raw. All commercial varieties, which matches an id with no variety. 122 rows, all core rows, household portions. | None | Foundation 2710824 "Avocado, Hass, peeled, raw" is single-variety (Hass). |
| banana-ripe-raw ⚑ | foundation | 1105314 | Bananas, ripe and slightly ripe, raw | Ripe stated. 16 inputs: 8 ripe and 8 slightly ripe. All core rows (classic energy row). Portions: 1 banana peeled; RACC. | None | 52 rows against 108 in SR 173944 "Bananas, raw", the same food code (NDB 9040). Half of the inputs are slightly ripe. |
| blueberry-dried-sweetened | sr-legacy | 168158 | Blueberries, dried, sweetened | Dried and sweetened stated. The only dried blueberry record in either dataset. 70 rows, all core rows. Portion: 0.25 cup. | None | Found by keyword search only. |
| blueberry-frozen-unsweetened | sr-legacy | 173950 | Blueberries, frozen, unsweetened (Includes foods for USDA's Food Distribution Program) | Frozen and unsweetened stated. The sweetened sibling 173951 is separately qualified. 90 rows, all core rows. Portions: package (20 oz); cup, unthawed. | None | Wild frozen blueberries (173949, 169799) are a different variety. Found by keyword search only. |
| blueberry-raw ⚑ | foundation | 2346411 | Blueberries, raw | Raw stated. 8 inputs "blueberries, fresh, raw". All core rows. | None | 26 rows, Atwater energy only, RACC only, no fiber row. SR 171711 "Blueberries, raw" is the same food code (NDB 9050) with 106 rows. Found by keyword search only. |
| lemon-raw ⚑ | sr-legacy | 167746 | Lemons, raw, without peel | Lemon, raw. 72 rows, all core rows, household portions. | The record is "without peel"; the catalog id does not say. | Neither dataset has a whole lemon with peel. Lemon peel (167749) is a separate record. Foundation has no lemon. |
| lime-raw | sr-legacy | 168155 | Limes, raw | Lime, raw. Scientific name *Citrus latifolia* (Persian lime, the usual retail lime). 75 rows, all core rows. Portions: fruit (2" dia); NLEA serving. | None | Peel state not stated. Foundation has no lime. |
| mango-raw ⚑ | sr-legacy | 169910 | Mangos, raw | Raw. Not tied to a variety. 102 rows, all core rows. Portions: fruit without refuse; cup pieces. | None | Foundation has only single-variety mangoes (Tommy Atkins 2710833 and Ataulfo 2710834). |
| pear-european-with-skin-raw ⚑ | sr-legacy | 169118 | Pears, raw | Raw. Scientific name *Pyrus communis* (European pear). The Asian pear 168177 is separately described. 107 rows, all core rows, household portions. | None | "With skin" is not stated. The release has no "without skin" pear to contrast with. Found by keyword search only. |
| pineapple-canned-in-juice-drained | sr-legacy | 167767 | Pineapple, canned, juice pack, drained | Canned, juice pack, and drained stated. 70 rows, all core rows. Portions: cup, sliced; spear; cup, chunks; cup, crushed. | None | The solids-and-liquids juice-pack record 169126 is a different state. Foundation has no canned pineapple. |
| pineapple-raw ⚑ | foundation | 2346398 | Pineapple, raw | Raw stated. 8 inputs "Pineapple, raw". All core rows. | None | 34 rows, Atwater energy only, RACC only. SR 169124 "Pineapple, raw, all varieties" is the same food code (NDB 9266) with 107 rows. |

No proposal shares an FDC record with another manifest id or with any of the 29 existing match-table entries, so no `sharedJustification` is needed.

## Unresolved

| Manifest id | Category | Reason |
| --- | --- | --- |
| banana-pureed-unsweetened | different_product_only | Neither dataset has a plain banana purée. The nearest record is SR 167732 "Babyfood, banana no tapioca, strained", which is an infant food. Its description does not state sweetening or added ingredients, and it is not substituted (see flagged case 15). |
| mango-dried-unsweetened | variant_not_distinguished | SR has dried mango only as "Mango, dried, sweetened" (169091). Foundation has no dried mango. Sweetened is the opposite variant. |
| mango-frozen-unsweetened | no_source_record | No frozen mango in either dataset. Raw mango (169910, Foundation 2710833 and 2710834) is a different state. |
| mango-pureed-unsweetened | no_source_record | No mango purée in either dataset. Mango nectar (167785) and "Babyfood, fruit dessert, mango with tapioca" (171341) are different products. |
| passion-fruit-pulp-pureed-unsweetened | variant_not_distinguished | SR has passion fruit only as "Passion-fruit, (granadilla), purple, raw" (169108, the whole fruit's edible portion) and as purple and yellow juice (169109, 169110). No record documents puréed pulp, and the variety of a commercial pulp is not known. Foundation has no passion fruit (see flagged case 16). |
| pineapple-canned-in-heavy-syrup-drained | variant_not_distinguished | SR has heavy-syrup pineapple only as "solids and liquids" (169944), and extra-heavy syrup the same way (169945). A drained record exists only for juice pack (167767). Including the syrup changes the sugar content, so no record matches the drained heavy-syrup state (see flagged case 17). |

## Deterministic pass outcome

The first two `plan` calls reproduced A1's parent batch id `rb-de5702452450983345068f40` and A2's canonical `rb-c61cabe465685a29a02ff753` (its pass id, `rp-6749592086a40f3177d9f0c4`, equals the A2 import's because the A2 reviewed entries now give it the release `2018-04+2026-10-29`). That shows the selection is deterministic across all three batches. The third `plan` stored 25 queued jobs under `rb-90e0df60cb523abc78291263` / `rp-f18929822a14a3a5f8d740e4`. The release is `unconfigured` because no `--dataset` was given and none of these ids has a match entry.

`run --source fdc-bulk` moved all 25 to `blocked` with `match_not_found` ("Manual match review or entry into source match table required"). The bulk adapter matches only from the reviewed table, which has no A3 entries, and this PR may not edit it. `validate` then reported `Job proposal is missing revisionDraft` for all 25. `coverage` shows 25 blocked out of 1,114 and 0 attempted. The A1 and A2 jobs in this private store were only planned, not run, so they appear as neither blocked nor imported. Coverage reads the store, not the published catalog.

**Skip-published check.** `selectNextBatch` skips ids with jobs in the store, not ids that are already published. This preparation therefore seeded A1 and A2 first and then checked the selection against the published catalog: none of the 25 A3 ids is among the 29 published variant ids, and none has a match-table entry.

The run confirms the CLI's fail-closed gating for the A3 ids. It does not yet show the per-field quality of the proposed records. That waits for the import PR's reviewed table entries.

## Sample review

Five proposed matches across the three categories were checked by hand against the raw pinned record: description, data type, food category, NDB number, scientific name where present, input foods, portion labels, and core-row presence. No nutrient values were copied into this report. Each record was returned by the audit-path reader and is not in the skipped set.

| # | Manifest id | Record | Description / state / form check | Result |
| ---: | --- | --- | --- | --- |
| 1 | chicken-egg-yolk-raw (eggs) | SR 172184 | "Egg, yolk, raw, fresh", Dairy and Egg Products, NDB 1125. Yolk only, raw and fresh, not frozen, sugared, salted, or dried (those siblings are separately qualified). Portions are large and cup. All core rows. | Pass (flagged, case 2) |
| 2 | cornstarch-dry (flours-starches) | SR 169698 | "Cornstarch", Cereal Grains and Pasta, NDB 20027. Dry starch as sold; portion is cup. All core rows. | Pass |
| 3 | banana-ripe-raw (fruits) | Foundation 1105314 | "Bananas, ripe and slightly ripe, raw", Fruits and Fruit Juices, NDB 9040, published 2020-04-01. 16 inputs, ripe and slightly ripe; the overripe record (1105073) is separate. Portions are banana peeled and RACC. All core rows. | Pass (flagged, case 9) |
| 4 | blueberry-frozen-unsweetened (fruits) | SR 173950 | "Blueberries, frozen, unsweetened (Includes foods for USDA's Food Distribution Program)", Fruits and Fruit Juices, NDB 9054. Frozen and unsweetened; not wild. Portions are package (20 oz) and cup, unthawed. All core rows. | Pass |
| 5 | pineapple-canned-in-juice-drained (fruits) | SR 167767 | "Pineapple, canned, juice pack, drained", Fruits and Fruit Juices, NDB 9354. Juice pack and drained, not solids and liquids (169126 is NDB 9268). Portions are cup sliced, spear, cup chunks, and cup crushed. All core rows. | Pass |

Sample result: 5 of 5 pass. The sample does not clear the individually flagged cases below. Reviewer: the batch-preparation agent (Claude), checklist version 1 of the [playbook](population-playbook.md#validation-and-review). The flagged cases go to issue #215 for adjudication before the import PR.

## Flagged cases

Every case that needs reviewer attention is listed individually, for adjudication through issue #215. Cases 1-14 are proposals and cases 15-18 are unresolved.

1. **chicken-egg-whole-raw: Foundation preference against a fuller SR near-duplicate.** Foundation 748967 and SR 171287 share NDB 1123. Both are raw, fresh whole egg (the Foundation inputs say "WHOLE, RAW, FRESH"). Their fat and protein levels are about equal. Foundation is proposed under the preference rule: it has all core rows with the classic energy row and an egg portion, but 95 rows against 134 in SR, and SR has five egg-size portions. Its carbohydrate level is above SR's and its sodium level below (both by more than 5%). For: a complete-core, current Foundation composite. Against: SR is more complete, and Q-010 switched two same-code pairs to SR on coverage.
2. **chicken-egg-yolk-raw: SR chosen because Foundation lacks a core row.** Foundation 748236 "Eggs, Grade A, Large, egg yolk" (NDB 1125, 24 inputs "YOLK, RAW, FRESH") has the same physical identity as SR 172184 but **no sodium row** (46 rows). This is the A2 case 14 pattern (raw egg white), which Q-010 approved. The frozen, sugared, salted, and dried yolk records are rejected.
3. **oat-flour-dry: whole-grain default and a sparse record.** The catalog name is "Oat flour" with no milling stated. Foundation 2261421 is whole-grain oat flour (8 inputs). SR 169741 is "partially debranned", which removes bran. Its fiber level is below the Foundation record's (by more than 5%), consistent with the debranning, so the two are different products. Foundation is proposed. It has all core rows but only 31 rows, Atwater energy only, and a RACC portion. If #215 does not accept whole grain as the default for unqualified oat flour, this becomes `variant_not_distinguished`.
4. **wheat-flour-all-purpose-enriched-dry: bleaching default, and SR over Foundation on enrichment rows.** The catalog id says all-purpose and enriched, not bleached or unbleached. Both datasets have both forms: SR 168894 (bleached, NDB 20081) and 168936 (unbleached, NDB 20581), and Foundation 789890 and 789951 with the same codes. SR 168894 is proposed. Bleached is the original all-purpose food code, but that is a default, not evidence. SR is chosen over Foundation because the Foundation flour records have 24 rows, a RACC portion only, no fiber row, and **no folic acid or folate DFE row** (folate total only). The A2 import already treats Foundation folate as a definition mismatch, so an enriched-flour profile from Foundation would leave the enrichment folate unknown. The Foundation record's protein level is above SR's (by more than 5%). The self-rising (168895), calcium-fortified (169754), unenriched (169761), and industrial-protein records are rejected.
5. **wheat-flour-bread-enriched-dry: SR over Foundation on enrichment rows.** SR 168896 and Foundation 790146 share NDB 20083. Foundation says "unbleached" (5 of its 6 inputs are conventional and 1 organic). SR does not state bleaching. As in case 4, Foundation 790146 has 24 rows and no folic acid or DFE row, so SR is proposed. The Foundation record's protein and sodium levels are above SR's (by more than 5%). The unenriched bread flour (168913) is rejected.
6. **apple-with-skin-raw: variety.** The catalog id names no variety. SR 171688 is the unqualified with-skin apple (NDB 9003). Foundation has five single-variety records (red delicious 1750339, fuji 1750340, gala 1750341, granny smith 1750342, honeycrisp 1750343), each 31 rows and RACC only. The SR variety records (167793, 168201-168204) are also narrower. The generic record is proposed. The reviewer should confirm that an unqualified SR apple is the right base, rather than a single Foundation variety.
7. **applesauce-pureed-unsweetened: added vitamin C default and source choice.** Foundation 2346414 states "unsweetened, with added vitamin C", and all 8 inputs say so. SR 167772 "Applesauce, canned, unsweetened, with added ascorbic acid" is the same food code (NDB 9401). SR 171695 "…without added ascorbic acid" is the unfortified form (NDB 9019). The catalog id does not name fortification. The fortified form is chosen, as for milk in A2 (Q-010 cases 10 and 11), because the current retail sample is fortified. Foundation is proposed under the preference rule. It has all core rows but 31 rows, Atwater energy only, RACC only, and no fiber row, against 83 rows in SR 167772. Its fat, protein, and carbohydrate levels are all above both SR records' (by more than 5%), so the source choice changes core macros. The sweetened records (167773, 171696) are rejected.
8. **avocado-raw: variety.** SR 171705 "all commercial varieties" matches an id with no variety. Foundation 2710824 is Hass only (77 rows, published 2024-10-31, 8 inputs "peeled, pit removed, raw"). Its fat level is above the SR record's (by more than 5%). Hass is the dominant retail avocado, so the reviewer may prefer the Foundation record. It is not proposed, because the catalog does not name the variety. The California (171706) and Florida (171707) records are narrower.
9. **banana-ripe-raw: ripeness composite and source choice.** Foundation 1105314 states "ripe and slightly ripe". Its inputs are half ripe and half slightly ripe. SR 173944 "Bananas, raw" (NDB 9040, the same food code) does not state ripeness. Foundation matches the catalog's "ripe" more literally and is proposed. Its carbohydrate level is about equal to SR's. It has 52 rows against 108. The overripe record (1105073) is a separate stage and has no sodium row.
10. **blueberry-raw: sparse Foundation record.** Foundation 2346411 and SR 171711 share the description "Blueberries, raw" and NDB 9050. Foundation is proposed under the preference rule. It has all core rows but only 26 rows, Atwater energy only, RACC only, and no fiber row. SR has 106 rows, a fiber row, and cup and berry portions. Its carbohydrate level is about equal. The wild (167640) and canned records are different products. This is the closest A3 analogue to the Q-010 tomato paste switch.
11. **lemon-raw: peel state.** SR 167746 says "without peel". The catalog id says only "raw". Neither dataset has a whole lemon with peel, and lemon peel is separate (167749). For: the without-peel record is the edible fruit, and its portions (sections, fruit, wedge) describe eating or cooking use. Against: the catalog id does not state the peel, so this is an inferred attribute. Lemon juice (167747) is already published under `lemon-juice-fresh-ready-to-drink` and is a different record.
12. **mango-raw: variety.** SR 169910 "Mangos, raw" names no variety, which matches the id. Foundation has Tommy Atkins (2710833) and Ataulfo (2710834), each 27 rows and RACC only. The generic SR record is proposed.
13. **pear-european-with-skin-raw: skin not stated.** SR 169118 "Pears, raw" carries the scientific name *Pyrus communis* (European pear), which supports "European". The description does not say "with skin", and there is no without-skin pear in the release to contrast with. The Foundation records are single-variety: Bartlett 746773 (NDB 9412; skin not stated) and green Anjou 2710836 "with skin" (26 rows, RACC only). SR's own variety records (167776-167779) do not state skin either. If #215 does not accept the generic record for "with skin", the Foundation Anjou record states the skin but adds a variety the catalog does not name.
14. **pineapple-raw: sparse Foundation record.** Foundation 2346398 "Pineapple, raw" and SR 169124 "Pineapple, raw, all varieties" share NDB 9266. Foundation is proposed under the preference rule. It has all core rows but 34 rows, Atwater energy only, and RACC only, against 107 rows and five household portions in SR. The SR traditional (168193) and extra sweet (168194) records are narrower.
15. **banana-pureed-unsweetened (unresolved): babyfood proxy.** The only puréed banana is SR 167732 "Babyfood, banana no tapioca, strained" (Baby Foods, 69 rows, jar portions from several brands). For: strained banana with no tapioca is close to plain purée. Against: it is an infant-food formulation, and its description states neither sweetening nor any added ingredient such as ascorbic acid. It is not proposed. The reviewer may accept it as a disclosed proxy, or the id may use a recipe-time derivation from raw banana.
16. **passion-fruit-pulp-pureed-unsweetened (unresolved): raw fruit versus puréed pulp.** SR 169108 "Passion-fruit, (granadilla), purple, raw" (*Passiflora edulis*) describes the edible portion of the whole purple fruit, which is the pulp with seeds. For: the edible portion of passion fruit is its pulp. Against: the catalog state is puréed pulp, which is usually strained and often made from yellow passion fruit. The record documents neither. The purple and yellow juice records (169109, 169110) are different products.
17. **pineapple-canned-in-heavy-syrup-drained (unresolved): packing medium and drained state.** SR 169944 is heavy-syrup pineapple "solids and liquids", which includes the syrup. The only drained canned pineapple is juice pack (167767). Using 169944 would count the syrup's sugar, and using 167767 would use the wrong packing medium. Both are rejected. A drained heavy-syrup profile would need a reviewed derivation or another source.
18. **Unresolved near candidates (not substituted):** dried unsweetened mango → "Mango, dried, sweetened" 169091 (opposite sweetening); frozen unsweetened mango → raw mango 169910 and Foundation 2710833 and 2710834 (different state); puréed mango → mango nectar 167785 and babyfood mango with tapioca 171341 (different products).

## Pipeline gaps

Found while running this batch. This PR changes no code, so all of these are documented and none is built.

1. **New: `suggest` does not match "-y" to "-ies" plurals.** The tokens come from the catalog name, and `tokenHits` matches on prefixes. "blueberry" is not a prefix of "blueberries", and the reverse check fails too. So Foundation `suggest` for all three blueberry ids returned only a crab record, and SR `suggest` missed "Blueberries, raw" (171711), the frozen unsweetened record (173950), and the dried sweetened record (168158). Keyword search found all of them. Plurals in "-s" (bananas, pears) still match by prefix.
2. **Open, still from A2 gap 2: `suggest` truncates relevant records among low-score ties.** SR "Cornstarch" (169698) lost to "corn" ties. "Bananas, raw" (173944), "Pears, raw" (169118), and "Applesauce, canned, unsweetened, without added ascorbic acid" (171695) lost to records with more name-word hits or lower fdcIds. The A3 catalog entries have no aliases, so the tokens are name-only, and "Chicken egg, whole" ranks chicken dishes alongside eggs. Ranking stays a review aid, but ties should prefer category or phrase matches before fdcId.
3. **Open, still from the A2 import (Q-010 Part 1): no skip-published planning.** `selectNextBatch` still skips store jobs, not published ids. This preparation seeded A1 and A2 into a fresh store and checked the selection against the published catalog. Skip-published planning or explicit eligible-id input is still owed before unattended waves.
4. **Open, policy, still from A2 gap 4: sparse Foundation records against fuller SR near-duplicates.** In A3, five proposals face the choice: whole egg (95 against 134 rows), applesauce (31 against 83), banana (52 against 108), raw blueberry (26 against 106), and raw pineapple (34 against 107). Q-010 decided two such pairs case by case (both switched to SR). A standing rule would make later batches more predictable. A3 also adds a related point. Foundation records carry total folate but no folic acid or DFE row, so for enriched or fortified foods the Foundation record cannot express the enrichment folate (cases 4 and 5).
5. **Open, still from A1 (gap 8): `coverage` counts a match-blocked job as blocked but not attempted.** It also reads only the store, so the 29 published profiles do not show as imported in a fresh store.

## Follow-ups: the import PR for this batch

The A3 import PR (`#63-A-3`, under the standing approval, with James's approval recorded in the PR) will contain:

1. Adjudication of the 18 flagged cases through issue #215 **before** any table entry is written. Any proposal that is rejected moves to the unresolved list with its candidate references kept.
2. Reviewed match-table entries for the surviving proposals: `adapter: fdc_bulk`, `dataType`, `fdcId`, `release`, the verbatim `description` from the table above, `stateEvidence`, `rationale`, reviewer handle, `reviewedAt`, and `checklistVersion: 1`. The release and dataType must agree, and the description must be non-empty (the V2 rules).
3. An exact-set plan in a fresh store outside the checkout (never `/tmp`): seed A1 (`rb-de5702452450983345068f40`) and A2 (`rb-c61cabe465685a29a02ff753`), then plan A3 and confirm it reproduces **`rb-90e0df60cb523abc78291263`** with exactly these 25 ids, and that none of them is already published.
4. The deterministic pass: `index` both releases into that store, `run` (one `run` stamps each job with its own match release), `validate`, review packets, approval by content hash, and `stage --write --out <fresh dir>`. `review --verify-source` refuses deterministic bulk proposals by design; the match-table re-check at packet, approval, and staging covers them. Per-field status (resolved, unknown, not checked) and validation counts go in the import report.
5. **The V4 rule, before the import PR opens:** stage the batch with `stageCatalog`, then `combineCatalogs(published, staged)`, then `verifyCatalog(combined)` with 0 defects, then `verifyAppendOnly(published, combined)` with **0 defects**. `added` must equal exactly the A3 imported ids, and `preserved` must equal **29** (all 14 A1 and 15 A2 published profiles). Publish only the combined `{ manifest, files }`, and record its counts and the check output in the import report ([rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches); CLI `catalogIntegrityCli.ts -- --combine <published> <staged>`, then `--previous <published> --next <combined>` on the written files).
6. The 6 unresolved ids remain actionable blocked work. Puréed banana and mango, frozen mango, dried unsweetened mango, puréed passion fruit pulp, and drained heavy-syrup pineapple need a label, a supplemental source, or a reviewed recipe-time derivation.

## Re-run instructions

The store is disposable. Remove `~/workspace/private-data/a3store/` and re-run the commands in [Method](#method), with the store under `~/workspace/private-data/` (not `/tmp`, which is a small tmpfs). `plan` re-derives the same parent batch ids from the same manifest ids: A1's `rb-de5702452450983345068f40`, then A2's `rb-c61cabe465685a29a02ff753`, then A3's `rb-90e0df60cb523abc78291263`. Until the import PR adds A3 table entries, the `run` outcome is identical (25 `match_not_found`), and no approved value can change because none exists. `suggest` reads the pinned files read-only and gives the same candidates for the same pins.
