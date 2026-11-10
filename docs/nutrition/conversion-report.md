# Flat saved foods: lossless-conversion report (#77)

Run: 2026-11-10. Aggregate counts only. This report names no food, document path, id, or nutrient value. No document was rewritten, nothing was written to Firestore, and no write flag changed.

## Input

The extract was a fresh foods-only pull of the current saved foods, made on 2026-11-10 by the orchestrator (Pumpkin) under James's explicit authorization. It is kept outside the checkout and is not in the repository. It contains saved foods only; it is not the 2026-11-09 census backup, which also holds diary entries and recipes.

It reconciles with the 2026-11-09 census count of 191 v1 foods: the extract holds 191 foods, all v1.

Every count in this report was verified by running the committed analysis CLI (`scripts/nutrition/conversionAnalysisCli.ts`) against the private extract on 2026-11-10; its aggregate output matches this report exactly. The serving-basis counts come from that run's classifier (`classifyBasis` in `scripts/nutrition/conversionAnalysis.ts`), so they are reproducible from the repository code.

A detailed per-food validation file was delivered to James privately. It is not in the repository.

## Conversion definition

The conversion measured here is the direct profile conversion of a flat v1 saved food into a v2 document:

- The food keeps its stored serving basis. It is not decomposed into ingredients and is not given a per-100 g basis. No gram basis is created.
- Every stored legacy value is kept exactly. Nothing is rounded, rescaled, or dropped.
- Every v2 detail value is null (unknown). No zero is invented.
- Each legacy value's quality status is `legacy_unclassified`. Fiber meaning and carb convention are not set, because v1 does not record them.

## Method

The method is implemented in `scripts/nutrition/conversionAnalysis.ts`. The command is `npx --no-install vite-node scripts/nutrition/conversionAnalysisCli.ts -- --extract <path outside the checkout>`. It refuses a path inside the checkout, including through a symlink, writes nothing, and prints aggregate counts only.

A flat v1 food converts losslessly when all of these hold:

1. `name` is a non-empty string.
2. Every one of the 24 `LEGACY_V1_KEYS` is present with a finite number of at least 0. An absent key would need an invented value. A null or non-numeric value cannot be held by the v2 shape (a number or null). A negative value is outside every nutrient bound and needs human review.
3. The document has no field outside `LEGACY_V1_KEYS` and `RESERVED_DOC_FIELDS`, because the v2 shape would drop it.
4. The document carries no `V2_DETAIL_KEYS` field and no `nutrientMeta`. A v1 document that already carries v2 detail is a collision, not a flat v1 food.
5. Round trip through the site's own code: `readNutrientFields(v1 doc)`, then `toV2Fields(record)`, then `readNutrientFields(v2 fields)` returns every stored legacy value exactly, and every `V2_DETAIL_KEYS` value in the converted fields is null. The converted legacy status is `legacy_unclassified`; fiber meaning and carb convention are not set.

A food that fails any check is blocked with a stable reason code: `missing_name`, `missing_key`, `null_value`, `non_numeric_value`, `negative_value`, `extra_field`, `v2_collision`, `already_v2`, `round_trip_mismatch`, `invented_detail`, or `meta_mismatch`.

Serving basis is classified from the food's name for aggregate counts only. "Weight stated" means the trailing parenthetical or trailing token states a weight (digits with g, oz, or ml, including 100g). "Count/unit stated" means it states a count or unit (pc, ct, piece, cookie, bar, can, bottle, scoop, slice, pack, bag, and similar). "Other basis stated" means a trailing parenthetical exists but matches neither. "No explicit basis" covers everything else. The conversion never changes or creates a basis; the classification only describes what is already stored.

## Schema

| Schema | Foods |
| --- | --- |
| Total | 191 |
| v1 | 191 |
| v2 | 0 |

## Verdicts

| Verdict | Foods |
| --- | --- |
| Clean (converts losslessly) | 191 |
| Blocked | 0 |

| Blocked reason | Foods |
| --- | --- |
| `missing_name` | 0 |
| `missing_key` | 0 |
| `null_value` | 0 |
| `non_numeric_value` | 0 |
| `negative_value` | 0 |
| `extra_field` | 0 |
| `v2_collision` | 0 |
| `already_v2` | 0 |
| `round_trip_mismatch` | 0 |
| `invented_detail` | 0 |
| `meta_mismatch` | 0 |

## Round trip

| Measure | Count |
| --- | --- |
| Stored legacy values checked (191 x 24) | 4,584 |
| Identical after the round trip | 4,584 |

Converted detail values: all null across all foods. Fiber meaning and carb convention: not set anywhere, because v1 does not record them.

## Serving basis

| Basis stated in the name | Foods |
| --- | --- |
| Weight stated | 92 |
| Count/unit stated | 30 |
| Other basis stated | 36 |
| No explicit basis | 33 |

Reconciliation: 92 + 30 + 36 + 33 = 191.

## Quantity field (observation)

The food readers ignore the `quantity` field. It is carried verbatim and is not a conversion input, so it is reported as an observation, not a blocker.

| Quantity | Foods |
| --- | --- |
| Present | 159 |
| Present and 0 | 103 |
| Absent | 32 |

Reconciliation: present 159 + absent 32 = 191.

## Writes performed by this run

| Target | Writes |
| --- | --- |
| Firestore | 0 |
| Documents rewritten | 0 |
| Write-flag changes | 0 |

`NUTRIENT_V2_WRITES_ENABLED` is false and `INGREDIENT_STORE_WRITES_ENABLED` is false.

## Conclusion

All 191 saved foods can convert to the direct v2 profile without losing a stored value and without inventing a zero or a gram basis. None is blocked. This report does not convert anything. The production conversion is the #60 Part B writer step. It still waits for James's confirmation that his validation of the private per-food file passed, and it follows the release runbook with a fresh backup.
