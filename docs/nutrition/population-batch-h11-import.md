# Population batch H11: import report (#63, third-pass batch H11)

Prepared: 2026-11-13. Base: `main` at `2d3e6df` (PR #242, the H10 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H11 is positions 251-275 of the approved-326 file, in file order: 22 from SR Legacy 2018-04 and 3 from Foundation 2026-10-29 (`cream-cheese-full-fat-as-sold`, 2346385; `sour-cream-full-fat-as-sold`, 2346387; and `yogurt-plain-nonfat-as-sold`, 2647437). It is the eleventh batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 391 to **416** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H11 ids share a source record, and no H11 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the two carbohydrate rows named in the acknowledged warning, this report holds no nutrient values, only aggregate coverage counts.

Related: [H10 import report](population-batch-h10-import.md) · [H9 import report](population-batch-h9-import.md) · [H8 import report](population-batch-h8-import.md) · [H5 import report](population-batch-h5-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H11) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H11 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 22 |
| from Foundation 2026-10-29 | 3 |
| Validation warnings acknowledged with a documented reason | 1 |
| Source-match table entries after this import | 416 (was 391) |
| Catalog profile count after this import | **416** (was 391) |

Store and batch identifiers: store `~/workspace/private-data/h11store-import` (never `/tmp`), parent batch id **`rb-d5707ac55fbd1b026aee8140`** (derived over the 25 attempted ids), pass id `rp-e482fc09d264453caacdad1d`, source release `2018-04+2026-10-29` (each job is stamped with its own match-entry release), reviewer `pumpkin-h11-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H10. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H11 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H10. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 251-275 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). All 25 come from bundle 2 `…717e51249110`.
- Positions 1-250 (H1 to H10) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (248 published), and none of the 25 H11 ids had a match entry before this batch. The base table had 391 entries.

The match table now has 416 entries, and the 391 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H11 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: the Foundation records that share or nearly share an SR Legacy description (2% cottage cheese 328841, whole milk ricotta 746766, swiss 746767, cotija 2647443, queso fresco 2647442, monterey jack 2647438, provolone 2647440, feta 2259796, low fat buttermilk 2259792, and sweetened condensed milk 2758990); the SR Legacy cream cheese and cultured sour cream records beside the Foundation full fat ones; the other fat levels (reduced fat, whole, and dried buttermilk; 1% against 2% and creamed or full fat cottage cheese; low fat and fat free cream cheese; reduced fat, light, and fat free sour cream; low fat monterey; reduced fat provolone; low sodium, low fat, and nonfat swiss; part skim against whole milk ricotta and low moisture mozzarella); the semisoft and soft goat cheeses; the Greek and flavored yogurts; plain whole milk yogurt (the source of `yogurt-plain-whole-milk-as-sold`), the Foundation nonfat Greek yogurt (the source of `greek-yogurt-plain-nonfat-as-sold`), and the Foundation low moisture part-skim mozzarella (the source of `mozzarella-low-moisture-part-skim-as-sold`); and raw arrowroot root and cornstarch (the source of `cornstarch-dry`) against arrowroot flour. All 72 distinct competing fdcIds cited in the boundaries (81 citations) exist in the pinned files with the cited descriptions. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H11 as positions 251-275 of the approved-326 file), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields traceably present in the pinned record, and none of the 125 core values is a source zero.

The three Foundation records (2346385, 2346387, and 2647437) have no classic energy row (1008). Their energy is the record's own Atwater specific factor row (2048), the second entry in the pipeline's energy preference order (1008, 2048, 2047), and it counts as present, as for the H9 `oats-steel-cut-dry` Foundation profile. The other four core rows are present directly. The 22 SR Legacy records have all five core rows directly, with energy from row 1008.

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H11 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 251 | brie-as-sold | SR Legacy 172177 | pass | imported |
| 252 | buttermilk-cultured-low-fat-as-sold | SR Legacy 170874 | pass | imported |
| 253 | camembert-as-sold | SR Legacy 172178 | pass | imported |
| 254 | cotija-as-sold | SR Legacy 170898 | pass | imported |
| 255 | cottage-cheese-1-percent-fat-as-sold | SR Legacy 173417 | pass | imported |
| 256 | cottage-cheese-2-percent-fat-as-sold | SR Legacy 172182 | pass | imported |
| 257 | cream-cheese-full-fat-as-sold | Foundation 2346385 | pass (energy from row 2048) | imported |
| 258 | feta-as-sold | SR Legacy 173420 | pass | imported |
| 259 | goat-cheese-hard-as-sold | SR Legacy 172197 | pass | imported |
| 260 | gouda-as-sold | SR Legacy 171241 | pass | imported |
| 261 | gruyere-as-sold | SR Legacy 171242 | pass | imported |
| 262 | monterey-jack-as-sold | SR Legacy 170844 | pass | imported |
| 263 | mozzarella-low-moisture-whole-milk-as-sold | SR Legacy 170846 | pass | imported |
| 264 | neufchatel-as-sold | SR Legacy 171246 | pass | imported |
| 265 | provolone-as-sold | SR Legacy 170850 | pass | imported |
| 266 | queso-fresco-as-sold | SR Legacy 172223 | pass | imported |
| 267 | ricotta-part-skim-as-sold | SR Legacy 171248 | pass | imported |
| 268 | ricotta-whole-milk-as-sold | SR Legacy 170851 | pass | imported |
| 269 | sour-cream-full-fat-as-sold | Foundation 2346387 | pass (energy from row 2048) | imported |
| 270 | sour-cream-reduced-fat-as-sold | SR Legacy 171256 | pass | imported |
| 271 | sweetened-condensed-milk-as-sold | SR Legacy 171275 | pass | imported |
| 272 | swiss-cheese-as-sold | SR Legacy 171251 | pass | imported |
| 273 | yogurt-plain-low-fat-as-sold | SR Legacy 170886 | pass | imported |
| 274 | yogurt-plain-nonfat-as-sold | Foundation 2647437 | pass (energy from row 2048) | imported |
| 275 | arrowroot-starch-dry | SR Legacy 170684 | pass | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H11 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run. (An earlier session had adapted the driver scripts from H10 and written a preflight output but created no store and made no repository change; this run re-ran the join and preflight from scratch before any edit.)

The prepare pass validated 25 with 0 errors and 1 warning. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h11-import`); each job's approved hash equals its review packet content hash. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry.

