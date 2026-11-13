# Population batch H14: import report (#63, third-pass batch H14)

Prepared: 2026-11-13. Base: `main` at `8bd0d6f` (PR #245, the H13 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H14 is position 326 of the approved-326 file, the last approved pair in file order, from SR Legacy 2018-04. It is a single-item batch and the final batch of the third-pass (H) lane. **1 was attempted and 1 is published**: the curated catalog goes from 466 to **467** profiles. The id passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so nothing was held and there was no pipeline rejection. Its source record is not used by any existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the one core source-zero sodium row, this report holds no nutrient values, only aggregate coverage counts.

**This completes the H lane.** All 326 approved third-pass pairs have now been attempted (H1 to H14), and 324 are published. The only remaining H-lane holds are `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5). Both pinned records report 902 kcal per 100 g, over the registry's 900 kcal calorie hard maximum, and both await James's registry decision.

Related: [H13 import report](population-batch-h13-import.md) · [H12 import report](population-batch-h12-import.md) · [H5 import report](population-batch-h5-import.md) · [H4 import report](population-batch-h4-import.md) · [H1 import report](population-batch-h1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H14) | 1 |
| Joined verdict to candidate entry and verified against the pinned record | 1 |
| Passed the five-core-field preflight | 1 |
| Passed the registry per-100 g hard-maximum check | 1 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H14 in the table | 1 |
| Profiles validated, approved, staged, and imported | **1** |
| from SR Legacy 2018-04 | 1 |
| from Foundation 2026-10-29 | 0 |
| Validation warnings acknowledged with a documented reason | 0 |
| Source-match table entries after this import | 467 (was 466) |
| Catalog profile count after this import | **467** (was 466) |

Store and batch identifiers: store `~/workspace/private-data/h14store-import` (never `/tmp`), parent batch id **`rb-01ced198e0a4955f24c5a0e1`** (derived over the 1 attempted id), pass id `rp-67daf2f9fa4839a9daad821e`, source release `2018-04`, reviewer `pumpkin-h14-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H13. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is the H14 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H13. That check was run before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Position 326 of that order is `pear-asian-raw` (`exactMatch: true`, `derivedSliceMatch: true`), the target named in the brief from the Q-036 merge record (issue #215). The brief named only the target id. The dataset, release, fdcId, and verbatim description were taken from the approved file (`sr-legacy`, `2018-04`, `168177`, "Pears, asian, raw") and verified against the pinned record. It comes from bundle 2 `…717e51249110`.
- Positions 1-325 (H1 to H13) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (323 published), and `pear-asian-raw` had no match entry before this batch. The base table had 466 entries.

The match table now has 467 entries, and the 466 existing entries are a byte-unchanged prefix (the diff is insertions only). The H14 entry's stateEvidence carries the pinned-record facts (NDB 9340, *Pyrus pyrifolia*, two whole-fruit portions), the approved pair rationale verbatim, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values: generic raw pears (SR 169118, *Pyrus communis*), the source of `pear-european-with-skin-raw`; the SR Legacy Bartlett, red Anjou, Bosc, and green Anjou records and the Foundation Bartlett and green Anjou records, all European pear varieties; heavy-syrup drained canned pears (SR 168182), the source of `pear-canned-in-heavy-syrup-drained`; dried sulfured uncooked pears; and raw prickly pears (SR 167750), the source of `prickly-pear-fruit-raw`, matched only on the name. All 10 competing fdcIds cited in the boundary exist in the pinned files with the cited descriptions, and each of the 3 "is the source of" claims was checked against the match table. The rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H14 as position 326 of the approved-326 file), the source bundle and approved-file position, and the pinned-record verification. The approved rationale is a source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record. The candidate entry carries no conflict note.

The existing `pear-european-with-skin-raw` entry (A3, ANSWER Q-015) already names Asian pear 168177 as narrower than the generic raw pear record. That entry is unchanged, and the two profiles stay separate.

## Preflight (five core fields)

The id passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All five core fields (energy row 1008, protein, carbohydrate by difference, total fat, sodium) are present directly in the pinned record.

One core value is a source zero, sodium (row 1093). It is the source's own row, so it counts as present, as in the H1, H2, H5, H10, H12, and H13 source-zero precedents, and it is documented in the entry's stateEvidence:

| Id | Source | Sodium row derivation code | Q-004 status |
| --- | --- | --- | --- |
| pear-asian-raw | SR 168177 | none | source_reported |

It is not Z-coded, so it is not `assumed_zero`.

Before any match-table edit, every row of the pinned record was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 326 | pear-asian-raw | SR Legacy 168177 | pass (uncoded source-zero sodium) | imported |

## Pipeline run and validation

The job was enqueued for the explicit H14 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run. The join and preflight were run twice, once from the checkout's table and once from a snapshot of the base table, and the two outputs are byte-identical.

The prepare pass validated 1 with 0 errors and 0 warnings, so the acknowledgement file is empty and there was nothing to acknowledge. The review packet showed no identity mismatch. The job was hash-approved by review content hash (reviewer `pumpkin-h14-import`). Its approved hash equals its review packet content hash (1 of 1 hash-bound approved).

## Field coverage of the imported profile

Coverage is counted on the 1 imported profile only, over its 67 quality-tracked fields:

| Measure | Count |
| --- | ---: |
| Cells | 67 |
| Resolved | 41 |
| Unknown | 26 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 0, calculated 3 (energy, carbohydrate, folate; all NC-coded), source_reported 33, assumed_zero 5 (all numeric 0, all Z rows replayed directly: vitamin B12, vitamin D, cholesterol, caffeine, trans fat), unknown 26. Unknown gaps: not reported by source 23, definition mismatch 2, partial components 1. No core field is missing, and no type faults were found. Energy comes from the record's classic energy row (1008). A field replay against the pinned rows checked 40 values with 0 mismatches (value and derivation code). One deterministic representation is identified in field provenance and was not replayed as a source row: `fiber` as `same_as:fiberTotal`.

## Imported profiles (completed imports)

pear-asian-raw.

## V4 cumulative proof

The published base was a frozen copy of main at `8bd0d6f`, taken from the checkout's curated directory before any change: 273 files, tree SHA-256 `33f685cb…211b`. It has 466 profiles (112 variant shards, 160 search shards, 1,065 search entries, 466 revisions) and 0 defects. The staged set has 1 profile and 0 defects. `combineCatalogs(published, staged)` gave 467 profiles (112 variant shards, 160 search shards, 1,067 search entries, 467 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 466, and added exactly `pear-asian-raw`. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (3 shard files removed, 4 written including the manifest, 269 unchanged; 273 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h14store-import/` (`stage-a`, `stage-b`), are byte-identical: 4 files each, tree SHA-256 `f8dcc312afa97e6e4c1db9749f4ca6f9d55dd1f45f635502c7bcbd5f0974c6ad` for both. A full pipeline rerun (enqueue and run the id again) left the store at 1 job, 1 unique job key, and 1 unique manifest id, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 466 to 467 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of the tracked `public/`, `scripts/`, and `tests/` sources outside the catalog data found no other test pinning the catalog count of 466. The shipped-catalog V4 test took 8.7 s in the parallel `scripts/nutrition` run, within its explicit 30 s timeout from H12.

## Pipeline rejections and holds

None in H14. `pear-asian-raw` was imported. It did not fail the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch (H lane complete)

All 326 third-pass APPROVED pairs have now been attempted, in file order, across H1 to H14. 324 are published. The 2 not published are registry-cap pipeline rejections: `beef-tallow-as-sold` (position 100, H4) and `lard-as-sold` (position 108, H5). Each pinned record reports 902 kcal per 100 g, over the registry's 900 kcal hard maximum, and both await James's registry decision. No approved pair remains unattempted. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H4](population-batch-h4-import.md) and [H5](population-batch-h5-import.md) reports). H14 does not change this. They are the only remaining H-lane holds.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same id against the published 467-profile catalog creates no duplicates. The job is hash-bound to the same match entry, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h14-scripts/` (adapted from `h13-scripts/` by `gen-from-h13.cjs`): join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification (with the field replay). The acknowledgement file is `~/workspace/private-data/h14store-import/acks.json` (empty; no warnings).
