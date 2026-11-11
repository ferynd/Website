# A2 identity evidence matrix (issue #215, Q-009 gate 1)

Purpose: give per-case attribute evidence for the 18 flagged cases in the [A2 preparation report](population-batch-a2-report.md#flagged-cases), so that issue #215 can adjudicate them on documented record evidence before the A2 import PR. ANSWER Q-009 approved the preparation report only and made this adjudication gate 1.

**This matrix approves nothing.** Adjudication happens in issue #215. This PR writes no match-table entry: [source-match-table.json](source-match-table.json) is byte-identical to `main` (the 14 A1 entries). Nothing was staged, imported, or published, and both write flags stay false.

Related: [A2 preparation report](population-batch-a2-report.md) · [A1 evidence matrix](a1-evidence-matrix.md) (rubric and format) · [research pipeline](research-pipeline.md) · [population playbook](population-playbook.md)

## Sources and method

- **Evidence comes only from the two pinned bulk files**: Foundation 2026-10-29 and SR Legacy 2018-04, each checked against its extracted-file SHA-256 pin in [researchConfig.ts](../../scripts/nutrition/researchConfig.ts) (`sha256:990e7731…58a1` and `sha256:70d4235a…0129`; both matched). They were read by a read-only helper kept outside the checkout under `~/workspace/private-data/a2evidence/`. That helper is not committed. Catalog wording comes from the public [ingredient-catalog.json](ingredient-catalog.json). No external source is cited.
- **What a case records**: the verbatim description, the data type and release, the food category, the NDB number, Foundation input-food labels (counts by label), portion labels, and the relevant sibling records and how they contrast with the candidate.
- **Coverage** means usable nutrient coverage. It is given as the nutrient row count and whether the five core rows are present: energy, protein, carbohydrate, total fat, and sodium. Energy counts as present when the record has either the classic kcal row (208) or an Atwater energy row (957/958). [fdcNutrientMap.js](../../public/shared/nutrition/research/fdcNutrientMap.js) maps both to `calories`.
- **No nutrient values appear in this document.** Where a fat or sodium level bears on a case, only the comparison is stated: "about equal" means within 5% of the reference, and otherwise the level is described as above or below it, or inside or outside a band. Under ANSWER Q-009 a fat or sodium comparison, and an unqualified title, never count as independent proof of identity. They are recorded as consistent or inconsistent evidence only.
- **Rubric**: the consolidated documented-attributes rubric from the [A1 evidence matrix](a1-evidence-matrix.md).
  - **SUPPORTED**: the material identity attributes are supported by the record's own wording, its inputs, or the release's naming, and nothing contradicts them.
  - **CONTRADICTED**: a material attribute of the candidate conflicts with the catalog id.
  - **GAP**: the evidence is insufficient to establish a material attribute.
  - A missing variant qualifier on a sibling is not proof of the opposite variant. Two records in different data types that share an NDB number are a cross-type near-duplicate, not independent confirmation of each other.
- **Two questions are kept apart.** For the Foundation-vs-SR cases, the verdict covers the food identity of the proposed record. The choice between the two candidates appears separately under "Coverage", because Pipeline gap 4 (sparse Foundation preference) is a policy decision for #215.

## Coverage comparison (Foundation vs SR candidates)

| Case | Manifest id | Candidate | Rows | Energy | Protein | Carbs | Fat | Sodium | Portion labels |
| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| 2 | tomato-paste-no-added-salt-as-sold | Foundation 2685580 (proposed) | 25 | Y (Atwater only) | Y | Y | Y | Y | RACC |
| 2 | | SR 170459 | 102 | Y | Y | Y | Y | Y | can (6 oz); tbsp; cup (two entries) |
| 3 | tomato-sauce-with-salt-as-sold | Foundation 2685579 (proposed) | 25 | Y (Atwater only) | Y | Y | Y | Y | RACC |
| 3 | | SR 170054 | 102 | Y | Y | Y | Y | Y | cup |
| 4 | cheddar-as-sold | Foundation 328637 (proposed) | 105 | Y | Y | Y | Y | Y | slice; shredded cup; RACC |
| 4 | | SR 173414 | 132 | Y | Y | Y | Y | Y | cup, melted; slice (1 oz); cup, shredded; oz; cubic inch; cup, diced |
| 5 | mozzarella-low-moisture-part-skim-as-sold | Foundation 329370 (proposed) | 112 | Y | Y | Y | Y | Y | cup; RACC |
| 5 | | SR 171244 | 125 | Y | Y | Y | Y | Y | oz; cup, diced; slice (1 oz); cubic inch; cup, shredded |
| 6 | greek-yogurt-plain-nonfat-as-sold | Foundation 330137 (proposed) | 134 | Y | Y | Y | Y | Y | container; RACC |
| 6 | | SR 170894 | 118 | Y | Y | Y | Y | Y | container |
| 8 | greek-yogurt-plain-5-percent-fat-as-sold | SR 171304 (proposed) | 100 | Y | Y | Y | Y | Y | none (grams only) |
| 8 | | Foundation 2259794 | 48 (1 row without amount) | Y (Atwater only) | Y | Y | Y | Y | RACC |
| 9 | heavy-cream-36-percent-fat-as-sold | SR 170859 (proposed) | 134 | Y | Y | Y | Y | Y | cup, whipped; cup, fluid (yields 2 cups whipped); tbsp; fl oz |
| 9 | | Foundation 2346386 | 36 (1 row without amount) | Y (Atwater only) | Y | Y | Y | Y | RACC |
| 10 | milk-reduced-fat-2-percent-as-sold | Foundation 746778 (proposed) | 157 | Y | Y | Y | Y | Y | cup |
| 10 | | SR 171267 | 128 | Y | Y | Y | Y | Y | quart; cup; fl oz |
| 11 | milk-whole-3-25-percent-fat-as-sold | Foundation 746782 (proposed) | 157 | Y | Y | Y | Y | Y | cup |
| 11 | | SR 171265 | 113 | Y | Y | Y | Y | Y | fl oz; cup; tbsp; quart |
| 12 | yogurt-plain-whole-milk-as-sold | Foundation 2259793 (proposed) | 48 (1 row without amount) | Y (Atwater only) | Y | Y | Y | Y | RACC |
| 12 | | SR 171284 | 91 | Y | Y | Y | Y | Y | container (8 oz); container (6 oz); container (4 oz); cup (8 fl oz) |
| 14 | chicken-egg-white-raw | SR 172183 (proposed) | 97 | Y | Y | Y | Y | Y | cup; large |
| 14 | | Foundation 747997 | 29 | Y | Y | Y | Y | **N** | white egg; RACC |

"1 row without amount": each of these three Foundation records (2346386, 2259794, 2259793) has a vitamin A (333) row with no `amount` field. That is a missing value in a non-core row, not a non-numeric amount. None of the three is in the 10-record skipped set.

## Proposals (cases 1-15)

### 1. tamari-regular-as-sold -> SR 174278 "Soy sauce made from soy (tamari)"
- Record: SR Legacy 2018-04, Legumes and Legume Products, NDB 16124. Portions are tsp and tbsp. 90 rows, all core rows present.
- Type: tamari (soy, no wheat) is stated, and it is the only tamari record in either dataset (a keyword search for "tamari" also returns only tamarind records). Foundation has no tamari.
- Sodium class: the record is unqualified. Its sodium level is about equal to regular shoyu 174277 and above low-sodium shoyu 172473. The release qualifies reduced-sodium soy sauces explicitly (172473 "shoyu, low sodium"; 172474 "reduced sodium, made from hydrolyzed vegetable protein"), but both are shoyu or HVP, not tamari. There is no tamari sibling to contrast with.
- Contradictions: none.
- Gap: "regular" rests on the unqualified title and the sodium class. Under ANSWER Q-009, neither is independent proof. The A1 soy sauce entry rested on the same kind of evidence but had a same-type (shoyu) qualified sibling. Tamari does not.
- **Verdict: GAP.** The evidence is consistent and nothing contradicts it, but there is no independent proof of the sodium variant. #215 may extend the A1 soy sauce precedent or hold this case.

### 2. tomato-paste-no-added-salt-as-sold -> Foundation 2685580 "Tomato, paste, canned, without salt added"
- Record: Foundation 2026-10-29, Vegetables and Vegetable Products, NDB 11546, published 2024-04-18. Inputs (8): "tomato, paste, canned, without salt added" x7 and "tomato, paste, canned, double- concentrated, without salt added" x1.
- Alternative: SR 170459 "Tomato products, canned, paste, without salt added (Includes foods for USDA's Food Distribution Program)", NDB 11546. This is a cross-type near-duplicate, so it does not independently confirm the Foundation record. Their sodium levels are about equal.
- Identity: both records state the paste form, canned, and no added salt. One of the 8 Foundation inputs is double-concentrated, so the Foundation composite is not purely single-strength paste. SR does not describe its inputs.
- Coverage: Foundation has 25 rows, all core rows (energy from Atwater rows only), and a RACC portion only. SR has 102 rows, all core rows, and household portions. Both are usable. SR is much more complete.
- **Verdict: SUPPORTED** (identity, for both candidates). The source choice is a #215 policy decision (Pipeline gap 4). The physical identity does not favor Foundation, and the double-concentrated input slightly favors SR.

### 3. tomato-sauce-with-salt-as-sold -> Foundation 2685579 "Tomato, sauce, canned, with salt added"
- Record: Foundation 2026-10-29, Vegetables and Vegetable Products, NDB 100342, published 2024-04-18. Inputs (8): "tomato, sauce, canned, with salt added" x8.
- Alternative: SR 170054 "Tomato products, canned, sauce", NDB 11549. **This is a different NDB from the Foundation record, so the two are not a near-duplicate pair.** Its sibling 169074 "Tomato sauce, canned, no salt added" (NDB 43217) is qualified. SR 170054's sodium level is far above 169074's and in the same class as the Foundation record (slightly above it). That is consistent with salted sauce, but the description does not state salt, and under Q-009 a sodium comparison is not proof.
- Identity: Foundation states "with salt added" in both the description and all 8 inputs. SR leaves salt unstated.
- Coverage: Foundation has 25 rows, all core rows (energy from Atwater rows only), and a RACC portion only. SR has 102 rows, all core rows, and a cup portion.
- **Verdict: SUPPORTED** for Foundation 2685579 on explicit wording. SR 170054's salt state is a GAP (sodium class only). A switch to SR for coverage would rest on that inference.

### 4. cheddar-as-sold -> Foundation 328637 "Cheese, cheddar"
- Record: Foundation 2026-10-29, Dairy and Egg Products, NDB 1009, published 2019-04-01. 47 inputs, all natural cheddar: sliced, shredded, and block/chunk; mild, medium, and sharp. Brands include CRACKER BARREL, SARGENTO, TILLAMOOK, KRAFT, CABOT, and store brands (KROGER, GREAT VALUE, LUCERNE, PUBLIX, and others), sampled across many states. No input is processed, reduced-fat, low-sodium, or imitation.
- Siblings: SR 173414 "Cheese, cheddar (Includes foods for USDA's Food Distribution Program)" (NDB 1009) is a cross-type near-duplicate, and its fat level is about equal. SR 170899 "Cheese, cheddar, sharp, sliced" (NDB 1270) is a narrower sharp-only variant.
- Generalization: unlike the two-brand chunky salsa composite in A1 (which was a GAP), this is a broad national retail sample of the generic food across forms and sharpness levels.
- Coverage: Foundation has 105 rows and SR has 132. Both have all core rows.
- **Verdict: SUPPORTED.**

### 5. mozzarella-low-moisture-part-skim-as-sold -> Foundation 329370 "Cheese, mozzarella, low moisture, part-skim"
- Record: Foundation 2026-10-29, Dairy and Egg Products, NDB 1029, published 2019-04-01. 38 inputs. 18 are "Mozzarella cheese, low-moisture, part-skim" (KRAFT, SARGENTO, and store brands). 20 are "Cheese, string (low-moisture, part-skim mozzarella)" (FRIGO, SARGENTO, KRAFT, BORDEN, and store brands). Every input label states low-moisture part-skim mozzarella.
- Siblings: SR 171244 (same description, NDB 1029) is a cross-type near-duplicate, and its fat level is about equal. SR 170900 (shredded, NDB 1271) is a narrower form. SR 170846 "whole milk, low moisture" and 170847 "part skim milk" (not low moisture) are different variants.
- Identity: string cheese is labeled as the same cheese type, so it is a shape, not a different formulation. Nothing contradicts the identity.
- Coverage: Foundation has 112 rows and SR has 125. Both have all core rows.
- **Verdict: SUPPORTED.**

### 6. greek-yogurt-plain-nonfat-as-sold -> Foundation 330137 "Yogurt, Greek, plain, nonfat"
- Record: Foundation 2026-10-29, Dairy and Egg Products, NDB 1256, published 2019-04-01. 18 inputs, 6 each of FAGE PLAIN NONFAT, CHOBANI PLAIN NON-FAT, and DANNON OIKOS PLAIN NON-FAT, across several regions.
- Siblings: SR 170894 (NDB 1256) is a cross-type near-duplicate. SR 171312 "Yogurt, Greek, nonfat, plain, CHOBANI" is a single-brand branded record (44 rows, no portions).
- Identity: Greek, plain, and nonfat are stated in the description and in every input. It is a three-brand market composite of one standardized product type.
- Coverage: Foundation has 134 rows and SR has 118. Both have all core rows.
- **Verdict: SUPPORTED.**

### 7. greek-yogurt-plain-2-percent-fat-as-sold -> SR 170903 "Yogurt, Greek, plain, lowfat"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1287. Portion: container (7 oz). 125 rows, all core rows present.
- Fat: the description says "lowfat", which is a range label. The record's fat level is inside a 1.5-2.5 g/100 g band around 2%. That is consistent with the target, but under Q-009 it is not proof.
- Siblings: every SR "Greek, 2% fat" record is a flavored CHOBANI product (170864 apricot, 170891 mixed berry, 170909 pineapple, 170912 strawberry banana, 171260 coconut, 172199 mango, 173434 key lime), so none is plain. Foundation has no lowfat or 2% plain Greek yogurt.
- **Verdict: GAP.** "2%" is not documented by the record. If #215 does not accept a fat level as band evidence, the id becomes `variant_not_distinguished`.

### 8. greek-yogurt-plain-5-percent-fat-as-sold -> SR 171304 "Yogurt, Greek, plain, whole milk"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1293. No portion rows (grams only). 100 rows, all core rows present.
- Sibling disagreement: Foundation 2259794 has the same description and NDB 1293 (8 inputs "Yogurt, Greek, whole milk, plain"). SR's fat level is inside a 4.5-5.5 g/100 g band. Foundation's is below that band and below SR's.
- Branded: SR 171309 "Yogurt, Greek, whole, plain, CHOBANI" is single-brand.
- **Verdict: GAP.** "5%" appears in neither record. The two same-code records also disagree on the fat level, which is the attribute that defines the catalog variant.

### 9. heavy-cream-36-percent-fat-as-sold -> SR 170859 "Cream, fluid, heavy whipping"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1053. Portions: cup, whipped; cup, fluid (yields 2 cups whipped); tbsp; fl oz.
- Alternative: Foundation 2346386 "Cream, heavy" (NDB 1053, published 2022-10-28; 8 inputs "heavy cream"). This is a cross-type near-duplicate. Its description matches the catalog name more literally.
- Fat: both records are within 0.5 g/100 g of 36. SR is just above 36 and Foundation just below, and the two are about equal (within 5%). **This corrects the report's emphasis.** The fat band does not separate the candidates. Both are consistent with the target, and neither is proven by its fat level.
- Siblings: SR 170858 "light whipping" and SR 170857 "light (coffee cream or table cream)" are lower-fat classes and are explicitly qualified.
- Coverage: SR has 134 rows, all core rows, and household portions. Foundation has 36 rows, all core rows (energy from Atwater rows only), a RACC portion only, and one vitamin A row with no amount.
- **Verdict: SUPPORTED** (identity, for both candidates; "heavy" is stated in each). The case for SR rests on coverage and portions, not on the fat band.

### 10. milk-reduced-fat-2-percent-as-sold -> Foundation 746778 "Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D"
- Record: Foundation 2026-10-29, Dairy and Egg Products, NDB 1079, published 2019-12-16. 24 inputs "MILK, 2% (WAVE 22E)". Portion: cup.
- Siblings: SR 171267 has the same description (NDB 1079; cross-type near-duplicate), and its fat level is about equal. These SR records are different variants: 172205 "without added vitamin A and vitamin D", 170870 and 172193 "with added nonfat milk solids", and 170871 "protein fortified".
- Identity: "reduced fat", "fluid", and "2% milkfat" are stated. Fortification is not part of the catalog id. The generic retail samples were composited under the fortified description.
- Coverage: Foundation has 157 rows and SR has 128. Both have all core rows.
- **Verdict: SUPPORTED.** Choosing the fortified form is a disclosed default, not a contradiction.

### 11. milk-whole-3-25-percent-fat-as-sold -> Foundation 746782 "Milk, whole, 3.25% milkfat, with added vitamin D"
- Record: Foundation 2026-10-29, Dairy and Egg Products, NDB 1077, published 2019-12-16. 24 inputs "MILK, WHOLE (WAVE 22E)". Portion: cup.
- Siblings: SR 171265 has the same description (NDB 1077; cross-type near-duplicate), and its fat level is about equal. SR 172217 "without added vitamin A and vitamin D" and SR 171266 "Milk, producer, fluid, 3.7% milkfat" are different variants.
- Identity: "whole" and "3.25% milkfat" are stated, matching the catalog id exactly.
- Coverage: Foundation has 157 rows and SR has 113. Both have all core rows.
- **Verdict: SUPPORTED.**

### 12. yogurt-plain-whole-milk-as-sold -> Foundation 2259793 "Yogurt, plain, whole milk"
- Record: Foundation 2026-10-29, Dairy and Egg Products, NDB 1116, published 2022-04-28. 8 inputs "Yogurt, whole milk, plain". Portion: RACC only.
- Alternative: SR 171284 has the same description (NDB 1116; cross-type near-duplicate). Its portions are containers of 8, 6, and 4 oz and cup (8 fl oz).
- **New finding: the two same-code records disagree materially on fat.** Foundation's fat level is well above SR's (not within 5%). SR's sits near the whole-milk standard level of 3.25 g/100 g. Foundation's does not. Neither description names a fat percentage, and the catalog id does not either, so this does not contradict "whole milk". It does mean the choice of source changes a core macro materially.
- Siblings: the Greek records (171304, 2259794) and the fruit-flavored records are different products.
- Coverage: Foundation has 48 rows, all core rows (energy from Atwater rows only), and one vitamin A row with no amount. SR has 91 rows and all core rows.
- **Verdict: SUPPORTED** (identity, for both candidates). The source choice is open for #215. The pinned files cannot say which record reflects current retail. Coverage favors SR, and recency favors Foundation (2022 against the 2018 release).

### 13. chicken-egg-poached-cooked-without-added-fat -> SR 172186 "Egg, whole, cooked, poached"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1131. Portion: large. 120 rows, all core rows present.
- Preparation: poaching is a water-cooking method, so the description itself implies no added fat. The record's fat level is about equal to raw whole egg 171287, which is consistent with that but not proof under Q-009.
- Salt: its sodium level is about double raw whole egg's. The hard-boiled egg 173424, cooked in the shell, is slightly below raw, so cooking alone does not raise sodium. That pattern is consistent with salted poaching water. The catalog state is `cooked-without-added-fat`, which says nothing about salt.
- Siblings: 172186 is the only poached record in either dataset. Foundation has no cooked egg.
- **Verdict: SUPPORTED** for "without added fat". The salt is outside the catalog state, and #215 should decide whether to accept it with a disclosure.

### 14. chicken-egg-white-raw -> SR 172183 "Egg, white, raw, fresh"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1124. Portions: cup; large.
- Alternative: Foundation 747997 "Eggs, Grade A, Large, egg white" (NDB 1124, published 2019-12-16). Its 24 inputs are "EGG, GRADE A, LARGE, WHITE, RAW, FRESH". This is a cross-type near-duplicate with the same physical identity, and its protein level is about equal.
- Siblings: SR 172203 and Foundation 323697 "Egg, white, raw, frozen, pasteurized", and the dried egg white records (323793, 170895, 172204, 173426, 173427), are different states.
- Coverage: SR has 97 rows and all core rows. **Foundation 747997 has no sodium row** (29 rows). It lacks a core nutrient, which is the ANSWER Q-002 situation.
- **Verdict: SUPPORTED** (identity, for both candidates). Coverage favors SR because Foundation is missing a core row.

### 15. goat-cheese-soft-chevre-as-sold -> SR 173435 "Cheese, goat, soft type"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1159. Portion: oz. 90 rows, all core rows present.
- Siblings: SR 173433 "semisoft type" and SR 172197 "hard type" are separately qualified. Foundation has no goat cheese. A search for "chevre" or "chèvre" finds nothing in either dataset.
- Identity: goat milk cheese, soft type, is supported against the semisoft and hard siblings. The catalog name and alias say chèvre (fresh goat cheese). The record does not say whether "soft type" means fresh, unripened cheese, and the pinned files contain no naming evidence that links "soft type" to chèvre.
- **Verdict: GAP** (narrow). The soft goat cheese class is supported. The fresh (chèvre) identity rests on a naming convention that is not documented in the pinned sources.

## Unresolved and batch-level cases (16-18)

### 16. chicken-egg-scrambled-cooked-without-added-fat (unresolved) -> candidate SR 172187 "Egg, whole, cooked, scrambled"
- Record: SR Legacy 2018-04, Dairy and Egg Products, NDB 1132. Portions: cup; large; tbsp.
- Composition pattern: compared with raw whole egg 171287, its fat level is higher, its carbohydrate level is more than double, and its protein level is lower. Its fat level is also higher than poached egg 172186's. Its sodium level is about equal to raw. Several core macros move together in the direction of added milk and fat, and none moves the other way. The description does not state the preparation.
- Other records: "Eggs, scrambled, frozen mixture" (169904) and "Fast foods, egg, scrambled" (173272) are different products. Foundation has no cooked egg.
- **Verdict: CONTRADICTED** (candidate 172187 against `cooked-without-added-fat`). The rejection is supported, and the id stays unresolved (`different_product_only`). A recipe-time derivation from raw whole egg needs separate review.

### 17. Unresolved near candidates (not substituted)
- **tamari-reduced-sodium-as-sold**: the near candidates are shoyu low sodium 172473 (soy and wheat) and HVP reduced sodium 172474 (hydrolyzed vegetable protein). Both are a different product type from tamari. The only tamari, 174278, is unqualified.
- **vinegar-champagne-liquid-as-sold and vinegar-sherry-liquid-as-sold**: the whole vinegar set in both datasets is SR distilled 172237, red wine 172240, balsamic 172241, and cider 173469, plus a salad dressing recipe (171417). Foundation has no vinegar. Red wine and distilled vinegar are different products.
- **vinegar-rice-seasoned-liquid-as-sold**: there is no rice vinegar, seasoned or plain, in either dataset.
- **chicken-egg-white-cooked-without-added-fat**: no cooked egg white exists in either dataset. Raw 172183 and Foundation 747997 are a different state.
- **Verdict: CONTRADICTED** for every near candidate as a substitute (a different product or state). The 4 ids without a source record stay GAP: no source in the pinned files.

### 18. Batch-level: CLI selection discrepancy (coconut milk vs chicken-egg-white-raw)
- Catalog evidence: `coconut-milk-canned-full-fat-as-sold` is `kind: generic`, `sourceStrategy: manufacturer-first`, priority 1, and its catalog note says: "Match brand, fortification, sweetening, and concentration before use; a generic match is provisional." It is outside the documented deterministic wave-A lane (priority 1, generic, usda-first).
- **Resolved by the planner fix in this PR.** [manifestReader.ts](../../scripts/nutrition/manifestReader.ts) `waveOf` now sends every non-branded entry that is not usda-first to wave D. Wave A is exactly the 225 documented ids. A regression test in [researchPipeline.test.ts](../../scripts/nutrition/researchPipeline.test.ts) fails on the old `waveOf` (it selects coconut milk and drops chicken-egg-white-raw) and passes on the fix.
- Proof runs: two fresh scratch stores under `~/workspace/private-data/a2evidence/` (never `/tmp`), each running `plan --wave A --max 25 --write` twice. Both stores gave the same result:
  - Plan 1 reproduced A1's parent batch id **`rb-de5702452450983345068f40`**.
  - Plan 2 selected exactly the 25 ids in the report's [Batch definition](population-batch-a2-report.md#batch-definition), in (priority, category, id) order, with no coconut milk and with chicken-egg-white-raw.
  - Plan 2's parent batch id is **`rb-c61cabe465685a29a02ff753`** (pass `rp-b2fd5c667f4f5ae57ca5e17f`).

  This is the canonical A2 parent batch id. `rb-7136e61a94abc4f865f3f051` belongs to the old CLI set and must not be reused. No `run`, `validate`, or `stage` was executed for A2.
- **Verdict: SUPPORTED** (coconut milk stays out of the usda-first lane). The discrepancy is resolved.

## Summary

| Verdict | Count | Cases |
| --- | ---: | --- |
| SUPPORTED | 12 | 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 18 |
| GAP | 4 | 1 (tamari sodium variant), 7 (Greek 2% band), 8 (Greek 5% band, and the datasets disagree), 15 (chèvre fresh identity) |
| CONTRADICTED | 2 | 16 (scrambled candidate), 17 (near-candidate substitutes) |

Source-choice items for #215, separate from identity:
- **Coverage favors SR over the proposed Foundation record in cases 2, 3, and 12.**
  - Case 2: the Foundation paste composite includes a double-concentrated input.
  - Case 3: switching to SR would rest on a sodium-class inference for salt.
  - Case 12: the same-code records disagree materially on fat.
- **Coverage supports the proposed SR record in cases 9 and 14.**
  - Case 9: the fat band does not separate the candidates, so the choice rests on coverage.
  - Case 14: Foundation lacks a sodium row.

Nothing here is a permanent exclusion, and this matrix writes no match-table entry.
