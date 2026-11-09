# Ingredient-list import (#67)

[Overview](README.md) · [Workflow](workflow.md) · [Assistant contract](assistant-contracts.md#ingredient-list-import-v1) · [Research pipeline](research-pipeline.md)

Shared modules under [public/shared/nutrition/import](../../public/shared/nutrition/import/) validate assistant-prepared ingredient lists and reconcile them with #61 profiles. They do not calculate nutrients, fit quantities, research missing foods, or write Firestore. The tracker Import workspace (`importWorkspace.js`, #70) calls these modules plus #66 resolution, #64 calculation, and #65 fitting. Production saving stays off. Both write flags stay false. Yield handling is still the single retention multiplier described in the [requirements review](REQUIREMENTS_REVIEW_2026-11-09.md). No photo, OCR, or paid API path is added.

| Module | Responsibility |
| --- | --- |
| ingredientList.js | Strict ingredient-list v1 validation, fact use, compound groups, and #61 quantity conversion. |
| pasteFormat.js | Human paste v1 parser and renderer. |
| importDraft.js | Frozen import plus a separate correction layer. |
| inputAdapters.js | Saved meals, saved recipes, Recipe Standardizer recipes, and legacy paste. |
| reconcile.js | `#61 matchIngredient`, variant compatibility, and confirmed-alias proposals. |
| assistantInstructions.js | Versioned text for "Copy assistant instructions". |
| index.js | `importIngredientList` for raw JSON, one fenced block, or paste. |

## Validation

Errors name a JSON path or a paste line and column. `schemaVersion` newer than 1 returns "site update required". Unknown keys are rejected. An `extensions` object is kept and ignored, and it makes the list JSON-only so paste rendering cannot drop it. Data URIs, images, and base64 are rejected. A document may contain prose around exactly one fenced JSON block. Fact source URLs follow the contract's 300-character text cap (`url (https)` does not raise it). A name containing `|`, a paste extra containing `;` or `|`, or a quantity unit the paste grammar cannot encode (such as `fl oz`) is JSON-only rather than rendered into a line the parser would split. An extra value may contain `=`; the parser keeps everything after the first equals, and that form round-trips. Canonical `not_applicable` variant values are accepted. A serving weight of zero is unapplied. Line-fact evidence keeps its basis. Recipe notes are stored on the line, not as one assumption per note.

Known facts must use `official_label`, `restaurant_published`, `manufacturer_site`, `user_measured`, or `user_stated`. Official facts require an https source. A serving fact with neither a serving count nor a gram serving weight is `unapplied` and is not a fit target. A line-scoped fact is research evidence for a later #62 job; this module does not start that job. Nutrient units convert through the registry. `fiberWeightedLegacy` is rejected because #64 computes it. The legacy `fiber` key is not rewritten to `fiberTotal`. Quantity units convert only through `toGrams`; millilitres do not become grams without a conversion record.

Fixed lines whose grams already violate an order, ratio, sum, or tail constraint are rejected. A constraint that estimated ranges cannot satisfy is a warning. Compound cycles are rejected. `compoundGroups` reports each parent with its children and does not choose which side a later calculation counts.

## Drafts, adapters, and matching

The validated list is frozen. `applyLineCorrection` returns a new draft; changing a `recipe_stated` basis to `estimated` does not change the import. A line named by a `fixed` constraint stays fixed.

Recipe adapters copy gram quantities as `recipe_stated` and do not copy recipe totals into facts. A diary or saved-food adapter keeps the stored per-unit nutrient snapshot beside the draft and does not multiply it by quantity. Legacy 24-field paste stays on `source.legacyRecord`. It is not given a fake provenance.

Exact confirmed variant matches reuse the stored revision and set `needsResearch` false. Underspecified and unconfirmed matches are listed for confirmation. A raw/cooked or drained/undrained conflict is not selected unless `confirmMatch` is called with `acknowledgeConflict`. Proposals set `writes: false`. `modelCalls` is 0.

`instructionsVersion` on a producer is provenance. It does not select a schema. The instruction text is `ASSISTANT_INSTRUCTIONS` at `INSTRUCTIONS_VERSION`.
