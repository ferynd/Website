# Assistant contracts

Status: target contract for CalorieTracker #62 (research packets) and #67 (ingredient-list import). Nothing on the site emits or parses these formats yet. Shipped behavior is recorded in [README](README.md); tasks and release gates live in [the active backlog](../../backlogs/calorie-tracker.md).

## Contents

1. [Purpose and versioning](#purpose-and-versioning)
2. [Ingredient-list import v1](#ingredient-list-import-v1)
3. [Human paste format v1](#human-paste-format-v1)
4. [Research request v1](#research-request-v1)
5. [Research response v1](#research-response-v1)
6. [Shared validation rules](#shared-validation-rules)
7. [Assistant instructions](#assistant-instructions)
8. [Examples](#examples)

## Purpose and versioning

External assistants (ChatGPT, Claude, Grok, Codex, James's bots, or ChatGPT project instructions) interpret photos, recipes, labels, and meal descriptions. The site does not. It receives a structured **ingredient list**, matches it against the ingredient library, resolves missing profiles through one research pipeline, calculates, optionally fits quantities, and saves. These contracts are the only bridge between the two sides:

| Contract | Direction | Owner |
| --- | --- | --- |
| Ingredient-list import v1 (JSON) and human paste format v1 | assistant → site | #67 |
| Research request v1 | site → assistant | #62 |
| Research response v1 | assistant → site | #62 |
| Assistant instructions | site → assistant (copyable text) | #67 |

The default transport is copy and paste: no site AI call, no per-call cost. The optional direct-provider route (#71) is deferred and, if ever built, carries the same research request/response schemas, and any extraction endpoint it adds must emit ingredient-list v1. Neither is a prerequisite for the primary flow.

Versioning rules for every contract:

- `kind` and an integer `schemaVersion` are required. A `schemaVersion` newer than the site supports is rejected with "site update required"; the site never guesses. Older versions are read only through explicit adapters.
- Unknown top-level keys are rejected, except an `extensions` object, which is ignored.
- `registryVersion` pins the nutrient vocabulary (currently `NUTRIENT_REGISTRY_VERSION = 2`). Nutrient labels and keys resolve exactly through the registry's `lookupLabel`/`getNutrient`, never by substring.
- Text fields are capped at 300 characters unless stated otherwise. Every array has the size limit given below.
- No base64, data URIs, images, or attachments anywhere. Photos stay with the assistant.

## Ingredient-list import v1

`kind: "nutrition.ingredientList"`, `schemaVersion: 1`. `Q` below is the quantity object defined under `line.quantity`.

| Field | Rule |
| --- | --- |
| `registryVersion` | Integer; required when `knownFacts` is non-empty. |
| `producer` | `{assistant: chatgpt\|claude\|grok\|codex\|gemini\|other, label?, instructionsVersion?}`. Provenance only. |
| `inputs` | Array of `photo\|recipe_text\|description\|nutrition_label\|menu\|other`. Metadata about what the assistant examined; no content. |
| `meal` | `{title ≤120, kind: single_portion\|batch_recipe\|packaged_food\|restaurant_item, servings: {count >0, consumed? >0}, servingWeight?: Q, finalWeight?: Q, yield?: {rawTotal?: Q, cookedTotal?: Q}}` |
| `ingredients[]` | 1–100 lines (the same cap as the Recipe Standardizer `MAX_INTAKE_ITEMS`). |
| `line.lineId` | `^[a-z0-9_-]{1,24}$`, unique. |
| `line.name` | ≤120 characters. Display/alias text only, never an identity. |
| `line.kind` | `generic\|branded\|additive\|compound` |
| `line.variant` | Mirrors #61 `VariantDims`: `state`, `preparation`, `drained`, `salt`, `fortification`, `fortificationDetail`, `sweetening`, `fatPercent`, `leanPercent`, `ediblePortion`, `brand{brand, product, gtin, market, labelDate, formulationNote}`. `drained`/`salt`/`fortification` use `VARIANT_ENUMS`; `state`/`preparation` use the shared controlled vocabulary #62 introduces. `unspecified` is allowed. |
| `line.quantity` (Q) | `{g: number\|null, gMin?, gMax?, basis: measured\|label\|recipe_stated\|estimated, original?: {amount, unit, text ≤60}}` |
| `line.role` | `main\|cooking_fat\|sauce\|seasoning\|garnish\|beverage\|other` |
| `line.parentLineId` | Optional compound parent; must exist and must not form a cycle. A parent and its children are never both counted. |
| `line.order` | Optional `{group, position, tail?: boolean}` (label order and the ≤2 % tail). |
| `line.confidence` | `{identity, quantity}`, each `low\|medium\|high`. |
| `line.notes`, `line.assumptionIds[]` | Optional. |
| `knownFacts[]` | ≤10. `{factId, provenance: official_label\|restaurant_published\|manufacturer_site\|user_measured\|user_stated, source?: {title, url (https), capturedAt, market}, appliesTo: {scope: meal\|serving\|line, lineId?}, basis: {servings?, servingWeight?: Q, description?}, nutrients: {<registry key or label>: {value, unit, rounding?: fda_label\|exact\|unknown, qualifier?: less_than}}, ingredientStatement? ≤2000}` |
| `constraints[]` | ≤50. `fixed{lineIds}`, `ratio{num, den, min, max}`, `order{lineIds (descending), group}`, `tail_max_percent{lineIds, maxPercent}`, `sum{lineIds, gMin, gMax}`. |
| `assumptions[]` | ≤30. `{id, text, appliesTo: [lineId \| factId \| "meal"]}` |
| `overallConfidence` | `{level: low\|medium\|high, note?}` |

Quantity rules:

- Grams describe the **variant as stated**: raw grams for the raw variant, cooked grams for the cooked variant.
- `g: null` requires `original`; conversion to grams happens only through #61 conversion records. There is no implicit mL-to-g conversion.
- `0 ≤ gMin ≤ g ≤ gMax ≤ 1,000,000`.
- `measured` and `label` quantities are fixed. Only `estimated` (and, if the user allows it, `recipe_stated`) quantities are free variables for #65 fitting, bounded by `[gMin, gMax]`.

Ingredient-list rules:

- **Facts need real provenance.** A fact without one of the listed provenances is rejected. Totals the assistant computed or inferred are not facts and have no accepted provenance, so official and inferred values never mix.
- **Facts need an applicable basis.** A serving-level fact with no serving weight or serving count is stored as "unapplied" and is never a fit target.
- **Line-level facts are evidence, not targets.** A fact scoped to one line (for example, a packaged ingredient's label) becomes label evidence for that ingredient's #62 research job.
- **No per-ingredient nutrient values.** Profiles come only from the library or the #62 pipeline.
- **Constraints are checked.** Every reference must exist; contradictions are rejected (a fixed line that is also bounded, an order constraint that fixed grams already violate); infeasibility detected before fitting is a warning naming the lines.
- **Imports are never mutated.** Parsing produces an `ImportDraft`; user corrections are a separate layer on top of it.
- **Assistants may wrap the JSON** in prose; the site accepts exactly one fenced JSON block and rejects anything else ambiguous.

## Human paste format v1

A lossless view of a common subset of the JSON. Anything outside the subset is JSON-only. The parser is deterministic, reports errors by line and column, and shows the resulting canonical JSON for review.

| Element | Syntax |
| --- | --- |
| Start / end | `NUTRITION-INGREDIENTS v1` … `END` |
| Meta lines | `Key: value` for `Title`, `Kind`, `Servings`, `Serving weight`, `Final weight`, `Confidence` |
| Ingredient lines | `N. name \| form \| amount \| basis \| key=val; …`. `form` is comma-separated vocabulary words; `amount` accepts `120 g`, `120 g (100-140)`, or `2 tbsp ≈ 28 g`. Children are numbered `N.M`. |
| Facts | `Fact <provenance> per <basis>: Calories 650 kcal; Protein 42 g; …` |
| Constraints | `Constraints: fixed 4; order 1>2>3; ratio 2/1 0.5-2; tail2% 5,6` |
| Assumptions | `Assumptions:` followed by `- text [1,3]` lines |

## Research request v1

`kind: "nutrition.researchRequest"`, `schemaVersion: 1`. Built by #62 for unresolved ingredients or fields, in the app and in the CLI, from the same code.

| Field | Content |
| --- | --- |
| Header | `requestId` (`rq-` + 24 hex), `requestDigest` (`sha256:` + hex of the canonical body), `createdAt`, `registryVersion`, `responseSchemaVersion: 1` |
| `purpose` | `profile` (full profile), `fields` (only missing fields), or `conversion` (household weight or density). There is no image or extraction purpose. |
| `targets[]` | Chunked by configurable packet limits: up to 8 targets requesting all fields, or up to 25 targets with ≤10 fields each. Each target: `{targetId (= #62 jobId), identity: {name, category, kind, aliases}, variant, requestedFields: [keys] \| "*", basis: "per_100g_edible", expectedUnits, knownObservations (context only; must not change), triedSources: [{adapter, release, outcome}], labelEvidence?}` |
| `rules[]` | Fixed text: cite sources; never invent IDs or URLs; return null plus a reason when unknown; keep raw/cooked/fortified distinct; estimates need a comparator, rationale, and range; do not change known observations; no meal totals. |
| `responseTemplate` | Skeleton of the expected response. |

The copy button copies the instructions and the JSON as one block. A request never contains meal composition; the user's own label evidence is included only when the user selects it, and the UI shows exactly what will be copied. One request can batch many jobs; it records one pass ID.

## Research response v1

`kind: "nutrition.researchResponse"`, `schemaVersion: 1`.

| Field | Content |
| --- | --- |
| Echo | `requestId`, `requestDigest` |
| `responder` | `{assistant, label?, webAccess: boolean}` |
| `results[]` | One entry per requested target. |

Each result: `targetId`; `identityMatch {description, state, conflict, notes}`; `sources [{sourceId, type: fdc\|manufacturer\|label\|composition_db\|literature\|other, title, url (https), recordId?, version?, publishedAt?, accessedAt}]`; `nutrients {key: {value \| null, unit, status, sourceIds[], range?, confidence?, derivation?, comparator?: {name, sourceId, transferReason}, qualifier?, roundingInterval?, upperBound?}}`; `conversions [{unit, grams, state, sourceIds, range?, confidence}]`; `assumptions[]`; `unresolved [{field, reason}]`. `status` is any `NUTRIENT_STATUSES` value except `legacy_unclassified`.

A response is rejected before staging when:

- the echoed `requestId`/`requestDigest` does not match a pending job, or the response is stale or belongs to another draft;
- it contains unrequested targets or fields, or changes a known observation;
- a requested field has no status, or a non-null value has no `sourceIds`;
- an estimate lacks a comparator or derivation, or a range;
- a value is `0` without evidence;
- a `measured` or `label_reported` value is not backed by an `fdc`, `manufacturer`, or `label` source with a `recordId` or URL;
- a unit does not convert, `checkPer100g` fails, a URL is not https, or a numeric field contains text.

After acceptance, results start `verification: unverified`. A source becomes verified by a deterministic re-fetch (an FDC `recordId` through a #62 adapter) or by a reviewer attesting to that specific source. Curated revisions require verified sources. Private revisions may be approved on reviewer attestation and stay labeled `assistant-researched`. Reported (measured, label) and inferred (calculated, estimated) values stay distinct into storage.

## Shared validation rules

- Strict JSON Schema validation; freeform nutrition text is never parsed or imported.
- Nutrient units convert only through the registry's `convertUnit`; quantity units convert only through #61 conversion records.
- Unknown stays `null` with a reason; zero needs evidence.
- Validation errors name a JSON path (or paste line and column).
- Models never calculate totals, scale portions, match confirmed IDs, or overwrite known facts. Matched library ingredients are never researched again.

## Assistant instructions

A versioned text block (`instructionsVersion`) that the site's "Copy assistant instructions" button emits; the code module is the source of truth and a test checks this document's examples against it. It tells assistants to:

1. Identify meaningful ingredients, including cooking fat, sauces, breading, sugar, and broth; keep compound ingredients nested.
2. Estimate grams with ranges and a basis; prefer measured weights and explicit recipes; state whether grams are raw or cooked. A visible hand may use the project's 6.5-inch palm-base-to-middle-fingertip scale assumption, recorded as an assumption.
3. Report only facts with real provenance (official label, restaurant, manufacturer, user-measured, user-stated). Never present computed totals as facts. Never invent a target for a photo-only meal.
4. List assumptions and confidence; emit ingredient-list v1 JSON in one fenced block, or the paste format.
5. Answer research requests only with research response v1, citing sources and returning `null` plus a reason for unknowns.

## Examples

Ingredient list (restaurant item with published facts; one measured line):

```json
{
  "kind": "nutrition.ingredientList",
  "schemaVersion": 1,
  "registryVersion": 2,
  "producer": {"assistant": "chatgpt", "label": "Nutrition project", "instructionsVersion": 1},
  "inputs": ["photo", "menu"],
  "meal": {
    "title": "Chicken burrito bowl",
    "kind": "restaurant_item",
    "servings": {"count": 1, "consumed": 1},
    "finalWeight": {"g": 510, "gMin": 470, "gMax": 560, "basis": "estimated"}
  },
  "ingredients": [
    {"lineId": "rice", "name": "white rice", "kind": "generic", "variant": {"state": "cooked"}, "quantity": {"g": 180, "gMin": 140, "gMax": 220, "basis": "estimated"}, "role": "main", "confidence": {"identity": "high", "quantity": "medium"}},
    {"lineId": "chicken", "name": "grilled chicken thigh", "kind": "generic", "variant": {"state": "cooked", "preparation": "grilled"}, "quantity": {"g": 120, "gMin": 100, "gMax": 150, "basis": "estimated"}, "role": "main", "confidence": {"identity": "high", "quantity": "medium"}},
    {"lineId": "beans", "name": "black beans", "kind": "generic", "variant": {"state": "canned", "drained": "drained"}, "quantity": {"g": 110, "gMin": 80, "gMax": 140, "basis": "estimated"}, "role": "main", "confidence": {"identity": "high", "quantity": "low"}},
    {"lineId": "salsa", "name": "tomato salsa", "kind": "compound", "variant": {}, "quantity": {"g": 60, "basis": "measured"}, "role": "sauce", "confidence": {"identity": "medium", "quantity": "high"}}
  ],
  "knownFacts": [
    {
      "factId": "menu",
      "provenance": "restaurant_published",
      "source": {"title": "Restaurant nutrition calculator", "url": "https://example.com/nutrition", "capturedAt": "2026-11-06", "market": "US"},
      "appliesTo": {"scope": "serving"},
      "basis": {"servings": 1},
      "nutrients": {"calories": {"value": 690, "unit": "kcal", "rounding": "fda_label"}, "protein": {"value": 45, "unit": "g", "rounding": "fda_label"}}
    }
  ],
  "constraints": [{"type": "fixed", "lineIds": ["salsa"]}],
  "assumptions": [{"id": "a1", "text": "Rice volume estimated from bowl diameter.", "appliesTo": ["rice"]}],
  "overallConfidence": {"level": "medium"}
}
```

The same list in the paste format (subset):

```text
NUTRITION-INGREDIENTS v1
Title: Chicken burrito bowl
Kind: restaurant_item
Servings: 1
1. white rice | cooked | 180 g (140-220) | estimated
2. grilled chicken thigh | cooked, grilled | 120 g (100-150) | estimated
3. black beans | canned, drained | 110 g (80-140) | estimated
4. tomato salsa | | 60 g | measured
Fact restaurant_published per 1 serving: Calories 690 kcal; Protein 45 g
Constraints: fixed 4
Assumptions:
- Rice volume estimated from bowl diameter. [1]
END
```

Research request (two missing fields for one library ingredient):

```json
{
  "kind": "nutrition.researchRequest",
  "schemaVersion": 1,
  "requestId": "rq-3f9a0c1d2e4b5a6978c0d1e2",
  "requestDigest": "sha256:9b1e5c3a7d2f4e6081a3b5c7d9e1f20314253647586970a1b2c3d4e5f6071829",
  "createdAt": "2026-11-06T20:00:00Z",
  "registryVersion": 2,
  "responseSchemaVersion": 1,
  "purpose": "fields",
  "targets": [
    {
      "targetId": "job-black-beans-canned-drained-1",
      "identity": {"name": "black beans", "category": "legumes", "kind": "generic", "aliases": ["turtle beans"]},
      "variant": {"state": "canned", "drained": "drained"},
      "requestedFields": ["manganese", "fiberSoluble"],
      "basis": "per_100g_edible",
      "expectedUnits": {"manganese": "mg", "fiberSoluble": "g"},
      "knownObservations": {"calories": {"value": 91, "unit": "kcal", "status": "measured"}},
      "triedSources": [{"adapter": "curated", "release": "nutrition-curated@0", "outcome": "not_found"}]
    }
  ],
  "rules": [
    "Cite every source; never invent IDs or URLs.",
    "Return null plus a reason when a value is unknown.",
    "Estimates need a comparator, a transfer reason, and a range.",
    "Do not change known observations or return meal totals."
  ],
  "responseTemplate": {"kind": "nutrition.researchResponse", "schemaVersion": 1, "requestId": "", "requestDigest": "", "responder": {}, "results": []}
}
```

Research response:

```json
{
  "kind": "nutrition.researchResponse",
  "schemaVersion": 1,
  "requestId": "rq-3f9a0c1d2e4b5a6978c0d1e2",
  "requestDigest": "sha256:9b1e5c3a7d2f4e6081a3b5c7d9e1f20314253647586970a1b2c3d4e5f6071829",
  "responder": {"assistant": "claude", "webAccess": true},
  "results": [
    {
      "targetId": "job-black-beans-canned-drained-1",
      "identityMatch": {"description": "Beans, black, mature seeds, canned, drained", "state": "canned, drained", "conflict": false, "notes": ""},
      "sources": [
        {"sourceId": "s1", "type": "fdc", "title": "FoodData Central", "url": "https://fdc.nal.usda.gov/", "recordId": "000000", "accessedAt": "2026-11-06"}
      ],
      "nutrients": {
        "manganese": {"value": 0.3, "unit": "mg", "status": "measured", "sourceIds": ["s1"]},
        "fiberSoluble": {"value": null, "unit": "g", "status": "unknown", "sourceIds": []}
      },
      "conversions": [],
      "assumptions": [],
      "unresolved": [{"field": "fiberSoluble", "reason": "No source reports soluble fiber for this form."}]
    }
  ]
}
```

Values and record IDs in these examples are placeholders that show shape only; they are not nutrition data.
