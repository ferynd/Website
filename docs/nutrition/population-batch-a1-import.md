# Population batch A1: import report (#63-A-1)

Prepared: 2026-11-10. Base: `main` at `697dad7` (PR #214). Authority: James's 2026-11-10 standing approval for the #63 population waves, his 2026-11-10 validation decisions (V1: complete A1 end to end under the rejection standard), the reviewed adjudication recorded as ANSWER Q-000 in issue #215, the mayonnaise source switch recommended in ANSWER Q-002 and approved by James on 2026-11-10, and the derivation labeling policy decided in ANSWER Q-004 under James's delegation. Review round 1 (ANSWER Q-003) required changes to the first version of this import; this report describes the corrected, restaged result. This import publishes **9 completed profiles** to the curated catalog. Proposed matches are listed separately and are not imports. Both write flags stay false; no Firestore access, no live calls, no FDC API key. The pinned dataset files stayed outside the checkout.

Related: [A1 dry-run report](population-batch-a1-report.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [normalization verification](normalization-verification.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch A1) | 25 |
| Reviewed match entries written | 9 |
| Profiles validated, approved, staged, and imported | **9** |
| Unresolved (no reviewed entry; blocked at matching, fail closed) | 16 |
| Catalog profile count after this import | 9 (was 0) |

Parent batch id `rb-de5702452450983345068f40` (same deterministic id as the dry run). The pass ran the merged PR #213/#214 pipeline: `plan`, `run --source fdc-bulk` (mixed releases in one pass, per-job match-entry release), `validate`, hash-bound `review --decide approve`, `stage --write`.

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions below are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description |
| --- | --- | --- | --- |
| breadcrumbs-plain-as-sold | SR Legacy 2018-04 | 174928 | Bread, crumbs, dry, grated, plain |
| chocolate-dark-45-59-percent-cacao-as-sold | SR Legacy 2018-04 | 170271 | Chocolate, dark, 45- 59% cacao solids |
| chocolate-dark-60-69-percent-cacao-as-sold | SR Legacy 2018-04 | 170272 | Chocolate, dark, 60-69% cacao solids |
| chocolate-dark-70-85-percent-cacao-as-sold | SR Legacy 2018-04 | 170273 | Chocolate, dark, 70-85% cacao solids |
| chocolate-milk-as-sold | SR Legacy 2018-04 | 167587 | Candies, milk chocolate |
| chocolate-unsweetened-baking-as-sold | SR Legacy 2018-04 | 167568 | Baking chocolate, unsweetened, squares |
| chocolate-white-as-sold | SR Legacy 2018-04 | 167571 | Candies, white chocolate |
| cocoa-powder-unsweetened-dutch-process-as-sold | SR Legacy 2018-04 | 169594 | Cocoa, dry powder, unsweetened, processed with alkali |
| mayonnaise-regular-as-sold | SR Legacy 2018-04 | 171009 | Salad dressing, mayonnaise, regular |

All 9 passed the pipeline validator with no errors. One warning was acknowledged, on cocoa-powder-unsweetened-dutch-process: "Atwater energy inconsistency: reported 220 kcal differs from calculated 424 kcal by >106". The staged profile keeps the source's reported energy (220 kcal per 100 g). The Atwater general-factor calculation overstates cocoa because much of its carbohydrate is fiber (29.8 g per 100 g in this record); the reported value is the record's own energy field and is retained deliberately. The warning is documented, not presented as fully explained. This is a flagged item reviewed individually, per the batch rules.

## Mayonnaise source switch (ANSWER Q-002, approved by James)

The first version of this import held mayonnaise out: its identity-approved Foundation record (2758986) carries no energy, total fat, carbohydrate, or sodium rows, so the profile would have published with null calories and null total fat. ANSWER Q-002 recommended switching the reviewed source to SR Legacy 171009, the same food with a complete profile, and James approved the switch on 2026-11-10. The match-table entry now points at SR 171009; the Foundation record is preserved in the adjudication audit trail as a rejected-for-base candidate and none of its rows were merged into this profile. The imported mayonnaise resolves 43 of 67 fields, including energy 680 kcal, total fat 74.8 g, and sodium 635 mg per 100 g.

## Removed in review round 1 (ANSWER Q-003)

The first version of this import staged 11 profiles. Independent review required three removals, applying the same exact-identity standard as ANSWER Q-000: a form or variant qualifier that appears only by inference from portion types or sibling records is not a match. The three records were re-checked in full for explicit wording; none carries any.

| Manifest id | Proposed source | Why it is unresolved |
| --- | --- | --- |
| lemon-juice-fresh-ready-to-drink | SR 167747, "Lemon juice, raw" | "Raw" does not explicitly establish fresh-squeezed or ready-to-drink form; the same inference rejected for orange juice in Q-000. |
| lime-juice-fresh-ready-to-drink | SR 168156, "Lime juice, raw" | Same as lemon juice: fresh form is inferred, not stated. |
| soy-sauce-regular-as-sold | SR 174277, "Soy sauce made from soy and wheat (shoyu)" | The record identifies shoyu but does not explicitly state regular or full sodium; "regular" was inferred by contrast with low-sodium siblings. |

Their match-table entries were removed and the batch was restaged without them. They join the unresolved set below and keep their proposed FDC ids as candidate references only.

## Unresolved (16)

These ids have no reviewed match entry. The deterministic pass blocked every one at matching with `match_not_found`, which is the fail-closed behavior from PR #213 working as intended: no entry, no match, no proposal.

Original 8 from the dry run (unchanged reasons, see the [dry-run report](population-batch-a1-report.md#unresolved)): apple-cider-nonalcoholic-ready-to-drink, ginger-beer-nonalcoholic-ready-to-drink, pear
...[truncated 5836 chars]