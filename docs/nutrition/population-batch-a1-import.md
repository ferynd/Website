# Population batch A1: import report (#63-A-1)

Prepared: 2026-11-10. Base: `main` at `697dad7` (PR #214). Authority: James's 2026-11-10 standing approval for the #63 population waves and his validation decisions (V1: complete A1 end to end). Identification follows the consolidated matching policy James adopted in issue #215 on 2026-11-10: a match is approved when the material food class attributes are supported by the record itself or by the dataset's own naming taxonomy, with no contradicting evidence, documented per item in [the A1 evidence matrix](a1-evidence-matrix.md). This supersedes the literal wording reading applied in ANSWER Q-000 and Q-003. The mayonnaise source switch (ANSWER Q-002) was approved by James on 2026-11-10, and the derivation labeling policy (ANSWER Q-004) was decided under James's delegation. Review round 2 (ANSWER Q-005) required the identity re-adjudication and a validator fix; this report describes the corrected, restaged result. This import publishes **14 completed profiles** to the curated catalog. Proposed matches are listed separately and are not imports. Both write flags stay false; no Firestore access, no live calls, no FDC API key. The pinned dataset files stayed outside the checkout.

Related: [A1 dry-run report](population-batch-a1-report.md) · [A1 evidence matrix](a1-evidence-matrix.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [normalization verification](normalization-verification.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch A1) | 25 |
| Reviewed match entries written | 14 |
| Profiles validated, approved, staged, and imported | **14** |
| Unresolved (no reviewed entry; blocked at matching, fail closed) | 11 |
| Catalog profile count after this import | 14 (was 0) |

Parent batch id `rb-de5702452450983345068f40` (same deterministic id as the dry run). The pass ran the merged PR #213/#214 pipeline: `plan`, `run --source fdc-bulk` (mixed releases in one pass, per-job match-entry release), `validate`, hash-bound `review --decide approve`, `stage --write`. Staging was run twice into fresh directories; the outputs are byte-identical. Pinned file checksums (SHA-256): SR Legacy 2018-04 bulk file `70d4235ae3a2bdf48a7b9eaa1286a83fa67b6f3270436c9ce8b008213f500129`; Foundation 2026-10-29 bulk file `990e7731dcec30cecbbb212896a0fe4333f38c65ce7f525e2b679f0dc27658a1`.

## Field coverage of the imported profiles

Across the 14 head revisions: 938 quality-tracked field cells (67 per profile), **566 resolved, 372 explicit unknowns, 0 unexamined**. Quality statuses under the Q-004 derivation policy: measured 282, calculated 82, source_reported 175, assumed_zero 27, unknown 372. Every assumed_zero value is the numeric 0 with a Z derivation code in provenance. All 14 profiles resolve energy, protein, carbohydrate, total fat, and sodium. (The staged nutrient maps carry one additional legacy key, `fiberWeightedLegacy`, null on every profile; it has no quality entry and is excluded from the cell counts above, the same basis ANSWER Q-005 verified for round 1.)

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions below are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description | Resolved |
| --- | --- | --- | --- | ---: |
| breadcrumbs-plain-as-sold | SR Legacy 2018-04 | 174928 | Bread, crumbs, dry, grated, plain | 41/67 |
| chocolate-dark-45-59-percent-cacao-as-sold | SR Legacy 2018-04 | 170271 | Chocolate, dark, 45- 59% cacao solids | 37/67 |
| chocolate-dark-60-69-percent-cacao-as-sold | SR Legacy 2018-04 | 170272 | Chocolate, dark, 60-69% cacao solids | 37/67 |
| chocolate-dark-70-85-percent-cacao-as-sold | SR Legacy 2018-04 | 170273 | Chocolate, dark, 70-85% cacao solids | 37/67 |
| chocolate-milk-as-sold | SR Legacy 2018-04 | 167587 | Candies, milk chocolate | 41/67 |
| chocolate-unsweetened-baking-as-sold | SR Legacy 2018-04 | 167568 | Baking chocolate, unsweetened, squares | 43/67 |
| chocolate-white-as-sold | SR Legacy 2018-04 | 167571 | Candies, white chocolate | 40/67 |
| cocoa-powder-unsweetened-dutch-process-as-sold | SR Legacy 2018-04 | 169594 | Cocoa, dry powder, unsweetened, processed with alkali | 40/67 |
| cocoa-powder-unsweetened-natural-as-sold | SR Legacy 2018-04 | 169593 | Cocoa, dry powder, unsweetened | 40/67 |
| lemon-juice-fresh-ready-to-drink | SR Legacy 2018-04 | 167747 | Lemon juice, raw | 43/67 |
| lime-juice-fresh-ready-to-drink | SR Legacy 2018-04 | 168156 | Lime juice, raw | 42/67 |
| mayonnaise-regular-as-sold | SR Legacy 2018-04 | 171009 | Salad dressing, mayonnaise, regular | 43/67 |
| orange-juice-fresh-ready-to-drink | SR Legacy 2018-04 | 169098 | Orange juice, raw (Includes foods for USDA's Food Distribution Program) | 41/67 |
| soy-sauce-regular-as-sold | SR Legacy 2018-04 | 174277 | Soy sauce made from soy and wheat (shoyu) | 41/67 |

All 14 passed the pipeline validator with no errors. Two Atwater warnings were acknowledged, one per cocoa profile: Dutch reports 220 kcal against a calculated 424 kcal, natural reports 228 kcal against a calculated 433 kcal. Both staged profiles keep the source's reported energy. The Atwater general-factor calculation overstates cocoa because much of its carbohydrate is fiber (about 30 g per 100 g in these records); the reported values are the records' own energy fields and are retained deliberately. The warnings are documented, not presented as fully explained. These are flagged items reviewed individually, per the batch rules.

## Mayonnaise source switch (ANSWER Q-002, approved by James)

The first version of this import held mayonnaise out: its identity-approved Foundation record (2758986) carries no energy, total fat, carbohydrate, or sodium rows, so the profile would have published with null calories and null total fat. ANSWER Q-002 recommended switching the reviewed source to SR Legacy 171009, the same food with a complete profile, and James approved the switch on 2026-11-10. The match-table entry points at SR 171009; the Foundation record is preserved in the adjudication audit trail as a rejected-for-base candidate and none of its rows were merged into this profile. The imported mayonnaise resolves 43 of 67 fields, including energy 680 kcal, total fat 74.8 g, and sodium 635 mg per 100 g.

## Identity re-adjudication in review round 2 (ANSWER Q-005, consolidated policy)

Round 1 removed lemon juice, lime juice, and soy sauce under a literal wording standard, and ANSWER Q-000 had rejected orange juice and natural cocoa on the same basis. Under the consolidated matching policy James adopted, those five were re-examined attribute by attribute against the pinned records, with the evidence written down in [the A1 evidence matrix](a1-evidence-matrix.md). For the juices and shoyu, the record identity, release-specific contrasts, and usable nutrient profile support a generic equivalent without proving a particular brand, packaging, or pasteurization state. For natural cocoa, the sibling contrast is supplemented by independent U.S. cocoa naming rules and university extension terminology; an omitted alkali qualifier alone would not prove the processing method. All five are restored as documented supported equivalents and are imported above.

The evidence pass kept three items unresolved for this batch, with corrected reasons: pomegranate juice is NOT excluded simply because Foundation 2727588 is from concentrate (that can be ready-to-drink), but its energy/fat/carbohydrate fields are absent and its 100%-juice formulation needs review; SR Legacy 167787 "Pomegranate juice, bottled" is an additional complete-macro candidate that needs a 100%-juice identity check. Salsa-red (Foundation 746777) is a composite of chunky medium branded products whose generic red/tomato formulation has not been verified; the catalog target does not specify "smooth". Semisweet chocolate chips cannot yet inherit SR 167976's confection formulation without evidence; shape alone does not prove nutrient differences, and chip household weights must be independently sourced. Keep these as unapproved candidates, not canonical matches or imported profiles.

ANSWER Q-005 also found that the immutable-profile validator (`ingredientProfile.js` `validateRevision`) did not enforce the Q-004 rule that an `assumed_zero` status requires the numeric 0, even though the research pipeline validator did. That invariant is now enforced in `validateRevision` itself, including a Z derivation code check when provenance carries one, with regression tests for a valid zero, an invalid positive value, an invalid null, and a wrong derivation code.

## Unresolved (11)

These ids have no reviewed match entry. The deterministic pass blocked every one at matching with `match_not_found`, which is the fail-closed behavior from PR #213 working as intended: no entry, no match, no proposal.

Original 8 from the dry run (unchanged reasons, see the [dry-run report](population-batch-a1-report.md#unresolved)): apple-cider-nonalcoholic-ready-to-drink, ginger-beer-nonalcoholic-ready-to-drink, pear-juice-100-percent-ready-to-drink, mustard-dijon-as-sold, panko-breadcrumbs-as-sold, cacao-nibs-as-sold, miso-red-as-sold, miso-white-as-sold.

Unresolved proposals kept as candidate references only (3): pomegranate-juice-100-percent-ready-to-drink (Foundation 2727588 lacks core macros and 100%-juice verification; consider SR Legacy 167787 separately), salsa-red-as-sold (Foundation 746777 branded chunky medium composite, generic red formulation not yet established), chocolate-chips-semisweet-as-sold (SR 167976 confection composition not independently validated for chips or chip conversions).

Unresolved here means unresolved for this batch, not unmatchable forever: a later wave may revisit an id if a pinned source with adequate evidence appears, under the same reviewed-entry rule.
