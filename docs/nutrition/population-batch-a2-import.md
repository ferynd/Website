# Population batch A2: import report (#63-A-2)

Prepared: 2026-11-11. Base: `main` at `b28ee1d` (PR #221). Authority: James's 2026-11-10 standing approval for the #63 population waves and batch imports, his batch ladder (A2 stays at 25), and issue #215 ANSWER Q-010 Part 2, which adjudicated the 18 flagged A2 cases and authorized specific reviewed identity/source pairings subject to deterministic pinned-record verification at import time. Q-010 is not an import approval by itself: this PR ran the full pipeline and still needs its own independent review at its exact head before merging.

This import adds **15 completed profiles** to the curated catalog (14 published before, 29 after). Ten ids stay unresolved. Proposed matches from the [A2 preparation report](population-batch-a2-report.md) are not imports; only the profiles listed under [Imported profiles](#imported-profiles-completed-imports) are. Both write flags stay false. There was no live call, no FDC API key, and no Firestore or rules change. The pinned dataset files, the job store, and the staging runs stayed outside the checkout. This report holds no nutrient values, only aggregate coverage counts.

Related: [A2 preparation report](population-batch-a2-report.md) · [A2 evidence matrix](a2-evidence-matrix.md) · [A1 import report](population-batch-a1-import.md) · [catalog integrity (V4)](catalog-integrity-verification.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md)

## Contents

1. [Outcome summary](#outcome-summary)
2. [Exact-set gate](#exact-set-gate)
3. [Pipeline run and validation](#pipeline-run-and-validation)
4. [Field coverage of the imported profiles](#field-coverage-of-the-imported-profiles)
5. [Imported profiles (completed imports)](#imported-profiles-completed-imports)
6. [Per-item source verification](#per-item-source-verification)
7. [V4 cumulative proof](#v4-cumulative-proof)
8. [Idempotency](#idempotency)
9. [Rejected to unresolved](#rejected-to-unresolved)
10. [Still unresolved (10)](#still-unresolved-10)
11. [Blocking issues](#blocking-issues)
12. [Re-run instructions](#re-run-instructions)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch A2) | 25 |
| Candidate matches checked against the pinned record | 15 |
| Reviewed match entries written | 15 |
| Profiles validated, approved, staged, and imported | **15** |
| from Foundation 2026-10-29 | 6 |
| from SR Legacy 2018-04 | 9 |
| Candidates rejected to unresolved at import | 0 |
| Unresolved (no reviewed entry; blocked at matching, fail closed) | 10 |
| Catalog profile count after this import | 29 (was 14) |

Parent batch id `rb-c61cabe465685a29a02ff753`, pass `rp-6749592086a40f3177d9f0c4` (pass release `2018-04+2026-10-29`, because the batch mixes both releases). The pass id differs from the one in the planner proof run (`rp-b2fd5c667f4f5ae57ca5e17f`) only because the pass id includes the release, which was `unconfigured` before this PR wrote the reviewed entries. The parent batch id is source-independent and is the same.

Pinned files: the reader checked each against its extracted-file SHA-256 pin on every load (SR Legacy 2018-04 `70d4235a…0129`, Foundation 2026-10-29 `990e7731…58a1`; the same pins as A1).

## Exact-set gate

ANSWER Q-010 requires an exactly-25 plan proved against both the published catalog and the local job store, because `selectNextBatch` skips ids with jobs in the store, not ids that are already published. On a fresh store at `~/workspace/private-data/a2store-import/cli` (never `/tmp`):

1. The first `plan --wave A --max 25 --write` seeded A1 and reproduced its parent batch id `rb-de5702452450983345068f40` with the 25 A1 ids.
2. The second `plan` selected exactly the 25 A2 ids of the brief and the preparation report, in (priority, category, id) order, with parent batch id `rb-c61cabe465685a29a02ff753`. Coconut milk is absent and chicken-egg-white-raw is present. The retired id `rb-7136e61a94abc4f865f3f051` was not used.
3. Against the published catalog: the 14 published variant ids are exactly the 14 A1 profiles, and none of the 25 A2 ids was already published.

## Pipeline run and validation

The run used the merged pipeline through [researchCli.ts](../../scripts/nutrition/researchCli.ts): `index` (both releases, `--write`), `run --source fdc-bulk --batch rb-c61cabe465685a29a02ff753`, `validate`, `review` with `--verify-source`, hash-bound `review --decide approve`, and `stage --write` into a fresh directory.

- **index:** SR Legacy 7,793 of 7,793 records indexed. Foundation 414 of 424, with the known 10 records skipped for non-numeric amounts (fdcId 2727566-2727571, 2727575, 2727576, 2747656, 2747673). None of them is an A2 candidate.
- **run:** 15 jobs reached `needs_review`, each matched to exactly its reviewed entry's fdcId and release. The 10 unresolved ids were `blocked` with `match_not_found`. That is the fail-closed behavior: no reviewed entry, no match.
- **validate:** all 15 proposals were valid with **0 errors and 0 warnings**. The 10 blocked jobs failed with `Job proposal is missing revisionDraft`, as expected. No job failed validation for any other reason, so no candidate had to be rejected at this step.
- **review --verify-source:** the command refused all 15 with `Deterministic FDC verification required`. This is by design and documented in the [research pipeline](research-pipeline.md): `verifySource` re-verifies an assistant-cited source and needs an assistant result, which a deterministic bulk proposal does not have. For deterministic proposals the record is re-checked by `assertCuratedMatchTable` instead, when the review packet is built, at approval, and again at staging (PR #214). It requires the record to equal the reviewed entry on fdcId, verbatim description, release, and dataType. All 15 passed that check. An independent check of each proposal's source record against its entry also matched on all four attributes. No packet showed an identity mismatch.
- **approve:** all 15 were approved by their review content hash under reviewer handle `claude-a2-import`. No validation warning needed acknowledgement. In A1, the two cocoa Atwater warnings did.
- **stage:** `stage --write` wrote 15 profiles (10 variant shards, 30 search shards, manifest) into a fresh directory outside the checkout. stageCatalog re-checked the match table and the private-text rules.

**Unknown and assumed-zero review.** Before approval, every one of the 15 drafts was compared field by field against its raw pinned record, through the nutrient id and derivation code recorded in provenance. For each field directly mapped to a pinned FDC nutrient row, the normalized per-100 g amount and any USDA derivation code were checked against that exact row. Other deterministic representations are identified separately: `omega3` sums ALA+EPA+DHA where all components exist, `fiber` may alias the source's `fiberTotal`, and `calories` for Foundation tomato sauce uses the source's Atwater-specific energy row (2048). These are identified in field-level provenance (`sum:ALA+EPA+DHA`, `same_as:fiberTotal`, and `atwater_specific_factors`) and are not independent laboratory observations. No values from alternate FDC records were blended. Where a component is missing it stays unknown with `partial_components`. Type fidelity holds: every resolved value is a finite non-negative number, and every unknown is null with a gap reason. All 18 `assumed_zero` cells hold the numeric 0 with derivation code Z. Status mapping follows Q-004: A → measured, NC → calculated, Z → assumed_zero, and every other code or no code → source_reported (AS, RK, JA, JO, BFFN, BFNN, BFZN, LC, MA, NR, O, T, and none). The 18 zeros are the SR Legacy records' own Z rows, spread over 7 profiles: caffeine on 7 (eggs, dairy, tomato paste), fiber and total fiber on the hard-boiled egg and the raw egg white, alcohol on the hard-boiled egg, vitamin D and E on the raw egg white, and vitamin B12, vitamin D, trans fat, and cholesterol on tomato paste. No zero was invented, and none comes from a Foundation record.

## Field coverage of the imported profiles

Across the 15 head revisions: 1,005 quality-tracked field cells (67 per profile), **548 resolved, 457 explicit unknowns, 0 not checked (unexamined)**. Quality statuses under the Q-004 derivation policy: **measured 244, calculated 72, source_reported 214, assumed_zero 18, unknown 457**. All 15 profiles resolve energy, protein, carbohydrate, total fat, and sodium. The staged nutrient maps also carry the legacy key `fiberWeightedLegacy`, null on every profile. It has no quality entry and is excluded from the cell counts, on the same basis as A1.

Unknown cells by gap reason: not_reported_by_source 428, definition_mismatch 21 (folate on the Foundation records), partial_components 8 (omega3). An unknown means the source was checked and has no usable value. It does not mean the field was unexamined, and unexamined is 0.

Per-field counts across the 15 profiles (fields with identical counts are grouped):

| Fields | Resolved | Unknown | Not checked | Resolved by status |
| --- | ---: | ---: | ---: | --- |
| calories | 15 | 0 | 0 | calculated 15 |
| protein | 15 | 0 | 0 | calculated 6, measured 3, source_reported 6 |
| carbs | 15 | 0 | 0 | calculated 14, source_reported 1 |
| fat, potassium, sodium, calcium, iron | 15 | 0 | 0 | measured 9, source_reported 6 |
| magnesium, phosphorus, zinc, copper, manganese | 15 | 0 | 0 | measured 11, source_reported 4 |
| sugarsTotal | 15 | 0 | 0 | measured 3, source_reported 12 |
| water | 15 | 0 | 0 | measured 7, source_reported 8 |
| vitaminA | 14 | 1 | 0 | calculated 12, source_reported 2 |
| fatSaturated | 14 | 1 | 0 | calculated 2, measured 2, source_reported 10 |
| vitaminB12, vitaminE | 13 | 2 | 0 | assumed_zero 1, measured 8, source_reported 4 |
| vitaminB6, vitaminB1, vitaminB2, vitaminB3, vitaminB5 | 13 | 2 | 0 | measured 9, source_reported 4 |
| selenium | 13 | 2 | 0 | measured 10, source_reported 3 |
| fatMonounsaturated, fatPolyunsaturated | 13 | 2 | 0 | calculated 3, measured 2, source_reported 8 |
| omega3EPA, omega3DHA, omega3DPA | 13 | 2 | 0 | measured 7, source_reported 6 |
| cholesterol | 13 | 2 | 0 | assumed_zero 1, measured 7, source_reported 5 |
| choline | 12 | 3 | 0 | measured 4, source_reported 8 |
| vitaminD | 11 | 4 | 0 | assumed_zero 2, source_reported 9 |
| lactose | 11 | 4 | 0 | measured 6, source_reported 5 |
| vitaminC | 10 | 5 | 0 | measured 2, source_reported 8 |
| fatTrans | 10 | 5 | 0 | assumed_zero 1, calculated 2, measured 2, source_reported 5 |
| fiber, fiberTotal | 9 | 6 | 0 | assumed_zero 2, measured 1, source_reported 6 |
| folate | 8 | 7 | 0 | calculated 8 |
| alcohol | 8 | 7 | 0 | assumed_zero 1, source_reported 7 |
| caffeine | 8 | 7 | 0 | assumed_zero 7, source_reported 1 |
| omega3 | 7 | 8 | 0 | calculated 7 |
| omega3ALA | 7 | 8 | 0 | measured 7 |
| iodine | 2 | 13 | 0 | measured 2 |
| starch | 1 | 14 | 0 | measured 1 |
| vitaminK, omega6, sugarsAdded, allulose, sugarAlcoholsTotal, erythritol, sorbitol, mannitol, isomalt, xylitol, glycerol, maltitol, fiberSoluble, fiberInsoluble, resistantStarch, biotin, chromium, molybdenum, chloride, fructans, gos, excessFructose | 0 | 15 | 0 | - |

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description | Resolved |
| --- | --- | --- | --- | ---: |
| cheddar-as-sold | Foundation 2026-10-29 | 328637 | Cheese, cheddar | 34/67 |
| chicken-egg-hard-boiled-cooked-without-added-fat | SR Legacy 2018-04 | 173424 | Egg, whole, cooked, hard-boiled | 40/67 |
| chicken-egg-poached-cooked-without-added-fat | SR Legacy 2018-04 | 172186 | Egg, whole, cooked, poached | 41/67 |
| chicken-egg-white-raw | SR Legacy 2018-04 | 172183 | Egg, white, raw, fresh | 40/67 |
| greek-yogurt-plain-nonfat-as-sold | Foundation 2026-10-29 | 330137 | Yogurt, Greek, plain, nonfat | 37/67 |
| half-and-half-as-sold | SR Legacy 2018-04 | 171255 | Cream, fluid, half and half | 43/67 |
| heavy-cream-36-percent-fat-as-sold | SR Legacy 2018-04 | 170859 | Cream, fluid, heavy whipping | 43/67 |
| milk-reduced-fat-2-percent-as-sold | Foundation 2026-10-29 | 746778 | Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D | 38/67 |
| milk-whole-3-25-percent-fat-as-sold | Foundation 2026-10-29 | 746782 | Milk, whole, 3.25% milkfat, with added vitamin D | 38/67 |
| mozzarella-low-moisture-part-skim-as-sold | Foundation 2026-10-29 | 329370 | Cheese, mozzarella, low moisture, part-skim | 35/67 |
| parmesan-hard-as-sold | SR Legacy 2018-04 | 170848 | Cheese, parmesan, hard | 40/67 |
| tomato-paste-no-added-salt-as-sold | SR Legacy 2018-04 | 170459 | Tomato products, canned, paste, without salt added (Includes foods for USDA's Food Distribution Program) | 42/67 |
| tomato-sauce-with-salt-as-sold | Foundation 2026-10-29 | 2685579 | Tomato, sauce, canned, with salt added | 18/67 |
| vinegar-balsamic-liquid-as-sold | SR Legacy 2018-04 | 172241 | Vinegar, balsamic | 19/67 |
| yogurt-plain-whole-milk-as-sold | SR Legacy 2018-04 | 171284 | Yogurt, plain, whole milk | 40/67 |

Validation outcome for this batch: 15 of 15 staged profiles passed the pipeline validator with 0 errors and 0 warnings, and staging re-checked each against the match table.

## Per-item source verification

Each of the 15 candidates was checked against the actual pinned record through the audit path. For each, the fdcId exists and parses, the dataType equals the entry's dataset, the description is copied verbatim, the release is the pin's release for that dataset, and all five core rows are present. "Q-010" marks a case adjudicated in ANSWER Q-010 Part 2. "Routine" marks one of the four unflagged proposals, which got the standard checks plus a keyword search of both datasets for a nearer competing record.

| Manifest id | Basis | Verification notes | Verdict |
| --- | --- | --- | --- |
| tomato-paste-no-added-salt-as-sold | Q-010 case 2 | **Base switched** to SR 170459 as directed (102 rows; can, tbsp, and cup portions). Foundation 2685580 (25 rows, RACC only, 1 of 8 inputs double-concentrated) is kept as an alternate. None of its nutrients was blended in. | Pass |
| tomato-sauce-with-salt-as-sold | Q-010 case 3 | Foundation 2685579. "with salt added" appears in the description and in all 8 inputs. The record is sparse (25 rows, RACC only), so 49 of 67 fields stay unknown. Nothing was copied from SR 170054, which has a different NDB and does not state its salt. | Pass |
| vinegar-balsamic-liquid-as-sold | Routine | SR 172241, the only balsamic record in either dataset. The other vinegars are distilled, red wine, and cider; Foundation has no vinegar. 28 rows, so 48 fields stay unknown. | Pass |
| cheddar-as-sold | Q-010 case 4 | Foundation 328637. 47 natural cheddar inputs (mild, medium, and sharp; sliced, shredded, and block). No processed, reduced-fat, low-sodium, or imitation input. SR 173414 is a related reference only. | Pass |
| greek-yogurt-plain-nonfat-as-sold | Q-010 case 6 | Foundation 330137. 18 inputs, plain nonfat, from 3 brands. 134 rows. | Pass |
| half-and-half-as-sold | Routine | SR 171255, the only unqualified half and half. The lowfat 171308 and fat-free 172212 siblings are qualified. Foundation has none. | Pass |
| heavy-cream-36-percent-fat-as-sold | Q-010 case 9 | SR 170859, chosen on coverage and portions (134 rows), not on fat. Foundation 2346386 is kept as an alternate. | Pass |
| milk-reduced-fat-2-percent-as-sold | Q-010 case 10 | Foundation 746778, 2% milkfat stated, 157 rows. **Fortified-as-sold default:** this profile is 2% milk with added vitamin A and vitamin D. Its vitamin A and D values do not describe unfortified 2% milk (SR 172205), which stays a separate variant. | Pass |
| milk-whole-3-25-percent-fat-as-sold | Q-010 case 11 | Foundation 746782, 3.25% milkfat stated, 157 rows. **Vitamin-D-fortified-as-sold default.** It makes no claim about unfortified whole milk (SR 172217). | Pass |
| mozzarella-low-moisture-part-skim-as-sold | Q-010 case 5 | Foundation 329370. All 38 inputs are labeled low-moisture part-skim, including string cheese. It is not extended to whole-milk or high-moisture mozzarella. | Pass |
| parmesan-hard-as-sold | Routine | SR 170848, the exact hard form. The grated (171247, Foundation 325036 and 2259795), shredded, low-sodium, reduced-fat, and topping records are separately qualified. | Pass |
| yogurt-plain-whole-milk-as-sold | Q-010 case 12 | **Base switched** to SR 171284 as directed. Reason: for the broad, unqualified whole-milk profile, SR is the more complete reference (91 rows and household portions, against 48 rows, RACC only, and one row without an amount in Foundation 2259793). The two records differ materially on fat and energy, and Foundation may represent richer retail yogurt. It is kept as an alternate, and the two macro baselines are not merged. | Pass |
| chicken-egg-hard-boiled-cooked-without-added-fat | Routine | SR 173424, the only hard-boiled record, cooked in the shell. Fried, omelet, scrambled, and poached are different preparations. Foundation has no cooked egg. | Pass |
| chicken-egg-poached-cooked-without-added-fat | Q-010 case 13 | SR 172186. Poaching adds no fat. **Disclosure:** its sodium level is well above raw and hard-boiled egg, which suggests salted poaching water. The profile is not claimed to be an unsalted poached egg. | Pass |
| chicken-egg-white-raw | Q-010 case 14 | SR 172183, raw and fresh stated, 97 rows. Foundation 747997 has no sodium row and is kept as an alternate. No field was grafted from it. | Pass |

## V4 cumulative proof

Run before this import PR, as the [V4 rule](catalog-integrity-verification.md#rule-for-a2-and-later-batches) requires. `published` is the catalog at `b28ee1d`. `staged` is the `stageCatalog` output written by `stage --write`.

| Catalog | Profiles | Variant shards | Search shards | Search entries | Revisions | Defects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| published (`b28ee1d`) | 14 | 8 | 29 | 47 | 14 | 0 |
| staged (A2) | 15 | 10 | 30 | 50 | 15 | 0 |
| `combineCatalogs(published, staged)` | **29** | 17 | 51 | 97 | 29 | **0** |

- `verifyCatalog(combined)`: **0 defects**.
- `verifyAppendOnly(published, combined)`: **0 defects, preserved = 14, added = 15**. The added ids are exactly the 15 approved ids listed above. No other id was added.
- `combineCatalogs(combined, staged)` (a rerun of the batch) reproduces the combined manifest and every shard exactly.
- The combined `{ manifest, files }`, and only that, was written to the curated catalog directory. Shards whose bucket gained an A2 record get a new content hash, so their old files are replaced (for example, bucket `ch` now holds cheddar and the egg ids next to the chocolates). The append-only check confirms that every A1 record and search entry is unchanged.
- On the written files, `catalogIntegrityCli.ts -- --previous <published> --next public/shared/nutrition/catalog/nutrition-curated` reported added 15, preserved 14, and 0 defects on both sides. `--combine <published> <staged>` gave the same counts, and the default mode on the written catalog reported 29 profiles and 0 defects.

## Idempotency

- **Staging:** `stage --write` ran twice into separate fresh directories. Both produced 41 files with an identical tree SHA-256 (`b7635f36…b64d`), computed over every file's bytes. The outputs are byte-identical.
- **Full-pass rerun:** `run --source fdc-bulk --batch rb-c61cabe465685a29a02ff753 --write` ran again on the same store. The store held 50 jobs before and after (50 unique job keys), the 15 approved jobs kept the same state, draft hash, review hash, and version (approved jobs are never fetched again), and the 10 blocked jobs stayed blocked at `match_not_found`. A third staging after the rerun was byte-identical to the first. A dry-run `plan --wave A` on the store selects none of the 25 A2 ids. It moves on to the next wave-A positions. Re-combining the batch with the combined catalog adds nothing. The rerun created no duplicate profile.

## Rejected to unresolved

None. All 15 candidates passed pinned-record verification, validation, and review, so no candidate was rejected at import.

## Still unresolved (10)

These ids have no reviewed match entry, and the deterministic pass blocked every one at matching with `match_not_found`. They are explicit blocked work, not permanent exclusions.

| Manifest id | Basis | Reason and cure |
| --- | --- | --- |
| tamari-regular-as-sold | Q-010 case 1 | Candidate SR 174278 "Soy sauce made from soy (tamari)" is kept as a candidate reference only. The regular-sodium variant is not established. Cure: a record or label that specifies regular-sodium tamari. |
| greek-yogurt-plain-2-percent-fat-as-sold | Q-010 case 7 | Candidate SR 170903 "Yogurt, Greek, plain, lowfat". "lowfat" is a range, not 2%. Cure: a plain record or label that identifies 2%. |
| greek-yogurt-plain-5-percent-fat-as-sold | Q-010 case 8 | Candidate SR 171304 "Yogurt, Greek, plain, whole milk". Neither source says 5%, and Foundation 2259794 differs on fat. Cure: explicit 5% formulation or label evidence. |
| goat-cheese-soft-chevre-as-sold | Q-010 case 15 | Candidate SR 173435 "Cheese, goat, soft type". Soft type does not establish fresh chèvre. Cure: a USDA product form, label, or authoritative synonym. |
| tamari-reduced-sodium-as-sold | Q-010 case 17 | variant_not_distinguished. Low-sodium shoyu and HVP sauce are different products. |
| vinegar-champagne-liquid-as-sold | Q-010 case 17 | no_source_record. Needs a supplemental source or label. |
| vinegar-rice-seasoned-liquid-as-sold | Q-010 case 17 | no_source_record. Needs a supplemental source or label. |
| vinegar-sherry-liquid-as-sold | Q-010 case 17 | no_source_record. Needs a supplemental source or label. |
| chicken-egg-scrambled-cooked-without-added-fat | Q-010 case 16 | different_product_only. SR 172187 does not document a no-added-fat preparation. Cure: an ingredient-controlled derivation or an explicitly no-added-fat source. |
| chicken-egg-white-cooked-without-added-fat | Q-010 case 17 | no_source_record. Raw, frozen, and dried egg white are different states. Cure: a reviewed recipe-time transformation or a matching source. |

None of these 10 ids has an entry in [source-match-table.json](source-match-table.json). That was checked with `validateMatchTable`: 29 valid entries, 29 distinct FDC records, and no entry for any of the 10.

## Blocking issues

None for this batch. Open, nonblocking items:

1. **Planner limitation (Q-010 Part 1):** `selectNextBatch` still skips store jobs, not published ids. A2 handled this by seeding A1 first and checking the exact set against the published catalog. Before unattended later waves, implement skip-published or explicit eligible-id input.
2. **`--verify-source` and deterministic jobs:** the command refuses deterministic bulk proposals by design. The match-table re-check at packet, approval, and staging covers them. A future change could make the CLI report that path explicitly instead of returning an error, so that operators do not read the refusal as a failure.
3. **Sparse sources:** tomato sauce (18/67) and balsamic vinegar (19/67) resolve every core field, but they leave most micronutrients unknown. Any supplemental enrichment needs separate provenance and an equivalence review (Q-010 case 3).
4. **Operational note:** one approval run was stopped by a session time limit after 6 of 15 approvals. Its store lock was left behind. The lock's recorded PID was confirmed dead before the lock was removed by hand, as the runbook directs. The remaining 9 jobs were then approved. Final job states were checked afterwards (15 approved, 10 blocked, 50 jobs in total).

## Re-run instructions

The store and staging output are disposable. They live outside the checkout under `~/workspace/private-data/a2store-import/` (never `/tmp`). From the repository root:

```sh
S=~/workspace/private-data/a2store-import/cli
D=~/workspace/private-data/fdc
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store $S   # A1 rb-de5702452450983345068f40 (seed)
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store $S   # A2 rb-c61cabe465685a29a02ff753
npx --no-install vite-node scripts/nutrition/researchCli.ts -- index --dataset sr-legacy --file $D/FoodData_Central_sr_legacy_food_json_2018-04.json --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- index --dataset foundation --file $D/FoodData_Central_foundation_food_json_2026-10-29.json --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- run --source fdc-bulk --batch rb-c61cabe465685a29a02ff753 --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- validate --batch rb-c61cabe465685a29a02ff753 --write --store $S
# per job: review packet, then approve with the packet's Approval Content Hash
npx --no-install vite-node scripts/nutrition/researchCli.ts -- review --job <jobId> --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- review --job <jobId> --decide approve --hash <hash> --reviewer claude-a2-import --write --store $S
npx --no-install vite-node scripts/nutrition/researchCli.ts -- stage --batch rb-c61cabe465685a29a02ff753 --write --out <fresh dir> --store $S
npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts -- --combine <published dir> <fresh dir>
```

With the same pins and match table, the job ids, parent batch id, review hashes, and staged bytes are reproduced. An approved value can change only through a new reviewed pass.
