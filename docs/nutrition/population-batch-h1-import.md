# Population batch H1: import report (#63, third-pass batch H1)

Prepared: 2026-11-12. Base: `main` at `9671269` (PR #232, the G4 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H1 is the first 25 pairs of the approved-326 file, in file order, per the GPT H1 preflight manifest. It is the first batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 143 to **168** profiles. Every candidate passed the five-core-field preflight (energy, protein, carbohydrate, total fat, and sodium rows all present in the pinned record), so nothing was held this batch. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, except the source rows quoted for the one acknowledged warning, plus aggregate coverage counts.

Related: [G4 import report](population-batch-g4-import.md) · [G3 import report](population-batch-g3-import.md) · [G2 import report](population-batch-g2-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H1) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Held | 0 |
| Reviewed match entries for H1 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 25 |
| from Foundation 2026-10-29 | 0 |
| Source-match table entries after this import | 168 (was 143) |
| Catalog profile count after this import | **168** (was 143) |

Store and batch identifiers: store `~/workspace/private-data/h1store-import` (never `/tmp`), parent batch id **`rb-16584e00045f2d82b14808ea`**, pass id `rp-fe51e562a23128de4b25e33d`, source release `2018-04`, reviewer `pumpkin-h1-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to G4. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H1 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, and that check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- None of the 326 overlaps the 143 published match entries.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- The first 25 of that order are exactly the 25 ids in the brief (`exactMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`), and they equal the GPT H1 preflight manifest selection entry for entry (`manifestMatch: true`). They come from three chunked batches: `…060946c9feb1` (11), `…12dda3031493` (13), and `…324a8590aab0` (1).

The match table now has 168 entries, and the 143 existing entries are a byte-unchanged prefix. Each H1 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, and the competing records that are not this product. Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H1 as the first 25 of the approved-326 file per the GPT H1 preflight manifest), the source bundle and approved-file position, and the pinned-record verification.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, dataType SR Legacy, verbatim description). All 25 had the five core fields traceably present in the pinned record. Two core values are source zeros, and both are the source's own rows, so they count as present: `plum-raw` sodium (0 mg, derivation A, analytical) and `pork-tenderloin-raw` carbohydrate (0 g, derivation PIK). Result: 0 holds and 0 pipeline rejections.

| Approved position | Id | Source | Preflight |
| ---: | --- | --- | --- |
| 1 | radicchio-raw | SR Legacy 168564 | pass |
| 2 | radish-daikon-raw | SR Legacy 168451 | pass |
| 3 | rutabaga-raw | SR Legacy 168454 | pass |
| 4 | serrano-pepper-raw | SR Legacy 169395 | pass |
| 5 | shallot-raw | SR Legacy 170499 | pass |
| 6 | spaghetti-squash-raw | SR Legacy 169298 | pass |
| 7 | swiss-chard-raw | SR Legacy 169991 | pass |
| 8 | taro-raw | SR Legacy 169308 | pass |
| 9 | tomatillo-raw | SR Legacy 168566 | pass |
| 10 | tomato-green-raw | SR Legacy 170456 | pass |
| 11 | tomato-sun-dried-dried | SR Legacy 168567 | pass |
| 12 | plantain-green-raw | SR Legacy 168215 | pass |
| 13 | plantain-ripe-raw | SR Legacy 169130 | pass |
| 14 | plum-raw | SR Legacy 169949 | pass (sodium is a source analytical 0) |
| 15 | prickly-pear-fruit-raw | SR Legacy 167750 | pass |
| 16 | raspberry-frozen-unsweetened | SR Legacy 168209 | pass |
| 17 | raspberry-raw | SR Legacy 167755 | pass |
| 18 | sapodilla-raw | SR Legacy 167759 | pass |
| 19 | soursop-raw | SR Legacy 167761 | pass |
| 20 | starfruit-raw | SR Legacy 171715 | pass |
| 21 | watermelon-raw | SR Legacy 167765 | pass |
| 22 | amaranth-dry | SR Legacy 170682 | pass |
| 23 | barley-hulled-dry | SR Legacy 170283 | pass |
| 24 | barley-pearled-dry | SR Legacy 170284 | pass |
| 25 | pork-tenderloin-raw | SR Legacy 168312 | pass (carbohydrate is a source 0, code PIK) |

## Pipeline run and validation

All 25 jobs were enqueued for the explicit H1 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. The prepare pass validated 25 with 0 errors and 1 warning. All 25 were hash-approved by review content hash (reviewer `pumpkin-h1-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. Each acknowledged warning and its reason are stored in the job's review notes.

**Acknowledged warning (1).**

1. `plantain-green-raw`: "Fat classes sum (0.17 g) exceeds total fat (0.07 g) by >5%". The pinned SR Legacy 168215 record's own rows are total lipid (1004) 0.07 g, derivation A with 1 data point, against saturated (1258) 0.121 g, monounsaturated (1292) 0.019 g, polyunsaturated (1293) 0.031 g, and trans (1257) 0.002 g, all derivation NC with 0 data points. The draft values equal those pinned rows with the same derivation codes (the field replay below found 0 mismatches), so the inconsistency is in the source record itself, at a very low total-fat level, and no value was adjusted. This is the same treatment as the A3 pear (SR 169118) precedent: documented, not presented as explained.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 995 |
| Unknown | 680 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 197, calculated 114, source_reported 570, assumed_zero 114 (all numeric 0 with a Z derivation code), unknown 680. Unknown gaps: not reported by source 617, definition mismatch 42, partial components 21. No core field is missing on any imported profile, and no type faults were found. A field replay against the pinned rows checked 966 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (25) and `omega3` as `sum:ALA+EPA+DHA` (4).

## Imported profiles (completed imports)

amaranth-dry, barley-hulled-dry, barley-pearled-dry, plantain-green-raw, plantain-ripe-raw, plum-raw, pork-tenderloin-raw, prickly-pear-fruit-raw, radicchio-raw, radish-daikon-raw, raspberry-frozen-unsweetened, raspberry-raw, rutabaga-raw, sapodilla-raw, serrano-pepper-raw, shallot-raw, soursop-raw, spaghetti-squash-raw, starfruit-raw, swiss-chard-raw, taro-raw, tomatillo-raw, tomato-green-raw, tomato-sun-dried-dried, watermelon-raw.

## V4 cumulative proof

The published base (a frozen copy of main at `9671269`) has 143 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 168 profiles (64 variant shards, 113 search shards, 408 search entries, 168 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 143, and added exactly the 25 H1 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/`, and a reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h1store-import/`, are byte-identical: 47 files each, tree SHA-256 `5b02253c7b57160fb20e7aef7924e02477dfa4ee0d698a60eac65010919f7828` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, so it created no duplicates. A combine rerun is identical to the first combine.

## Pipeline rejections and holds

None. All 25 candidates passed the join, the pinned-record verification, and the five-core-field preflight.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, the first 25 (approved-file positions 1-25) are published by this batch, and 301 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

None for this batch. The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 168-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts (join and preflight, match-table append, pipeline driver, and V4 verification) are kept outside the checkout under `~/workspace/private-data/h1-scripts/`.
