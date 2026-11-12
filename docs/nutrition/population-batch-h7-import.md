# Population batch H7: import report (#63, third-pass batch H7)

Prepared: 2026-11-12. Base: `main` at `f3bba5f` (PR #238, the H6 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H7 is positions 151-175 of the approved-326 file, in file order, all 25 from SR Legacy 2018-04. It is the seventh batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 291 to **316** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H7 ids share a source record, and no H7 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values and the five acknowledged energy checks named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H6 import report](population-batch-h6-import.md) · [H5 import report](population-batch-h5-import.md) · [H4 import report](population-batch-h4-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H7) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H7 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 25 |
| Validation warnings acknowledged with a documented reason | 5 |
| Source-match table entries after this import | 316 (was 291) |
| Catalog profile count after this import | **316** (was 291) |

Store and batch identifiers: store `~/workspace/private-data/h7store-import` (never `/tmp`), parent batch id **`rb-a8ff46cc3d3e6464a0cd8772`** (derived over the 25 attempted ids), pass id `rp-2b41c78d106857ebdd386b5f`, source release `2018-04`, reviewer `pumpkin-h7-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H6. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H7 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H6. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 151-175 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from four chunked batches: `…938429bc2e87` (4), `…9d619f186af5` (4), `…a0c32376bd17` (14), and `…c133ca970816` (3).
- Positions 1-150 (H1 to H6) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (148 published), and none of the 25 H7 ids had a match entry before this batch. The base table had 291 entries.

The match table now has 316 entries, and the 291 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H7 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: cooked, New Zealand, and Australian liver, lamb, and veal records; the Foundation raw ground lamb (2727570) and dry wild rice (2710821) records; other grades and trims of short ribs and lamb shoulder; raw, canned, hash, and loaf corned beef; other ground-beef formulations and cooked states; raw and pan-fried chicken liver; fresh versus dried basil and chives; herb leaves versus seeds (coriander, fennel bulb); raw and pickled ginger root; branded and condensed broths; the agave plant records; and light and high-fructose corn syrups. Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H7 as positions 151-175 of approved-326), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in SR Legacy 2018-04, dataType SR Legacy, verbatim description). All 25 had the five core fields traceably present in the pinned record. Some core values are source zeros. Each is the source's own row, so it counts as present:

- Z (assumed zero): carbohydrate for `ground-beef-70-percent-lean-30-percent-fat-raw-raw-formulation-70-30`, `ground-lamb-raw`, and `lamb-shoulder-lean-and-fat-raw` (status assumed_zero).
- NC (calculated): carbohydrate for `beef-short-ribs-boneless-lean-and-fat-raw` and `veal-cutlet-lean-raw` (status calculated).
- No derivation code: protein and total fat for `corn-syrup-dark-as-sold` (status source_reported).

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H7 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 151 | beef-liver-raw | SR Legacy 169451 | pass | imported |
| 152 | beef-short-ribs-boneless-lean-and-fat-raw | SR Legacy 170826 | pass (carbohydrate NC zero) | imported |
| 153 | corned-beef-cooked-as-sold | SR Legacy 170200 | pass | imported |
| 154 | ground-beef-70-percent-lean-30-percent-fat-raw-raw-formulation-70-30 | SR Legacy 168652 | pass (carbohydrate Z zero) | imported |
| 155 | ground-lamb-raw | SR Legacy 174370 | pass (carbohydrate Z zero) | imported |
| 156 | lamb-shoulder-lean-and-fat-raw | SR Legacy 172496 | pass (carbohydrate Z zero) | imported |
| 157 | veal-cutlet-lean-raw | SR Legacy 172643 | pass (carbohydrate NC zero) | imported |
| 158 | chicken-liver-cooked-without-added-fat | SR Legacy 171061 | pass | imported |
| 159 | wild-rice-dry | SR Legacy 169726 | pass | imported |
| 160 | allspice-dry-ground-or-powdered | SR Legacy 171315 | pass | imported (energy warning acknowledged) |
| 161 | basil-dried | SR Legacy 171317 | pass | imported (energy warning acknowledged) |
| 162 | basil-fresh | SR Legacy 172232 | pass | imported |
| 163 | bay-leaf-dried | SR Legacy 170917 | pass | imported |
| 164 | caraway-whole-dried-seed | SR Legacy 170918 | pass | imported |
| 165 | chili-powder-spice-blend-dry-ground-or-powdered | SR Legacy 171319 | pass | imported (energy warning acknowledged) |
| 166 | chives-fresh | SR Legacy 169994 | pass | imported |
| 167 | clove-dry-ground-or-powdered | SR Legacy 171321 | pass | imported (energy warning acknowledged) |
| 168 | coriander-whole-dried-seed | SR Legacy 170922 | pass | imported (energy warning acknowledged) |
| 169 | curry-powder-dry-ground-or-powdered | SR Legacy 170924 | pass | imported |
| 170 | fennel-whole-dried-seed | SR Legacy 171323 | pass | imported |
| 171 | fenugreek-whole-dried-seed | SR Legacy 171324 | pass | imported |
| 172 | ginger-dry-ground-or-powdered | SR Legacy 170926 | pass | imported |
| 173 | vegetable-broth-regular-ready-to-use | SR Legacy 171583 | pass | imported |
| 174 | agave-syrup-as-sold | SR Legacy 170277 | pass | imported |
| 175 | corn-syrup-dark-as-sold | SR Legacy 168836 | pass (protein and total fat zeros, no code) | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H7 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run.

The prepare pass validated 25 with 0 errors and 5 warnings. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h7-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry.

**Acknowledged warnings (5).** All five are the validator's general-factor Atwater check (4/4/9 kcal per g), and all five are explained by the record's own specific factors, as in the G1 dill and thyme precedent. In each case the draft's energy, protein, fat, and carbohydrate equal the pinned rows, and no value was adjusted. Each acknowledgement is recorded individually in the approval notes and in `~/workspace/private-data/h7store-import/acks.json`.

1. `allspice-dry-ground-or-powdered`: "Atwater energy inconsistency: reported 263 kcal differs from calculated 391 kcal by >98". Pinned SR 171315 carries a CalorieConversionFactor of protein 3.36, fat 8.37, carbohydrate 2.35. Applied to the record's own protein, fat, and carbohydrate rows, those factors give 262.6 kcal, which reproduces the reported energy row (263 kcal, code NC).
2. `basil-dried`: "Atwater energy inconsistency: reported 233 kcal differs from calculated 320 kcal by >80". Pinned SR 171317 factors 2.44, 8.37, 3.0 give 233.6 kcal (reported 233, NC).
3. `chili-powder-spice-blend-dry-ground-or-powdered`: "Atwater energy inconsistency: reported 282 kcal differs from calculated 382 kcal by >95". Pinned SR 171319 factors 3.23, 8.37, 2.39 give 282.1 kcal (reported 282, NC).
4. `clove-dry-ground-or-powdered`: "Atwater energy inconsistency: reported 274 kcal differs from calculated 403 kcal by >101". Pinned SR 171321 factors 1.82, 8.37, 2.35 give 273.6 kcal (reported 274, NC).
5. `coriander-whole-dried-seed`: "Atwater energy inconsistency: reported 298 kcal differs from calculated 430 kcal by >107". Pinned SR 170922 factors 3.36, 8.37, 1.95 give 297.9 kcal (reported 298, NC).

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 988 |
| Unknown | 687 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 280, calculated 134, source_reported 447, assumed_zero 127 (all numeric 0, all Z rows: 119 replayed directly, plus 8 `fiber` cells aliasing a Z `fiberTotal` row), unknown 687. Unknown gaps: not reported by source 640, definition mismatch 32, partial components 15. The profiles resolve 29 to 43 fields each. No core field is missing on any imported profile, and no type faults were found. All 25 take energy from the record's classic energy row (1008). A field replay against the pinned rows checked 953 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (25) and `omega3` as `sum:ALA+EPA+DHA` (10).

## Imported profiles (completed imports)

agave-syrup-as-sold, allspice-dry-ground-or-powdered, basil-dried, basil-fresh, bay-leaf-dried, beef-liver-raw, beef-short-ribs-boneless-lean-and-fat-raw, caraway-whole-dried-seed, chicken-liver-cooked-without-added-fat, chili-powder-spice-blend-dry-ground-or-powdered, chives-fresh, clove-dry-ground-or-powdered, coriander-whole-dried-seed, corn-syrup-dark-as-sold, corned-beef-cooked-as-sold, curry-powder-dry-ground-or-powdered, fennel-whole-dried-seed, fenugreek-whole-dried-seed, ginger-dry-ground-or-powdered, ground-beef-70-percent-lean-30-percent-fat-raw-raw-formulation-70-30, ground-lamb-raw, lamb-shoulder-lean-and-fat-raw, veal-cutlet-lean-raw, vegetable-broth-regular-ready-to-use, wild-rice-dry.

## V4 cumulative proof

The published base was a frozen copy of main at `f3bba5f`, taken from the checkout's curated directory before any change: 230 files, tree SHA-256 `1e74da65…d313`. It has 291 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 316 profiles (91 variant shards, 146 search shards, 752 search entries, 316 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 291, and added exactly the 25 imported H7 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (38 shard files removed, 47 written, 191 unchanged; 238 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h7store-import/`, are byte-identical: 47 files each, tree SHA-256 `bd54396e0a43f624088e8f7c86cd71fa55d5751bf752768cd30f48722ad0cc26` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 291 to 316 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning the catalog count of 291.

## Pipeline rejections and holds

None. All 25 H7 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 173 of positions 1-175 are now published (H1 to H7). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 151 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H7 does not change this.
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 316 profiles it took 3.7 s when the four required suites ran together, and 2.7 s when the `scripts/nutrition` directory ran with file parallelism off (13 files, 181/181 passed). When the whole directory ran in parallel on this host, it timed out at 5.0 s (180/181, that test only). The timeout was not changed here. It needs an explicit timeout, and the need grows with each batch.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 316-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h7-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification. The acknowledgement file is `~/workspace/private-data/h7store-import/acks.json`.
