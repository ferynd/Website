# Population batch G3: import report (#63, Gemini batch G3)

Prepared: 2026-11-12. Base: `main` at `33221f8` (PR #230, the corrected G2 import). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports; issue #215 ANSWER Q-018, recorded in [q018-gemini-200-verdicts.json](adjudications/q018-gemini-200-verdicts.json); and the Q-021 merge record plus the G3/G4 planning reconstruction in issue #215, which fixed G3 as original bundle positions 98-132. Q-018 APPROVED means source identity only. It is subject to exact pinned USDA row replay, field provenance, the five-core-field preflight, and the V4 append-only checks, and it is not an import approval by itself. This PR ran the full pipeline, and it still needs its own independent review at its exact head before merging.

G3 is the next 25 Q-018-APPROVED pairings in original bundle order, APPROVED positions 51 to 75 (`gemini-bundle-2026-11-11-f5d496273016`, original bundle positions 98-132). **25 were attempted and 25 are published**: the curated catalog goes from 93 to **118** profiles. Every candidate passed the five-core-field preflight introduced after ANSWER Q-021 (energy, protein, carbohydrate, total fat, and sodium rows all present in the pinned record), so nothing was held this batch. Both write flags stay false. There was no live call, no FDC API key, no Gemini or paid API call, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Run notes: this import took three runs. The first run was killed silently (empty log) after appending the 25 reviewed match entries and passing the exact-set preflight gate; its match table was re-verified entry by entry and kept. The second run completed the full pipeline (index, jobs, validation, hash-bound approval, two byte-identical stagings, V4 combine and write of the combined catalog, both count pins) and was then killed by SIGTERM before it could write this report, the bookkeeping, or a commit. The orchestrator verified the pipeline outputs directly (store jobs all approved, verify-write results, staging hashes), re-ran the test suites, and finished the report, Stage log, backlog note, and commit itself, following the PR #207 / #211 precedent. Every number below comes from the second run's recorded outputs, independently re-checked where noted.

Related: [G2 import report](population-batch-g2-import.md) · [G1 import report](population-batch-g1-import.md) · [Q-018 review](adjudications/q018-gemini-200-review.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch G3) | 25 |
| Joined verdict to candidate entry and verified against the pinned record | 25 |
| Passed the five-core-field preflight | 25 |
| Rejected at import (pipeline rejection) | 0 |
| Held | 0 |
| Reviewed match entries for G3 in the table | 25 |
| Profiles validated, approved, staged, and imported | **25** |
| from Foundation 2026-10-29 | 6 |
| from SR Legacy 2018-04 | 19 |
| Source-match table entries after this import | 118 (was 93) |
| Catalog profile count after this import | **118** (was 93) |

Store and batch identifiers: store `~/workspace/private-data/g3store-import/store` (never `/tmp`), parent batch id **`rb-29feb61942ccd80fe73a9af6`**, pass id `rp-91edb9e056c8fa495e4d7ac1`, pass release `2018-04+2026-10-29`.

Pinned files: the reader checked each against its extracted-file SHA-256 pin on every load (SR Legacy 2018-04 `70d4235a…0129`, Foundation 2026-10-29 `990e7731…58a1`; the same pins as A1 to G2). Indexing: Foundation 414 of 424 records (the same 10 known non-numeric-amount records skipped and reported), SR Legacy 7,793 of 7,793, 0 duplicates.

## Exact-set gate

The batch was re-derived mechanically from the original bundle order plus the Q-018 verdicts: APPROVED positions 51-75 are exactly original bundle positions 98-132, the 25 ids in the brief, with zero overlap with the 93 published match entries (the only earlier APPROVED ids not in the table remain the two holds, `pomegranate-arils-raw` and `olive-oil-extra-virgin-as-sold`). The gate output (`exactMatch: true`, positions match) is recorded in the store's preflight artifacts.

## Pipeline run and validation

All 25 jobs ran through the research service layer against both pinned datasets, validated with 0 errors and 0 warnings, and were hash-approved (reviewer `pumpkin-g3-import`). No warning acknowledgements were needed this batch.

## Field coverage of the imported profiles

Coverage is counted on the 25 imported profiles only, over the 67 quality-tracked fields per profile (1,675 cells):

| Measure | Count |
| --- | ---: |
| Cells | 1,675 |
| Resolved | 911 |
| Unknown | 764 |
| Unexamined | 0 |

Quality status counts under the Q-004 derivation policy: measured 257, calculated 110, source_reported 448, assumed_zero 96 (all numeric 0 with a Z derivation code), unknown 764. Unknown gaps: not reported by source 698, definition mismatch 42, partial components 24. No core field is missing on any imported profile, and no type faults were found.

## Imported profiles (completed imports)

bell-pepper-green-raw, bell-pepper-red-raw, broccoli-boiled-drained-without-added-salt, broccoli-raw, brussels-sprouts-boiled-drained-without-added-salt, cabbage-green-raw, carrot-boiled-drained-without-added-salt, carrot-raw, cauliflower-boiled-drained-without-added-salt, cauliflower-raw, garlic-raw, ginger-root-raw, green-bean-boiled-drained-without-added-salt, green-bean-canned-drained, green-bean-raw, green-pea-boiled-drained-without-added-salt, green-pea-canned-drained, green-pea-raw, honey-as-sold, kale-boiled-drained-without-added-salt, onion-red-raw, onion-yellow-raw, poblano-pepper-raw, potato-peeled-boiled-drained-without-added-salt, sugar-granulated-white-as-sold. Each has its reviewed match-table entry with the Q-018 verdict reason, the pinned-record verification, and the bundle provenance carried in its rationale.

## V4 cumulative proof

`combineCatalogs(published, staged)` gave 118 profiles with 0 defects. `verifyCatalog` on the combined catalog: 0 defects. `verifyAppendOnly(published, combined)`: 0 defects, preserved 93, added exactly the 25 G3 ids. Recombining the combined catalog with the staged set reproduced it identically (no duplicates on rerun).

## Idempotency and determinism

Two staging runs are byte-identical (29 files, tree SHA-256 `61652dda…a1` for both). A combine rerun is identical to the first combine.

## Pipeline rejections and holds

None. All 25 candidates passed the join, the pinned-record verification, and the five-core-field preflight.

## Blocking issues

None for this batch. The ladder stays at 25 (ANSWER Q-020: G1 was not a clean 25/25; no later answer has advanced it).

## Re-run instructions

Re-running the pipeline for the same 25 ids against the published 118-profile catalog creates no duplicates: the jobs are hash-bound to the same match entries, staging reproduces the same bytes, and `combineCatalogs` plus `verifyAppendOnly` return the same combined catalog with 0 defects.
