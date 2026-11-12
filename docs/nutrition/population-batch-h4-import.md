# Population batch H4: import report (#63, third-pass batch H4)

Prepared: 2026-11-12. Base: `main` at `1b807ea` (PR #235, the H3 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, and the ChatGPT third-pass adjudication in issue #215 (2026-11-11/12). That adjudication reviewed Gemini's third-pass proposals for bundle 2 (`gemini-bundle-2026-11-11-717e51249110`) plus the 21 chunked batches, 716 targets in all. It gave 326 APPROVED source-identity pairs, 185 HELD, 21 REJECTED pairings, and 184 UNRESOLVED. APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

H4 is positions 76-100 of the approved-326 file, in file order, all SR Legacy 2018-04. It is the fourth batch of the third-pass (H) lane. **25 were attempted and 24 are published**: the curated catalog goes from 218 to **242** profiles. All 25 passed the join, the pinned-record checks, and the five-core-field preflight. One id, `beef-tallow-as-sold`, is held as a pipeline rejection: its pinned energy row is above the nutrient registry's per-100 g hard maximum for calories, so the profile builder refuses it (see [Pipeline rejections and holds](#pipeline-rejections-and-holds)). Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. Apart from the zero core values and the held record's energy value named below, this report holds no nutrient values, only aggregate coverage counts.

Related: [H3 import report](population-batch-h3-import.md) · [H2 import report](population-batch-h2-import.md) · [H1 import report](population-batch-h1-import.md) · [G4 import report](population-batch-g4-import.md) · [G2 import report](population-batch-g2-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch H4) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection, held) | 1 |
| Reviewed match entries for H4 in the table | 24 |
| Profiles validated, approved, staged, and imported | **24** |
| from SR Legacy 2018-04 | 24 |
| Source-match table entries after this import | 242 (was 218) |
| Catalog profile count after this import | **242** (was 218) |

