# Population batch G4: import report (#63, Gemini batch G4)

Prepared: 2026-11-12. Base: `main` at `eb6603e` (PR #231, the G3 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports; issue #215 ANSWER Q-018, recorded in [q018-gemini-200-verdicts.json](adjudications/q018-gemini-200-verdicts.json); and the Q-021 merge record plus the G3/G4 planning reconstruction in issue #215, which fixed G4 as original bundle positions 133-200. Q-018 APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

G4 is the last 25 Q-018-APPROVED pairings in original bundle order, APPROVED positions 76 to 100 (`gemini-bundle-2026-11-11-f5d496273016`, original bundle positions 133-200). It is the last batch of the bundle-1 Q-018 lane. **25 were attempted and 25 are published**: the curated catalog goes from 118 to **143** profiles. Every candidate passed the five-core-field preflight (energy, protein, carbohydrate, total fat, and sodium rows all present in the pinned record), so nothing was held this batch. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Run notes: the first G4 Claude run completed the pipeline (match-table append, exact-set gate, preflight, index, jobs, validation, hash-bound approval, two stagings, the V4 combine and write of the combined catalog, both count pins). A sandbox restart killed it at 2026-11-12T11:42Z, after staging and before it could write this report, the bookkeeping, or a commit. The orchestrator verified the pipeline outputs directly: the store jobs are all approved, the exact-set gate output matches, and a rerun of the V4 verification script reproduced every result below. A finishing pass then wrote this report, the Stage log rows, and the backlog note, re-ran the test suites, and committed. The pipeline was not re-run in the finishing pass, and the match table and catalog output were not edited by it.

Related: [G3 import report](population-batch-g3-import.md) · [G2 import report](population-batch-g2-import.md) · [G1 import report](population-batch-g1-import.md) · [Q-018 review](adjudications/q018-gemini-200-review.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch G4) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Held | 0 |
| Reviewed match entries for G4 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from Foundation 2026-10-29 | 2 |
| from SR Legacy 2018-04 | 23 |
| Source-match table entries after this import | 143 (was 118) |
| Catalog profile count after this import | **143** (was 118) |

Store and batch identifiers: store `~/workspace/private-data/g4store-import` (never `/tmp`), parent batch id **`rb-5ae4d88400934e09faa0548d`**, pass id `rp-6fe217226a2d55e045665bb0`, reviewer `pumpkin-g4-import`.

Pinned files: SR Legacy 2018-04 `70d4235a…0129` and Foundation 2026-10-29 `990e7731…58a1`, the same extracted-file SHA-256 pins as A1 to G3.

## Exact-set gate

The batch was re-derived mechanically from the original bundle order (200 targets) plus the Q-018 verdicts (100 APPROVED). APPROVED positions 76-100 are exactly original bundle positions 133-200, which are the 25 ids in the brief (`exactMatch: true`, `positionsMatch: true`). None overlaps the 118 published match entries. The match table now has 143 entries, and the 118 existing entries are a byte-unchanged prefix. Each G4 entry carries its Q-018 verdict reason, the pinned-record verification, and the bundle provenance (original bundle positions 133-200, with the entry's own position) in its stateEvidence and rationale.

## Preflight (five core fields)

All 25 passed the join (targetId plus fdcId against the original candidate entry) and the pinned-record checks (record present in the named dataset, verbatim description). All 25 had the five core fields traceably present in the pinned record. Result: 0 holds and 0 pipeline rejections.

| Id | Bundle position | Source | Preflight |
| --- | ---: | --- | --- |
| potato-white-with-skin-raw | 133 | SR Legacy 170028 | pass |
| potato-with-skin-baked-without-added-fat | 134 | SR Legacy 170093 | pass |
| spinach-boiled-drained-without-added-salt | 136 | SR Legacy 168463 | pass |
| spinach-raw | 138 | SR Legacy 168462 | pass |
| sweet-corn-kernels-raw | 142 | Foundation 2710826 | pass |
| sweet-potato-orange-flesh-raw | 145 | Foundation 2346404 | pass |
| tomato-red-raw | 148 | SR Legacy 170457 | pass |
| zucchini-raw | 150 | SR Legacy 169291 | pass |
| black-tea-brewed-ready-to-drink | 170 | SR Legacy 173227 | pass |
| carrot-juice-ready-to-drink | 171 | SR Legacy 170491 | pass |
| club-soda-ready-to-drink | 172 | SR Legacy 174842 | pass |
| coconut-water-unsweetened-ready-to-drink | 173 | SR Legacy 174831 | pass |
| coffee-brewed-black-ready-to-drink | 174 | SR Legacy 171890 | pass |
| coffee-decaffeinated-brewed-black-ready-to-drink | 175 | SR Legacy 171889 | pass |
| cola-regular-ready-to-drink | 177 | SR Legacy 174852 | pass |
| cranberry-juice-cocktail-ready-to-drink | 178 | SR Legacy 171903 | pass |
| cranberry-juice-unsweetened-ready-to-drink | 179 | SR Legacy 168117 | pass |
| espresso-ready-to-drink | 180 | SR Legacy 171891 | pass |
| ginger-ale-ready-to-drink | 181 | SR Legacy 174846 | pass |
| green-tea-brewed-ready-to-drink | 183 | SR Legacy 171917 | pass |
| instant-coffee-plain-dry | 185 | SR Legacy 171893 | pass |
| tomato-juice-ready-to-drink | 191 | SR Legacy 170458 | pass |
| tonic-water-ready-to-drink | 193 | SR Legacy 171869 | pass |
| water-tap-ready-to-drink | 196 | SR Legacy 173647 | pass |
| croissant-butter-as-sold | 200 | SR Legacy 174987 | pass |

## Pipeline run and validation

All 25 jobs ran through the research service layer against both pinned datasets. The prepare pass validated 25 with 0 errors and 0 warnings, and all 25 were hash-approved (reviewer `pumpkin-g4-import`). No warning acknowledgements were needed this batch.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 984 |
| Unknown | 691 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 232, calculated 118, source_reported 513, assumed_zero 121 (all numeric 0 with a Z derivation code), unknown 691. Unknown gaps: not reported by source 629, definition mismatch 42, partial components 20. No core field is missing on any imported profile, and no type faults were found. A field replay against the pinned rows checked 955 values with 0 mismatches.

## Imported profiles (completed imports)

black-tea-brewed-ready-to-drink, carrot-juice-ready-to-drink, club-soda-ready-to-drink, coconut-water-unsweetened-ready-to-drink, coffee-brewed-black-ready-to-drink, coffee-decaffeinated-brewed-black-ready-to-drink, cola-regular-ready-to-drink, cranberry-juice-cocktail-ready-to-drink, cranberry-juice-unsweetened-ready-to-drink, croissant-butter-as-sold, espresso-ready-to-drink, ginger-ale-ready-to-drink, green-tea-brewed-ready-to-drink, instant-coffee-plain-dry, potato-white-with-skin-raw, potato-with-skin-baked-without-added-fat, spinach-boiled-drained-without-added-salt, spinach-raw, sweet-corn-kernels-raw, sweet-potato-orange-flesh-raw, tomato-juice-ready-to-drink, tomato-red-raw, tonic-water-ready-to-drink, water-tap-ready-to-drink, zucchini-raw.

## V4 cumulative proof

The published base has 118 profiles and 0 defects. The staged set has 25 profiles and 0 defects. `combineCatalogs(published, staged)` gave 143 profiles (55 variant shards, 105 search shards, 367 search entries, 143 revisions). `verifyCatalog` on the combined catalog found 0 defects. `verifyAppendOnly(published, combined)` found 0 defects, preserved 118, and added exactly the 25 G4 ids. Recombining the combined catalog with the staged set reproduced it identically, so a rerun creates no duplicates.

## Idempotency and determinism

The two staging runs are byte-identical: 48 files each, tree SHA-256 `9e9be9bfca635b324136057659ef32b827159bfb3842400093e005211f22fbc6` for both. A combine rerun is identical to the first combine.

## Pipeline rejections and holds

None. All 25 candidates passed the join, the pinned-record verification, and the five-core-field preflight.

## Q-018 reconciliation after this batch

With G4, every Q-018 APPROVED pairing in bundle 1 has been processed. Of the 100 APPROVED pairings, 98 are published and 2 are held:

| Batch | APPROVED positions | Published | Held |
| --- | --- | ---: | --- |
| G1 | 1-25 | 24 | `pomegranate-arils-raw` (aril basis not confirmable from the pinned record) |
| G2 | 26-50 | 24 | `olive-oil-extra-virgin-as-sold` (all five core fields absent, ANSWER Q-021) |
| G3 | 51-75 | 25 | none |
| G4 | 76-100 | 25 | none |
| **Total** | 1-100 | **98** | **2** |

The 48 HELD, 7 REJECTED, and 45 UNRESOLVED Q-018 verdicts got nothing. The third-pass pool (H lane) and Bundle 2 are separate lanes with their own Q-### gates, and this batch touched neither.

## Blocking issues

None for this batch. The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25, and Q-021 does not advance it either).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 143-profile catalog creates no duplicates. The jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects.
