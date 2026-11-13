# Population batch H13: import report (#63, third-pass batch H13)

Prepared: 2026-11-13. Base: `main` at `63a009b` (PR #244, the H12 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H13 is positions 301-325 of the approved-326 file, in file order, all 25 from SR Legacy 2018-04 (fruits, plus the three coconut meat records filed under Nut and Seed Products). It is the thirteenth batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 441 to **466** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H13 ids share a source record, and no H13 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the six core source-zero sodium rows, this report holds no nutrient values, only aggregate coverage counts.

Related: [H12 import report](population-batch-h12-import.md) · [H11 import report](population-batch-h11-import.md) · [H10 import report](population-batch-h10-import.md) · [H5 import report](population-batch-h5-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H13) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H13 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 25 |
| from Foundation 2026-10-29 | 0 |
| Validation warnings acknowledged with a documented reason | 0 |
| Source-match table entries after this import | 466 (was 441) |
| Catalog profile count after this import | **466** (was 441) |

Store and batch identifiers: store `~/workspace/private-data/h13store-import` (never `/tmp`), parent batch id **`rb-4e8f29df4bc9c71a33b3b9c8`** (derived over the 25 attempted ids), pass id `rp-ea284d6b5a75d0e8f898d42d`, source release `2018-04`, reviewer `pumpkin-h13-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H12. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H13 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H12. That check was run before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 301-325 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). All 25 come from bundle 2 `…717e51249110`.
- Positions 1-300 (H1 to H12) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (298 published), and none of the 25 H13 ids had a match entry before this batch. The base table had 441 entries.

The match table now has 466 entries, and the 441 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H13 entry's stateEvidence carries the pinned-record facts (NDB number, scientific name where the record has one, portions), the approved pair rationale verbatim, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: the Foundation records beside SR Legacy ones (dark red sweet cherries 2346399, peeled seedless mandarin 2710832, dried sweetened cranberries 2758976, dried figs 746768, raw grapefruit 2758977, red and green seedless grapes 2346412 and 2346413, and raw honeydew 2710816, green kiwifruit 327046, and nectarines 327357, which share the SR Legacy descriptions); the regional and mixed-color grapefruit and orange records; the canned, syrup-pack, juice-pack solids-and-liquids, frozen, dried, toasted, creamed, and flaked forms; juices and nectars; and the sources of existing or in-batch profiles that must stay separate (for example the sweetened shredded and unsweetened desiccated coconut, raw coconut meat, coconut flour, coconut oil, coconut water, the cranberry juices, raw blackberries, cantaloupe, watermelon, orange juice, heavy-syrup canned peaches, and long-grain enriched white rice for the longan name match). All 85 distinct competing fdcIds cited in the boundaries (97 citations) exist in the pinned files with the cited descriptions, and each of the 29 "is the source of" claims was checked against the match table (including the in-batch entries). Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H13 as positions 301-325 of the approved-326 file), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

One candidate conflict note was examined: the candidate entry for `coconut-desiccated-dried-unsweetened` (SR 170170) carries a "description says sweetened" conflict. It is a substring match on "not sweetened"; the pinned description is "Nuts, coconut meat, dried (desiccated), not sweetened", which matches the unsweetened target. This is documented in the entry's stateEvidence.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields (energy row 1008, protein, carbohydrate by difference, total fat, sodium) present directly in the pinned record.

Six core values are source zeros, all sodium (row 1093), each the source's own row, so each counts as present, as in the H1, H2, H5, H10, and H12 source-zero precedents, and each is documented in that entry's stateEvidence:

| Id | Source | Sodium row derivation code | Q-004 status |
| --- | --- | --- | --- |
| cherry-sweet-raw | SR 171719 | A | measured |
| grapefruit-pink-or-red-raw | SR 174673 | none | source_reported |
| grapefruit-white-raw | SR 174676 | none | source_reported |
| longan-raw | SR 169089 | none | source_reported |
| nectarine-raw | SR 169914 | A | measured |
| orange-raw | SR 169097 | none | source_reported |

None is Z-coded, so none is `assumed_zero`. The canned juice-pack mandarin oranges (SR 168184) carry derivation BD on the protein, fat, and sodium rows; those stay `source_reported` under Q-004.

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap (the highest energy is desiccated unsweetened coconut), so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H13 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 301 | cherry-sour-raw | SR Legacy 173954 | pass | imported |
| 302 | cherry-sweet-raw | SR Legacy 171719 | pass (A-coded source-zero sodium) | imported |
| 303 | clementine-raw | SR Legacy 168195 | pass | imported |
| 304 | coconut-desiccated-dried-unsweetened | SR Legacy 170170 | pass | imported |
| 305 | coconut-flesh-raw | SR Legacy 170169 | pass | imported |
| 306 | coconut-shredded-dried-sweetened | SR Legacy 168586 | pass | imported |
| 307 | cranberry-dried-sweetened | SR Legacy 171723 | pass | imported |
| 308 | cranberry-raw | SR Legacy 171722 | pass | imported |
| 309 | fig-raw | SR Legacy 173021 | pass | imported |
| 310 | gooseberry-raw | SR Legacy 173030 | pass | imported |
| 311 | grapefruit-pink-or-red-raw | SR Legacy 174673 | pass (uncoded source-zero sodium) | imported |
| 312 | grapefruit-white-raw | SR Legacy 174676 | pass (uncoded source-zero sodium) | imported |
| 313 | grapes-red-or-green-raw | SR Legacy 174683 | pass | imported |
| 314 | guava-raw | SR Legacy 173044 | pass | imported |
| 315 | honeydew-melon-raw | SR Legacy 169911 | pass | imported |
| 316 | jujube-raw | SR Legacy 168151 | pass | imported |
| 317 | kiwifruit-green-raw | SR Legacy 168153 | pass | imported |
| 318 | kumquat-raw | SR Legacy 168154 | pass | imported |
| 319 | longan-raw | SR Legacy 169089 | pass (uncoded source-zero sodium) | imported |
| 320 | mandarin-orange-canned-in-juice-drained | SR Legacy 168184 | pass | imported |
| 321 | mandarin-raw | SR Legacy 169105 | pass | imported |
| 322 | mulberry-raw | SR Legacy 169913 | pass | imported |
| 323 | nectarine-raw | SR Legacy 169914 | pass (A-coded source-zero sodium) | imported |
| 324 | orange-raw | SR Legacy 169097 | pass (uncoded source-zero sodium) | imported |
| 325 | papaya-raw | SR Legacy 169926 | pass | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H13 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run. (An earlier session adapted the driver scripts from H12 and wrote the join and preflight output, but it created no store and made no repository change. This run re-ran the join and preflight from the base table snapshot, and the output was byte-identical to the stored one. It then generated the evidence and appended the table entries.)

The prepare pass validated 25 with 0 errors and 0 warnings, so the acknowledgement file is empty and there was nothing to acknowledge. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h13-import`); each job's approved hash equals its review packet content hash (25 of 25 hash-bound approved).

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 972 |
| Unknown | 703 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 319, calculated 101, source_reported 441, assumed_zero 111 (all numeric 0, all Z rows replayed directly: vitamin B12 22, vitamin D 22, cholesterol 21, caffeine 21, trans fat 20, alcohol 2, and 1 each of EPA, DHA, and DPA), unknown 703. Unknown gaps: not reported by source 636, definition mismatch 43, partial components 24. The profiles resolve 23 to 42 fields each. No core field is missing on any imported profile, and no type faults were found. All 25 profiles take energy from the record's classic energy row (1008). A field replay against the pinned rows checked 947 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (24) and `omega3` as `sum:ALA+EPA+DHA` (1).

