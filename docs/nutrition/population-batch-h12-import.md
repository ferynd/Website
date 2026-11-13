# Population batch H12: import report (#63, third-pass batch H12)

Prepared: 2026-11-13. Base: `main` at `2e00f55` (PR #243, the H11 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H12 is positions 276-300 of the approved-326 file, in file order: 21 from SR Legacy 2018-04 and 4 from Foundation 2026-10-29 (`cassava-flour-dry`, 2512377; `coconut-flour-dry`, 2515382; `corn-masa-harina-nixtamalized-dry`, 2710835; and `glutinous-rice-flour-dry`, 1104867). It is the twelfth batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 416 to **441** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H12 ids share a source record, and no H12 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the energy, protein, fat, and carbohydrate rows named in the three acknowledged warnings and the one core source zero, this report holds no nutrient values, only aggregate coverage counts.

Related: [H11 import report](population-batch-h11-import.md) · [H10 import report](population-batch-h10-import.md) · [H9 import report](population-batch-h9-import.md) · [H5 import report](population-batch-h5-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H12) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H12 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 21 |
| from Foundation 2026-10-29 | 4 |
| Validation warnings acknowledged with a documented reason | 3 |
| Source-match table entries after this import | 441 (was 416) |
| Catalog profile count after this import | **441** (was 416) |

Store and batch identifiers: store `~/workspace/private-data/h12store-import` (never `/tmp`), parent batch id **`rb-e31a7bd740e742f5660cc747`** (derived over the 25 attempted ids), pass id `rp-94a07cfb0382a40dd4e3f318`, source release `2018-04+2026-10-29` (each job is stamped with its own match-entry release), reviewer `pumpkin-h12-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H11. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H12 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H11. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 276-300 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). All 25 come from bundle 2 `…717e51249110`.
- Positions 1-275 (H1 to H11) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (273 published), and none of the 25 H12 ids had a match entry before this batch. The base table had 416 entries.

The match table now has 441 entries, and the 416 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H12 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: the Foundation records beside SR Legacy ones (potato flour 2261422, brown rice flour 1104812, rye flour 2512375, unenriched all-purpose flour 790018, unenriched whole wheat flour 790085, raw apricot with skin 2710815, raw blackberries 2727581, and raw cantaloupe 746770, which shares the SR Legacy description); the SR Legacy masa corn flours (enriched white, unenriched white, enriched yellow) beside the Foundation masa harina; the other fortifications and grades (unenriched semolina; enriched bleached, enriched unbleached, and calcium-fortified all-purpose flours; medium rye flour; whole-grain soft wheat flour); the differently processed products (pre-gelatinized chickpea flour, coarse ground pre-gelatinized brown rice flour, cooked oat bran, toasted wheat germ cereal, wheat germ oil); the non-glutinous white rice flours and uncooked glutinous rice grain; the self-rising cornmeals; and the sources of existing profiles that must stay separate (raw cassava for `cassava-raw`, raw dry chickpeas for `chickpea-dry`, rolled and steel cut oats, rice bran oil, long-grain brown rice, rye grain, enriched bread flour, whole-wheat pasta, enriched dry spaghetti, the shelf stable corn tortilla, cornstarch, raw apple with skin, unsweetened applesauce, apricot jam, raw black beans, and raw watermelon). All 72 distinct competing fdcIds cited in the boundaries (86 citations) exist in the pinned files with the cited descriptions. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H12 as positions 276-300 of the approved-326 file), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields traceably present in the pinned record. One core value is a source zero: the sodium row (1093) of `apple-peeled-raw` (SR 171689) is 0 with no derivation code. It is the source's own row, so it counts as present, as in the H1, H2, H5, and H10 source-zero precedents, and it is documented in that entry's stateEvidence. It stays `source_reported` (not `assumed_zero`) under Q-004 because the row is not Z-coded.

Three of the four Foundation records (2512377, 2515382, and 2710835) have no classic energy row (1008). Their energy is the record's own Atwater specific factor row (2048), the second entry in the pipeline's energy preference order (1008, 2048, 2047), and it counts as present, as for the H9 `oats-steel-cut-dry` and H11 Foundation profiles. The fourth Foundation record, glutinous rice flour 1104867, has a classic energy row (1008). The other four core rows are present directly in all four. The 21 SR Legacy records have all five core rows directly, with energy from row 1008.

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H12 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 276 | cassava-flour-dry | Foundation 2512377 | pass (energy from row 2048) | imported |
| 277 | chickpea-flour-dry | SR Legacy 174288 | pass | imported |
| 278 | coconut-flour-dry | Foundation 2515382 | pass (energy from row 2048) | imported |
| 279 | corn-masa-harina-nixtamalized-dry | Foundation 2710835 | pass (energy from row 2048) | imported |
| 280 | durum-semolina-enriched-dry | SR Legacy 169715 | pass | imported |
| 281 | glutinous-rice-flour-dry | Foundation 1104867 | pass | imported |
| 282 | oat-bran-dry | SR Legacy 168872 | pass | imported |
| 283 | potato-flour-dry | SR Legacy 168446 | pass | imported |
| 284 | rice-bran-dry | SR Legacy 169713 | pass | imported |
| 285 | rice-flour-brown-dry | SR Legacy 168898 | pass | imported |
| 286 | rye-flour-dark-dry | SR Legacy 168885 | pass | imported |
| 287 | rye-flour-light-dry | SR Legacy 168887 | pass | imported |
| 288 | vital-wheat-gluten-dry | SR Legacy 168147 | pass | imported |
| 289 | wheat-bran-dry | SR Legacy 169722 | pass | imported |
| 290 | wheat-flour-all-purpose-unenriched-dry | SR Legacy 169761 | pass | imported |
| 291 | wheat-flour-cake-enriched-dry | SR Legacy 169723 | pass | imported |
| 292 | wheat-flour-self-rising-enriched-dry | SR Legacy 168895 | pass | imported |
| 293 | wheat-flour-whole-wheat-dry | SR Legacy 168893 | pass | imported |
| 294 | wheat-germ-dry | SR Legacy 168892 | pass | imported |
| 295 | apple-peeled-raw | SR Legacy 171689 | pass (uncoded source-zero sodium) | imported |
| 296 | apricot-raw | SR Legacy 171697 | pass | imported |
| 297 | blackberry-raw | SR Legacy 173946 | pass | imported |
| 298 | blackcurrant-raw | SR Legacy 173963 | pass | imported |
| 299 | cantaloupe-raw | SR Legacy 169092 | pass | imported |
| 300 | cherimoya-raw | SR Legacy 173953 | pass | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H12 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run. (An earlier session had adapted the driver scripts from H11 and written a preflight output but created no store and made no repository change; this run re-ran the join and preflight from scratch before any edit.)

The prepare pass validated 25 with 0 errors and 3 warnings. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h12-import`); each job's approved hash equals its review packet content hash. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry.

