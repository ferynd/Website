# Population batch H8: import report (#63, third-pass batch H8)

Prepared: 2026-11-12. Base: `main` at `036d662` (PR #239, the H7 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H8 is positions 176-200 of the approved-326 file, in file order, all 25 from SR Legacy 2018-04. It is the eighth batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 316 to **341** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H8 ids share a source record, and no H8 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H7 import report](population-batch-h7-import.md) · [H6 import report](population-batch-h6-import.md) · [H5 import report](population-batch-h5-import.md) · [H4 import report](population-batch-h4-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H8) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H8 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 25 |
| Validation warnings acknowledged with a documented reason | 0 |
| Source-match table entries after this import | 341 (was 316) |
| Catalog profile count after this import | **341** (was 316) |

Store and batch identifiers: store `~/workspace/private-data/h8store-import` (never `/tmp`), parent batch id **`rb-98e3c3413240786333747dda`** (derived over the 25 attempted ids), pass id `rp-4cf3903e117b16ca689ea73d`, source release `2018-04`, reviewer `pumpkin-h8-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H7. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H8 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H7. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 176-200 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from four chunked batches: `…c133ca970816` (4), `…d29ae758b859` (4), `…d79a47789d55` (6), and `…e801dd4d2841` (11).
- Positions 1-175 (H1 to H7) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (173 published), and none of the 25 H8 ids had a match entry before this batch. The base table had 316 entries.

The match table now has 341 entries, and the 316 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H8 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: dark and high-fructose corn syrups and table blends; liquid versus dry tabletop fructose; Canadian maple syrup, maple sugar, and pancake blends; generic and Foundation dry lentils versus red lentils; cooked, canned, and sprouted navy beans, adzuki beans, and split peas; cooked tempeh; ground mace and nutmeg butter; dried thyme and marjoram; the Pacific tomato-sauce sardine; steamed, raw, fried, imitation, and Foundation frozen scallops; Foundation frozen sea bass, squid, and swordfish records and the Foundation farm-raised tilapia; other tuna species and canned tunas; and the prepared, cubed, low-sodium, reduced-sodium, condensed, and branded beef broths and bouillons. Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H8 as positions 176-200 of approved-326), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in SR Legacy 2018-04, dataType SR Legacy, verbatim description). All 25 had the five core fields traceably present in the pinned record. Some core values are source zeros. Each is the source's own row, so it counts as present:

- Z (assumed zero): carbohydrate for `sardine-with-bones-canned-oil-packed-drained`, `sea-bass-raw`, `swordfish-raw`, `tuna-bluefin-raw`, and `tuna-yellowfin-raw` (status assumed_zero).
- NC (calculated): carbohydrate for `tilapia-raw` (status calculated).
- A (analytical): protein for `corn-syrup-light-as-sold` (status measured).
- No derivation code: protein and total fat for `fructose-as-sold`, and total fat for `malt-syrup-as-sold` (status source_reported).

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H8 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 176 | corn-syrup-light-as-sold | SR Legacy 168837 | pass (protein A zero) | imported |
| 177 | fructose-as-sold | SR Legacy 169896 | pass (protein and total fat zeros, no code) | imported |
| 178 | malt-syrup-as-sold | SR Legacy 169660 | pass (total fat zero, no code) | imported |
| 179 | maple-syrup-as-sold | SR Legacy 169661 | pass | imported |
| 180 | lentil-red-dry | SR Legacy 174284 | pass | imported |
| 181 | navy-bean-dry | SR Legacy 173745 | pass | imported |
| 182 | split-pea-green-dry | SR Legacy 172428 | pass | imported |
| 183 | tempeh-plain-as-sold | SR Legacy 174272 | pass | imported |
| 184 | lemongrass-fresh | SR Legacy 168573 | pass | imported |
| 185 | nutmeg-dry-ground-or-powdered | SR Legacy 171326 | pass | imported |
| 186 | oregano-dried | SR Legacy 171328 | pass | imported |
| 187 | tarragon-dried | SR Legacy 170937 | pass | imported |
| 188 | turmeric-dry-ground-or-powdered | SR Legacy 172231 | pass | imported |
| 189 | adzuki-bean-dry | SR Legacy 173727 | pass | imported |
| 190 | sardine-with-bones-canned-oil-packed-drained | SR Legacy 175139 | pass (carbohydrate Z zero) | imported |
| 191 | scallop-cooked-moist-heat | SR Legacy 167742 | pass | imported |
| 192 | scallop-raw | SR Legacy 174220 | pass | imported |
| 193 | sea-bass-raw | SR Legacy 175142 | pass (carbohydrate Z zero) | imported |
| 194 | squid-raw | SR Legacy 174223 | pass | imported |
| 195 | swordfish-raw | SR Legacy 173703 | pass (carbohydrate Z zero) | imported |
| 196 | tilapia-raw | SR Legacy 175176 | pass (carbohydrate NC zero) | imported |
| 197 | tuna-bluefin-raw | SR Legacy 173706 | pass (carbohydrate Z zero) | imported |
| 198 | tuna-yellowfin-raw | SR Legacy 175159 | pass (carbohydrate Z zero) | imported |
| 199 | beef-bouillon-concentrated-dry | SR Legacy 171560 | pass | imported |
| 200 | beef-broth-regular-ready-to-use | SR Legacy 171538 | pass | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H8 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run.

The prepare pass validated 25 with 0 errors and 0 warnings. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h8-import`); each job's approved hash equals its review packet content hash. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry.

