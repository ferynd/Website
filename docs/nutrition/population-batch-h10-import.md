# Population batch H10: import report (#63, third-pass batch H10)

Prepared: 2026-11-13. Base: `main` at `3c5a0ee` (PR #241, the H9 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H10 is positions 226-250 of the approved-326 file, in file order: 23 from SR Legacy 2018-04 and 2 from Foundation 2026-10-29 (`tortilla-corn-as-sold`, 2758997, and `tortilla-wheat-flour-as-sold`, 2758996). It is the tenth batch of the third-pass (H) lane. **25 were attempted and 25 are published**: the curated catalog goes from 366 to **391** profiles. All 25 passed the join, the pinned-record checks, the five-core-field preflight, and the registry per-100 g hard-maximum check, so no id was held and there was no pipeline rejection. No two H10 ids share a source record, and no H10 source record is used by an existing entry. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H9 import report](population-batch-h9-import.md) · [H8 import report](population-batch-h8-import.md) · [H7 import report](population-batch-h7-import.md) · [H5 import report](population-batch-h5-import.md) · [H1 import report](population-batch-h1-import.md) · [G1 import report](population-batch-g1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H10) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Passed the registry per-100 g hard-maximum check | 25 |
| Rejected at import (pipeline rejection, held) | 0 |
| Reviewed match entries for H10 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from SR Legacy 2018-04 | 23 |
| from Foundation 2026-10-29 | 2 |
| Validation warnings acknowledged with a documented reason | 0 |
| Source-match table entries after this import | 391 (was 366) |
| Catalog profile count after this import | **391** (was 366) |

Store and batch identifiers: store `~/workspace/private-data/h10store-import` (never `/tmp`), parent batch id **`rb-68e141005db6f31649e1a866`** (derived over the 25 attempted ids), pass id `rp-bc8fad71b6a6564718f823b6`, source release `2018-04+2026-10-29` (each job is stamped with its own match-entry release), reviewer `pumpkin-h10-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H9. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H10 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H9. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 226-250 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). All 25 come from bundle 2 `…717e51249110`.
- Positions 1-225 (H1 to H9) are all published except the registry-cap holds `beef-tallow-as-sold` (H4) and `lard-as-sold` (H5) (223 published), and none of the 25 H10 ids had a match entry before this batch. The base table had 366 entries.

The match table now has 391 entries, and the 366 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H10 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: the SR Legacy ready-to-bake or -fry corn and flour tortillas, whole wheat tortillas, and the Hopi blue corn tortilla; toasted and prepared-from-recipe whole-wheat bread; the branded barbecue sauces; the light, fat-free, and low-calorie blue cheese, caesar, and ranch dressings, and the Foundation ranch dressing; the generic, reduced-sugar, no-sugar, and fruit-juice-sweetened jams and marmalades; the low-sodium marinara and the Foundation marinara and yellow mustard records that share an SR Legacy description; regular mayonnaise (the source of `mayonnaise-regular-as-sold`) and the other light or reduced-calorie mayonnaise records; red salsa; regular shoyu (the source of `soy-sauce-regular-as-sold`), tamari, and hydrolyzed vegetable protein soy sauces; branded sriracha; reduced-sodium teriyaki; the Foundation canned tomato sauce with salt added (the source of `tomato-sauce-with-salt-as-sold`), generic canned tomato sauce, and no-salt-added paste and puree; the other vinegars, including balsamic (the source of `vinegar-balsamic-liquid-as-sold`); and roquefort cheese. All 66 competing fdcIds cited in the boundaries exist in the pinned files with the cited descriptions. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H10 as positions 226-250 of the approved-326 file), the source bundle and approved-file position, and the pinned-record verification. All 25 approved rationales are the same source-identity sentence with no condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, matching dataType, verbatim description). All 25 had the five core fields traceably present in the pinned record. Some core values are source zeros. Each is the source's own row, so it counts as present:

- A (analytical): protein and total fat for `vinegar-apple-cider-liquid-as-sold` and `vinegar-distilled-white-liquid-as-sold`, and total fat for `vinegar-red-wine-liquid-as-sold` (status measured).
- No derivation code: total fat for `orange-marmalade-as-sold`, and protein and total fat for `worcestershire-sauce-as-sold` (status source_reported), as in the H4, H5, H7, and H8 precedents.

The two Foundation tortilla records (2758997 and 2758996) have neither a classic energy row (1008) nor an Atwater specific factor row (2048). Their energy is the record's own Atwater general factor row (2047), the last entry in the pipeline's energy preference order (1008, 2048, 2047), and it counts as present, as for the G2 `pasta-wheat-enriched-dry` (2758998) and G3 `poblano-pepper-raw` (2747662) Foundation profiles. The other four core rows are present directly.

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000, mcg 100,000,000; `hardMaxFor` in `nutrientRegistry.js`). No row in any of the 25 records is above a cap, so the H4 beef tallow and H5 lard registry-cap precedent did not apply to any H10 id.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 226 | tortilla-corn-as-sold | Foundation 2758997 | pass (energy from row 2047) | imported |
| 227 | tortilla-wheat-flour-as-sold | Foundation 2758996 | pass (energy from row 2047) | imported |
| 228 | whole-wheat-sandwich-bread-as-sold | SR Legacy 172688 | pass | imported |
| 229 | barbecue-sauce-as-sold | SR Legacy 174523 | pass | imported |
| 230 | blue-cheese-dressing-as-sold | SR Legacy 173562 | pass | imported |
| 231 | caesar-dressing-as-sold | SR Legacy 169055 | pass | imported |
| 232 | fish-sauce-as-sold | SR Legacy 174531 | pass | imported |
| 233 | hoisin-sauce-as-sold | SR Legacy 172886 | pass | imported |
| 234 | jam-apricot-as-sold | SR Legacy 170645 | pass | imported |
| 235 | marinara-sauce-as-sold | SR Legacy 171192 | pass | imported |
| 236 | mayonnaise-light-as-sold | SR Legacy 173594 | pass | imported |
| 237 | mustard-yellow-as-sold | SR Legacy 172234 | pass | imported |
| 238 | orange-marmalade-as-sold | SR Legacy 168819 | pass (total fat zero, no code) | imported |
| 239 | oyster-sauce-as-sold | SR Legacy 174529 | pass | imported |
| 240 | ranch-dressing-as-sold | SR Legacy 173592 | pass | imported |
| 241 | salsa-verde-as-sold | SR Legacy 171824 | pass | imported |
| 242 | soy-sauce-reduced-sodium-as-sold | SR Legacy 172473 | pass | imported |
| 243 | sriracha-as-sold | SR Legacy 171186 | pass | imported |
| 244 | teriyaki-sauce-as-sold | SR Legacy 171167 | pass | imported |
| 245 | tomato-sauce-no-added-salt-as-sold | SR Legacy 169074 | pass | imported |
| 246 | vinegar-apple-cider-liquid-as-sold | SR Legacy 173469 | pass (protein and total fat A zeros) | imported |
| 247 | vinegar-distilled-white-liquid-as-sold | SR Legacy 172237 | pass (protein and total fat A zeros) | imported |
| 248 | vinegar-red-wine-liquid-as-sold | SR Legacy 172240 | pass (total fat A zero) | imported |
| 249 | worcestershire-sauce-as-sold | SR Legacy 171610 | pass (protein and total fat zeros, no code) | imported |
| 250 | blue-cheese-as-sold | SR Legacy 172175 | pass | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H10 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. There was one prepare pass on one store, and no aborted run.

The prepare pass validated 25 with 0 errors and 0 warnings. Every review packet showed no identity mismatch. All 25 were hash-approved by review content hash (reviewer `pumpkin-h10-import`); each job's approved hash equals its review packet content hash. The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry.

**Acknowledged warnings (0).** No H10 job carried a validation warning, so nothing was acknowledged. The acknowledgement file `~/workspace/private-data/h10store-import/acks.json` is empty (`{}`).

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 963 |
| Unknown | 712 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 383, calculated 116, source_reported 417, assumed_zero 47 (all numeric 0, all Z rows: 46 replayed directly, plus 1 `fiber` cell aliasing a Z `fiberTotal` row), unknown 712. Unknown gaps: not reported by source 651, definition mismatch 42, partial components 19. The profiles resolve 21 to 44 fields each. No core field is missing on any imported profile, and no type faults were found. 23 profiles take energy from the record's classic energy row (1008). The two Foundation tortillas take it from the record's Atwater general factor row (2047), with derivation `atwater_general_factors` in field provenance. A field replay against the pinned rows checked 932 values (including both 2047 energy rows) with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (25) and `omega3` as `sum:ALA+EPA+DHA` (6).

## Imported profiles (completed imports)

barbecue-sauce-as-sold, blue-cheese-as-sold, blue-cheese-dressing-as-sold, caesar-dressing-as-sold, fish-sauce-as-sold, hoisin-sauce-as-sold, jam-apricot-as-sold, marinara-sauce-as-sold, mayonnaise-light-as-sold, mustard-yellow-as-sold, orange-marmalade-as-sold, oyster-sauce-as-sold, ranch-dressing-as-sold, salsa-verde-as-sold, soy-sauce-reduced-sodium-as-sold, sriracha-as-sold, teriyaki-sauce-as-sold, tomato-sauce-no-added-salt-as-sold, tortilla-corn-as-sold, tortilla-wheat-flour-as-sold, vinegar-apple-cider-liquid-as-sold, vinegar-distilled-white-liquid-as-sold, vinegar-red-wine-liquid-as-sold, whole-wheat-sandwich-bread-as-sold, worcestershire-sauce-as-sold.

## V4 cumulative proof

The published base was a frozen copy of main at `3c5a0ee`, taken from the checkout's curated directory before any change: 255 files, tree SHA-256 `6a44bf36…d135`. It has 366 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 391 profiles (106 variant shards, 153 search shards, 902 search entries, 391 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 366, and added exactly the 25 imported H10 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (48 shard files removed, 54 written, 206 unchanged; 260 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h10store-import/` (`stage-a`, `stage-b`), are byte-identical: 54 files each, tree SHA-256 `47efba2c6fc3cdfef899b6676a58af700487467d238a0aa9fe33225c50ac6335` for both. A full pipeline rerun (enqueue and run all 25 again) left the store at 25 jobs, 25 unique job keys, and 25 unique manifest ids, so it created no duplicates, and all 25 jobs stayed hash-bound approved. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 366 to 391 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of the tracked `public/`, `scripts/`, and `tests/` sources outside the catalog data found no other test pinning the catalog count of 366.

## Pipeline rejections and holds

None. All 25 H10 ids were imported. No id failed the join, the pinned-record checks, the five-core-field preflight, the registry hard-maximum check, validation, review, staging, or V4.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 248 of positions 1-250 are now published (H1 to H10). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 76 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` still need a registry decision on the per-100 g calorie hard maximum before they can be retried (see the [H5 report](population-batch-h5-import.md)). H10 does not change this.
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 391 profiles it took 4.2 s when the four required suites ran together (the `scripts/nutrition` directory passed 13 files, 181/181, with file parallelism off). The timeout was not changed here. The margin is now under 1 s, and the next batch may need an explicit timeout.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 391-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h10-scripts/`: join and preflight (with the registry hard-maximum check), evidence generation and match-table append (with the empty hold set), the pipeline driver, and V4 verification (whose field replay now also covers Atwater general factor energy rows). The acknowledgement file is `~/workspace/private-data/h10store-import/acks.json` (0 entries).
