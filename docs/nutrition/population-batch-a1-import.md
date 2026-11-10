# Population batch A1: import report (#63-A-1)

Prepared: 2026-11-10. Base: `main` at `697dad7` (PR #214). Authority: James's 2026-11-10 standing approval for the #63 population waves, his 2026-11-10 validation decisions (V1: complete A1 end to end under the rejection standard), and the reviewed adjudication recorded as ANSWER Q-000 in issue #215. This import publishes **11 completed profiles** to the curated catalog. Proposed matches are listed separately and are not imports. Both write flags stay false; no Firestore access, no live calls, no FDC API key. The pinned dataset files stayed outside the checkout.

Related: [A1 dry-run report](population-batch-a1-report.md) · [population playbook](population-playbook.md) · [research pipeline](research-pipeline.md) · [normalization verification](normalization-verification.md)

## Outcome summary

| Measure | Count |
| --- | ---: |
| Ids attempted (batch A1) | 25 |
| Reviewed match entries written | 12 |
| Profiles validated, approved, staged, and imported | **11** |
| Held out at nutrient validation (see below) | 1 |
| Unresolved (no reviewed entry; blocked at matching, fail closed) | 13 |
| Catalog profile count after this import | 11 (was 0) |

Parent batch id `rb-de5702452450983345068f40` (same deterministic id as the dry run). The pass ran the merged PR #213/#214 pipeline: `plan`, `run --source fdc-bulk` (mixed releases in one pass, per-job match-entry release), `validate`, hash-bound `review --decide approve`, `stage --write`.

## Imported profiles (completed imports)

Each profile is revision 1 of its variant in [the curated catalog](../../public/shared/nutrition/catalog/nutrition-curated/manifest.json), built only from the reviewed record named in [the match table](source-match-table.json). Descriptions below are verbatim from the pinned records.

| Manifest id | Source | FDC id | Record description |
| --- | --- | --- | --- |
| lemon-juice-fresh-ready-to-drink | SR Legacy 2018-04 | 167747 | Lemon juice, raw |
| lime-juice-fresh-ready-to-drink | SR Legacy 2018-04 | 168156 | Lime juice, raw |
| breadcrumbs-plain-as-sold | SR Legacy 2018-04 | 174928 | Bread, crumbs, dry, grated, plain |
| chocolate-dark-45-59-percent-cacao-as-sold | SR Legacy 2018-04 | 170271 | Chocolate, dark, 45- 59% cacao solids |
| chocolate-dark-60-69-percent-cacao-as-sold | SR Legacy 2018-04 | 170272 | Chocolate, dark, 60-69% cacao solids |
| chocolate-dark-70-85-percent-cacao-as-sold | SR Legacy 2018-04 | 170273 | Chocolate, dark, 70-85% cacao solids |
| chocolate-milk-as-sold | SR Legacy 2018-04 | 167587 | Candies, milk chocolate |
| chocolate-unsweetened-baking-as-sold | SR Legacy 2018-04 | 167568 | Baking chocolate, unsweetened, squares |
| chocolate-white-as-sold | SR Legacy 2018-04 | 167571 | Candies, white chocolate |
| cocoa-powder-unsweetened-dutch-process-as-sold | SR Legacy 2018-04 | 169594 | Cocoa, dry powder, unsweetened, processed with alkali |
| soy-sauce-regular-as-sold | SR Legacy 2018-04 | 174277 | Soy sauce made from soy and wheat (shoyu) |

All 11 passed the pipeline validator with no errors. One warning was acknowledged, on cocoa-powder-unsweetened-dutch-process: "Atwater energy inconsistency: reported 220 kcal differs from calculated 424 kcal by >106". The staged profile keeps the source's reported energy (220 kcal per 100 g). The Atwater general-factor calculation overstates cocoa because much of its carbohydrate is fiber (29.8 g per 100 g in this record); the reported value is the record's own energy field and is retained deliberately. This is a flagged item reviewed individually, per the batch rules.

## Held out at nutrient validation

**mayonnaise-regular-as-sold** (Foundation 2758986, "Mayonnaise, Regular"). The identity match was approved in ANSWER Q-000 and a reviewed entry was written, and the job reached approval in the working store. It is **not** in the staged catalog. The pinned Foundation record carries 77 nutrient rows, almost all fatty-acid species, plus water, ash, and protein (1.25 g); it has no energy, total fat, carbohydrate, or sodium rows, so the profile would publish mayonnaise with null calories and null total fat. The same food has a complete profile in SR Legacy (171009, "Salad dressing, mayonnaise, regular"). Rather than publish a hollow profile or silently switch sources against the recorded adjudication, the item is held out of this batch and the source choice is QUESTION Q-002 in issue #215, for James's decision. Its reviewed entry remains in the match table, pointing at the Foundation record; if James chooses the SR record, the entry is replaced in a follow-up change, not edited silently here. Final job state in the import store: needs_review (not approved for staging).

## Unresolved (13)

These ids have no reviewed match entry. The deterministic pass blocked every one at matching with `match_not_found`, which is the fail-closed behavior from PR #213 working as intended: no entry, no match, no proposal.

Original 8 from the dry run (unchanged reasons, see the [dry-run report](population-batch-a1-report.md#unresolved)): apple-cider-nonalcoholic-ready-to-drink, ginger-beer-nonalcoholic-ready-to-drink, pear-juice-100-percent-ready-to-drink, mustard-dijon-as-sold (all `different_product_only`); panko-breadcrumbs-as-sold, cacao-nibs-as-sold (`no_source_record`); miso-red-as-sold, miso-white-as-sold (`variant_not_distinguished`).

Rejected in adjudication (ANSWER Q-000), each retaining its proposed FDC id as a candidate reference only, not a validated match: orange-juice-fresh-ready-to-drink (SR 169098; "raw" does not explicitly establish fresh-squeezed), pomegranate-juice-100-percent-ready-to-drink (Foundation 2727588; catalog does not specify concentrate or storage form), salsa-red-as-sold (Foundation 746777; "red" inferred from ingredients, not stated), chocolate-chips-semisweet-as-sold (SR 167976; chip form appears only in portion descriptions), cocoa-powder-unsweetened-natural-as-sold (SR 169593; non-alkalized inferred from a sibling record).

## Nutrient coverage of the imported set

Across the 11 imported profiles, every stored registry field was examined; there are no unexamined fields in this set.

| Measure | Count |
| --- | ---: |
| Registry fields tracked per profile | 67 |
| Field cells (11 profiles x 67 fields) | 737 |
| Resolved with a sourced value | 442 |
| Explicit unknown (gap reason recorded, value null) | 295 |
| Not checked | 0 |

Unknowns are concentrated where SR Legacy simply does not report the field: iodine, biotin, chromium, chloride, molybdenum, added sugars, soluble and insoluble fiber splits, resistant starch, omega-6 total, vitamin K (one definition-mismatch case is carried as a gap, not a value), and the sugar alcohols and FODMAP fields are unknown in all 11. Every profile resolves calories, protein, carbohydrate, total fat, and sodium. Per-field detail is reproducible from the import store's coverage output; unknown means the source did not report the field, never that a zero was substituted.

## Idempotency and integrity evidence

- `stage --write` was run twice from the approved store into two fresh directories; the outputs are byte-identical (manifest plus search and variant shards, profileCount 11 both times).
- Batch, pass, and job ids are content-derived: an independent replay of the full pass (fresh store, same pinned files, same match table) reproduced the same parent batch id `rb-de5702452450983345068f40` and the same job ids, and re-staged output matched. No duplicate profiles were created; staging refuses multiple approved passes for one variant.
- The match table holds exactly the 12 reviewed entries; no two share an FDC record; the 13 unresolved ids have no entries.

## Open decision flagged for James (does not block this batch)

The V3 verification found that nutrient quality labels ignore FDC derivation codes: values USDA marks calculated (`NC`) or assumed zero (`Z`) are currently labeled `measured` (23,031 assumed zeros across the checked releases; see [normalization verification](normalization-verification.md)). ANSWER Q-001 in issue #215 recommends honest labels (calculated for `NC`, a distinct assumed-zero status keeping the numeric 0, and an unclassified label where no derivation is recorded). No label policy was invented or changed in this import; profiles carry their source provenance, and the relabeling waits for James's approval as its own change.

## Re-run instructions

From the repository root, with the pinned files in an operator-local directory and a store outside the checkout (note: a store is about 225 MB; keep it on a large disk, not a small tmpfs):

```sh
npx --no-install vite-node scripts/nutrition/researchCli.ts -- index --dataset foundation --file <dir>/FoodData_Central_foundation_food_json_2026-10-29.json --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- index --dataset sr-legacy --file <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- plan --wave A --max 25 --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- run --source fdc-bulk --batch rb-de5702452450983345068f40 --write --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- validate --batch rb-de5702452450983345068f40 --write --store <store>
# per matched job: review (packet), then review --decide approve --hash <contentHash> --reviewer <handle> [--ack <warnings>]
npx --no-install vite-node scripts/nutrition/researchCli.ts -- stage --batch rb-de5702452450983345068f40 --write --out <fresh dir> --store <store>
npx --no-install vite-node scripts/nutrition/researchCli.ts -- coverage --store <store>
```

A note on `review --verify-source`: it serves assistant-packet proposals, where an assistant result exists to refetch against. For deterministic bulk jobs it reports "Deterministic FDC verification required" because there is no assistant result; verification for these jobs is the checksummed pinned-file fetch itself, the source checksum recorded on each job, the hash-bound approval, and the staging re-check of the reviewed match table.