**Acknowledged warnings (3).** The reasons are recorded in the review notes and in `~/workspace/private-data/h12store-import/acks.json`. All three are the validator's general 4/4/9 Atwater check against bran records whose energy uses USDA's specific factors. Each pinned SR Legacy 2018-04 record carries a CalorieConversionFactor of protein 1.82, fat 8.37, carbohydrate 2.35. Applied to the record's own protein, fat, and carbohydrate-by-difference rows, those factors reproduce the reported energy row (1008, code NC). The draft values equal the pinned rows, and no value was adjusted. This follows the dill, thyme, allspice, basil, and chili powder specific-factor precedents.

- `oat-bran-dry`: "Atwater energy inconsistency: reported 246 kcal differs from calculated 397 kcal by >99". SR 168872: protein 17.3 g, fat 7.03 g, carbohydrate 66.2 g give 245.9 kcal (reported 246).
- `rice-bran-dry`: "Atwater energy inconsistency: reported 316 kcal differs from calculated 440 kcal by >110". SR 169713: protein 13.4 g, fat 20.8 g, carbohydrate 49.7 g give 315.3 kcal (reported 316).
- `wheat-bran-dry`: "Atwater energy inconsistency: reported 216 kcal differs from calculated 359 kcal by >90". SR 169722: protein 15.6 g, fat 4.25 g, carbohydrate 64.5 g give 215.5 kcal (reported 216).

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 899 |
| Unknown | 776 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 296, calculated 95, source_reported 410, assumed_zero 98 (all numeric 0, all Z rows replayed directly: vitamin B12 21, vitamin D 19, cholesterol 19, caffeine 16, trans fat 7, alcohol 4, and 1 each of vitamins A, B1, B2, B3, B5, B6, C, E, EPA, DHA, DPA, and total sugars; `vital-wheat-gluten-dry`, a manufacturer-analysis record, carries 13 of them), unknown 776. Unknown gaps: not reported by source 715, definition mismatch 37, partial components 24. The profiles resolve 20 to 42 fields each; the four Foundation profiles resolve 20 to 24, the SR Legacy profiles 28 to 42. No core field is missing on any imported profile, and no type faults were found. 22 profiles take energy from the record's classic energy row (1008). The three Foundation profiles without row 1008 take it from the record's Atwater specific factor row (2048), with derivation `atwater_specific_factors` in field provenance. A field replay against the pinned rows checked 875 values (including the three 2048 energy rows) with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (23) and `omega3` as `sum:ALA+EPA+DHA` (1).