Store and batch identifiers: store `~/workspace/private-data/h4store-import` (never `/tmp`), parent batch id **`rb-c86db101de3a4f7052a184b2`** (derived over the 25 attempted ids), pass id `rp-eec248ee8dc0e3cee194ba1a`, source release `2018-04`, reviewer `pumpkin-h4-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to H3. Indexing found 7,793 SR Legacy records (0 skipped) and 414 of 424 Foundation records (10 blocked Foundation records with non-numeric amounts, reported and not fatal, per the audit-path indexing from PR #213; none is an H4 source).

## Exact-set gate

The approved-pairs file's recorded SHA-256 values do not match the Drive-served bytes (a serialization difference on GPT's side), so the content was cross-validated instead. That check was re-run here before any match-table edit, and its output was byte-identical to the operator's earlier preflight output:

- Candidate index: the 21 chunked batch inputs under `~/workspace/gemini-batches/` plus the bundle 2 input, 22 bundles and **3,737 candidate entries**.
- All **326** approved pairs are unique by targetId, and all 326 join exactly to an original candidate entry in their named bundle (same targetId, fdcId, dataset, release, and verbatim description). There are 0 join failures.
- The approved-file order was re-derived mechanically: the 21 chunked batches in bundleId order, then bundle 2, each in its own target order, filtered to APPROVED. This reproduces the file order for all 326 (`derivedOrderEqualsFileOrder: true`).
- Positions 76-100 of that order are exactly the 25 ids in the brief (`exactMatch: true`, `derivedSliceMatch: true`), with the brief's fdcIds (`fdcMatchesBrief: true`). They come from four chunked batches: `…58fa9fec344d` (12), `…5ceb3bdc16dd` (6), `…60ba36e97bcb` (6), and `…68e79c05f0c7` (1).
- Positions 1-75 (H1 to H3) are all published, and none of the 25 H4 ids had a match entry before this batch. The base table had 218 entries.

The match table now has 242 entries, and the 218 existing entries are a byte-unchanged prefix (the diff is insertions only). Each H4 entry's stateEvidence carries the pinned-record facts, the approved pair rationale verbatim, any zero core value with its derivation code, and the competing records that are not this product (with explicit boundaries where a near record must not use these values, for example the plain sun-dried tomato record, the stabilized glucose-reduced dried egg records, the heavy-syrup solids-and-liquids peach and pear records, the grass-fed ground bison record, the linoleic and mid-oleic sunflower oil records, the 51% whole-wheat pasta records, the with-added-solution and meat-only chicken records, the 93/7 and fat-free ground turkey records, and the low sodium turkey bacon record). Every cited competing fdcId was checked against the pinned files for its verbatim description. Each rationale carries the approved rationale, the provenance line (Gemini third-pass proposal, bundle 2 plus the 21 chunked batches; adjudicated APPROVED in the ChatGPT third-pass adjudication, issue #215, 2026-11-11/12; selected for H4 as positions 76-100 of approved-326), the source bundle and approved-file position, and the pinned-record verification. None of the 25 approved rationales carries a condition beyond source identity, so no verdict condition needed separate confirmation from the pinned record.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, dataType SR Legacy, verbatim description). All 25 had the five core fields traceably present in the pinned record. Some core values are source zeros. Each is the source's own row, so it counts as present:

- Z (assumed_zero under Q-004): `chicken-egg-white-dried` total fat, and carbohydrate for `ground-bison-raw`, `chicken-wing-meat-and-skin-raw`, and `anchovy-canned-oil-packed-drained`.
- NC (calculated): `ground-turkey-85-percent-lean-15-percent-fat-raw-raw-formulation-85-15` carbohydrate.
- No derivation code (source_reported): protein, carbohydrate, and sodium for `sunflower-oil-high-oleic-as-sold` and `walnut-oil-as-sold` (and for the held `beef-tallow-as-sold`).

None of the 25 was held at preflight. The single hold came later, at the profile builder.

| Approved position | Id | Source | Preflight | Outcome |
| ---: | --- | --- | --- | --- |
| 76 | tomato-sun-dried-oil-packed-drained | SR Legacy 169384 | pass | imported (1 warning acknowledged) |
| 77 | turnip-greens-raw | SR Legacy 170061 | pass | imported |
| 78 | turnip-raw | SR Legacy 170465 | pass | imported |
| 79 | watercress-raw | SR Legacy 170068 | pass | imported |
| 80 | yam-raw | SR Legacy 170071 | pass | imported |
| 81 | chicken-egg-white-dried | SR Legacy 172204 | pass (fat Z zero) | imported |
| 82 | chicken-egg-whole-dried | SR Legacy 172188 | pass | imported |
| 83 | duck-egg-whole-raw | SR Legacy 172189 | pass | imported |
| 84 | quail-egg-whole-raw | SR Legacy 172191 | pass | imported |
| 85 | peach-canned-in-heavy-syrup-drained | SR Legacy 168181 | pass | imported |
| 86 | pear-canned-in-heavy-syrup-drained | SR Legacy 168182 | pass | imported |
| 87 | ground-bison-raw | SR Legacy 174421 | pass (carbohydrate Z zero) | imported |
| 88 | sunflower-oil-high-oleic-as-sold | SR Legacy 172338 | pass (uncoded source zeros) | imported |
| 89 | walnut-oil-as-sold | SR Legacy 171030 | pass (uncoded source zeros) | imported |
| 90 | mung-bean-glass-noodles-dry | SR Legacy 174258 | pass | imported |
| 91 | pasta-whole-wheat-dry | SR Legacy 169738 | pass | imported |
| 92 | rice-noodles-dry | SR Legacy 169742 | pass | imported |
| 93 | chicken-drumstick-meat-and-skin-raw | SR Legacy 172373 | pass | imported |
| 94 | chicken-liver-raw | SR Legacy 171060 | pass | imported |
| 95 | chicken-thigh-meat-and-skin-raw | SR Legacy 172385 | pass | imported |
| 96 | chicken-wing-meat-and-skin-raw | SR Legacy 172390 | pass (carbohydrate Z zero) | imported |
| 97 | ground-turkey-85-percent-lean-15-percent-fat-raw-raw-formulation-85-15 | SR Legacy 174493 | pass (carbohydrate NC zero) | imported |
| 98 | turkey-bacon-as-sold | SR Legacy 174592 | pass | imported |
| 99 | anchovy-canned-oil-packed-drained | SR Legacy 174183 | pass (carbohydrate Z zero) | imported |
| 100 | beef-tallow-as-sold | SR Legacy 171400 | pass (uncoded source zeros) | **held: pipeline rejection** (energy above the registry hard maximum) |

## Pipeline run and validation

The jobs were enqueued for the explicit H4 id list (no `plan`) and ran through the research service layer (`createFileResearchStore` plus `createResearchService`, the layer the CLI uses) against both pinned datasets, indexed once into a fresh store.

The first prepare run enqueued all 25. `runJob` threw for `beef-tallow-as-sold` with `TypeError: Invalid nutrient: calories` from `buildRevisionDraft` (see the hold below), so that run stopped before validation. That store held only the 25 unvalidated jobs from the aborted run, and it was deleted. The match table was reset to the base and re-appended without the held id. Prepare then ran again on a fresh store for the 24 remaining ids.

The second prepare pass validated 24 with 0 errors and 1 warning. Every review packet showed no identity mismatch. All 24 were hash-approved by review content hash (reviewer `pumpkin-h4-import`). The driver refuses approval if any validation warning lacks a documented reason, or if a reason names a warning the job does not carry. Each acknowledged warning and its reason are stored in the job's review notes.

**Acknowledged warning (1).**

1. `tomato-sun-dried-oil-packed-drained`: "Target food state is unspecified". The catalog state `oil-packed-drained` maps, through the variant vocabulary, to preparation `oil-packed` and drained `drained`, with no `state` dimension, so the job's dims have `state: unspecified`. The warning comes from that mapping. It is the same vocabulary gap acknowledged for `applesauce-pureed-unsweetened` in [A3](population-batch-a3-import.md) and `flaxseed-ground` in [G2](population-batch-g2-import.md). It is not an identity doubt: pinned SR Legacy 169384 states "Tomatoes, sun-dried, packed in oil, drained" verbatim, and the plain sun-dried tomato record (168567) is a different product. (`anchovy-canned-oil-packed-drained` carries the same preparation but its state `canned` fills the dimension, so it raised no warning.) The published dims are the vocabulary's own, and no value was adjusted.

## Field coverage of the imported profiles

Coverage is counted on the 24 imported profiles only, over the 67 quality-tracked fields per profile (1,608 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,608 |
| Resolved | 962 |
| Unknown | 646 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 231, calculated 114, source_reported 504, assumed_zero 113 (all numeric 0 with a Z derivation code), unknown 646. Unknown gaps: not reported by source 592, definition mismatch 38, partial components 16. No core field is missing on any imported profile, and no type faults were found. All 24 profiles take energy from the record's classic energy row (1008). A field replay against the pinned rows checked 931 values with 0 mismatches (value and derivation code). Two deterministic representations are identified in field provenance and were not replayed as source rows: `fiber` as `same_as:fiberTotal` (23) and `omega3` as `sum:ALA+EPA+DHA` (8).

## Imported profiles (completed imports)

anchovy-canned-oil-packed-drained, chicken-drumstick-meat-and-skin-raw, chicken-egg-white-dried, chicken-egg-whole-dried, chicken-liver-raw, chicken-thigh-meat-and-skin-raw, chicken-wing-meat-and-skin-raw, duck-egg-whole-raw, ground-bison-raw, ground-turkey-85-percent-lean-15-percent-fat-raw-raw-formulation-85-15, mung-bean-glass-noodles-dry, pasta-whole-wheat-dry, peach-canned-in-heavy-syrup-drained, pear-canned-in-heavy-syrup-drained, quail-egg-whole-raw, rice-noodles-dry, sunflower-oil-high-oleic-as-sold, tomato-sun-dried-oil-packed-drained, turkey-bacon-as-sold, turnip-greens-raw, turnip-raw, walnut-oil-as-sold, watercress-raw, yam-raw.

## V4 cumulative proof

The published base was a frozen copy of main at `1b807ea`. Before the run it was verified identical to the checkout's curated directory: 209 files, tree SHA-256 `fed3e309…f2e8` for both. It has 218 profiles and 0 defects. The staged set has 24 profiles and 0 defects. `combineCatalogs(published, staged)` gave 242 profiles (82 variant shards, 136 search shards, 574 search entries, 242 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 218, and added exactly the 24 imported H4 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates. The combined catalog was written to `public/shared/nutrition/catalog/nutrition-curated/` (38 shard files removed, 49 written, 170 unchanged; 219 files on disk). A reread of the written directory is identical to the combined catalog.

## Idempotency and determinism

The two staging runs, into two fresh directories under `~/workspace/private-data/h4store-import/`, are byte-identical: 49 files each, tree SHA-256 `a9935f1bd72e346d2f608b6ea059208513b487c52b70e87dd8a1f342f8358237` for both. A full pipeline rerun (enqueue and run all 24 again) left the store at 24 jobs, 24 unique job keys, and 24 unique manifest ids, all still approved, so it created no duplicates. A combine rerun is identical to the first combine.

## Count pins

Both shipped-catalog count pins move from 218 to 242 in this PR: `public/tools/CalorieTracker/nutrition/ingredientCatalog.test.js` (`shipped.profileCount`) and `scripts/nutrition/catalogIntegrity.test.ts` (shipped `profileCount`, `variantIds` length, self append-only `preserved`, and the CLI summary `profileCount`). A search of all test files found no other test pinning the catalog count of 218. The only other `218` in a test file is an unrelated kJ energy fixture row in `normalizationVerification.test.ts`.

## Pipeline rejections and holds

One pipeline rejection, held with no match-table entry, no job in the import store, and no profile:

- **`beef-tallow-as-sold`** (approved position 100, SR Legacy 171400 "Fat, beef tallow"). Its join, pinned-record checks, and five-core-field preflight all passed. The pinned record's energy row (1008) is 902 kcal per 100 g, derivation NC (calculated). The nutrient registry caps calories per 100 g at a hard maximum of 900 kcal (`hardMaxFor('kcal')` in `nutrientRegistry.js`), so `checkPer100g('calories', 902)` returns `reject`, and `buildRevisionDraft` throws `Invalid nutrient: calories` inside `runJob`. No other value among the 25 records is above a registry hard maximum (checked over every row: kcal above 900 or grams above 100). Following the brief, the value was not altered, no other record was substituted, and the registry bound was not changed in this import PR. Whether the calorie bound should allow pure fats calculated above 900 kcal is a registry decision. In the pinned SR Legacy 2018-04 file, 8 records have an energy row above 900 kcal, all at 902: beef tallow, lard, and six fish oils (herring, menhaden, fully hydrogenated menhaden, salmon, cod liver, sardine). It needs its own Q-### gate before this id can be retried.

## Third-pass reconciliation after this batch

Of the 326 third-pass APPROVED pairs, 99 of positions 1-100 are now published (H1 to H4). `beef-tallow-as-sold` (position 100) is held as above, and 226 remain for later H batches. The 185 HELD, 21 REJECTED, and 184 UNRESOLVED third-pass verdicts got nothing, and neither did any approved pair outside these 25. The bundle-1 Q-018 lane is closed (98 published, 2 held; see the [G4 report](population-batch-g4-import.md)).

## Blocking issues

- `beef-tallow-as-sold` needs a registry decision on the per-100 g calorie hard maximum before it can be retried (see above).
- Test timing: the `shipped catalog (#63 V4)` test in `catalogIntegrity.test.ts` reads and verifies the full shipped catalog under vitest's default 5 s timeout. It took 2.2 s when its suite ran alone. When the whole `scripts/nutrition` directory ran in parallel on a 4-CPU host, it timed out in 2 of 3 runs; the third run passed 181/181. The timeout was not changed here. It may need an explicit timeout as the catalog grows.

The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 24 ids against the published 242-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects. The driver scripts are kept outside the checkout under `~/workspace/private-data/h4-scripts/`: join and preflight, match-table append (with the hold set), the pipeline driver (with the held set), and V4 verification. The acknowledgement file is `~/workspace/private-data/h4store-import/acks.json`.
