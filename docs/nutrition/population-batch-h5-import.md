# Population batch H5: import report (#63, third-pass batch H5)

Prepared: 2026-11-12. Base: `main` at `b2db4f0` (PR #236, the H4 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H5 is positions 101-125 of the approved-326 file, in file order: 24 SR Legacy 2018-04 and 1 Foundation 2026-10-29. It is the fifth batch of the third-pass (H) lane. **25 were attempted and 24 are published**: the curated catalog goes from 242 to **266** profiles. All 25 passed the join, the pinned-record checks, and the five-core-field preflight. One id, `lard-as-sold`, is held as a pipeline rejection: its pinned energy row is above the nutrient registry's per-100 g hard maximum for calories, the same failure as the H4 beef tallow hold (see [Pipeline rejections and holds](#pipeline-rejections-and-holds)). Two ids, `butter-clarified-as-sold` and `ghee-as-sold`, share one approved source record (SR 171314). Both were imported through the match table's shared-record rule (see [Shared source record](#shared-source-record)). Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values and the held record's energy value named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H4 import report](population-batch-h4-import.md) · [H3 import report](population-batch-h3-import.md) · [H2 import report](population-batch-h2-import.md) · [H1 import report](population-batch-h1-import.md) · [G4 import report](population-batch-g4-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H5) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection, held) | 1 |
| Reviewed match entries for H5 in the table | 24 |
| Profiles validated, approved, staged, and imported | **24** |
| from SR Legacy 2018-04 | 23 |
| from Foundation 2026-10-29 | 1 |
| Source-match table entries after this import | 266 (was 242) |
| Catalog profile count after this import | **266** (was 242) |

Store and batch identifiers: store `~/workspace/private-data/h5store-import` (never `/tmp`), parent batch id **`rb-260c0ed0510c0e9d0f6e4100`** (derived over the 25 attempted ids), pass id `rp-fdf6a4320b8403d93d838bde`, source release `2018-04+2026-10-29`, reviewer `pumpkin-h5-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H4. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H5 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead, as in H1 to H4. That check was re-run here before any match-table edit:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 101-125 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from two chunked batches: `…68e79c05f0c7` (15) and `…6cdf8320404d` (10).
- Positions 1-100 (H1 to H4) are all published except the H4 hold `beef-tallow-as-sold` (99 published), and none of the 25 H5 ids had a match entry before this batch. The base table had 242 entries.

The match table now has 266 entries, and the 242 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H5 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product. It also gives explicit boundaries where a near record must not use these values, for example: salted and unsalted butter; the industrial, hydrogenated, and confection coconut, palm kernel, and palm-and-kernel fats; corn oil blends; the opposite fatty-acid type of safflower and sunflower oil; partially hydrogenated soybean oil; granulated and brown sugar; the with-salt boiled bamboo shoot record; and the green, yellow, and red bell pepper records. Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H5 as positions 101-125 of approved-326), the source bundle and approved-file position, and the pinned-record verification. None of the 25 approved rationales carries a condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Shared source record

`butter-clarified-as-sold` (position 101) and `ghee-as-sold` (position 106) were both approved against SR Legacy 171314 "Butter, Clarified butter (ghee)". The record's description names both, so they are two catalog identities for one product. `validateMatchTable` allows two manifest ids on one release and FDC id only when both entries carry a `sharedJustification`. This is the pipeline's documented rule for a shared record (see [research pipeline](research-pipeline.md)), and its tests cover it. Both new entries carry one. Each states the shared description, the two approved positions, and that the two profiles carry the same source values with no substitution. No existing entry was touched. The pipeline accepted both: both jobs validated with no warning, both review packets showed no identity mismatch, `stageCatalog` staged both as separate variants, and V4 found 0 defects. So neither id was held. The two profiles have the same values and quality statuses (16 of 67 fields resolved each, since the record is a label-calculated (LC) record with few nutrient rows).

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, dataType SR Legacy or Foundation as named, verbatim description). All 25 had the five core fields traceably present in the pinned record. Many core values are source zeros, as expected for pure fats, oils, and sugar. Each is the source's own row, so it counts as present:

- LC (calculated from label): protein, carbohydrate, and sodium for `butter-clarified-as-sold` and `ghee-as-sold` (status source_reported).
- A (analytical): protein and sodium for `coconut-oil-as-sold`, sodium for `soybean-oil-as-sold`, protein and total fat for `sugar-turbinado-as-sold`, and sodium for `bell-pepper-orange-raw` (status measured).
- No derivation code (source_reported): protein, carbohydrate, and sodium for `chicken-fat-as-sold`, `cocoa-butter-as-sold`, `corn-oil-as-sold`, `grapeseed-oil-as-sold`, `palm-kernel-oil-as-sold`, `palm-oil-as-sold`, `rice-bran-oil-as-sold`, `safflower-oil-high-linoleic-as-sold`, `safflower-oil-high-oleic-as-sold`, and `sunflower-oil-high-linoleic-as-sold`; carbohydrate for `coconut-oil-as-sold`; protein and carbohydrate for `soybean-oil-as-sold` (and protein, carbohydrate, and sodium for the held `lard-as-sold`).

None of the 25 was held at preflight. Before any match-table edit, every row of the 25 pinned records was also checked against the registry's per-100 g hard maxima (kcal 900, g 100, mg 100,000). Only `lard-as-sold` failed (see the hold below). Four records sit exactly at 900 kcal (`butter-clarified-as-sold`, `ghee-as-sold`, `chicken-fat-as-sold`, `corn-oil-as-sold`), and `checkPer100g('calories', 900)` returns `ok` because the cap is inclusive.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 101 | butter-clarified-as-sold | SR Legacy 171314 | pass (LC source zeros) | imported (shared record with ghee) |
| 102 | chicken-fat-as-sold | SR Legacy 173564 | pass (uncoded source zeros) | imported |
| 103 | cocoa-butter-as-sold | SR Legacy 171421 | pass (uncoded source zeros) | imported |
| 104 | coconut-oil-as-sold | SR Legacy 171412 | pass (A and uncoded source zeros) | imported |
| 105 | corn-oil-as-sold | SR Legacy 171029 | pass (uncoded source zeros) | imported |
| 106 | ghee-as-sold | SR Legacy 171314 | pass (LC source zeros) | imported (shared record with clarified butter) |
| 107 | grapeseed-oil-as-sold | SR Legacy 171028 | pass (uncoded source zeros) | imported |
| 108 | lard-as-sold | SR Legacy 171401 | pass (uncoded source zeros) | **held: pipeline rejection** (energy above the registry hard maximum) |
| 109 | palm-kernel-oil-as-sold | SR Legacy 171422 | pass (uncoded source zeros) | imported |
| 110 | palm-oil-as-sold | SR Legacy 171015 | pass (uncoded source zeros) | imported |
| 111 | rice-bran-oil-as-sold | SR Legacy 171013 | pass (uncoded source zeros) | imported |
| 112 | safflower-oil-high-linoleic-as-sold | SR Legacy 171026 | pass (uncoded source zeros) | imported |
| 113 | safflower-oil-high-oleic-as-sold | SR Legacy 171027 | pass (uncoded source zeros) | imported |
| 114 | soybean-oil-as-sold | SR Legacy 171411 | pass (A and uncoded source zeros) | imported |
| 115 | sunflower-oil-high-linoleic-as-sold | SR Legacy 171025 | pass (uncoded source zeros) | imported |
| 116 | sugar-turbinado-as-sold | SR Legacy 170674 | pass (protein and fat A zeros) | imported |
| 117 | acorn-squash-raw | SR Legacy 168472 | pass | imported |
| 118 | amaranth-leaves-raw | SR Legacy 168385 | pass | imported |
| 119 | arugula-raw | SR Legacy 169387 | pass | imported |
| 120 | asparagus-raw | SR Legacy 168389 | pass | imported |
| 121 | bamboo-shoot-canned-drained | SR Legacy 169212 | pass | imported |
| 122 | bamboo-shoot-cooked-without-added-fat | SR Legacy 169211 | pass | imported |
| 123 | banana-pepper-raw | SR Legacy 169394 | pass | imported |
| 124 | beet-greens-raw | SR Legacy 170375 | pass | imported |
| 125 | bell-pepper-orange-raw | Foundation 2258591 | pass (sodium A zero; energy from row 2048) | imported |

## Pipeline run and validation

The jobs were enqueued for the explicit H5 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store. The lard hold was known from the preflight registry check before any table edit, so it never got a match entry or a job. There was one prepare pass on one store, and no aborted run.

The prepare pass validated 24 with 0 errors and 0 warnings. Every review packet showed no identity mismatch. All 24 were hash-approved by review content hash (reviewer `pumpkin-h5-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. With no warnings, the acknowledgement file is empty (`{}`).

## Field coverage of the imported profiles

Coverage is counted on the 24 imported profiles only, over the 67 quality-tracked fields per profile (1,608 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,608 |
| Resolved | 844 |
| Unknown | 764 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 97, calculated 89, source_reported 575, assumed_zero 83 (all numeric 0 with a Z derivation code), unknown 764. Unknown gaps: not reported by source 709, definition mismatch 35, partial components 20. Unknown is higher than in earlier batches because pure fats, oils, and sugar have few nutrient rows in SR Legacy (the two LC clarified butter and ghee profiles resolve 16 fields each, and turbinado sugar resolves 15). No core field is missing on any imported profile, and no type faults were found. 23 profiles take energy from the record's classic energy row (1008). `bell-pepper-orange-raw` has no 1008 row, so it takes energy from the Atwater specific factor row (2048), as the pipeline's energy preference order (1008, 2048, 2047) requires. A field replay against the pinned rows checked 818 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (22) and `omega3` as `sum:ALA+EPA+DHA` (4).

## Imported profiles (completed imports)

acorn-squash-raw, amaranth-leaves-raw, arugula-raw, asparagus-raw, bamboo-shoot-canned-drained, bamboo-shoot-cooked-without-added-fat, banana-pepper-raw, beet-greens-raw, bell-pepper-orange-raw, butter-clarified-as-sold, chicken-fat-as-sold, cocoa-butter-as-sold, coconut-oil-as-sold, corn-oil-as-sold, ghee-as-sold, grapeseed-oil-as-sold, palm-kernel-oil-as-sold, palm-oil-as-sold, rice-bran-oil-as-sold, safflower-oil-high-linoleic-as-sold, safflower-oil-high-oleic-as-sold, soybean-oil-as-sold, sugar-turbinado-as-sold, sunflower-oil-high-linoleic-as-sold.

## V4 cumulative proof

The published base was a frozen copy of main at `b2db4f0`. Before the run it was verified identical to the checkout's curated directory: 219 files, tree SHA-256 `6d2cf429…adb7` for both. It has 242 profiles and 0 defects. The staged set has 24 profiles and 0 defects. `combineCatalogs(published, staged)` gave 266 profiles (86 variant shards, 139 search shards, 629 search entries, 266 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 242, and added exactly the 24 imported H5 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (40 shard files removed, 48 written, 178 unchanged; 226 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h5store-import/`, are byte-identical: 48 files each, tree SHA-256 `408cf09e881850367421fc0f25d1b1bb34b58eaec7aab19275864ee5131a78d5` for both. A full pipeline rerun (enqueue and run all 24 again) left the store at 24 jobs, 24 unique job keys, and 24 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 242 to 266 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning the catalog count of 242.

## Pipeline rejections and holds

One pipeline rejection, held with no match-table entry, no job in the import store, and no profile:

- **`lard-as-sold`** (approved position 108, SR Legacy 171401 "Lard"). Its join, pinned-record checks, and five-core-field preflight all passed. The pinned record's energy row (1008) is 902 kcal per 100 g, derivation NC (calculated). The nutrient registry caps calories per 100 g at a hard maximum of 900 kcal (`hardMaxFor('kcal')` in `nutrientRegistry.js`), so `checkPer100g('calories', 902)` returns `reject` (checked directly against the registry here). That is the check that made `buildRevisionDraft` throw `Invalid nutrient: calories` for H4's `beef-tallow-as-sold`. Because the hold was found before any table edit, no job was run for lard. This is the same validation failure as the beef tallow hold, and the H4 report had already listed lard among the 8 SR Legacy records at 902 kcal. Following the brief and that precedent, the value was not altered, no other record was substituted, and the registry bound was not changed in this import PR. It needs the same registry Q-### gate as beef tallow before it can be retried.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 123 of positions 1-125 are now published (H1 to H5). `beef-tallow-as-sold` (position 100) and `lard-as-sold` (position 108) are held as registry-cap pipeline rejections, and 201 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `lard-as-sold` and `beef-tallow-as-sold` need a registry decision on the per-100 g calorie hard maximum before they can be retried (see above).
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. With 266 profiles it took 3.3 s when the four required suites ran together, and 2.5 s when the `scripts/nutrition` directory ran with file parallelism off (13 files, 181/181 passed). When the whole directory ran in parallel on this host, it timed out at 5 s in both runs (180/181, that test only). The timeout was not changed here. It needs an explicit timeout, and the need grows with each batch.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 24 ids against the published 266-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h5-scripts/`: join and preflight, match-table append (with the hold set, evidence, and shared-record justifications), the pipeline driver (with the held set), and V4 verification. The acknowledgement file is `~/workspace/private-data/h5store-import/acks.json`.