## Imported profiles (completed imports)

cherry-sour-raw, cherry-sweet-raw, clementine-raw, coconut-desiccated-dried-unsweetened, coconut-flesh-raw, coconut-shredded-dried-sweetened, cranberry-dried-sweetened, cranberry-raw, fig-raw, gooseberry-raw, grapefruit-pink-or-red-raw, grapefruit-white-raw, grapes-red-or-green-raw, guava-raw, honeydew-melon-raw, jujube-raw, kiwifruit-green-raw, kumquat-raw, longan-raw, mandarin-orange-canned-in-juice-drained, mandarin-raw, mulberry-raw, nectarine-raw, orange-raw, papaya-raw.

## V4 cumulative proof

The published base was a frozen copy of main at `63a009b`, taken from the checkout's curated directory before any change: 268 files, tree SHA-256 `678d5da4…6795`. It has 441 profiles (109 variant shards, 158 search shards, 1,026 search entries, 441 revisions) and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 466 profiles (112 variant shards, 160 search shards, 1,065 search entries, 466 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 441, and added exactly the 25 imported H13 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (40 shard files removed, 46 written, 227 unchanged; 273 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h13store-import/` (`stage-a`, `stage-b`), are byte-identical: 46 files each, tree SHA-256 `69945b1c3f9f740fd3b1bf0a1e6dd41406b3c3a876b932ccbaa810db72f22689` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, so it created no duplicates, and all 25 jobs stayed hash-bound approved. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 441 to 466 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of the tracked `public/`, `scripts/`, and `tests/` sources outside the catalog data found no other test pinning the catalog count of 441. The shipped-catalog V4 test took 9.0 s in the parallel `scripts/nutrition` run, within its explicit 30 s timeout from H12.

## Pipeline rejections and holds

None. All 25 H13 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 323 of positions 1-325 are now published (H1 to H13). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 1 remains for a later H batch (position 326, `pear-asian-raw`, SR 168177). The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H13 does not change this.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 466-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h13-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification (with the field replay). The acknowledgement file is `~/workspace/private-data/h13store-import/acks.json` (empty; no warnings).