**Acknowledged warnings (1).** The reason is recorded in the review notes and in `~/workspace/private-data/h11store-import/acks.json`:

- `buttermilk-cultured-low-fat-as-sold`: "Sugars + starch (5.36 g) exceeds total carbs (4.79 g) by >5%". This is a source-row inconsistency in the pinned SR Legacy 2018-04 record 170874 itself. Carbohydrate by difference (row 1005) is 4.79 g (derivation NC, 0 data points), while total sugars (row 2000) is 5.36 g (derivation LC, back calculated from a label claim, 0 data points). The record has no starch row, so the validator's sugars plus starch sum is the sugars row alone. The draft values equal those pinned rows with the same derivation codes (carbs from 1005, sugarsTotal from 2000, starch unknown), and no value was adjusted. This follows the A3 pear (SR 169118), H1 green plantain (SR 168215), H2 fennel bulb (SR 169385), and H9 imitation crab (SR 174203) component-sum precedents: documented, not presented as explained.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 937 |
| Unknown | 738 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 183, calculated 120, source_reported 611, assumed_zero 23 (all numeric 0, all Z rows replayed directly: caffeine 18, vitamin D 3, vitamin B12 1, cholesterol 1), unknown 738. Unknown gaps: not reported by source 677, definition mismatch 40, partial components 21. The profiles resolve 17 to 43 fields each; the three Foundation profiles resolve 17 to 23, the SR Legacy profiles 31 to 43. No core field is missing on any imported profile, and no type faults were found. 22 profiles take energy from the record's classic energy row (1008). The three Foundation profiles take it from the record's Atwater specific factor row (2048), with derivation `atwater_specific_factors` in field provenance. A field replay against the pinned rows checked 911 values (including the three 2048 energy rows) with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (22) and `omega3` as `sum:ALA+EPA+DHA` (4).

## Imported profiles (completed imports)

arrowroot-starch-dry, brie-as-sold, buttermilk-cultured-low-fat-as-sold, camembert-as-sold, cotija-as-sold, cottage-cheese-1-percent-fat-as-sold, cottage-cheese-2-percent-fat-as-sold, cream-cheese-full-fat-as-sold, feta-as-sold, goat-cheese-hard-as-sold, gouda-as-sold, gruyere-as-sold, monterey-jack-as-sold, mozzarella-low-moisture-whole-milk-as-sold, neufchatel-as-sold, provolone-as-sold, queso-fresco-as-sold, ricotta-part-skim-as-sold, ricotta-whole-milk-as-sold, sour-cream-full-fat-as-sold, sour-cream-reduced-fat-as-sold, sweetened-condensed-milk-as-sold, swiss-cheese-as-sold, yogurt-plain-low-fat-as-sold, yogurt-plain-nonfat-as-sold.

## V4 cumulative proof

The published base was a frozen copy of main at `2d3e6df`, taken from the checkout's curated directory before any change: 260 files, tree SHA-256 `e150689a…877f`. It has 391 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 416 profiles (108 variant shards, 156 search shards, 965 search entries, 416 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 391, and added exactly the 25 imported H11 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (47 shard files removed, 53 written, 212 unchanged; 265 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h11store-import/` (`stage-a`, `stage-b`), are byte-identical: 53 files each, tree SHA-256 `c797f2b5453ce34504eb1deb1a414b569b5ed27d0152880bf557d43e8c211dbd` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, so it created no duplicates, and all 25 jobs stayed hash-bound approved. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 391 to 416 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of the tracked `public/`, `scripts/`, and `tests/` sources outside the catalog data found no other test pinning the catalog count of 391.

## Pipeline rejections and holds

None. All 25 H11 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 273 of positions 1-275 are now published (H1 to H11). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 51 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H11 does not change this.
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 416 profiles it took 3.9 s when the `scripts/nutrition` directory ran (13 files, 181/181, with file parallelism off) and 4.2 s when the four required suites ran together (4 files, 72/72). The timeout was not changed here. The margin is now under 1 s, and the next batch may need an explicit timeout.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 416-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h11-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification (with the field replay). The acknowledgement file is `~/workspace/private-data/h11store-import/acks.json` (1 entry).