**Acknowledged warnings (0).** No H8 job carried a validation warning, so nothing was acknowledged. The acknowledgement file `~/workspace/private-data/h8store-import/acks.json` is empty (`{}`).

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 974 |
| Unknown | 701 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 298, calculated 126, source_reported 452, assumed_zero 98 (all numeric 0, all Z rows: 90 replayed directly, plus 8 `fiber` cells aliasing a Z `fiberTotal` row), unknown 701. Unknown gaps: not reported by source 650, definition mismatch 34, partial components 17. The profiles resolve 31 to 44 fields each. No core field is missing on any imported profile, and no type faults were found. All 25 take energy from the record's classic energy row (1008). A field replay against the pinned rows checked 943 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (23) and `omega3` as `sum:ALA+EPA+DHA` (8).

## Imported profiles (completed imports)

adzuki-bean-dry, beef-bouillon-concentrated-dry, beef-broth-regular-ready-to-use, corn-syrup-light-as-sold, fructose-as-sold, lemongrass-fresh, lentil-red-dry, malt-syrup-as-sold, maple-syrup-as-sold, navy-bean-dry, nutmeg-dry-ground-or-powdered, oregano-dried, sardine-with-bones-canned-oil-packed-drained, scallop-cooked-moist-heat, scallop-raw, sea-bass-raw, split-pea-green-dry, squid-raw, swordfish-raw, tarragon-dried, tempeh-plain-as-sold, tilapia-raw, tuna-bluefin-raw, tuna-yellowfin-raw, turmeric-dry-ground-or-powdered.

## V4 cumulative proof

The published base was a frozen copy of main at `036d662`, taken from the checkout's curated directory before any change: 238 files, tree SHA-256 `bfffdaf5…b527`. It has 316 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 341 profiles (99 variant shards, 148 search shards, 795 search entries, 341 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 316, and added exactly the 25 imported H8 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (40 shard files removed, 51 written, 197 unchanged; 248 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h8store-import/` (`stage-a`, `stage-b`), are byte-identical: 51 files each, tree SHA-256 `b10a592a539b469f584040a5fa55b13b73c4714a4761e3c1ab170e94318dc00b` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 316 to 341 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning the catalog count of 316.

## Pipeline rejections and holds

None. All 25 H8 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 198 of positions 1-200 are now published (H1 to H8). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 126 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H8 does not change this.
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 341 profiles it took 3.8 s when the four required suites ran together. The `scripts/nutrition` directory passed with file parallelism off (13 files, 181/181). The timeout was not changed here. It needs an explicit timeout, and the need grows with each batch.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 341-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h8-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification. The acknowledgement file is `~/workspace/private-data/h8store-import/acks.json` (empty).
