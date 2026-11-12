# Population batch H3: import report (#63, third-pass batch H3)

Prepared: 2026-11-12. Base: `main` at `4dc248b` (PR #234, the H2 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H3 is positions 51-75 of the approved-326 file, in file order. It is the third batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 193 to **218** profiles. Every candidate passed the five-core-field preflight (energy, protein, carbohydrate, total fat, and sodium rows all present in the pinned record), including the two Foundation records, so nothing was held this batch. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Related: [H2 import report](population-batch-h2-import.md) · [H1 import report](population-batch-h1-import.md) · [G4 import report](population-batch-g4-import.md) · [G3 import report](population-batch-g3-import.md) · [G2 import report](population-batch-g2-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H3) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Held | 0 |
| Reviewed match entries for H3 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 23 |
| from Foundation 2026-10-29 | 2 |
| Source-match table entries after this import | 218 (was 193) |
| Catalog profile count after this import | **218** (was 193) |

Store and batch identifiers: store `~/workspace/private-data/h3store-import` (never `/tmp`), parent batch id **`rb-7ebd038dca3187a38ff4671a`**, pass id `rp-f14b7f9500935c0e58328481`, source release `2018-04+2026-10-29` (each job is stamped with its own match-entry release), reviewer `pumpkin-h3-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H2. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H3 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, and that check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 51-75 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from two chunked batches: `…4ffb619731c7` (7) and `…52614fc5660e` (18).
- Positions 1-50 (H1 and H2) are all published, and none of the 25 H3 ids had a match entry before this batch.

The match table now has 218 entries, and the 193 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H3 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, and the competing records that are not this product (with explicit boundaries where a near record must not use these values, for example the salted boiled onion and eggplant records, the Foundation red-potato-without-skin record, the Foundation destemmed napa leaf record, and the peeled versus with-peel cucumber records). Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H3 as positions 51-75 of approved-326), the source bundle and approved-file position, and the pinned-record verification. None of the 25 approved rationales carries a condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields traceably present in the pinned record, and none of the core values is a source zero. The two Foundation records are not hollow: `onion-white-raw` (1104962) carries energy (1008), protein, total fat, carbohydrate, and sodium rows, and `bok-choy-raw` (2685572) carries the Atwater specific-factor energy row (2048) plus protein, total fat, carbohydrate, and sodium rows. Result: 0 holds and 0 pipeline rejections.

| Approved position | Id | Source | Preflight |
| ---: | --- | --- | --- |
| 51 | mustard-greens-raw | SR Legacy 169256 | pass |
| 52 | okra-raw | SR Legacy 169260 | pass |
| 53 | onion-cooked-without-added-fat | SR Legacy 170001 | pass |
| 54 | onion-white-raw | Foundation 1104962 | pass |
| 55 | parsnip-raw | SR Legacy 170417 | pass |
| 56 | potato-red-with-skin-raw | SR Legacy 170029 | pass |
| 57 | pumpkin-raw | SR Legacy 168448 | pass |
| 58 | bok-choy-raw | Foundation 2685572 | pass (energy from the 2048 Atwater specific-factor row) |
| 59 | broccoli-rabe-raw | SR Legacy 170381 | pass |
| 60 | brussels-sprouts-raw | SR Legacy 170383 | pass |
| 61 | butternut-squash-raw | SR Legacy 169295 | pass |
| 62 | cabbage-napa-raw | SR Legacy 169979 | pass |
| 63 | cabbage-red-raw | SR Legacy 169977 | pass |
| 64 | cabbage-savoy-raw | SR Legacy 170388 | pass |
| 65 | cassava-raw | SR Legacy 169985 | pass |
| 66 | celery-raw | SR Legacy 169988 | pass |
| 67 | chayote-raw | SR Legacy 170402 | pass |
| 68 | chinese-broccoli-raw | SR Legacy 169404 | pass |
| 69 | collard-greens-raw | SR Legacy 170406 | pass |
| 70 | cucumber-peeled-raw | SR Legacy 169225 | pass |
| 71 | cucumber-with-peel-raw | SR Legacy 168409 | pass |
| 72 | dandelion-greens-raw | SR Legacy 169226 | pass |
| 73 | eggplant-cooked-without-added-fat | SR Legacy 169229 | pass |
| 74 | eggplant-raw | SR Legacy 169228 | pass |
| 75 | endive-raw | SR Legacy 168412 | pass |

## Pipeline run and validation

All 25 jobs were enqueued for the explicit H3 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. The prepare pass validated 25 with 0 errors and 0 warnings. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h3-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry; the acknowledgement file for this batch is empty because no job carries a warning.

**Acknowledged warnings: none.** No validation warning was raised, so none was acknowledged or swallowed.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 970 |
| Unknown | 705 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 192, calculated 113, source_reported 548, assumed_zero 117 (all numeric 0 with a Z derivation code), unknown 705. Unknown gaps: not reported by source 633, definition mismatch 47, partial components 25. No core field is missing on any imported profile, and no type faults were found. A field replay against the pinned rows checked 945 values with 0 mismatches (value and derivation code). One deterministic representation is identified in field provenance and was not replayed as a source row: `fiber` as `same_as:fiberTotal` (25).

## Imported profiles (completed imports)

bok-choy-raw, broccoli-rabe-raw, brussels-sprouts-raw, butternut-squash-raw, cabbage-napa-raw, cabbage-red-raw, cabbage-savoy-raw, cassava-raw, celery-raw, chayote-raw, chinese-broccoli-raw, collard-greens-raw, cucumber-peeled-raw, cucumber-with-peel-raw, dandelion-greens-raw, eggplant-cooked-without-added-fat, eggplant-raw, endive-raw, mustard-greens-raw, okra-raw, onion-cooked-without-added-fat, onion-white-raw, parsnip-raw, potato-red-with-skin-raw, pumpkin-raw.

## V4 cumulative proof

The published base (a frozen copy of main at `4dc248b`, verified identical to the checkout's curated directory before the run: 194 files, tree SHA-256 `2b721a76…c48d` for both) has 193 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 218 profiles (79 variant shards, 129 search shards, 510 search entries, 218 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 193, and added exactly the 25 H3 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/`, and a reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h3store-import/`, are byte-identical: 50 files each, tree SHA-256 `ddf51e0f8548df5a0352ec2af6a29c3dac788bdd213a67ae27edd36e3f7affa9` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 193 to 218 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning the catalog count of 193 (the only other `193` in a test file is an unrelated protein-target comment in `targetEngine.test.js`).

## Pipeline rejections and holds

None. All 25 candidates passed the join, the pinned-record verification, and the five-core-field preflight.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, positions 1-75 are now published (H1, H2, and H3), and 251 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

None for this batch. The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 218-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts (join and preflight, match-table append, pipeline driver, and V4 verification) are kept outside the checkout under `~/workspace/private-data/h3-scripts/`.