## Imported profiles (completed imports)

apple-peeled-raw, apricot-raw, blackberry-raw, blackcurrant-raw, cantaloupe-raw, cassava-flour-dry, cherimoya-raw, chickpea-flour-dry, coconut-flour-dry, corn-masa-harina-nixtamalized-dry, durum-semolina-enriched-dry, glutinous-rice-flour-dry, oat-bran-dry, potato-flour-dry, rice-bran-dry, rice-flour-brown-dry, rye-flour-dark-dry, rye-flour-light-dry, vital-wheat-gluten-dry, wheat-bran-dry, wheat-flour-all-purpose-unenriched-dry, wheat-flour-cake-enriched-dry, wheat-flour-self-rising-enriched-dry, wheat-flour-whole-wheat-dry, wheat-germ-dry.

## V4 cumulative proof

The published base was a frozen copy of main at `2e00f55`, taken from the checkout's curated directory before any change: 265 files, tree SHA-256 `ce22bcb5…02d2`. It has 416 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 441 profiles (109 variant shards, 158 search shards, 1,026 search entries, 441 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 416, and added exactly the 25 imported H12 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (37 shard files removed, 41 written, 227 unchanged; 268 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h12store-import/` (`stage-a`, `stage-b`), are byte-identical: 41 files each, tree SHA-256 `468a41461bc7f9854bf23004abfd9318cce34986f1ef5c391a857bd3e7d14c1a` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, so it created no duplicates, and all 25 jobs stayed hash-bound approved. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 416 to 441 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of the tracked `public/`, `scripts/`, and `tests/` sources outside the catalog data found no other test pinning the catalog count of 416 (the only other match is biotin's FDC nutrient number `'416'` in `fdcNutrientMap.js`, which is unrelated).

**Shipped-catalog test timeout.** The H11 report warned that the `shipped catalog (#63 V4)` test was near vitest's 5 s default. With 441 profiles it passed at 3.9 s with file parallelism off, but it timed out at 5.8 s in a default parallel run of `scripts/nutrition`. This PR gives that one test an explicit 30 s timeout, with a comment, in `catalogIntegrity.test.ts`. No assertion changed. Afterwards it took 8.7 s in the parallel `scripts/nutrition` run (13 files, 181/181) and passed when the four required suites ran together (4 files, 72/72; the `catalogIntegrity.test.ts` file took 5.8 s in that run).

## Pipeline rejections and holds

None. All 25 H12 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 298 of positions 1-300 are now published (H1 to H12). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 26 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H12 does not change this.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 441-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h12-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification (with the field replay). The acknowledgement file is `~/workspace/private-data/h12store-import/acks.json` (3 entries).
