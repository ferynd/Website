# Population batch H2: import report (#63, third-pass batch H2)

Prepared: 2026-11-12. Base: `main` at `718b25a` (PR #233, the H1 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H2 is positions 26-50 of the approved-326 file, in file order. It is the second batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 168 to **193** profiles. Every candidate passed the five-core-field preflight (energy, protein, carbohydrate, total fat, and sodium rows all present in the pinned record), so nothing was held this batch. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, except the source rows quoted for the one acknowledged warning and the source zeros named in the preflight, plus aggregate coverage counts.

Related: [H1 import report](population-batch-h1-import.md) · [G4 import report](population-batch-g4-import.md) · [G3 import report](population-batch-g3-import.md) · [G2 import report](population-batch-g2-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H2) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Held | 0 |
| Reviewed match entries for H2 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 23 |
| from Foundation 2026-10-29 | 2 |
| Source-match table entries after this import | 193 (was 168) |
| Catalog profile count after this import | **193** (was 168) |

Store and batch identifiers: store `~/workspace/private-data/h2store-import` (never `/tmp`), parent batch id **`rb-6b988d999b504f0ee63373ae`**, pass id `rp-af164dfd34d6341857d3c6c3`, source release `2018-04+2026-10-29` (each job is stamped with its own match-entry release), reviewer `pumpkin-h2-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H1. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H2 source).

Run history: the first H2 run was killed by SIGTERM after the match-table append and before any jobs were created. Its appended table was re-verified (the 25 entries equal approved-326 positions 26-50 by targetId, fdcId, and verbatim description, and the 168 existing entries are a byte-unchanged prefix) and kept. Its partial store held indexed sources only, no jobs file, and a stale lock from the dead process, so it was removed and recreated fresh at the same path; only the one H2 working store is kept.

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, and that check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 26-50 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from two chunked batches: `…324a8590aab0` (13) and `…4ffb619731c7` (12).
- Positions 1-25 (H1) are all published (`h1AllPublished: true`), and none of the 25 H2 ids had a match entry before this batch.

The match table now has 193 entries, and the 168 existing entries are a byte-unchanged prefix. Each H2 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, and the competing records that are not this product (with explicit boundaries where a near record must not use these values, for example UV-exposed mushrooms, salted almond butter, and the Foundation leek bulb-and-greens record). Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H2 as positions 26-50 of approved-326), the source bundle and approved-file position, and the pinned-record verification.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields traceably present in the pinned record. Two core values are source zeros, and both are the source's own rows, so they count as present: `almond-raw-unsalted` sodium (0 mg, Foundation, derivation A, analytical) and `brazil-nut-raw-unsalted` sodium (0 mg, Foundation, derivation A, analytical). Result: 0 holds and 0 pipeline rejections.

| Approved position | Id | Source | Preflight |
| ---: | --- | --- | --- |
| 26 | mushroom-cremini-raw | SR Legacy 168434 | pass |
| 27 | mushroom-enoki-raw | SR Legacy 169382 | pass |
| 28 | mushroom-maitake-raw | SR Legacy 169403 | pass |
| 29 | mushroom-morel-raw | SR Legacy 168423 | pass |
| 30 | mushroom-oyster-raw | SR Legacy 168580 | pass |
| 31 | mushroom-shiitake-dried | SR Legacy 168436 | pass |
| 32 | mushroom-shiitake-raw | SR Legacy 169242 | pass |
| 33 | mushroom-white-button-cooked-without-added-fat | SR Legacy 169252 | pass |
| 34 | mushroom-white-button-raw | SR Legacy 169251 | pass |
| 35 | almond-butter-unsalted-as-sold | SR Legacy 168588 | pass |
| 36 | almond-dry-roasted-salted | SR Legacy 168596 | pass |
| 37 | almond-raw-unsalted | Foundation 2346393 | pass (sodium is a source analytical 0) |
| 38 | brazil-nut-raw-unsalted | Foundation 2515373 | pass (sodium is a source analytical 0) |
| 39 | fennel-bulb-raw | SR Legacy 169385 | pass |
| 40 | jalapeno-pepper-raw | SR Legacy 168576 | pass |
| 41 | jerusalem-artichoke-raw | SR Legacy 169236 | pass |
| 42 | jicama-raw | SR Legacy 170073 | pass |
| 43 | kale-raw | SR Legacy 168421 | pass |
| 44 | leek-white-and-light-green-parts-raw | SR Legacy 169246 | pass |
| 45 | lettuce-butterhead-raw | SR Legacy 168429 | pass |
| 46 | lettuce-green-leaf-raw | SR Legacy 169249 | pass |
| 47 | lettuce-iceberg-raw | SR Legacy 169248 | pass |
| 48 | lettuce-red-leaf-raw | SR Legacy 168431 | pass |
| 49 | lettuce-romaine-raw | SR Legacy 169247 | pass |
| 50 | lotus-root-raw | SR Legacy 169250 | pass |

## Pipeline run and validation

All 25 jobs were enqueued for the explicit H2 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. The prepare pass validated 25 with 0 errors and 1 warning. All 25 were hash-approved by review content hash (reviewer `pumpkin-h2-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. Each acknowledged warning and its reason are stored in the job's review notes.

**Acknowledged warning (1).**

1. `fennel-bulb-raw`: "Fat classes sum (0.33 g) exceeds total fat (0.2 g) by >5%". The pinned SR Legacy 169385 record's own rows are total lipid (1004) 0.2 g, no derivation code with 2 data points, against saturated (1258) 0.09 g, monounsaturated (1292) 0.068 g, and polyunsaturated (1293) 0.169 g, all derivation NC with 0 data points, and trans (1257) 0 g, derivation Z. The draft values equal those pinned rows with the same derivation codes (the field replay below found 0 mismatches), so the inconsistency is in the source record itself, at a very low total-fat level, and no value was adjusted. This is the same treatment as the A3 pear (SR 169118) and H1 green plantain (SR 168215) precedents: documented, not presented as explained.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 960 |
| Unknown | 715 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 364, calculated 138, source_reported 356, assumed_zero 102 (all numeric 0 with a Z derivation code), unknown 715. Unknown gaps: not reported by source 653, definition mismatch 40, partial components 22. No core field is missing on any imported profile, and no type faults were found. A field replay against the pinned rows checked 932 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (25) and `omega3` as `sum:ALA+EPA+DHA` (3).

## Imported profiles (completed imports)

almond-butter-unsalted-as-sold, almond-dry-roasted-salted, almond-raw-unsalted, brazil-nut-raw-unsalted, fennel-bulb-raw, jalapeno-pepper-raw, jerusalem-artichoke-raw, jicama-raw, kale-raw, leek-white-and-light-green-parts-raw, lettuce-butterhead-raw, lettuce-green-leaf-raw, lettuce-iceberg-raw, lettuce-red-leaf-raw, lettuce-romaine-raw, lotus-root-raw, mushroom-cremini-raw, mushroom-enoki-raw, mushroom-maitake-raw, mushroom-morel-raw, mushroom-oyster-raw, mushroom-shiitake-dried, mushroom-shiitake-raw, mushroom-white-button-cooked-without-added-fat, mushroom-white-button-raw.

## V4 cumulative proof

The published base (a frozen copy of main at `718b25a`, verified identical to the checkout's curated directory before the run) has 168 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 193 profiles (71 variant shards, 122 search shards, 461 search entries, 193 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 168, and added exactly the 25 H2 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/`, and a reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h2store-import/`, are byte-identical: 40 files each, tree SHA-256 `bc541b97a5c9e677cad8035609f8ae5101c065bd980aeebb69b5f47cb684ae51` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 168 to 193 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning 168.

## Pipeline rejections and holds

None. All 25 candidates passed the join, the pinned-record verification, and the five-core-field preflight.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, positions 1-50 are now published (H1 and H2), and 276 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

None for this batch. The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 193-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts (join and preflight, match-table append, pipeline driver, and V4 verification) are kept outside the checkout under `~/workspace/private-data/h2-scripts/`.
