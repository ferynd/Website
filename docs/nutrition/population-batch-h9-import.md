# Population batch H9: import report (#63, third-pass batch H9)

Prepared: 2026-11-12. Base: `main` at `4696ebd` (PR #240, the H8 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H9 is positions 201-225 of the approved-326 file, in file order: 24 from SR Legacy 2018-04 and 1 from Foundation 2026-10-29 (`oats-steel-cut-dry`, 2346397). It is the ninth batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 341 to **366** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H9 ids share a source record, and no H9 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H8 import report](population-batch-h8-import.md) · [H7 import report](population-batch-h7-import.md) · [H5 import report](population-batch-h5-import.md) · [H4 import report](population-batch-h4-import.md) · [H2 import report](population-batch-h2-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H9) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H9 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 24 |
| from Foundation 2026-10-29 | 1 |
| Validation warnings acknowledged with a documented reason | 1 |
| Source-match table entries after this import | 366 (was 341) |
| Catalog profile count after this import | **366** (was 341) |

Store and batch identifiers: store `~/workspace/private-data/h9store-import` (never `/tmp`), parent batch id **`rb-89e529a5af6c202af11aedeb`** (derived over the 25 attempted ids), pass id `rp-d4f1544c98b9ad07353f3a2c`, source release `2018-04+2026-10-29` (each job is stamped with its own match-entry release), reviewer `pumpkin-h9-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H8. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H9 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H8. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 201-225 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from three chunked batches and bundle 2: `…e801dd4d2841` (1), `…f0c6239734fd` (10), `…f5dab00b9298` (8), and bundle 2 `…717e51249110` (6).
- Positions 1-200 (H1 to H8) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (198 published), and none of the 25 H9 ids had a match entry before this batch. The base table had 341 entries.

The match table now has 366 entries, and the 341 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H9 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: the prepared-with-water chicken bouillon, dry broth cubes, and the ready-to-serve, condensed, and reduced-sodium chicken broths; the Foundation raw Atlantic cod, Foundation raw haddock, and Foundation frozen mahi mahi records, Pacific cod, and the cooked, canned, dried and salted, and smoked fish records; raw, canned, and pasteurized lump blue crab and crab cakes; cooked roe and caviar; Greenland halibut and the Alaska Native records; raw, kippered, and Pacific herring; other mackerel species; raw octopus; plain surimi and imitation shrimp and scallop; cooked bulgur, couscous, millet, and teff, and the Foundation dry bulgur record; puffed millet and millet flour; Foundation rolled oats, the generic SR Legacy oats record, puffed oats, and oat flour; enriched, cooked, parboiled, and instant rice; rye and sorghum flours and the Foundation white sorghum records; plain croutons; toasted multigrain and rye breads, reduced-calorie rye, and white pita; and the low-salt, unsalted-top, fat-free, and whole-wheat saltines. All 88 competing fdcIds cited in the boundaries exist in the pinned files. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H9 as positions 201-225 of the approved-326 file), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields traceably present in the pinned record. Some core values are source zeros. Each is the source's own row, so it counts as present:

- Z (assumed zero): carbohydrate for `cod-atlantic-raw`, `crab-blue-meat-cooked-moist-heat`, `haddock-raw`, `halibut-raw`, `mackerel-atlantic-raw`, and `mahi-mahi-raw` (status assumed_zero).

The Foundation record for `oats-steel-cut-dry` (2346397) has no classic energy row (1008). Its energy is the record's own Atwater specific factor row (2048), which counts as present; the other four core rows are present directly.

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H9 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 201 | chicken-bouillon-concentrated-dry | SR Legacy 171562 | pass | imported |
| 202 | cod-atlantic-raw | SR Legacy 171955 | pass (carbohydrate Z zero) | imported |
| 203 | crab-blue-meat-cooked-moist-heat | SR Legacy 174205 | pass (carbohydrate Z zero) | imported |
| 204 | fish-roe-raw | SR Legacy 175132 | pass | imported |
| 205 | haddock-raw | SR Legacy 171964 | pass (carbohydrate Z zero) | imported |
| 206 | halibut-raw | SR Legacy 174200 | pass (carbohydrate Z zero) | imported |
| 207 | herring-pickled-as-sold | SR Legacy 175118 | pass | imported |
| 208 | imitation-crab-surimi-as-sold | SR Legacy 174203 | pass | imported (1 warning acknowledged) |
| 209 | mackerel-atlantic-raw | SR Legacy 175119 | pass (carbohydrate Z zero) | imported |
| 210 | mahi-mahi-raw | SR Legacy 171959 | pass (carbohydrate Z zero) | imported |
| 211 | octopus-cooked-moist-heat | SR Legacy 174249 | pass | imported |
| 212 | bulgur-dry | SR Legacy 170688 | pass | imported |
| 213 | couscous-plain-dry | SR Legacy 169699 | pass | imported |
| 214 | millet-dry | SR Legacy 169702 | pass | imported |
| 215 | oats-steel-cut-dry | Foundation 2346397 | pass (energy from row 2048) | imported |
| 216 | rice-white-long-grain-unenriched-dry | SR Legacy 169756 | pass | imported |
| 217 | rye-berries-dry | SR Legacy 168884 | pass | imported |
| 218 | sorghum-dry | SR Legacy 169716 | pass | imported |
| 219 | teff-dry | SR Legacy 169747 | pass | imported |
| 220 | croutons-seasoned-as-sold | SR Legacy 172752 | pass | imported |
| 221 | multigrain-bread-as-sold | SR Legacy 168013 | pass | imported |
| 222 | pita-bread-whole-wheat-as-sold | SR Legacy 174916 | pass | imported |
| 223 | pumpernickel-bread-as-sold | SR Legacy 174918 | pass | imported |
| 224 | rye-bread-as-sold | SR Legacy 172684 | pass | imported |
| 225 | saltine-cracker-as-sold | SR Legacy 172746 | pass | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H9 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. A first attempt at this batch stopped silently after writing only part of the source cache, with no jobs created. That partial store (a source cache and a stale lock from a process that no longer existed) was discarded, and the store was recreated fresh at the same path. Everything reported here comes from one prepare pass on that fresh store.

The prepare pass validated 25 with 0 errors and 1 warning. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h9-import`); each job's approved hash equals its review packet content hash. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry.

