# Population batch A1: dry-run preparation report (#63)

Prepared: 2026-11-10. Base: `main` at `30f0224` (PR #210, the FDC Foundation and SR Legacy pins). Authority: James's standing approval of 2026-11-10 for the #63 population waves. This batch is **preparation only**. Nothing was staged or published. The reviewed [match table](source-match-table.json) is unchanged and still has no entries; the proposed matches below exist only in this report. No `--live` run, no FDC API key, and no Firestore access. Both write flags in [capabilities.js](../../public/shared/nutrition/capabilities.js) stay false, and nothing under `public/` changed. This report contains source record ids and descriptions, which are public, but no nutrient values. No dataset file or record dump entered the repository.

Related: [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [FDC pins dry run](fdc-pins-dry-run-report.md)

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

Wave A, deterministic lane: the first 25 priority-1 entries of [ingredient-catalog.json](ingredient-catalog.json) in (priority, category, id) order that are generic and not already covered by an approved profile.

- **Generic** means `kind: generic` with `sourceStrategy: usda-first`. That excludes the 21 branded/manufacturer-first entries, the 6 additive/compound-reference entries, and the 1 generic/manufacturer-first (formulation-dependent) entry among the 253 priority-1 ids. That leaves 225 eligible priority-1 ids, and this batch takes the first 25 of them.
- **Not already covered:** the curated catalog [manifest](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json) has `profileCount: 0`, so no id was excluded on that ground.
- The CLI's own selection (`plan --wave A --max 25`) returns exactly these 25 ids in the same order.
- Categories: beverages (7), breads-bakery (2), cocoa-chocolate (10), condiments-sauces (6).
- Parent batch id `rb-de5702452450983345068f40`; deterministic pass id `rp-59fe9af3536d20bea8cb921b`.

## Method

**Datasets.** These are the two pinned bulk releases in [researchConfig.ts](../../scripts/nutrition/researchConfig.ts). The files sit in an operator-local directory outside the checkout, and the reader verified each one against its extracted-file sha256 pin on every load.

| Dataset id | Data type | Release | Pin (extracted JSON) |
| --- | --- | --- | --- |
| `foundation` | Foundation | 2026-10-29 | `sha256:990e7731…58a1` |
| `sr-legacy` | SR Legacy | 2018-04 | `sha256:70d4235a…0129` |

**Foundation blocked set.** The 10 Foundation records with non-numeric nutrient amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673; see the [pins dry run](fdc-pins-dry-run-report.md)) were skipped by the audit path. None of them was a candidate for any id in this batch.

**Commands.** All were run from the repository root through [researchCli.ts](../../scripts/nutrition/researchCli.ts):

```sh
# 1. Candidate search, per manifest id and dataset (the audit path; read-only)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- suggest --manifest-id <id> --dataset foundation --file <dir>/FoodData_Central_foundation_food_json_2026-10-29.json --max 25
npx --no-install vite-node scripts/nutrition/researchCli.ts -- suggest --manifest-id <id> --dataset sr-legacy --file <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json --max 25
# 2. Deterministic pass (job store outside the checkout)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store /tmp/63a1-store
npx --no-install vite-node scripts/nutrition/researchCli.ts -- run --source fdc-bulk --dataset sr-legacy --batch rb-de5702452450983345068f40 --write --store /tmp/63a1-store
npx --no-install vite-node scripts/nutrition/researchCli.ts -- validate --batch rb-de5702452450983345068f40 --write --store /tmp/63a1-store
npx --no-install vite-node scripts/nutrition/researchCli.ts -- coverage --store /tmp/63a1-store
```

The `suggest` ranking only orders candidates by word overlap. Every proposal below is a manual decision: candidates were ranked by physical and formulation match (state, form, fat level, raw/cooked, concentrate/fresh, fortification) before nutrient completeness, per the [source hierarchy](population-playbook.md#source-hierarchy). Where `suggest`'s top 25 was noisy, the same pinned files were also searched read-only by description keyword. Foundation was preferred only where it matched as well as SR Legacy, and the two types were never counted as confirming each other. A vague or state-mismatched candidate was recorded as unresolved.

**Store.** `/tmp/63a1-store` holds one file, `jobs.json`, with the 25 jobs. No source cache was written: nothing reached the fetch step, so no dataset content was copied there either.

## Aggregate counts

| Measure | Count |
| --- | ---: |
| Ids attempted (identity resolution against both datasets) | 25 |
| Proposed matches | 17 |
| from Foundation 2026-10-29 | 3 |
| from SR Legacy 2018-04 | 14 |
| Unresolved | 8 |
| Jobs planned in the store | 25 |
| Jobs that reached a proposal through the CLI | 0 |
| Validated | 0 |
| Validation failures | 25 |
| Approved, staged, imported | 0 |

Validation failure categories:

| Category | Count |
| --- | ---: |
| `Job proposal is missing revisionDraft` (job blocked at match with `match_not_found`, because the reviewed match table is empty) | 25 |

Unresolved reason categories:

| Category | Count |
| --- | ---: |
| `no_source_record`: neither pinned dataset has the food | 2 |
| `different_product_only`: the closest record is a different product or formulation | 4 |
| `variant_not_distinguished`: the dataset has the food but not the catalog variant | 2 |

Per-field status summary: no job produced a revision, so **0** registry fields resolved, **0** were recorded as unknown, and every stored registry field is **not checked** for all 25 ids. A per-field summary needs the deterministic pass to run on reviewed match-table entries (see [Pipeline gaps](#pipeline-gaps)).

## Proposed matches

These are proposals only, for entry into the reviewed match table in the import PR. They were not written to [source-match-table.json](source-match-table.json). Every listed record parses on the audit path.

| Manifest id | Dataset | FDC id | Data type | Fit reason |
| --- | --- | --- | --- | --- |
| lemon-juice-fresh-ready-to-drink | sr-legacy | 167747 | SR Legacy | "Lemon juice, raw": fresh-squeezed juice; the from-concentrate and bottled siblings are rejected. |
| lime-juice-fresh-ready-to-drink | sr-legacy | 168156 | SR Legacy | "Lime juice, raw": fresh-squeezed; the canned or bottled sibling is rejected. |
| orange-juice-fresh-ready-to-drink | sr-legacy | 169098 | SR Legacy | "Orange juice, raw": fresh-squeezed. The Foundation not-from-concentrate refrigerated record is commercial and pasteurized, a different state (flagged). |
| pomegranate-juice-100-percent-ready-to-drink | foundation | 2727588 | Foundation | "Juice, pomegranate, from concentrate, shelf-stable": 100% juice, unsweetened, unfortified; Foundation preferred over SR "bottled" (flagged). |
| breadcrumbs-plain-as-sold | sr-legacy | 174928 | SR Legacy | "Bread, crumbs, dry, grated, plain": dry, plain (unseasoned) crumbs as sold; the seasoned sibling is rejected. |
| chocolate-chips-semisweet-as-sold | sr-legacy | 167976 | SR Legacy | "Candies, semisweet chocolate": portions are chips and morsels, so the chip form is covered; the "made with butter" variant is rejected (flagged). |
| chocolate-dark-45-59-percent-cacao-as-sold | sr-legacy | 170271 | SR Legacy | "Chocolate, dark, 45- 59% cacao solids": exact cacao band. |
| chocolate-dark-60-69-percent-cacao-as-sold | sr-legacy | 170272 | SR Legacy | "Chocolate, dark, 60-69% cacao solids": exact cacao band. |
| chocolate-dark-70-85-percent-cacao-as-sold | sr-legacy | 170273 | SR Legacy | "Chocolate, dark, 70-85% cacao solids": exact cacao band. |
| chocolate-milk-as-sold | sr-legacy | 167587 | SR Legacy | "Candies, milk chocolate": milk chocolate confection (category cocoa-chocolate, not the dairy beverage). |
| chocolate-unsweetened-baking-as-sold | sr-legacy | 167568 | SR Legacy | "Baking chocolate, unsweetened, squares": solid baking chocolate; the liquid form is rejected. |
| chocolate-white-as-sold | sr-legacy | 167571 | SR Legacy | "Candies, white chocolate": white chocolate confection. |
| cocoa-powder-unsweetened-dutch-process-as-sold | sr-legacy | 169594 | SR Legacy | "Cocoa, dry powder, unsweetened, processed with alkali": Dutch-process is alkali-processed; the hi-fat and branded records are rejected. |
| cocoa-powder-unsweetened-natural-as-sold | sr-legacy | 169593 | SR Legacy | "Cocoa, dry powder, unsweetened": the non-alkalized sibling of 169594 (flagged: "natural" is inferred). |
| mayonnaise-regular-as-sold | foundation | 2758986 | Foundation | "Mayonnaise, Regular": exact, full-fat; Foundation preferred over SR 171009. |
| salsa-red-as-sold | foundation | 746777 | Foundation | "Sauce, salsa, ready-to-serve": input foods are chunky medium red tomato salsas; Foundation preferred over SR 174524 (flagged). |
| soy-sauce-regular-as-sold | sr-legacy | 174277 | SR Legacy | "Soy sauce made from soy and wheat (shoyu)": regular brewed soy sauce; low-sodium, HVP, and tamari records are rejected. |

No proposal shares an FDC record with another manifest id, so no `sharedJustification` is needed.

## Unresolved

| Manifest id | Category | Reason |
| --- | --- | --- |
| apple-cider-nonalcoholic-ready-to-drink | different_product_only | Neither dataset has nonalcoholic apple cider. SR has only filtered apple juice (for example 173933) and hard cider (174146). Apple juice is a different product (filtration) and is not substituted. |
| ginger-beer-nonalcoholic-ready-to-drink | different_product_only | Neither dataset has ginger beer. SR has only ginger ale (174846), a different and formulation-dependent soft drink. This likely needs a label source (manufacturer-first). |
| pear-juice-100-percent-ready-to-drink | different_product_only | The only pear juice record is "Babyfood, juice, pear" (167718), a baby-food product whose fortification may differ. Blends and canned-pear packing juice are rejected. |
| mustard-dijon-as-sold | different_product_only | Both datasets have only "Mustard, prepared, yellow" (Foundation 326698; SR 172234). Dijon is a different formulation and is not substituted. |
| panko-breadcrumbs-as-sold | no_source_record | No panko record in either dataset. Plain dry breadcrumbs (174928) are a different product (texture and density) and are proposed only for breadcrumbs-plain. |
| cacao-nibs-as-sold | no_source_record | No cacao or cocoa nib record in either dataset. Dark chocolate and cocoa powder are different products. |
| miso-red-as-sold | variant_not_distinguished | SR has a single "Miso" (172442) with no red or white distinction, and Foundation has none. Red and white miso differ in salt and fermentation, so the generic record is not assigned to either. |
| miso-white-as-sold | variant_not_distinguished | Same as miso-red; one shared generic record cannot represent both variants. |

## Deterministic pass outcome

`plan` stored 25 queued jobs under the parent batch and pass ids above. `run --source fdc-bulk` moved all 25 to `blocked` with `match_not_found` ("Manual match review or entry into source match table required"). The bulk adapter matches only from the reviewed table, which has no entries, and this batch may not edit it. `validate` then reported `Job proposal is missing revisionDraft` for all 25. `coverage` shows 25 blocked of 1,114 and 0 attempted: coverage counts an id as attempted only after a source fetch or packet, and these jobs stopped before the fetch.

The run therefore confirms the CLI's gating, but it does not yet show the per-field quality of the proposed records. That waits for the import PR's reviewed table entries.

## Sample review

Five proposed matches across the four categories were checked by hand against the raw pinned record: description, data type, food category, and portion descriptions (no nutrient values were read into this report). Each record also passed the per-record parser on the audit path.

| # | Manifest id | Record | Description / state / form check | Result |
| ---: | --- | --- | --- | --- |
| 1 | lemon-juice-fresh-ready-to-drink (beverages) | SR 167747 | "Lemon juice, raw", Fruits and Fruit Juices; portions are wedge, lemon yield, cup, fl oz, which fits fresh-squeezed juice, not concentrate. | Pass |
| 2 | breadcrumbs-plain-as-sold (breads-bakery) | SR 174928 | "Bread, crumbs, dry, grated, plain", Baked Products; dry and unseasoned, as sold; portions are cup and oz. | Pass |
| 3 | chocolate-dark-70-85-percent-cacao-as-sold (cocoa-chocolate) | SR 170273 | "Chocolate, dark, 70-85% cacao solids", Sweets; the cacao band equals the catalog band; portions are bar and oz. | Pass |
| 4 | mayonnaise-regular-as-sold (condiments-sauces) | Foundation 2758986 | "Mayonnaise, Regular", Fats and Oils, published 2026-04-30; regular full-fat mayonnaise, not reduced-fat or the salad-dressing "mayonnaise type". | Pass |
| 5 | soy-sauce-regular-as-sold (condiments-sauces) | SR 174277 | "Soy sauce made from soy and wheat (shoyu)", Legumes and Legume Products; regular sodium, brewed from soy and wheat; portions are packet, tbsp, tsp, cup. | Pass |

Sample result: 5 of 5 pass. The sample does not clear the individually flagged cases below. Reviewer: the batch-preparation agent (Claude), checklist version 1 of the [playbook](population-playbook.md#validation-and-review). The import PR's human reviewer must re-confirm the flagged cases.

## Flagged cases

Every case needing reviewer attention is listed individually.

1. **orange-juice-fresh-ready-to-drink: state conflict between candidates.** Foundation 2003597 ("Orange juice, no pulp, not fortified, not from concentrate, refrigerated") is commercial pasteurized juice. SR 169098 ("Orange juice, raw") is fresh-squeezed and is proposed. Both carry NDB number 9206, so USDA treats the Foundation record as the successor food code. The reviewer should decide whether "fresh" means fresh-squeezed (SR 169098) or simply not-from-concentrate (Foundation 2003597).
2. **pomegranate-juice-100-percent-ready-to-drink: ambiguous reconstitution.** Foundation 2727588 is from concentrate and shelf-stable. SR 167787 is "bottled" and unspecified. The catalog does not say which, so Foundation is proposed on the Foundation-preference rule.
3. **salsa-red-as-sold: color inferred.** The description does not say "red". The Foundation input foods (chunky medium tomato salsas) and SR's separate "salsa, verde" record (171824) support red tomato salsa. SR 174524 has the same description and NDB number 6164, a cross-type near-duplicate that is not independent confirmation.
4. **mayonnaise-regular-as-sold: cross-type near-duplicate.** SR 171009 ("Salad dressing, mayonnaise, regular") is the same food in another data type, and SR 171403 ("mayonnaise type") is a different product. Foundation 2758986 is proposed.
5. **chocolate-chips-semisweet-as-sold: form and near-duplicate.** SR 167976 is semisweet chocolate whose portions are chips and morsels; no separate chip formulation exists. Near-duplicate SR 169690 ("made with butter") is a different formulation and is rejected.
6. **chocolate-unsweetened-baking-as-sold: near-duplicate form.** SR 167567 ("liquid") is rejected in favor of 167568 ("squares").
7. **cocoa-powder-unsweetened-natural-as-sold: "natural" inferred.** SR 169593 does not say "natural". It is taken as natural because its sibling 169594 is "processed with alkali". SR 168774 (HERSHEY'S European Style, branded) and 170657 (hi-fat, alkali) are rejected.
8. **cocoa-powder-unsweetened-dutch-process-as-sold: near-duplicates.** 170657 has a different fat level and 168774 is branded with a sparse row; both are rejected for 169594.
9. **chocolate-dark-\* (three ids): near-duplicate NFS record.** SR 170274 ("Candies, chocolate, dark, NFS", a weighted blend of the three bands) matches every band loosely and is rejected for each. Each id takes its exact band.
10. **chocolate-milk-as-sold: name ambiguity.** "Chocolate, milk" could be read as the dairy beverage. The catalog category (cocoa-chocolate) settles it as the confection, SR 167587.
11. **lemon and lime juice: branded and concentrate siblings.** Lemon: SR 167748 (from concentrate), 167801 (CONCORD), and 167802 (REAL LEMON) are rejected. Lime: 168157 (canned or bottled) is rejected.
12. **soy-sauce-regular-as-sold: neighboring ids.** SR 174278 (tamari) belongs to tamari-regular-as-sold, a later batch. 174279 (hydrolyzed vegetable protein) and the two low or reduced sodium records are rejected.
13. **Unresolved near candidates** (not substituted): apple cider → apple juice 173933; ginger beer → ginger ale 174846; pear juice → babyfood 167718; Dijon → yellow mustard 326698 and 172234; panko → plain breadcrumbs 174928; red and white miso → generic miso 172442.

## Pipeline gaps

Found while running this batch. Items 1 and 2 are fixed here with tests; the rest are documented and not built.

1. **Fixed: the CLI did nothing under vite-node.** `researchCli.ts` ran only when `argv[1]` was the script itself. vite-node removes the script path, so every documented `npx vite-node … researchCli.ts` command exited 0 without output. It now runs when vite-node's `argv[2]` is a CLI command, and a vite-node script that only imports the module does not start it (`isResearchCliEntry`, tested).
2. **Fixed: `suggest` threw on the real Foundation file and matched only exact full names.** It used the strict reader, which throws on the 10 blocked records, and a whole-name substring test that found almost nothing (for example "Lemon juice, fresh"). It now uses the audit path, reports `skippedFdcIds`, and ranks by name and alias word overlap ([matchSuggest.ts](../../scripts/nutrition/matchSuggest.ts), tested). Ranking stays a review aid.
3. **Open: the deterministic pass needs reviewed table entries.** `run --source fdc-bulk` matches only from `source-match-table.json`. Until the import PR adds reviewed entries, no proposal, validation, or per-field summary can come from the CLI. Not built here: an overlay of unreviewed proposals would be risky because of gap 4.
4. **Open, important for the import PR: a missing table entry passes review and staging.** `verifiedRecordMatchesTable` in [researchReview.js](../../public/shared/nutrition/research/researchReview.js) returns true when the table has no entry for the manifest id. Today the bulk adapter can only match from the table, so this is not reachable through the CLI. Any future path that matches curated jobs outside the table would bypass the reviewed-table gate at approval and at `stage`. A missing entry should fail closed for curated FDC records.
5. **Open: `index` uses the strict reader.** `index --dataset foundation` throws on the real file ("Non-numeric amount…"), so Foundation-matched jobs cannot be fetched from the source cache. The import PR needs `indexBulk` to use the audit path (index parsed records, report the blocked ids) before the three Foundation proposals can run. SR Legacy indexes completely (7,793 records).
6. **Open: one bulk adapter release per run.** The bulk adapter stamps `toSourceResult` with the release of the `--dataset` given to `run`. A mixed batch must therefore run Foundation-matched and SR-matched jobs in separate `run --job …` calls with the matching `--dataset`. The service's cache key uses the match entry's release, so the fetch itself is correct.
7. **Open, minor: `plan` without `--dataset` stores no batch source release** (passId uses `unconfigured`). A mixed-type batch has no single release, so the pass id does not identify the releases used; the match entries do.
8. **Open, minor: `coverage` counts a match-blocked job as blocked but not attempted.** It counts an attempt only after a fetch or packet.

## Follow-ups: the import PR for this batch

The A1 import PR (`#63-A-1`, under the standing approval, with James's approval recorded in the PR) will contain:

1. Reviewed match-table entries for the 17 proposed matches above: `adapter: fdc_bulk`, `dataType`, `fdcId`, `release`, verbatim `description`, `stateEvidence`, `rationale`, reviewer handle, `reviewedAt`, `checklistVersion: 1`. The flagged cases are re-confirmed by the human reviewer first, and any rejected proposal moves to the unresolved list.
2. The fix for gap 5 (audit-path indexing) with tests, and preferably gap 4 (fail closed on a missing table entry) with tests.
3. The deterministic pass: `index` both releases into a store outside the checkout, run the SR Legacy and Foundation jobs with their own `--dataset`, `validate`, `review` with `--verify-source`, approval by hash, and `stage --write --out <fresh dir>`. The staged shards are reviewed in the PR, with per-field status (resolved, unknown, not checked) and validation counts reported.
4. The 8 unresolved ids remain actionable blocked work. Apple cider, ginger beer, Dijon mustard, panko, and cacao nibs need a label or supplemental source. Red and white miso need a variant-specific source. Pear juice needs a non-baby-food source or an explicit decision. Residual fields go to a #62 research-packet pass under a new pass id on the same parent batch.

## Re-run instructions

The store and outputs are disposable: remove `/tmp/63a1-store` and re-run the commands in [Method](#method). `plan` re-derives the same parent batch id from the same manifest ids. Before the import PR adds table entries, the `run` outcome is identical (25 `match_not_found`), and no approved value can change because none exists.
