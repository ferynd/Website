# Population batch H6: import report (#63, third-pass batch H6)

Prepared: 2026-11-12. Base: `main` at `019f5ea` (PR #237, the H5 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H6 is positions 126-150 of the approved-326 file, in file order: 21 SR Legacy 2018-04 and 4 Foundation 2026-10-29. It is the sixth batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 266 to **291** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H6 ids share a source record, and no H6 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H5 import report](population-batch-h5-import.md) · [H4 import report](population-batch-h4-import.md) · [H3 import report](population-batch-h3-import.md) · [H2 import report](population-batch-h2-import.md) · [H1 import report](population-batch-h1-import.md) · [G4 import report](population-batch-g4-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H6) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H6 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 21 |
| from Foundation 2026-10-29 | 4 |
| Source-match table entries after this import | 291 (was 266) |
| Catalog profile count after this import | **291** (was 266) |

Store and batch identifiers: store `~/workspace/private-data/h6store-import` (never `/tmp`), parent batch id **`rb-a17af1e1b57575a2dfa61401`** (derived over the 25 attempted ids), pass id `rp-b8c2e2e8013c3ba00ac08553`, source release `2018-04+2026-10-29`, reviewer `pumpkin-h6-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H5. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H6 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H5. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 126-150 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from four chunked batches: `…6cdf8320404d` (2), `…82a27cb82761` (7), `…8fe63e79c3a7` (14), and `…938429bc2e87` (2).
- Positions 1-125 (H1 to H5) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (123 published), and none of the 25 H6 ids had a match entry before this batch. The base table had 266 entries.

The match table now has 291 entries, and the 266 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H6 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: the other bell pepper colors and the Foundation yellow bell pepper record; cooked ground beef states and other lean/fat formulations; other pork loin cuts and trims, pork shoulder sub-cuts, backfat, and separable fat; raw, oil-roasted, salted, and unsalted variants of each nut and seed; nut and seed butters; whole (in-hull) pumpkin seeds; other tahini kernel types; other tofu coagulants and firmness; and lean-only and single-grade flank steak. Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H6 as positions 126-150 of approved-326), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, dataType SR Legacy or Foundation as named, verbatim description). All 25 had the five core fields traceably present in the pinned record. Some core values are source zeros. Each is the source's own row, so it counts as present:

- Z (assumed zero): carbohydrate for `ground-beef-75-percent-lean-25-percent-fat-raw-raw-formulation-75-25`, `pork-belly-raw`, `pork-shoulder-lean-and-fat-raw`, and `beef-flank-steak-raw` (status assumed_zero).
- NC (calculated): carbohydrate for `ground-beef-97-percent-lean-3-percent-fat-raw-raw-formulation-97-3` (status calculated).
- PIK: carbohydrate for `pork-loin-chop-boneless-raw` (status source_reported).
- A (analytical): sodium for the four Foundation records `chia-seed-raw-unsalted`, `pine-nut-raw-unsalted`, `pumpkin-seed-hulled-raw-unsalted`, and `sunflower-seed-hulled-raw-unsalted` (status measured).

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H6 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 126 | bell-pepper-yellow-raw | SR Legacy 169383 | pass | imported |
| 127 | bitter-melon-raw | SR Legacy 168393 | pass | imported |
| 128 | ground-beef-75-percent-lean-25-percent-fat-raw-raw-formulation-75-25 | SR Legacy 174037 | pass (carbohydrate Z zero) | imported |
| 129 | ground-beef-97-percent-lean-3-percent-fat-raw-raw-formulation-97-3 | SR Legacy 173111 | pass (carbohydrate NC zero) | imported |
| 130 | bratwurst-cooked-as-sold | SR Legacy 171620 | pass | imported |
| 131 | canadian-bacon-as-sold | SR Legacy 167869 | pass | imported |
| 132 | pork-belly-raw | SR Legacy 167812 | pass (carbohydrate Z zero) | imported |
| 133 | pork-loin-chop-boneless-raw | SR Legacy 167839 | pass (carbohydrate PIK zero) | imported |
| 134 | pork-shoulder-lean-and-fat-raw | SR Legacy 167843 | pass (carbohydrate Z zero) | imported |
| 135 | cashew-dry-roasted-salted | SR Legacy 169421 | pass | imported |
| 136 | cashew-raw-unsalted | SR Legacy 170162 | pass | imported |
| 137 | chia-seed-raw-unsalted | Foundation 2710819 | pass (sodium A zero; energy from row 2048) | imported |
| 138 | macadamia-nut-raw-unsalted | SR Legacy 170178 | pass | imported |
| 139 | peanut-dry-roasted-salted | SR Legacy 174262 | pass | imported |
| 140 | peanut-raw-unsalted | SR Legacy 172430 | pass | imported |
| 141 | pine-nut-raw-unsalted | Foundation 2346392 | pass (sodium A zero; energy from row 2048) | imported |
| 142 | pistachio-dry-roasted-salted | SR Legacy 169426 | pass | imported |
| 143 | pistachio-raw-unsalted | SR Legacy 170184 | pass | imported |
| 144 | pumpkin-seed-hulled-dry-roasted-salted | SR Legacy 169415 | pass | imported |
| 145 | pumpkin-seed-hulled-raw-unsalted | Foundation 2515380 | pass (sodium A zero; energy from row 2048) | imported |
| 146 | sunflower-seed-hulled-dry-roasted-salted | SR Legacy 169418 | pass | imported |
| 147 | sunflower-seed-hulled-raw-unsalted | Foundation 2515381 | pass (sodium A zero; energy from row 2048) | imported |
| 148 | tahini-sesame-paste-as-sold | SR Legacy 170189 | pass | imported |
| 149 | tofu-firm-calcium-set-as-sold | SR Legacy 172475 | pass | imported |
| 150 | beef-flank-steak-raw | SR Legacy 169563 | pass (carbohydrate Z zero) | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H6 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run.

The prepare pass validated 25 with 0 errors and 0 warnings. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h6-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. With no warnings, the acknowledgement file is empty (`{}`).

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 907 |
| Unknown | 768 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 269, calculated 123, source_reported 416, assumed_zero 99 (all numeric 0; the replay below found 93 source rows with a Z derivation code), unknown 768. Unknown gaps: not reported by source 720, definition mismatch 30, partial components 18. The four Foundation profiles resolve fewer fields (17 to 22 each) because their Foundation records carry fewer nutrient rows. The 21 SR Legacy profiles resolve 29 to 44 each. No core field is missing on any imported profile, and no type faults were found. 21 profiles take energy from the record's classic energy row (1008). The four Foundation profiles have no 1008 row, so they take energy from the Atwater specific factor row (2048), as the pipeline's energy preference order (1008, 2048, 2047) requires. A field replay against the pinned rows checked 876 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (24) and `omega3` as `sum:ALA+EPA+DHA` (7).

## Imported profiles (completed imports)

beef-flank-steak-raw, bell-pepper-yellow-raw, bitter-melon-raw, bratwurst-cooked-as-sold, canadian-bacon-as-sold, cashew-dry-roasted-salted, cashew-raw-unsalted, chia-seed-raw-unsalted, ground-beef-75-percent-lean-25-percent-fat-raw-raw-formulation-75-25, ground-beef-97-percent-lean-3-percent-fat-raw-raw-formulation-97-3, macadamia-nut-raw-unsalted, peanut-dry-roasted-salted, peanut-raw-unsalted, pine-nut-raw-unsalted, pistachio-dry-roasted-salted, pistachio-raw-unsalted, pork-belly-raw, pork-loin-chop-boneless-raw, pork-shoulder-lean-and-fat-raw, pumpkin-seed-hulled-dry-roasted-salted, pumpkin-seed-hulled-raw-unsalted, sunflower-seed-hulled-dry-roasted-salted, sunflower-seed-hulled-raw-unsalted, tahini-sesame-paste-as-sold, tofu-firm-calcium-set-as-sold.

## V4 cumulative proof

The published base was a frozen copy of main at `019f5ea`. Before the run it was verified identical to the checkout's curated directory: 226 files, tree SHA-256 `02766bc3…19c7` for both. It has 266 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 291 profiles (87 variant shards, 142 search shards, 695 search entries, 291 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 266, and added exactly the 25 imported H6 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (45 shard files removed, 50 written, 180 unchanged; 230 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h6store-import/`, are byte-identical: 50 files each, tree SHA-256 `df74cb48fb0837e195c2aaf8be1cf04a4f88220c1b5e3294c5a23877b2ab53b3` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 266 to 291 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning the catalog count of 266.

## Pipeline rejections and holds

None. All 25 H6 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 148 of positions 1-150 are now published (H1 to H6). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 176 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H6 does not change this.
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 291 profiles it took 3.4 s when the four required suites ran together, and 2.6 s when the `scripts/nutrition` directory ran with file parallelism off (13 files, 181/181 passed). When the whole directory ran in parallel on this host, it timed out at 5.5 s (180/181, that test only). The timeout was not changed here. It needs an explicit timeout, and the need grows with each batch.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 291-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h6-scripts/`: join and preflight (with the registry hard-maximum check), match-table append (with the evidence and the empty hold set), the pipeline driver, and V4 verification. The acknowledgement file is `~/workspace/private-data/h6store-import/acks.json`.