**Acknowledged warnings (1).**

1. `imitation-crab-surimi-as-sold`: "Fat classes sum (0.64 g) exceeds total fat (0.46 g) by >5%". The pinned SR Legacy 174203 record's own rows are total lipid (1004) 0.46 g, derivation A with 2 data points, against saturated (1258) 0.216 g, monounsaturated (1292) 0.275 g, polyunsaturated (1293) 0.143 g, and trans (1257) 0.008 g, all derivation NC with 0 data points. The draft values equal those pinned rows with the same derivation codes (the field replay below found 0 mismatches), so the inconsistency is in the source record itself, at a very low total-fat level, and no value was adjusted. This is the same treatment as the A3 pear (SR 169118), H1 green plantain (SR 168215), and H2 fennel bulb (SR 169385) precedents: documented, not presented as explained.

The acknowledgement file is `~/workspace/private-data/h9store-import/acks.json`, and the acknowledgement text is carried in the job's review notes.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 967 |
| Unknown | 708 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 241, calculated 113, source_reported 542, assumed_zero 71 (all numeric 0, all Z rows: 62 replayed directly, plus 9 `fiber` cells aliasing a Z `fiberTotal` row), unknown 708. Unknown gaps: not reported by source 648, definition mismatch 40, partial components 20. The profiles resolve 21 to 44 fields each. No core field is missing on any imported profile, and no type faults were found. 24 profiles take energy from the record's classic energy row (1008); `oats-steel-cut-dry` takes it from the Foundation record's Atwater specific factor row (2048), with derivation `atwater_specific_factors` in field provenance. A field replay against the pinned rows checked 938 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (24) and `omega3` as `sum:ALA+EPA+DHA` (5).

## Imported profiles (completed imports)

bulgur-dry, chicken-bouillon-concentrated-dry, cod-atlantic-raw, couscous-plain-dry, crab-blue-meat-cooked-moist-heat, croutons-seasoned-as-sold, fish-roe-raw, haddock-raw, halibut-raw, herring-pickled-as-sold, imitation-crab-surimi-as-sold, mackerel-atlantic-raw, mahi-mahi-raw, millet-dry, multigrain-bread-as-sold, oats-steel-cut-dry, octopus-cooked-moist-heat, pita-bread-whole-wheat-as-sold, pumpernickel-bread-as-sold, rice-white-long-grain-unenriched-dry, rye-berries-dry, rye-bread-as-sold, saltine-cracker-as-sold, sorghum-dry, teff-dry.

## V4 cumulative proof

The published base was a frozen copy of main at `4696ebd`, taken from the checkout's curated directory before any change and confirmed byte-identical to it: 248 files, tree SHA-256 `6d58d658…9598`. It has 341 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 366 profiles (103 variant shards, 151 search shards, 844 search entries, 366 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 341, and added exactly the 25 imported H9 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (49 shard files removed, 57 written, 198 unchanged; 255 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h9store-import/` (`stage-a`, `stage-b`), are byte-identical: 57 files each, tree SHA-256 `2085992a9c8a7e95a50514cdb7c1fea32d511e763941d3aa9ab39d98ff05f33b` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 341 to 366 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of the tracked `public/`, `scripts/`, and `tests/` sources outside the catalog data found no other test pinning the catalog count of 341.

## Pipeline rejections and holds

None. All 25 H9 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 223 of positions 1-225 are now published (H1 to H9). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 101 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H9 does not change this.
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 366 profiles it took 4.0 s when the four required suites ran together (3.4 s with file parallelism off, where the `scripts/nutrition` directory passed 13 files, 181/181). The timeout was not changed here. The margin is now about 1 s, and the next batch or two may need an explicit timeout.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 366-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h9-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification. The acknowledgement file is `~/workspace/private-data/h9store-import/acks.json` (1 entry).
