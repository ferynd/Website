# Normalization verification against the pinned FDC releases (#63 V3)

Run: 2026-11-10. Branch `claude/calorie-tracker-63-v2v3` (PR #214), first run from `main` `62f2336`, then rebased onto `main` `bde7740` (PR #213) and re-run with identical counts (see [Rebase onto PR #213](#rebase-onto-pr-213)). Authority: James's decisions of 2026-11-10 (V3: verify nutrient normalization against actual records, covering expanded field coverage, units, zero versus unknown, provenance, and source matching). This document holds **aggregate counts only**: no nutrient value, no record content, and no dataset file entered the repository. FDC ids and the verbatim description of one record are public metadata. The run wrote nothing; its only output was stdout JSON. No live call, no API key, no Firestore access. The reviewed [match table](source-match-table.json) is unchanged, and both write flags stay false.

Related: [research pipeline](research-pipeline.md) · [A1 batch report](population-batch-a1-report.md) · [FDC pins dry run](fdc-pins-dry-run-report.md)

## Contents

1. [What was checked](#what-was-checked)
2. [Runs](#runs)
3. [Headline counts](#headline-counts)
4. [Per-key coverage](#per-key-coverage)
5. [Units](#units)
6. [Zero versus unknown](#zero-versus-unknown)
7. [Provenance](#provenance)
8. [Source matching: the 17 A1 proposals](#source-matching-the-17-a1-proposals)
9. [Defects and follow-ups](#defects-and-follow-ups)
10. [In-repo tests](#in-repo-tests)
11. [Re-run](#re-run)
12. [Rebase onto PR #213](#rebase-onto-pr-213)

## What was checked

[normalizationVerification.ts](../../scripts/nutrition/normalizationVerification.ts) runs the pipeline's own normalization path: the FDC bulk adapter's `toSourceResult` (`parseFdcFood`), then `normalizeSourceResult` with [fdcNutrientMap](../../public/shared/nutrition/research/fdcNutrientMap.js), exactly as `researchService.runJob` calls them. It does not reimplement the path. For each record it also classifies every stored registry field (67 keys; the derived `fiberWeightedLegacy` is excluded) from the parsed source rows and the nutrient map alone, without consulting the normalizer:

| Outcome | Meaning | Required normalized form |
| --- | --- | --- |
| resolved | a mapped row with a finite amount | finite value, status measured/calculated/label_reported, field provenance naming the source nutrient id |
| below_loq | a mapped zero below the limit of quantification | null, `below_quantification_limit`, finite upper bound |
| unknown | a mapped row with a null or missing amount | null, `unknown`, `gap:not_reported_by_source`, no provenance |
| gap | a definition-mismatch row only (or omega-3 without all of ALA, EPA, DHA) | null, `unknown`, `gap:definition_mismatch` (`gap:partial_components`), no provenance |
| absent | no mapped row | null, `unknown`, `gap:not_reported_by_source`, no provenance |

Any disagreement is a defect. Each resolved value is also recomputed from its source row with the registry converter (`convertUnit`) as a unit spot check. Energy must follow 1008 > 2048 > 2047, and kJ (1062) must never reach calories. Vitamin A IU (1104) and total folate (1177) must stay gaps and never become RAE or DFE values. Phylloquinone-only vitamin K (1185) must stay a gap. Record provenance (recordId, source key, release, dataType, publishedAt, checksum recomputed from the record, title, accessedAt, permittedUse) must survive normalization.

The 17 A1 proposals also run end to end as **one mixed-release batch** (3 Foundation, 14 SR Legacy) through `researchService.runJob` with a single bulk adapter. They use in-memory, verification-only entries built from the pinned records. Those entries are not reviewed, and nothing was written to the match table. Each resulting draft is compared with the normalizer's output and checked with the fail-closed reviewed-table gate (`assertCuratedMatchTable`). The absent-entry rule in that gate is PR #213's. The release and dataType agreement, the non-empty description rule, and the re-check of deterministic bulk proposals are PR #214's.

## Runs

Both pinned files were loaded from an operator-local directory and verified against their `researchConfig` pins (extracted-file sha256) on load. Foundation 2026-10-29: 424 records, 414 parsed, 10 blocked (the known non-numeric-amount records). SR Legacy 2018-04: 7,793 records, all parsed.

| Run | Foundation records checked | SR Legacy records checked | Total |
| --- | ---: | ---: | ---: |
| Deterministic sample (default: the A1 records plus 100 others per dataset, evenly spaced by fdcId) | 103 (3 A1 + 100) | 114 (14 A1 + 100) | 217 |
| Every parsed record (`--all`) | 414 | 7,793 | 8,207 |

The full run is a superset of the sample. Both runs were made after the coverage fix below. Before the fix, the full run reported Foundation 8,879 resolved / 18,178 absent (241 fewer resolved fields) and was otherwise identical.

## Headline counts

| Measure | Sample (217) | All (8,207) |
| --- | ---: | ---: |
| Records with any defect | 0 | 0 |
| Registry-key outcomes checked (records × 67) | 14,539 | 549,869 |
| resolved | 6,451 | 292,800 |
| below_loq | 0 | 0 |
| unknown (mapped row, null amount) | 0 | 0 |
| gap | 404 | 17,476 |
| absent | 7,684 | 239,593 |
| Unit spot checks pass / fail | 6,451 / 0 | 292,800 / 0 |
| Energy preference pass / fail | 217 / 0 | 8,207 / 0 |
| Records with kJ energy (1062) / kJ only | 137 / 0 | 7,888 / 0 |
| Calories from 1008 / 2048 / 2047 / none | 137 / 46 / 18 / 16 | 7,888 / 192 / 77 / 50 |
| Vitamin A IU-only records kept as gaps / converted | 4 / 0 | 441 / 0 |
| Total-folate-only records kept as gaps / converted | 47 / 0 | 545 / 0 |
| Phylloquinone vitamin K kept as gaps / mapped | 98 / 0 | 5,139 / 0 |
| Record provenance pass / fail | 217 / 0 | 8,207 / 0 |
| Field provenance pass / fail | 6,451 / 0 | 292,800 / 0 |

Per dataset (all records):

| Dataset | resolved | below_loq | unknown | gap | absent | Defects |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Foundation 2026-10-29 (414) | 9,120 | 0 | 0 | 681 | 17,937 | 0 |
| SR Legacy 2018-04 (7,793) | 283,680 | 0 | 0 | 16,795 | 221,656 | 0 |

## Per-key coverage

All parsed records, after the coverage fix. Each cell is resolved / gap / absent. No key had an unknown or below-LOQ outcome in either release.

| Key | Foundation (414) | SR Legacy (7,793) |
| --- | --- | --- |
| `calories` | 364 / 0 / 50 | 7793 / 0 / 0 |
| `protein` | 397 / 0 / 17 | 7793 / 0 / 0 |
| `carbs` | 364 / 0 / 50 | 7793 / 0 / 0 |
| `fat` | 383 / 0 / 31 | 7793 / 0 / 0 |
| `fiber` | 234 / 0 / 180 | 7231 / 0 / 562 |
| `potassium` | 386 / 0 / 28 | 7516 / 0 / 277 |
| `magnesium` | 386 / 0 / 28 | 7421 / 0 / 372 |
| `sodium` | 368 / 0 / 46 | 7709 / 0 / 84 |
| `calcium` | 386 / 0 / 28 | 7708 / 0 / 85 |
| `choline` | 39 / 0 / 375 | 4611 / 0 / 3182 |
| `vitaminB12` | 74 / 0 / 340 | 7113 / 0 / 680 |
| `folate` | 0 / 172 / 242 | 6482 / 373 / 938 |
| `vitaminC` | 118 / 0 / 296 | 7332 / 0 / 461 |
| `vitaminB6` | 258 / 0 / 156 | 7262 / 0 / 531 |
| `vitaminA` | 52 / 0 / 362 | 6918 / 441 / 434 |
| `vitaminD` | 78 / 0 / 336 | 5185 / 0 / 2608 |
| `vitaminE` | 86 / 0 / 328 | 5580 / 0 / 2213 |
| `vitaminK` | 0 / 85 / 329 | 0 / 5054 / 2739 |
| `selenium` | 151 / 0 / 263 | 6865 / 0 / 928 |
| `iodine` | 47 / 0 / 367 | 0 / 0 / 7793 |
| `phosphorus` | 386 / 0 / 28 | 7467 / 0 / 326 |
| `iron` | 386 / 0 / 28 | 7713 / 0 / 80 |
| `zinc` | 386 / 0 / 28 | 7406 / 0 / 387 |
| `omega3` | 60 / 354 / 0 | 1843 / 5950 / 0 |
| `fatSaturated` | 172 / 0 / 242 | 7450 / 0 / 343 |
| `fatTrans` | 134 / 0 / 280 | 4179 / 0 / 3614 |
| `fatMonounsaturated` | 172 / 0 / 242 | 7277 / 0 / 516 |
| `fatPolyunsaturated` | 157 / 0 / 257 | 7279 / 0 / 514 |
| `omega3ALA` | 66 / 70 / 278 | 1967 / 4977 / 849 |
| `omega3EPA` | 63 / 0 / 351 | 5800 / 0 / 1993 |
| `omega3DHA` | 63 / 0 / 351 | 5772 / 0 / 2021 |
| `omega3DPA` | 62 / 0 / 352 | 5756 / 0 / 2037 |
| `omega6` | 0 / 0 / 414 | 0 / 0 / 7793 |
| `sugarsTotal` | 161 / 0 / 253 | 6007 / 0 / 1786 |
| `sugarsAdded` | 0 / 0 / 414 | 0 / 0 / 7793 |
| `starch` | 131 / 0 / 283 | 1167 / 0 / 6626 |
| `fiberTotal` | 234 / 0 / 180 | 7231 / 0 / 562 |
| `fiberSoluble` | 10 / 0 / 404 | 0 / 0 / 7793 |
| `fiberInsoluble` | 10 / 0 / 404 | 0 / 0 / 7793 |
| `resistantStarch` | 17 / 0 / 397 | 0 / 0 / 7793 |
| `vitaminB1` | 214 / 0 / 200 | 7402 / 0 / 391 |
| `vitaminB2` | 194 / 0 / 220 | 7421 / 0 / 372 |
| `vitaminB3` | 221 / 0 / 193 | 7402 / 0 / 391 |
| `vitaminB5` | 89 / 0 / 325 | 6376 / 0 / 1417 |
| `biotin` | 118 / 0 / 296 | 0 / 0 / 7793 |
| `copper` | 386 / 0 / 28 | 7284 / 0 / 509 |
| `manganese` | 386 / 0 / 28 | 6492 / 0 / 1301 |
| `molybdenum` | 68 / 0 / 346 | 0 / 0 / 7793 |
| `cholesterol` | 81 / 0 / 333 | 7394 / 0 / 399 |
| `alcohol` | 0 / 0 / 414 | 5399 / 0 / 2394 |
| `water` | 406 / 0 / 8 | 7793 / 0 / 0 |
| `caffeine` | 0 / 0 / 414 | 5215 / 0 / 2578 |
| `lactose` | 116 / 0 / 298 | 5083 / 0 / 2710 |

The remaining 14 keys are absent in every record of both releases: `allulose`, `sugarAlcoholsTotal`, `erythritol`, `sorbitol`, `mannitol`, `isomalt`, `xylitol`, `glycerol`, `maltitol`, `chromium`, `chloride`, `fructans`, `gos`, `excessFructose`. Neither release reports these, so they need residual-field passes (label or supplemental sources), as the playbook already plans. `omega6` and `sugarsAdded` are also absent everywhere: FDC reports individual n-6 fatty acids but no total, and these releases carry no added-sugars row.

## Units

Every resolved value matched its source row converted with the registry converter: 292,800 of 292,800 in the full run. In both pinned releases every mapped row already uses the registry unit:

| Unit pair | Pass | Fail |
| --- | ---: | ---: |
| g (identity) | 112,122 | 0 |
| mg (identity) | 137,467 | 0 |
| mcg (identity; FDC writes µg) | 33,151 | 0 |
| kcal (identity) | 8,157 | 0 |
| omega-3 sum of g components | 1,903 | 0 |

The real data never exercises a mcg/mg/g conversion, so those paths are covered by the synthetic in-repo tests (mg→g, g→mg, mg→mcg, the micro sign, and upper-case unit names). kJ appears in 7,888 records and was never used for calories. Vitamin A IU and total folate were never converted.

## Zero versus unknown

| Measure (all records) | Count |
| --- | ---: |
| Mapped rows with an explicit 0 kept as a 0 with status and field provenance | 58,345 |
| Explicit zeros lost (turned into null or unknown) | 0 |
| Absent rows kept as null / `unknown` / `gap:not_reported_by_source` | 239,593 |
| Mapped rows with a null or missing amount | 0 (none in either release) |
| Below-LOQ rows | 0 (neither release carries LOQ fields) |
| Explicit zeros whose FDC derivation code is `Z` ("assumed zero") but reported as `measured` | 23,031 |

Foundation has 30 nutrient rows without an amount, all for nutrient 2066 ("Vitamin A", an unmapped summary row), so no mapped key met a null amount. The null-amount, missing-amount, and below-LOQ paths are covered by synthetic tests instead. The assumed-zero count is a deferred defect (below).

## Provenance

All 8,207 records kept recordId, source key `fdc:<id>`, release, dataType, publishedAt, title, accessedAt, and permittedUse through normalization. The checksum the adapter stamps equals a sha256 recomputed from the pinned record. All 292,800 resolved fields name the record's source key and the FDC nutrient id they came from. Fiber carries `same_as:fiberTotal`, omega-3 carries `sum:ALA+EPA+DHA`, and Atwater energy carries its factor derivation. No gap, unknown, or absent field carries provenance.

Status labels do not carry FDC's own derivation. Of the 290,628 resolved fields labeled `measured`, the FDC derivation code is A/AS/AR/AI for 72,693, `NC` (calculated) for 31,851, `Z` (assumed zero) for 23,031, a borrowed-from-another-form `BF*` code for 19,160, another imputation or estimation code for 61,096, and none recorded (most SR Legacy rows) for 82,797. See deferred defect 1.

## Source matching: the 17 A1 proposals

| Measure | Count |
| --- | ---: |
| Proposed records found and parsed in their pinned file | 17 / 17 |
| Data type equals the report | 17 / 17 |
| Report description is the record's verbatim description | 16 / 17 |
| Jobs run as one mixed-release batch reaching `needs_review` | 17 / 17 |
| Each record stamped with its own match release (none with the other) | 17 / 0 |
| Revision draft equals the normalizer output on every field value and status | 17 / 17 |
| Fail-closed gate: exact entry (verbatim description, release, dataType) passes | 17 / 17 |
| Fail-closed gate: no entry fails | 17 / 17 |
| Fail-closed gate: wrong release fails | 17 / 17 |
| Fail-closed gate: wrong dataType fails | 17 / 17 |
| Fail-closed gate: entry copying the non-verbatim report description fails | 1 / 1 |

The one non-verbatim description is SR 169098. The report quotes it as "Orange juice, raw", but the record's description is "Orange juice, raw (Includes foods for USDA's Food Distribution Program)". The A1 import's table entry must use the verbatim text, or the gate will (correctly) refuse it.

## Defects and follow-ups

**Fixed in this branch (normalization, with regression tests):**

- **Expanded field coverage: three source rows that map exactly to registry keys were dropped as "not reported by source".** Foundation reports total sugars as 1063 "Sugars, Total" (number 269.3) rather than 2000, plus molybdenum (1102, µg) and resistant starch (1071, g). The map had none of them, so 161, 68, and 17 Foundation records lost a value the source reports, and the gap reason misstated the source. [fdcNutrientMap.js](../../public/shared/nutrition/research/fdcNutrientMap.js) now maps all three, and [sourceResult.js](../../public/shared/nutrition/research/sourceResult.js) applies the energy rule when two exact rows map to one key: the first quantified row wins (2000 over 1063), and a below-LOQ row is used only when no row is quantified. Foundation resolved fields rose from 8,879 to 9,120. No existing key had two exact rows, so no other output changed.

**Deferred (documented, not fixed here):**

1. **Status ignores FDC derivation codes.** Every quantified FDC row becomes `measured`, including 23,031 `Z` assumed zeros, 31,851 `NC` calculated values, and borrowed or imputed values. The parser also drops the derivation code, so field provenance cannot show it. A fix needs a policy decision on which codes stay `measured` and which become `calculated` or an estimate, and what an assumed zero means. Decide this before or during the A1 import review, because it affects the quality labels of imported fields.
2. **The A1 report's quoted descriptions are not all verbatim.** SR 169098 differs (see above). The A1 import must copy each description from the pinned record.
3. **Method-mismatch rows show as absent, not as gaps.** Foundation's AOAC 2011.25 total dietary fiber (2033, 34 records) and carbohydrate by summation (1050, 30 records) are not mapped. When 1079 or 1005 is missing, fiber or carbs reads `gap:not_reported_by_source` where `gap:definition_mismatch` would be more precise. The special fiber and carbohydrate handling fills those keys before mismatch rows apply, so fixing this means changing that handling.
4. **SR Legacy `publicationDate` is `M/D/YYYY`** (for example `4/1/2019`). It is copied verbatim into `publishedAt` and passes the finite-date check. Foundation dates are ISO. Normalizing to ISO is a small follow-up.
5. **Omega-3 total is `gap:partial_components` even when no component row exists** (354 Foundation and 5,950 SR records). That is the documented D10 policy, but `not_reported_by_source` would describe a record with no components more precisely.
6. **`runJob` throws, rather than blocking the job, when a normalized value exceeds a registry hard bound.** A synthetic test found this; no A1 record reaches it.
7. **`parseFdcFood` defaults a missing `dataType` to `Foundation`.** It is unreachable with the pinned files, where every record carries one, but with the new dataType check it could mislabel a record from another source.

## In-repo tests

[normalizationVerification.test.ts](../../scripts/nutrition/normalizationVerification.test.ts) uses only committed synthetic fixtures and inline synthetic records. It covers:

- every one of the 67 keys accounted for on each committed FDC fixture with no defect;
- identity and mcg/mg/g conversions through the registry converter;
- vitamin A IU and total folate kept as gaps and never converted, and RAE/DFE used when present;
- kJ never used, and 1008 > 2048 > 2047;
- an explicit zero, a null amount, a missing amount, a missing nutrient, a below-LOQ zero, and an assumed zero kept apart;
- record and field provenance;
- the coverage fix (1063 / 1102 / 1071, and 2000 over 1063);
- the verifier reporting tampered output, so it is not vacuous;
- an end-to-end run on two synthetic pinned releases that checks the mixed-release batch, the gate counts, and that sentinel values never reach the summary;
- the CLI refusing files inside the checkout and writing only to stdout.

## Re-run

From the repository root, with the pinned files outside the checkout:

```sh
npx --no-install vite-node scripts/nutrition/normalizationVerificationCli.ts -- \
  --foundation <dir>/FoodData_Central_foundation_food_json_2026-10-29.json \
  --sr-legacy <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json            # sample
npx --no-install vite-node scripts/nutrition/normalizationVerificationCli.ts -- --all \
  --foundation <dir>/FoodData_Central_foundation_food_json_2026-10-29.json \
  --sr-legacy <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json            # every parsed record
```

The output is deterministic: it prints no timestamps, and the sample is evenly spaced by fdcId.

## Rebase onto PR #213

PR #213 (merged as `bde7740`) took over tolerant Foundation indexing and the fail-closed rule for an absent match-table entry. PR #214 was rebased onto it, and this suite now indexes through PR #213's `indexBulk`. That function indexes every parsed record, returns a value-free report, and treats a duplicate fdcId as fatal. Neither pinned file has a duplicate fdcId, so the same records are indexed as before. The suite's own pin and checksum check (`auditPinnedBulk`) did not change.

Both runs were repeated after the rebase, against the same pinned files:

| Measure | Before rebase | After rebase |
| --- | ---: | ---: |
| Sample records checked / with defects | 217 / 0 | 217 / 0 |
| All parsed records checked / with defects | 8,207 / 0 | 8,207 / 0 |
| Resolved fields, all records (Foundation + SR Legacy) | 9,120 + 283,680 = 292,800 | 9,120 + 283,680 = 292,800 |
| A1: found and parsed / reaching `needs_review` / stamped with own release | 17 / 17 / 17 | 17 / 17 / 17 |
| A1 gate: exact passes / no entry, wrong release, wrong dataType fail / report description fails | 17 / 17, 17, 17 / 1 | 17 / 17, 17, 17 / 1 |

No count changed.
