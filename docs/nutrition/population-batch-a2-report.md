# Population batch A2: dry-run preparation report (#63)

Prepared: 2026-11-11. Base: `main` at `267942f` (PR #218; the V4 integrity suite merged in PR #217 as `d19c454`, and the A1 import merged in PR #216 as `f03d706`, which brought the published catalog to 14 profiles). Authority: James's standing approval of 2026-11-10 for the #63 population waves, and his batch ladder: A1 and one more 25-item batch must pass end to end before the batch size goes up to 50. A2 stays at 25.

This batch is **preparation only**. Nothing was staged, imported, or published. The reviewed [match table](source-match-table.json) is byte-identical to `main` (still the 14 A1 entries). The proposed matches below exist only in this report. No `--live` run, no FDC API key, and no Firestore access. Both write flags in [capabilities.js](../../public/shared/nutrition/capabilities.js) stay false, and nothing under `public/` changed. The report gives public FDC record ids, descriptions, and input-food or portion labels. It gives no nutrient values: wherever a fat or sodium level was used as identity evidence, the report states only how it compares. No dataset file or record dump entered the repository.

Related: [A1 preparation report](population-batch-a1-report.md) · [A1 import report](population-batch-a1-import.md) · [A1 evidence matrix](a1-evidence-matrix.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

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

Wave A, deterministic lane. The eligible set is the priority-1 entries of [ingredient-catalog.json](ingredient-catalog.json) with `kind: generic` and `sourceStrategy: usda-first`, ordered by (priority, category, id). This is the same rule A1 used. There are 225 eligible ids. A1 took positions 1-25 and A2 takes positions 26-50.

The batch was re-derived from the catalog JSON on this branch and **matches the brief's list exactly**, with no discrepancy:

| Category | Ids (count) |
| --- | --- |
| condiments-sauces | tamari-reduced-sodium-as-sold, tamari-regular-as-sold, tomato-paste-no-added-salt-as-sold, tomato-sauce-with-salt-as-sold, vinegar-balsamic-liquid-as-sold, vinegar-champagne-liquid-as-sold, vinegar-rice-seasoned-liquid-as-sold, vinegar-sherry-liquid-as-sold (8) |
| dairy | cheddar-as-sold, goat-cheese-soft-chevre-as-sold, greek-yogurt-plain-2-percent-fat-as-sold, greek-yogurt-plain-5-percent-fat-as-sold, greek-yogurt-plain-nonfat-as-sold, half-and-half-as-sold, heavy-cream-36-percent-fat-as-sold, milk-reduced-fat-2-percent-as-sold, milk-whole-3-25-percent-fat-as-sold, mozzarella-low-moisture-part-skim-as-sold, parmesan-hard-as-sold, yogurt-plain-whole-milk-as-sold (12) |
| eggs | chicken-egg-hard-boiled-cooked-without-added-fat, chicken-egg-poached-cooked-without-added-fat, chicken-egg-scrambled-cooked-without-added-fat, chicken-egg-white-cooked-without-added-fat, chicken-egg-white-raw (5) |

- **Not already covered:** the 14 published profiles and the 14 match-table entries are all A1 ids. None of the A2 ids has a profile or a table entry.
- **The CLI's selection differs by one id.** After the A1 jobs are seeded, `plan --wave A --max 25` returns 24 of these ids plus `coconut-milk-canned-full-fat-as-sold` (category `dairy-alternatives`, `kind: generic`, `sourceStrategy: manufacturer-first`), and it drops `chicken-egg-white-raw`. The CLI's `waveOf` puts every priority-1 non-branded, non-compound entry in wave A, including the one generic/manufacturer-first entry that A1's definition excludes. The list above is authoritative for A2, as the brief directs. Coconut milk stays out of this batch because its catalog note requires a brand and formulation match first. See [Pipeline gaps](#pipeline-gaps) item 1 and [Flagged cases](#flagged-cases) item 18.
- **Parent batch id.** The id the CLI derives, `rb-7136e61a94abc4f865f3f051` (pass `rp-5e17c5f1bb7a7ac197a411e0`), belongs to the CLI's 25-id set, not to the authoritative A2 set. `parentBatchIdFor` hashes the sorted manifest ids, so the two sets get different ids. The plan step therefore does not give an id for A2 itself. The import PR must plan the exact 25 ids, or record the batch with an explicit id list, so that its parent batch id covers this set (see [Follow-ups](#follow-ups-the-import-pr-for-this-batch)). The CLI pass is still reported because 24 of its 25 jobs are A2 ids, and it shows the gate.

## Method

**Datasets.** These are the two pinned bulk releases in [researchConfig.ts](../../scripts/nutrition/researchConfig.ts). The files sit in an operator-local directory outside the checkout. The reader checks each one against its extracted-file sha256 pin on every load.

| Dataset id | Data type | Release | Pin (extracted JSON) |
| --- | --- | --- | --- |
| `foundation` | Foundation | 2026-10-29 | `sha256:990e7731…58a1` |
| `sr-legacy` | SR Legacy | 2018-04 | `sha256:70d4235a…0129` |

**Foundation blocked set.** The audit path skipped the 10 Foundation records with non-numeric nutrient amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). Every Foundation `suggest` call reported `skippedRecords: 10`. None of them was a candidate for any A2 id.

**Commands.** All were run from the repository root through [researchCli.ts](../../scripts/nutrition/researchCli.ts). `<dir>` is the operator-local dataset directory and `<store>` is `~/workspace/private-data/a2store/cli`. The store is outside the checkout and not under `/tmp`.

```sh
# 1. Candidate search, per manifest id and dataset (the audit path; read-only)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- suggest --manifest-id <id> --dataset foundation --file <dir>/FoodData_Central_foundation_food_json_2026-10-29.json --max 25
npx --no-install vite-node scripts/nutrition/researchCli.ts -- suggest --manifest-id <id> --dataset sr-legacy --file <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json --max 25
# 2. Deterministic pass. The first plan seeds the A1 jobs, so the second plan selects the next 25.
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store <store>   # rb-de5702452450983345068f40 (A1, reproduced)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store <store>   # rb-7136e61a94abc4f865f3f051
npx --no-install vite-node scripts/nutrition/researchCli.ts -- run --source fdc-bulk --dataset sr-legacy --batch rb-7136e61a94abc4f865f3f051 --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- validate --batch rb-7136e61a94abc4f865f3f051 --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- coverage --store <store>
```

The `suggest` ranking only orders candidates by word overlap. Where its top 25 was noisy, or missed the obvious record, the same pinned files were also searched read-only by description keyword. That search used an operator-local helper that prints only fdcId, description, food category, NDB number, publication date, portion labels, input-food labels, and nutrient-row counts. It is not committed. Two proposals (tamari-regular and half-and-half) were found only by keyword search, because `suggest` truncated them (see [Pipeline gaps](#pipeline-gaps) item 2).

Every proposal is a manual decision under the consolidated matching policy James adopted on 2026-11-10 (the documented-attributes rubric in the [A1 evidence matrix](a1-evidence-matrix.md)). For each proposal, the report records the attributes that support it, the attributes that contradict it, and the gaps. Candidates were ranked by physical and formulation match first (state, form, fat level, raw/cooked, salt, concentration, fortification) and by nutrient completeness second. Foundation was preferred only where it matched as well as SR Legacy. A cross-type near-duplicate (same NDB number) was never counted as independent confirmation. The absence of a variant qualifier on a record was not treated as proof of the opposite variant. Where a fat or sodium level was read from the pinned record as identity evidence, the report states the comparison only, never the value. Any materially ambiguous identity goes to [Flagged cases](#flagged-cases) for adjudication through issue #215.

**Store.** `~/workspace/private-data/a2store/cli` holds one file, `jobs.json`, with 50 jobs: the 25 A1 jobs reproduced by the seeding plan (queued, not run) and the 25 CLI-batch jobs. No source cache was written: no job reached the fetch step, so no dataset content was copied there. The raw `suggest` outputs are kept beside it in `~/workspace/private-data/a2store/suggest/` and are not committed.

## Aggregate counts

| Measure | Count |
| --- | ---: |
| Ids attempted (identity resolution against both datasets) | 25 |
| Proposed matches | 19 |
| from Foundation 2026-10-29 | 8 |
| from SR Legacy 2018-04 | 11 |
| Proposed matches carrying a flag | 15 |
| Unresolved | 6 |
| Flagged cases (Flagged cases section) | 18 |
| Jobs planned in the store for the CLI batch (24 of them A2 ids) | 25 |
| Jobs that reached a proposal through the CLI | 0 |
| Validated | 0 |
| Validation failures | 25 |
| Approved, staged, imported | 0 |

Validation failure categories:

| Category | Count |
| --- | ---: |
| `Job proposal is missing revisionDraft` (job blocked at match with `match_not_found`, because the reviewed match table has no A2 entries) | 25 |

Unresolved reason categories:

| Category | Count |
| --- | ---: |
| `no_source_record`: neither pinned dataset has the food | 4 |
| `different_product_only`: the closest record is a different product or preparation | 1 |
| `variant_not_distinguished`: the dataset has the food but not the catalog variant | 1 |

Per-field status summary: no job produced a revision, so **0** registry fields resolved, **0** were recorded as unknown, and every stored registry field is **not checked** for all 25 ids. A per-field summary needs the deterministic pass to run on reviewed match-table entries in the import PR.

## Proposed matches

These are proposals only, for entry into the reviewed match table in the import PR. They were not written to [source-match-table.json](source-match-table.json). Each listed record was returned by the audit-path reader and is not in the skipped set. Descriptions are verbatim. A ⚑ marks a proposal with a flagged case.

| Manifest id | Dataset | FDC id | Verbatim description | Supporting attributes | Contradictions | Gaps |
| --- | --- | --- | --- | --- | --- | --- |
| tamari-regular-as-sold ⚑ | sr-legacy | 174278 | Soy sauce made from soy (tamari) | Tamari type stated (soy only, no wheat). Unqualified for sodium, while every reduced form in the release is qualified. Its sodium level is in the same class as regular shoyu 174277 and well above low-sodium shoyu 172473. | None | The release has no reduced-sodium tamari to contrast with, so "regular" rests on the sodium class, not on a sibling. |
| tomato-paste-no-added-salt-as-sold ⚑ | foundation | 2685580 | Tomato, paste, canned, without salt added | Paste form and no-salt state stated. Canned. The input foods are the same food. | None | Sparse record (25 nutrient rows, RACC portion only; core macros, sodium, and Atwater energy present). 1 of 8 inputs is "double- concentrated". SR 170459 is the same food code (NDB 11546). |
| tomato-sauce-with-salt-as-sold ⚑ | foundation | 2685579 | Tomato, sauce, canned, with salt added | Sauce form and "with salt added" stated. Canned. | None | Sparse record (25 rows, RACC only). The SR alternative 170054 "Tomato products, canned, sauce" does not state its salt. |
| vinegar-balsamic-liquid-as-sold | sr-legacy | 172241 | Vinegar, balsamic | Exact product. The only balsamic record in either dataset. Portions are tbsp, tsp, and cup. | None | 28 nutrient rows; core rows present. |
| cheddar-as-sold ⚑ | foundation | 328637 | Cheese, cheddar | Natural cheddar. Inputs are 47 retail samples of mild and sharp cheddar in slice, shred, and block forms, from national and store brands. Not reduced fat, low sodium, or processed. | None | Composite of branded inputs. SR 173414 is the same food code (NDB 1009). |
| goat-cheese-soft-chevre-as-sold ⚑ | sr-legacy | 173435 | Cheese, goat, soft type | Goat milk cheese, soft type. Chèvre is soft fresh goat cheese. | None | "Chevre" is not in the description. Semisoft and hard siblings exist. |
| greek-yogurt-plain-2-percent-fat-as-sold ⚑ | sr-legacy | 170903 | Yogurt, Greek, plain, lowfat | Greek, plain. Its fat level is consistent with the 2% band. | "lowfat" is a range label, not "2%". | The 2% band is inferred from the reported fat level. The only "2% fat" Greek records are flavored CHOBANI products. |
| greek-yogurt-plain-5-percent-fat-as-sold ⚑ | sr-legacy | 171304 | Yogurt, Greek, plain, whole milk | Greek, plain, whole milk. Its fat level sits at the 5% band. | None in this record. Foundation 2259794 (same food code) reports a fat level below the 5% band. | "5%" is inferred from the reported fat level. No portions (grams only). |
| greek-yogurt-plain-nonfat-as-sold ⚑ | foundation | 330137 | Yogurt, Greek, plain, nonfat | Greek, plain, nonfat stated. Inputs are FAGE, CHOBANI, and DANNON OIKOS plain nonfat. | None | Composite of branded inputs. SR 170894 is the same food code (NDB 1256). |
| half-and-half-as-sold | sr-legacy | 171255 | Cream, fluid, half and half | Exact product. The lowfat (171308) and fat-free (172212) siblings are explicitly qualified. Portions are tbsp, cup, individual container, and fl oz. | None | No Foundation record. |
| heavy-cream-36-percent-fat-as-sold ⚑ | sr-legacy | 170859 | Cream, fluid, heavy whipping | Heavy (whipping) cream. Its fat level sits at the 36% band. Complete record. Portions are cup, tbsp, and fl oz. | None in this record. | Foundation 2346386 "Cream, heavy" (same food code, NDB 1053) has a fat level just below 36% and only 36 rows. |
| milk-reduced-fat-2-percent-as-sold ⚑ | foundation | 746778 | Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D | Reduced fat, fluid, and 2% milkfat stated. Inputs are generic "MILK, 2%" retail samples. | None | Fortification is not in the catalog id. The fortified form is chosen; the unfortified SR 172205 is rejected. |
| milk-whole-3-25-percent-fat-as-sold ⚑ | foundation | 746782 | Milk, whole, 3.25% milkfat, with added vitamin D | Whole and 3.25% milkfat stated. Inputs are generic "MILK, WHOLE" retail samples. | None | Fortification is not in the catalog id. The unfortified SR 172217 is rejected. |
| mozzarella-low-moisture-part-skim-as-sold ⚑ | foundation | 329370 | Cheese, mozzarella, low moisture, part-skim | Low moisture and part-skim stated. Inputs are low-moisture part-skim mozzarella and string cheese of the same type. | None | Composite of branded inputs, including string cheese. SR 171244 is the same food code (NDB 1029). |
| parmesan-hard-as-sold | sr-legacy | 170848 | Cheese, parmesan, hard | Exact form (hard). The grated, shredded, low-sodium, and reduced-fat records are separately qualified. Portions are cubic inch, package, and oz. | None | Foundation has grated parmesan only (325036, 2259795), which is a different form. |
| yogurt-plain-whole-milk-as-sold ⚑ | foundation | 2259793 | Yogurt, plain, whole milk | Plain, whole milk, not Greek. Inputs are generic "Yogurt, whole milk, plain". | None | 48 rows, RACC only (Atwater energy). SR 171284 is the same food code (NDB 1116). |
| chicken-egg-hard-boiled-cooked-without-added-fat | sr-legacy | 173424 | Egg, whole, cooked, hard-boiled | Whole egg, cooked in the shell, so no fat is added. Portions are tbsp, chopped cup, and large egg. | None | No Foundation cooked-egg record. |
| chicken-egg-poached-cooked-without-added-fat ⚑ | sr-legacy | 172186 | Egg, whole, cooked, poached | Whole egg, poached. Its fat level matches raw whole egg 171287, so no fat was added. | None for fat. | Its sodium level is well above raw whole egg, which suggests salted poaching water. The catalog state constrains fat, not salt. |
| chicken-egg-white-raw ⚑ | sr-legacy | 172183 | Egg, white, raw, fresh | Raw and fresh stated. Complete record. Portions are cup and large egg. | None | Foundation 747997 (same food code, NDB 1124; its inputs are labeled raw and fresh) has no sodium row and 29 rows in total. |

No proposal shares an FDC record with another manifest id, so no `sharedJustification` is needed.

## Unresolved

| Manifest id | Category | Reason |
| --- | --- | --- |
| tamari-reduced-sodium-as-sold | variant_not_distinguished | SR has tamari (174278) only at regular sodium, and Foundation has no tamari. The reduced-sodium records are shoyu (172473) and hydrolyzed vegetable protein sauce (172474). Both are different products and are not substituted. |
| vinegar-champagne-liquid-as-sold | no_source_record | No champagne vinegar in either dataset. SR has distilled (172237), red wine (172240), balsamic (172241), and cider (173469) vinegar, and Foundation has none. Red wine vinegar is a different product. |
| vinegar-rice-seasoned-liquid-as-sold | no_source_record | No rice vinegar, seasoned or plain, in either dataset. Seasoned rice vinegar contains added sugar and salt, so no other vinegar can stand in for it. |
| vinegar-sherry-liquid-as-sold | no_source_record | No sherry vinegar in either dataset (the same SR vinegar set as above). |
| chicken-egg-scrambled-cooked-without-added-fat | different_product_only | SR 172187 "Egg, whole, cooked, scrambled" has a fat level above raw whole egg (171287) and above the poached egg (172186), with more carbohydrate and less protein. That pattern points to added milk and fat, which contradicts "without added fat". "Eggs, scrambled, frozen mixture" (169904) and "Fast foods, egg, scrambled" (173272) are different products. Foundation has no cooked egg. |
| chicken-egg-white-cooked-without-added-fat | no_source_record | Neither dataset has a cooked egg white. The raw (172183, Foundation 747997), frozen pasteurized (172203, 323697), and dried egg white records are different states. |

## Deterministic pass outcome

The first `plan` reproduced A1's parent batch id `rb-de5702452450983345068f40`, which shows the selection is deterministic. The second `plan` stored 25 queued jobs under `rb-7136e61a94abc4f865f3f051` / `rp-5e17c5f1bb7a7ac197a411e0`. The release is `unconfigured` because no `--dataset` was given and none of these ids has a match entry. `run --source fdc-bulk` moved all 25 to `blocked` with `match_not_found` ("Manual match review or entry into source match table required"). The bulk adapter matches only from the reviewed table, which has no A2 entries, and this PR may not edit it. `validate` then reported `Job proposal is missing revisionDraft` for all 25. `coverage` shows 25 blocked out of 1,114 and 0 attempted. The A1 jobs in this private store were only planned, not run, so they appear as neither blocked nor imported. Coverage reads the store, not the published catalog.

The run confirms the CLI's fail-closed gating for the A2 ids under the post-V2 pipeline. It does not yet show the per-field quality of the proposed records. That waits for the import PR's reviewed table entries.

## Sample review

Five proposed matches across the three categories were checked by hand against the raw pinned record: description, data type, food category, NDB number, input foods, and portion labels. No nutrient values were copied into this report. Each record was returned by the audit-path reader and is not in the skipped set.

| # | Manifest id | Record | Description / state / form check | Result |
| ---: | --- | --- | --- | --- |
| 1 | tamari-regular-as-sold (condiments-sauces) | SR 174278 | "Soy sauce made from soy (tamari)", Legumes and Legume Products, NDB 16124. Tamari type, not shoyu or HVP; portions are tsp and tbsp; sodium in the regular class (comparison only). | Pass (flagged, case 1) |
| 2 | vinegar-balsamic-liquid-as-sold (condiments-sauces) | SR 172241 | "Vinegar, balsamic", Spices and Herbs, NDB 2069. Liquid as sold; portions are tbsp, tsp, and cup. | Pass |
| 3 | cheddar-as-sold (dairy) | Foundation 328637 | "Cheese, cheddar", Dairy and Egg Products, NDB 1009, published 2019-04-01. Its inputs are natural mild and sharp cheddar in slice, shred, and block forms, with no processed, reduced-fat, or low-sodium inputs. Portions are slice, shredded cup, and RACC. | Pass (flagged, case 4) |
| 4 | parmesan-hard-as-sold (dairy) | SR 170848 | "Cheese, parmesan, hard", Dairy and Egg Products, NDB 1033. Hard form, not grated or shredded; portions are cubic inch, package, and oz. | Pass |
| 5 | chicken-egg-hard-boiled-cooked-without-added-fat (eggs) | SR 173424 | "Egg, whole, cooked, hard-boiled", Dairy and Egg Products, NDB 1129. Whole egg cooked in the shell, so no added fat; portions are tbsp, chopped cup, and large egg. | Pass |

Sample result: 5 of 5 pass. The sample does not clear the individually flagged cases below. Reviewer: the batch-preparation agent (Claude), checklist version 1 of the [playbook](population-playbook.md#validation-and-review). The flagged cases go to issue #215 for adjudication before the import PR.

## Flagged cases

Every case that needs reviewer attention is listed individually, for adjudication through issue #215. Cases 1-15 are proposals and cases 16-18 are unresolved or batch-level.

1. **tamari-regular-as-sold: sodium class inferred.** SR 174278 is the only tamari record. The release qualifies reduced sodium explicitly only for shoyu (172473) and HVP sauce (172474). With no reduced-sodium tamari sibling, "regular" rests on the record's sodium level, which is in the same class as regular shoyu 174277 (approved for A1) and well above low-sodium shoyu. For: the same evidence pattern as the A1 soy sauce entry. Against: no sibling contrast.
2. **tomato-paste-no-added-salt-as-sold: Foundation preference against a sparse record.** Foundation 2685580 and SR 170459 ("Tomato products, canned, paste, without salt added (Includes foods for USDA's Food Distribution Program)") match equally and share NDB 11546. They are a cross-type near-duplicate, not independent confirmation. Foundation is proposed under the preference rule. It has core macros, sodium, and Atwater energy, but only 25 nutrient rows and a RACC portion, against 102 rows and full portions in SR. One of its 8 inputs is "double- concentrated" paste, which bears on concentration. The reviewer should choose Foundation or SR (the ANSWER Q-002 precedent switched a hollow Foundation record to SR, but that record lacked core macros, which this one does not).
3. **tomato-sauce-with-salt-as-sold: salt state explicit in only one dataset.** Foundation 2685579 states "with salt added". SR 170054 "Tomato products, canned, sauce" is unqualified, and its sibling 169074 says "no salt added". Under the rubric, an unqualified sibling is not proof of salted, so Foundation is proposed on explicit wording. It is a sparse record (25 rows, RACC only).
4. **cheddar-as-sold: branded-looking Foundation composite.** The inputs are 47 retail samples (CRACKER BARREL, SARGENTO, TILLAMOOK, KRAFT, CABOT, and several store brands), mild and sharp, sliced, shredded, and block. This is a broad national market sample, unlike the two-brand chunky salsa composite in A1, but the reviewer should confirm that it generalizes to generic cheddar. SR 173414 (NDB 1009) is a cross-type near-duplicate. SR 170899 ("sharp, sliced") is narrower and is rejected. Reduced-fat, nonfat, low-sodium, processed, and imitation records are rejected.
5. **mozzarella-low-moisture-part-skim-as-sold: composite includes string cheese.** The inputs to Foundation 329370 are low-moisture part-skim mozzarella and string cheese described as low-moisture part-skim mozzarella (FRIGO, SARGENTO, KRAFT, BORDEN, store brands). SR 171244 (NDB 1029) is a cross-type near-duplicate. SR 170900 (shredded) is rejected. The whole-milk (170846) and non-low-moisture part-skim (170847) records are different variants.
6. **greek-yogurt-plain-nonfat-as-sold: branded composite.** The inputs to Foundation 330137 are FAGE, CHOBANI, and DANNON OIKOS plain nonfat. SR 170894 (NDB 1256) is a cross-type near-duplicate. SR 171312 (CHOBANI, branded) is rejected.
7. **greek-yogurt-plain-2-percent-fat-as-sold: fat band inferred.** SR 170903 says "lowfat", not "2%". Its reported fat level is consistent with the 2% band, but "lowfat" is a range label. Every "2% fat" Greek record in SR is a flavored CHOBANI product (for example 170864 apricot and 172199 mango) and is rejected. If the reviewer does not accept a fat level as band evidence, this moves to `variant_not_distinguished`.
8. **greek-yogurt-plain-5-percent-fat-as-sold: fat band inferred, and the datasets disagree.** SR 171304 and Foundation 2259794 share the description "Yogurt, Greek, plain, whole milk" and NDB 1293. SR's fat level sits at the 5% band. Foundation's is below it, so Foundation does not match as well and SR is proposed despite the Foundation preference. SR 171304 has no portion rows (grams only). SR 171309 (CHOBANI whole plain) is branded and is rejected. As in case 7, if a fat level is not accepted as band evidence, this becomes `variant_not_distinguished`.
9. **heavy-cream-36-percent-fat-as-sold: SR chosen over Foundation on fat band and completeness.** SR 170859 "Cream, fluid, heavy whipping" and Foundation 2346386 "Cream, heavy" share NDB 1053. SR's fat level sits at the 36% band and the record is complete. Foundation's fat level is just below 36% and it has 36 rows. The catalog name says "heavy cream". The SR record says "heavy whipping", which is the same commercial class. The light whipping (170858) and light (170857) creams are rejected.
10. **milk-reduced-fat-2-percent-as-sold: fortification inferred.** The catalog id does not name fortification. Foundation 746778 states "with added vitamin A and vitamin D", the usual retail form. SR 171267 is its cross-type near-duplicate (NDB 1079). The unfortified (172205), nonfat-solids (170870, 172193), and protein-fortified (170871) 2% records are rejected.
11. **milk-whole-3-25-percent-fat-as-sold: fortification inferred.** Foundation 746782 states "with added vitamin D". SR 171265 is its cross-type near-duplicate (NDB 1077). The unfortified SR 172217 and producer milk 171266 (3.7%) are rejected.
12. **yogurt-plain-whole-milk-as-sold: cross-type near-duplicate and a sparse Foundation record.** Foundation 2259793 and SR 171284 share NDB 1116. Foundation is proposed under the preference rule. It has 48 rows with Atwater energy and a RACC portion only. The Greek (171304, 2259794) and fruit-flavored records are different products.
13. **chicken-egg-poached-cooked-without-added-fat: salt.** SR 172186 has the same fat level as raw whole egg, so no fat was added. Its sodium level is well above raw, which suggests salted poaching water. The catalog state says only "without added fat". The reviewer should decide whether salted poaching is acceptable for this id.
14. **chicken-egg-white-raw: SR chosen over an equal Foundation match on completeness.** The inputs to Foundation 747997 ("Eggs, Grade A, Large, egg white") are labeled raw and fresh, and it shares NDB 1124 with SR 172183. That makes the physical match equal. Foundation has no sodium row (29 rows in total), while SR 172183 is complete and states "raw, fresh" in the description. SR is proposed on completeness. The frozen pasteurized (172203, 323697) and dried records are rejected.
15. **goat-cheese-soft-chevre-as-sold: naming.** SR 173435 "Cheese, goat, soft type" does not say "chevre". It is the soft-type sibling of semisoft (173433) and hard (172197) goat cheese. Soft fresh goat cheese is what "chevre" means in US retail.
16. **chicken-egg-scrambled-cooked-without-added-fat (unresolved): preparation contradiction.** The only generic record, SR 172187, shows added milk and fat (fat level above raw and poached egg). It is rejected rather than used as a proxy. A no-added-fat scrambled egg needs a recipe-time derivation from raw whole egg or another source.
17. **Unresolved near candidates (not substituted):** reduced-sodium tamari → shoyu low sodium 172473 and HVP reduced sodium 172474; champagne and sherry vinegar → red wine vinegar 172240 and distilled vinegar 172237; seasoned rice vinegar → none; cooked egg white → raw egg white 172183 and Foundation 747997.
18. **Batch-level: CLI selection discrepancy.** `plan --wave A` selects coconut-milk-canned-full-fat-as-sold (generic, manufacturer-first) in place of chicken-egg-white-raw. This report follows the brief's authoritative list. The reviewer should confirm that coconut milk stays out of the usda-first lane, as A1's definition and its catalog note imply.

## Pipeline gaps

Found while running this batch. This PR changes no code, so all of these are documented and none is built.

1. **Open: `plan --wave A` does not match the documented eligible set.** `waveOf` assigns wave A to every priority-1 entry that is not branded and not compound-reference. That includes the generic/manufacturer-first coconut milk, which A1 and A2 exclude. `plan` also does not skip ids that already have published profiles. It only skips ids with jobs in the given store, so an empty store re-plans A1. The import PR, or a small follow-up, should add an explicit id-list or `--after`-style selection, or filter `sourceStrategy: usda-first` for the deterministic lane, so that the parent batch id covers exactly the reviewed set.
2. **Open: `suggest` truncates relevant records among low-score ties.** For tamari-regular, "Soy sauce made from soy (tamari)" (174278) did not make the top 25: the noise words "regular" and "tamari" (which also matches "Tamarinds") produced many score-1 ties, and the cap keeps the lowest fdcIds. For half-and-half, "Cream, fluid, half and half" (171255) lost to pork "rump half" records. Keyword search found both. Ranking stays a review aid, but ties should prefer category or phrase matches before fdcId.
3. **Open, still from A1 (gap 8): `coverage` counts a match-blocked job as blocked but not attempted.** It also reads only the store, so the 14 published A1 profiles do not show as imported in a fresh store.
4. **Open, policy: Foundation preference against sparse Foundation records.** Several A2 Foundation candidates have core macros but far fewer rows than their SR counterparts (25-48 against 90-135). ANSWER Q-002 covered a Foundation record that lacked core macros. The tomato paste, tomato sauce, and whole-milk yogurt proposals need a decision on whether a sparse but core-complete Foundation record still wins on preference (cases 2, 3, and 12).

## Follow-ups: the import PR for this batch

**Status (2026-11-11):** the import ran; see the [A2 import report](population-batch-a2-import.md). Issue #215 ANSWER Q-010 adjudicated the 18 flagged cases: 11 flagged proposals approved, with tomato paste switched to SR 170459 and plain whole-milk yogurt to SR 171284; 4 flagged proposals held (tamari-regular, Greek 2% and 5%, chèvre); and the 6 existing unresolved ids upheld. The 4 unflagged proposals passed the routine pinned-source checks. Final outcome: 15 reviewed entries, 15 profiles validated, approved, staged, and imported (catalog 14 to 29; V4 combine and append-only checks: 0 defects, preserved 14), 0 rejected at import, 10 unresolved. The plan below is kept for the record.

The A2 import PR (`#63-A-2`, under the standing approval, with James's approval recorded in the PR) will contain:

1. Adjudication of the 18 flagged cases through issue #215 **before** any table entry is written. Any proposal that is rejected moves to the unresolved list with its candidate references kept.
2. Reviewed match-table entries for the surviving proposals: `adapter: fdc_bulk`, `dataType`, `fdcId`, `release`, the verbatim `description` from the table above, `stateEvidence`, `rationale`, reviewer handle, `reviewedAt`, and `checklistVersion: 1`. The release and dataType must agree, and the description must be non-empty (the V2 rules).
3. A plan whose parent batch id covers exactly the A2 ids (see gap 1). If that needs a code change, it goes in a separate PR first, or the import report records the CLI id and the id list explicitly.
4. The deterministic pass: `index` both releases into a store outside the checkout (never `/tmp`), `run` (one `run` stamps each job with its own match release), `validate`, `review --verify-source`, approval by content hash, and `stage --write --out <fresh dir>`. Per-field status (resolved, unknown, not checked) and validation counts go in the import report.
5. **The V4 rule, before the import PR opens:** stage the batch with `stageCatalog`, then `combineCatalogs(published, staged)`, then `verifyCatalog(combined)` with 0 defects, then `verifyAppendOnly(published, combined)` with **0 defects**. `added` must equal exactly the A2 imported ids, and `preserved` must equal 14 (the published A1 profiles). Publish only the combined `{ manifest, files }`, and record its counts and the check output in the import report ([rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches); CLI `catalogIntegrityCli.ts -- --combine <published> <staged>`, then `--previous <published> --next <combined>` on the written files).
6. The 6 unresolved ids remain actionable blocked work. Champagne, sherry, and seasoned rice vinegar, and reduced-sodium tamari, need a label or supplemental source. Cooked egg white and no-added-fat scrambled egg need a reviewed recipe-time derivation from the raw record or another source.

## Historical preparation re-run instructions (superseded)

**Do not use this section to rerun the reviewed A2 import.** It describes the earlier pre-adjudication dry run and old planner selection. The former CLI parent `rb-7136e61a94abc4f865f3f051` is retired and must not be reused. PR #220 corrected the A2 exact-set parent to `rb-c61cabe465685a29a02ff753`; PR #222 adds 15 reviewed source matches, so replaying the current pipeline no longer produces 25 `match_not_found` outcomes. Follow the [A2 import report's re-run instructions](population-batch-a2-import.md#re-run-instructions) instead. The original instructions below are retained only as historical evidence.

The store and outputs are disposable. Remove `~/workspace/private-data/a2store/` and re-run the commands in [Method](#method), with the store under `~/workspace/private-data/` (not `/tmp`, which is a small tmpfs). `plan` re-derives the same parent batch ids from the same manifest ids: A1's `rb-de5702452450983345068f40` first, then the CLI's `rb-7136e61a94abc4f865f3f051`. Until the import PR adds A2 table entries, the `run` outcome is identical (25 `match_not_found`), and no approved value can change because none exists.
