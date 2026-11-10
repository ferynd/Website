# Nutrition workflow and data contract

Status: target design for CalorieTracker #59 onward. Current behavior is recorded in [README](README.md). Implementation tasks and their release gates live in [the active backlog](../../backlogs/calorie-tracker.md).

External assistants interpret; the tracker imports, matches, resolves, calculates, fits, reviews, and saves. Photos, recipes, labels, and meal descriptions go to an external assistant (ChatGPT, Claude, Grok, Codex, or James's bots), which returns a structured ingredient list per the [assistant contracts](assistant-contracts.md). The site is the authoritative ingredient database, quantity fitter, nutrition calculator, and store. Importing a completed 24-field ChatGPT estimate remains supported as a secondary path.

Local code and CLI entry points: [shared research pipeline](research-pipeline.md) and [ingredient-list import](ingredient-import.md). The tracker Import workspace runs the stages below through those modules, #66 resolution, and #64 calculation. Quantity fitting (#65) runs in the workspace and moves only estimated grams. Live source pins, publication, and production saving remain gated.

## Contents

1. [Staged meal analysis](#staged-meal-analysis) (ingredient-list import; see also [assistant contracts](assistant-contracts.md))
2. [Input and reuse flow](#input-and-reuse-flow)
3. [Expanded nutrition](#expanded-nutrition)
4. [Ingredient and meal records](#ingredient-and-meal-records)
5. [Recipe reconstruction](#recipe-reconstruction)
6. [Deterministic calculations](#deterministic-calculations)
7. [Missing ingredients and website screens](#missing-ingredients-and-website-screens)
8. [AI, offline, and shared-module boundaries](#ai-offline-and-shared-module-boundaries)
9. [ChatGPT and import compatibility](#chatgpt-and-import-compatibility)
10. [Sources](#sources)

## Staged meal analysis

The tracker's Import workspace (#70) runs these stages in order. Each stage is resumable from a draft and records whether its output is deterministic, user-entered, or assistant-provided.

| Stage | Behavior | Owner |
| --- | --- | --- |
| 1. Import and validate | Accept ingredient-list v1 JSON or the paste format, a saved meal or recipe, a Recipe Standardizer recipe, or legacy paste. Parse strictly, report errors by path or line, and show a normalized preview. Nothing is matched or researched yet. | #67 |
| 2. Match | Match identities/forms against cached, private, and curated profiles with exact variant compatibility. Exact matches reuse the stored profile revision; ambiguous ones are listed for confirmation. | #61, #67 (reconcile) |
| 3. Resolve | Batch all missing profiles and fields: alias or alternative, official lookup, research packet (or the optional #71 route when enabled and within budget), manual entry, incomplete draft, or cancel. | #66 (choices), #62 (jobs and packets) |
| 4. Calculate | Recalculate every registry nutrient through the shared module once records are resolved, without repeating finished research. | #64 |
| 5. Fit | Only when eligible known facts exist: adjust estimated quantities within their ranges against those facts. Respect rounding and uncertainty; never change known facts or measured lines; flag non-unique or infeasible fits. | #65 |
| 6. Review | Show known-versus-calculated differences, measured vs estimated quantities with ranges, coverage, and the quality and source of derived nutrition. | #66 |
| 7. Save | Save composition, quantities, profile revisions, known facts, and the complete snapshot as a recipe, food item, and/or diary entry. | #64 |
| 8. Reuse | Load saved meals and recipes as future inputs and rescale them without research or models. | #64, #67 |

With matched ingredients, every stage runs with zero model calls. Import never triggers research for matched lines. The Ingredient Library tab (#69) manages the profiles these stages use.

## Input and reuse flow

Accept ingredient-list v1 JSON or paste, a saved meal or recipe, a Recipe Standardizer recipe, or legacy paste. Keep the original import and user corrections separate from inferred data. Identifying ingredients and estimating amounts are the external assistant's job ([assistant instructions](assistant-contracts.md#assistant-instructions)). The steps below describe the site's logic behind the stages above.

1. Validate the import: identities as stated, grams with basis and ranges, constraints, assumptions, and known facts with provenance.
2. Match identities and forms to the local ingredient index, approved user profiles, and curated source profiles. Reuse profiles before any external research. Search aliases, but distinguish raw/cooked, dry/hydrated, drained/undrained, fat percentage, fortification, salt, and brand formulation.
3. Show missing profiles and ambiguous matches together. A profile can exist while particular nutrients remain unknown. Missing-profile and missing-nutrient lists must be distinct.
4. Resolve missing items through the user's selected action. External research is limited to the selected missing identities or fields. Cache approved results.
5. Calculate totals, retain source-reported meal facts, and show estimated ingredients, coverage, assumptions, and unresolved discrepancies.
6. When eligible known facts exist, apply known quantities, ingredient order, those facts, yield, and plausible recipe ratios as constraints. Fit only `estimated` quantities, never canonical ingredient nutrient values, then recalculate.
7. On Save, persist the meal's ingredient list, exact profile revisions, quantities, constraints, known facts, and nutrition snapshot. Create missing approved ingredient profiles once. Reuse existing IDs across meals.

Interpretation happens in the external assistant; the site validates what it receives. A saved recipe with resolved ingredients, a portion change, or an approved structured import must use zero model calls for matching confirmed IDs, scaling, aggregation, and saving. After any missing record is resolved, recalculate the meal from step 5 onward.

## Expanded nutrition

Preserve read/import support for all 24 existing tracker keys. Add a versioned registry shared by the static tracker and React recipe tool. Registry entries specify stable key, unit, meaning, aliases, overlap, valid basis, and presentation behavior. Importers must use exact supported labels, not substring matching.

The proposed names below are the vocabulary for #60. Any implementation adjustment must update import/export and this contract together.

| Group | New or clarified keys | Units and meaning |
| --- | --- | --- |
| Core | `calories`, `protein`, `carbs`, `fat` | kcal and g; carbs remain unadjusted source total with a declared carbohydrate convention. |
| Fat classes | `fatSaturated`, `fatTrans`, `fatMonounsaturated`, `fatPolyunsaturated` | g; preserve the source's isomer definitions. They are components of fat, never additional fat. |
| Fatty acids | existing `omega3`; `omega3ALA`, `omega3EPA`, `omega3DHA`, optional `omega3DPA`, `omega6` | g; distinguish reported total from a partial sum of measured components. Never map EPA or DHA alone to total omega-3. |
| Sugars and starch | `sugarsTotal`, `sugarsAdded`, `starch`, `allulose`, `sugarAlcoholsTotal` | g; preserve overlap with carbs and between sugars. Allulose is a separate carbohydrate, not a sugar alcohol. |
| Individual polyols | `erythritol`, `sorbitol`, `mannitol`, `isomalt`, `xylitol`, `glycerol`, `maltitol` | g; source-specific identities; glycerin is an alias of glycerol. Unknown polyol mixture does not acquire invented proportions. |
| Standard fiber | `fiberTotal`, `fiberSoluble`, `fiberInsoluble`, optional `resistantStarch` | g; `fiberTotal` is standard label/database dietary fiber. Subtypes and resistant starch can overlap. |
| Legacy project metric | `fiberWeightedLegacy` | g-equivalent, estimated by the established project weights; a custom metric, not a laboratory measurement or standard dietary-fiber total. |
| Missing vitamins | `vitaminB1`, `vitaminB2`, `vitaminB3`, `vitaminB5`; optional `biotin` | mg except biotin in mcg. Distinguish measured niacin from niacin equivalents if a source uses the latter. |
| Missing minerals | `copper`, `manganese`; optional `chromium`, `molybdenum`, `chloride` | mg for copper/manganese/chloride; mcg for chromium/molybdenum. Optional fields may remain unknown. |
| Other useful components | `cholesterol`, `alcohol`, `water`, optional `caffeine` | cholesterol/caffeine in mg; ethanol and water in g. Preserve alcohol when accounting for cocktails and cooked reductions. |
| FODMAP components | `lactose`, `fructans`, `gos`; optional excess fructose and relevant polyols | g and evidence. Project equivalents are derived separately from stored component amounts. |

Keep every existing vitamin and mineral. Standardize vitamin A as mcg RAE, folate as mcg DFE where supported, vitamin D as mcg, and vitamin E as mg alpha-tocopherol. Retain source forms when conversion is not defensible. Do not treat folic acid as an unconditional synonym for folate DFE, or a K1-only value as measured total vitamin K.

### Fiber transition

Standard dietary fiber includes soluble and insoluble components. Do not classify ordinary insoluble fiber as "non-dietary." Fermentability and viscosity are separate properties, not complements of soluble/insoluble fiber [S2].

Preserve the project's existing weighted estimate under `fiberWeightedLegacy`:

- Known fermentable/viscous fibers: full amount, except the following specific weights.
- Psyllium: 0.7; resistant starch/hemicellulose: 0.5-0.6 with the chosen coefficient recorded; cellulose: 0.2; lignin: 0.
- When subtypes are unknown: fruit/legumes/oats/barley 0.8; non-starchy vegetables 0.7; nuts/seeds 0.6; wheat/bran-heavy foods 0.5 times total fiber.
- Apply one method per amount, with the specific subtype rule taking precedence. Do not count a fiber twice or invent a group weight for an unsupported food.

Historical `fiber` values are ambiguous because the chat workflow used weighted fiber while other tracker imports could use standard fiber. Preserve the original value and mark its meaning `total`, `weighted_legacy`, or `unknown` only when evidence supports the classification. `weighted_legacy` is the stored name for this contract's weighted custom metric; the registry uses that spelling so the value is not mistaken for a future standard weighting. Never silently rewrite history or infer the classification solely from the field name. New standard-fiber targets must not be applied to the custom metric.

### Nutrient quality

Every nutrient observation carries:

- Numeric value or `null`, unit, and per-100-g edible basis.
- Status: `measured`, `label_reported`, `calculated`, `estimated_from_comparable`, `below_quantification_limit`, `unknown`, `not_applicable`, `assumed_zero`, or `source_reported`.
- Derivation honesty for USDA sources (issue #215, ANSWER Q-004): a value is `measured` only when its USDA derivation code is analytical (A). Code NC is `calculated`; code Z is `assumed_zero` and keeps its numeric 0; any other code, or no code, is `source_reported`, a real source value whose determination method is not classified. The raw derivation code is preserved in field provenance as `sourceDerivationCode`.
- Source reference, source nutrient definition/ID, retrieval and publication/version dates when available.
- Derivation and comparator ID/revision for estimates; confidence and a defensible range where useful.
- Rounding interval, detection/quantification limit, or qualifier when supplied.

Zero requires supporting evidence. Label-rounded zero is a label observation, not proof of chemical absence. USDA can return value zero alongside a nonzero limit-of-quantification field [S1]. Unknowns remain null all the way through import, calculations, storage, export, and charts.

Assess coverage per nutrient as well as per ingredient and gram. When inputs are estimated, use an estimate marker. Use a lower-bound indicator only when the included values and omitted nonnegative contributions justify it. "All ingredients linked" does not mean "all micronutrients known."

Reading a v1 document that has a number and no stored quality uses status `legacy_unclassified`. That status is part of `NUTRIENT_STATUSES` and is not written onto new v2 observations.

#### Coverage and uncertainty display (#64, #66)

Meal totals keep a status per nutrient: reported, calculated, estimated (any estimated input, quantity, or value), or unknown. Unknown is never zero. Show coverage per nutrient by grams and by ingredient, and a lower bound only when omitted contributions are nonnegative and the bound is justified. Propagate quantity ranges and value ranges as intervals. Rank the most important uncertainties (largest contribution to the interval of a displayed nutrient) for review. The exact aggregation and ranking rules are an open #64 design decision.

### Registry implementation (#60)

The shared module is `public/shared/nutrition/nutrientRegistry.js`, `public/shared/nutrition/capabilities.js`, and `public/shared/nutrition/nutrientText.js`. The static tracker imports those files by relative URL. Recipe Standardizer imports them with the `@/public/shared/nutrition/` alias. There is no generated second copy.

v2 food documents, only when writes are enabled, store flat top-level keys (`null` means unknown), `nutrientSchemaVersion: 2`, and a sparse `nutrientMeta` object with `registryVersion`, `quality`, and `fiberMeaning` / `carbConvention` only when those are not `unknown`. Unknown quality entries are omitted. A v2 food item logged on a day keeps that same `nutrientMeta`, including upper bounds and estimated status. Day documents do not store detail totals. Readers derive them, and a key missing from any logged item is partial coverage rather than zero.

`checkPer100g` and `checkPerUnit` are the bounds. Pure salt at 39,340 mg sodium per 100 g passes the per-100 g check (review above 40,000 mg, hard maximum 100,000 mg). The v1 per-unit editor cap stays the historical maximum, including sodium 23,000.

`NUTRIENT_V2_WRITES_ENABLED` in `public/shared/nutrition/capabilities.js` is the switch for food/day document shape, not the only write switch. It is false. `resolveNutrientWriteVersion()` returns 1 or 2 from that constant and has no localStorage, query, or environment override. With the flag off, food writes stay `{name, quantity, 24 numbers, lastUpdated}`. Food save and saved-food CSV import read the target inside a Firestore transaction and refuse to overwrite a document whose `nutrientSchemaVersion` is 2 or higher. Diary days have no such guard: `saveDailyEntry()` and `saveDailyEntrySnapshot()` replace the whole day with `setDoc` without checking its schema, so a cached older client can erase newer diary fields until #60 Part B adds a transactional diary guard. See [cached-client compatibility](ingredient-store-release.md#cached-client-compatibility).

Tracker Settings shows `Nutrient registry v2 · storage v1 · ingredient store v1 (writes off) · build nutritrack-v5`, because the build token is `NUTRITRACK_CACHE_NAME`. The service worker cache in the repository is `nutritrack-v5` (`public/tools/CalorieTracker/sw.js`). Same-origin JavaScript, HTML, and navigations are network-first with cache fallback. Styles and images stay cache-first. Firebase hosts stay network-only. The read-only census is `scripts/firebase/nutrientCensus.ts`. James approved that census and backup on 2026-11-09; the parent runs it. This repository change does not run it, and no Firestore rules deploy is required for these fields. A later write-enable PR must bump the cache past `nutritrack-v5`, because v5 already shipped with writes off.

## Ingredient and meal records

### Ingredient identity and profile


Implemented in #61 Part A (writes off):

- Private collections are `artifacts/default-app-id/users/{uid}/ingredientIdentities/{identityId}`, `ingredientVariants/{variantId}`, `ingredientRevisions/{revisionId}`, and `ingredientConversions/{conversionId}` under the same user prefix. The shared `INGREDIENT_COLLECTIONS` constant owns the names. There are no client hard deletes: retire identities/variants; revisions/conversions remain immutable.
- Private identity IDs are `pi-` plus 20 SHA-256 hex digits of the frozen `identityKeyV1` (normalized original name, category, kind). Renames do not change IDs. Private variants use `pv-` plus the hash of identity ID and canonical dimensions; curated override variants use `ov-` plus the hash of catalog/variant IDs. Revisions use `variantId~rN`, with contiguous head advancement. Conversion IDs are `pc-` plus a content hash prefix. A key collision fails explicitly.
- Dimensions record state, preparation, drained status, fat/lean percentages, salt, fortification and detail, sweetening, edible portion, and optional brand/product/GTIN/market/label date/formulation. Only exact compatibility permits reuse; unspecified versus specified requires review. Search aliases alone never confirm a link.
- A revision has a `per_100g_edible` basis, v2 nutrient observations and metadata from the shared registry, field provenance, source records, optional `basedOn`, and a `supersedes` chain. Its SHA-256 hash covers identity, variant, basis, nutrients, metadata, provenance, sources, and `basedOn`. Readers reject corrupt content. Deep per-value validation is client- and read-side (`validateRevision`, `verifyRevisionHash` -> corrupt status); the Firestore boundary enforces registry keys, top-level metadata shape, and bounded sources. An owner can recover from a bad/corrupt revision at any time by advancing the head past it with a valid superseding revision n+1. Unknown remains null; non-null values including zero require evidence and a source. Legacy foods adapt as `legacy_per_unit`, with unknown fiber meaning and no invented gram basis.
- Pinned refs carry `{refVersion, scope, namespace, identityId, variantId, revision, revisionId, contentHash}`. Private namespace comes from the existing app ID; curated namespace is `catalog:nutrition-curated`. An effective curated lookup prefers a private override head, while pinned refs always resolve their named revision. Recipe links dual-read optional `ingredientRef` before the legacy `foodItemId`/fingerprint path; per-100-g contributions use grams/100. Missing, stale, or corrupt profiles leave explicit gaps. A newer head is informational and does not alter totals. Existing links are not repointed.
- Immutable household, density, piece, and package conversions include their variant ref, state, source, confidence, and optional range. No implicit mL-to-g conversion is allowed. Private searches use one array-contains token, document-ID order and cursors, capped at 25 results. Curated open fetches only a manifest, searches at most two hashed shards, and retains at most 32 shards.
- The static curated manifest at `public/shared/nutrition/catalog/nutrition-curated/manifest.json` ships EMPTY (`profileCount: 0`). It contains no nutrition values. Population/research/importers remain #62/#63.
- IndexedDB `nutrition-profile-cache-v1` stores owner metadata, revisions, heads, conversions, and `pendingSaves`. Keys include namespace and pinned revision. Limits are 2,000 revisions, 4,000 conversions and 8 MB estimated JSON, with LRU eviction; pending drafts are never evicted. Heads expire after 24 hours and revalidate on open/reconnect. Owner changes and sign-out clear the database in both tools, including pending drafts. Unavailable IndexedDB disables caching and reports missing data.
- `INGREDIENT_STORE_WRITES_ENABLED = false` is a separate compile-time gate with no localStorage, query, or environment override. Every shared write path and profile-link confirmation checks it. Transactions deduplicate deterministic creates, advance revisions atomically, and preserve failed saves in the outbox for explicit review/retry. `NUTRIENT_V2_WRITES_ENABLED` remains false, so foods and diary records retain v1 shape. The repository service worker is `nutritrack-v5` with writes still off. Catalog manifests use network-first fetches and hashed shards are cache-first. Firestore traffic remains network-only.

Rules changes are **repository source, pending deployment**, verified only in the local emulator. See [ingredient release](ingredient-store-release.md) for the separate Part B gates. #60 Part B is not a blocker for #61 Part A because the gates control separate document collections.

Use a stable ID independent of a display name. A family such as ground beef has separate variants for material differences. Keep aliases for search, not for automatic equivalence.

The current recipe fuzzy matcher treats words such as raw, cooked, dried, salted, and unsalted as noise. It can remain a candidate suggester, but must not become the canonical automatic resolver. Require exact variant compatibility for automatic reuse. Add indexed lookup, pagination, and bounded local caches; do not load the entire expanded catalog every time either tool opens.

Version fingerprints explicitly. The existing fingerprint includes the ordered 24 nutrient keys, so simply adding keys changes old hashes. Keep a v1 verifier for stored confirmed links and export references, and introduce a v2 fingerprint/version together. Reconfirmation, if required, must be visible and deliberate. A legacy reference must never be silently trusted or invalidated merely because the supported nutrient dictionary grew.

#60 keeps the v1 fingerprint as the FNV-1a 32-bit hex of quantity plus the ordered 24 keys. The v2 fingerprint is `v2:` plus the FNV-1a hex of registry version, quantity, fiber meaning, carbohydrate convention, and every key as `value:status:upperBound:roundingInterval:qualifier`. Unknown or omitted conventions, and an omitted upper bound, rounding interval, or qualifier, are empty tokens, so they match a document that does not store them. A change from `weighted_legacy` to `total`, between carbohydrate conventions, or in an upper bound, rounding interval, or qualifier such as `lower_bound`, changes the v2 fingerprint even when the numbers and statuses stay the same. `verifyTrackerFoodFingerprint` returns `match`, `match-v1-expanded`, or `mismatch`. `match` and `match-v1-expanded` both mean the legacy 24 keys are unchanged. `confirmed-legacy` is a review state for a v1 fingerprint on a food that now carries detail. It is not a stored link status, and those links still contribute the 24 keys. While `NUTRIENT_V2_WRITES_ENABLED` is false, new confirmations store another v1 fingerprint and the review UI does not ask to reconfirm merely to include detail.

Suggested logical records:

| Record | Required content |
| --- | --- |
| Ingredient identity | Stable ID, canonical name, aliases, category, generic/branded/additive/compound type. |
| Variant | State/preparation, edible portion, lean/fat percentage, drained status, salt, fortification, optional brand/GTIN and label market/date. |
| Immutable profile revision | Identity and variant IDs, nutrient observations, source records, revision, content hash, quality review, superseded revision if applicable. |
| Source record | Dataset/type/ID, official URL, version/date, access date, source basis and conversions, permitted-use notes. |
| Quantity conversion | Unit and grams, food state, density or household-weight source, confidence. A tablespoon of oil is not a tablespoon of flour. |
| Research job | Target key/type (catalog jobs require manifest ID; non-catalog/private/new-ingredient jobs use namespace/owner + stable ingredient/variant identity), requested fields, candidate matches, status, error/gap reason, reviewed result, attempts, and timestamps. |

A curated ingredient catalog may be bundled as public, read-only, source-licensed data. User-created profiles, meals, labels, photos, and corrections stay owner-private. Public records are never writable by arbitrary clients. User overrides create private revisions and never change other users' data.

Preserve the existing namespace contract/constants and honor the separate F-141 migration plan. Current `namespaces.ts` exports pinned constants, not a dual-read resolver. Any resolver is explicit future work. Do not change `default-app-id` as an incidental part of this feature. References must record namespace/catalog plus profile ID and revision. The #61 Part A paths and readers above are implemented; writes and production rules deployment remain disabled pending Part B.

### Meal or recipe version

Store:

- Stable recipe/meal ID and revision, title, preparation state, original input references, and evidence reliability.
- Ingredient lines with profile ID/revision, quantity in grams, state, optional range, whether measured/inferred, constraint group, and source of the estimate.
- Compound-ingredient links or subrecipe versions, with cycle protection. Count either the complete compound profile or its children in a calculation, never both.
- Measured/estimated final edible batch weight, servings/portions, yield, retained/discarded water/fat and retention assumptions.
- Known meal facts, their serving basis, source, and tolerances. Keep these separate from component-derived totals.
- Calculation version, chosen scenario, deviations, alternative plausible quantity ranges, per-nutrient coverage, and resulting nutrition snapshot.
- A frozen saved snapshot and the referenced versions. Opening an old diary entry must not silently apply new ingredient data.
- Import provenance: contract `kind`, `schemaVersion`, producer, and `instructionsVersion`; per-line basis, range, and confidence; known-fact provenance; the #62 research job and pass IDs that resolved each profile.
- Versions of the derived-metric conventions (weighted fiber, adjusted carbs, FODMAP equivalents).
- For a diary entry, the meal reference (`mealRef`) and revision alongside the frozen snapshot.

Recalculating a saved recipe never triggers research. Editing a profile produces a new revision. A recipe may show "new ingredient data available" and offer explicit recalculation. Past logged meals remain reproducible unless the user deliberately updates them. Deleting an ingredient cannot erase the evidence needed by existing snapshots.

Example: a casserole and a burger can share the same `ground-beef-90-10` profile only if the same raw/cooked and drained form applies. They store different quantities and preparation assumptions. "Burger" as a whole dish is a recipe, not the reusable identity for all ground beef.

### Save guarantees

Deduplicate by identity/form/source revision and a checked idempotency key. Confirm source revisions again at commit. Use transactions or a staged, resumable process with explicit partial-success reporting. A failed meal save must not report success merely because ingredient creation succeeded. A retried request must not create duplicate ingredients or meals. Preserve the existing recipe revision conflict flow.

Keep the tracker as the diary writer. Pass composition and references through tracker-owned logging rather than adding a recipe-side whole-day writer. Direct diary logging from Recipe Standardizer remains separate P6 work. Cover another tab editing the same day between recipe export and tracker logging; saving an ingredient graph must not overwrite that change.

## Recipe reconstruction

The goal is a defensible estimate, not a unique recipe recovered from a label.

### Evidence priority

1. Measured ingredient and final weights, explicit recipe quantities, and exact applicable product identity.
2. Official restaurant/package facts on a verified serving basis. Preserve rounding and applicability.
3. Label ingredient hierarchy/order and quantified claims.
4. Assistant estimates from photos (count/size/volume), meal mass estimates, published comparable recipes, and restaurant preparation patterns.
5. Clearly recorded priors where evidence leaves several plausible recipes.

Known quantities constrain weights. Known nutrients constrain the aggregate on the matching serving and cooking basis. Unreported nutrients are absent constraints, never zero targets.

### Fit specification

**Target eligibility.** Only known facts with real provenance and an applicable basis (see [assistant contracts](assistant-contracts.md#ingredient-list-import-v1)) are fit targets. A photo-only meal without such facts is not fitted, and no target is invented. **Free variables** are lines with basis `estimated`, bounded by `[gMin, gMax]`. **Fixed** lines have basis `measured`, `label`, or `recipe_stated`, or a `fixed` constraint; their `gMin`/`gMax` record tolerance for uncertainty only. A user who wants a `recipe_stated` line fitted changes its basis to `estimated` in the correction layer. The assistant's estimate is the starting point.

Implement a deterministic constrained optimizer over nonnegative gram quantities. Typical constraints are label calories, macros, sodium, fiber, serving weight, ingredient order, preparation states, and plausible recipe ratios. Start with bounded, evidence-backed priors. Pin exact weights only when the evidence warrants it; use intervals for rounded labels and uncertain portions. Minimize weighted residuals against known meal facts and deviation from reasonable recipe ratios, with explicit slack for conflicting evidence. Store algorithm/version, all bounds/weights, and deterministic tie-breaking.

Descending ingredient order applies within the correct label group and formulation stage. Preserve compound nesting. A "contains 2% or less" tail bounds each applicable ingredient but does not impose order within that tail [S3]. Generic recipe text does not acquire a legal order constraint. Jurisdiction and relevant labeling rules must be recorded rather than assumed universally.

Separate as-formulated mass from finished cooked mass. Model moisture gain/loss and discarded or absorbed fat explicitly. A final plate weight is not a requirement that raw ingredients sum to that same weight. Prefer an appropriate cooked profile when available; otherwise apply justified food/method-specific yield and retention factors once [S6].

When evidence is infeasible, flag the inconsistent serving basis, identity, amount, or label observation. Offer corrections or alternative scenarios. Never quietly relax a measured quantity, invent negative oil, or alter ingredient nutrition to force a match.

Retain source-reported meal nutrients as observed facts. Show derived estimates alongside them when they differ, and use the derived profile to fill missing nutrients. Do not multiply all missing micronutrients by a calorie correction factor. Fitting known macros does not establish the accuracy of inferred micronutrients.

### Required solver cases

- Exact known recipe and arbitrary portion scaling.
- Multiple recipes fit the same calories/macros; report uncertainty rather than claiming identification.
- Fixed ingredient quantity and ordered list; nested sauce; unordered 2% tail.
- Rounded calories/macros, infeasible label, wrong serving basis, and missing label nutrient.
- Raw beef cooked and drained; dry rice gaining water; cooking oil partly retained; mixed known/estimated yield.
- Ingredient profile missing a nutrient; no implicit zero target.
- Known branded compound versus child breakdown; no duplicate counting.

## Deterministic calculations

For an ingredient amount `q` grams with a profile per 100 g, nutrient contribution is `q / 100 × profile value`. The shared implementation is [calculate.js](../../public/shared/nutrition/calculate.js). Missing profile values contribute unknown coverage, not measured zero. Scale ingredient contributions before summing. Keep full internal precision and round only at the display/export boundary. Weighted fiber is computed per ingredient and then summed. Meal status is estimated if any counted input is estimated, otherwise calculated, otherwise reported. Unknown stays null.

Quantity fitting is [fit.js](../../public/shared/nutrition/fit.js). It moves only estimated grams inside their bounds, calls `calculateMeal` for residuals, and leaves measured, label, and recipe-stated grams unchanged. A rounded fact without an interval width is not an exact target. With no eligible fact, nothing moves.

Use source energy as its own observation. A 4/4/9 macro estimate is a diagnostic, not an unconditional equality: source methods, fiber, polyols, allulose, alcohol, and organic acids can affect the relationship [S1, S4]. Do not add fat, fatty-acid, sugar, or fiber subfields to their parent totals. Fatty-acid sums need not equal total lipid exactly [S1].

### Derived project metrics

Weighted fiber (`fiberWeightedLegacy`) is computed at calculation time from `fiberTotal`, fiber subtypes, and the category weights under [Fiber transition](#fiber-transition). It is versioned and is not stored as a field in curated or private profiles, so it is excluded from profile field-status coverage and from research requests (including `"*"`). Adjusted carbs and FODMAP equivalents come from the same shared #64 calculation module. Saved meals record the convention versions used.

### Project carb calculation

Keep unadjusted carbs in the nutrition facts. Compute an explicitly named project-adjusted carb value outside the core copy block. Track which components are already included in the source carbohydrate definition to avoid subtracting fiber twice.

`Adjusted carbs = carbs - included fiber - included allulose - Σ[(1 - counted fraction) × included polyol grams]`

Existing counted fractions: erythritol 0; sorbitol/mannitol/isomalt/xylitol/glycerol 0.5; maltitol 0.75. Allulose is separate, with counted fraction 0 for this project. Its project carb treatment does not imply zero energy [S4]. Never silently assign a counted fraction to an unidentified mixture. Validate impossible negatives and incomplete subtraction inputs instead of hiding them with a clamp.

These are versioned project conventions. Store the unmodified data as well as the derived result. Do not implement medication dosing.

### Existing FODMAP and output conventions

Keep lactose/fructans/GOS in grams with sources or estimated status. Prefer Monash or suitable primary/clinical evidence; serving thresholds do not by themselves establish exact grams. Preserve the project's derived equivalents: lactose / 12 g as milk equivalents; fructans / 3.0 g and GOS / 0.75 g as project FODZYME scoop equivalents, rounded to 0.1. These are project conventions, not measured enzyme requirements.

Retain the confidence note, ingredient quantities, nutrition-only copy block, separate FODMAP/carb summary, and concise sources/assumptions. Core copy blocks start with Calories and end with Choline. Net carbs and FODMAP values remain outside them. Round calories to whole numbers, macros to 0.1 g, and micronutrients sensibly. Keep estimated status visible.

## Missing ingredients and website screens

### Intake

**Import ingredient list** in the tracker's Import workspace (#70) accepts ingredient-list JSON or paste, a saved meal or recipe, or legacy paste. Show the parsed item and serving basis before final save. A user can correct an identity or quantity without rerunning research for already resolved profiles.

### Ingredient Library tab

A dedicated tracker tab (#69) manages the shared ingredient profiles:

- **Search:** indexed, paginated, alias- and variant-aware; works offline over cached profiles.
- **Add and edit:** private profiles and overrides, saved as new revisions with source and basis. Curated records are never edited in place.
- **Review:** identity, variants, per-field status and provenance, missing nutrient fields, unit conversions, and revision history. Missing fields and missing conversions are separately filterable. An affected recipes/meals view is capability-gated until #64 Part B exposes ingredient-graph references; do not require it in the #69 ship.
- **Import:** label facts, manual measurements, or a reviewed research result.
- **Research:** selected ingredients or selected missing fields through official sources (#62 jobs) first; then a research packet, or the optional API, via #62, only after a recorded official-source attempt leaves gaps, or via an explicit override. The default is the copy/paste research packet; the optional #71 route stays off. Results stay staged until reviewed, and model citations require evidence verification before approval.

Recipe Standardizer opens the same views from its link editor rather than maintaining a second editor.

### Ingredients and review

Show an editable list: ingredient, exact form, grams, measured/estimated badge, matched profile, source, and missing-field status. Expand a row for nutrient evidence and variants. Provide switches for meal total, serving, portion, and per-100-g edible/cooked basis.

### Missing-data dialog

The shared ladder is [resolution.js](../../public/shared/nutrition/resolution.js). It does not fit quantities or call a model. List all missing/ambiguous ingredients and fields in one review. Offer, in ladder order:

- **Choose existing:** search aliases, approved alternatives, verified variants, and user overrides; explicit substitute selection is recorded as an estimate. Confirming an ambiguous match can create a private confirmed alias so the next import matches exactly.
- **Look up selected:** run official-source lookup (#62) for the selected identities or fields. Show progress, result quality, and a review step before persistence. Reuse any approved records if another tab populated them first.
- **Research packet:** available after a recorded official-source attempt left the selected identity or fields unresolved (or an explicit user override of that gate). One click copies one text-only research request ([v1](assistant-contracts.md#research-request-v1)) covering the selected unresolved ingredients and fields, including a mix of missing profiles and field gaps. The issued jobs stay on the resolution state as `awaiting_response` so the pasted response validates through the same #62 validator and review steps as bulk population. A field gap pins the matched profile revision and extends it; it does not open a new identity. A missing revision document blocks that packet instead of zero-filling the profile. **Optional:** the #71 direct route sends the same request only when enabled and within its configured budget. Cited sources must be verified before curated approval; unverified output stays labeled.
- **Enter manually:** add a label or measured facts with source and basis.
- **Save incomplete draft:** retain the recipe and unknowns, clearly excluded from claims of complete nutrition.
- **Cancel:** return without committing the meal. Do not launch research or charge an AI request.

A failed lookup leaves the ingredient unresolved with an actionable reason. Never silently drop an ingredient, assume an unknown nutrient is zero, or call a model without the chosen research action. Research cancellation must stop pending work where possible and report any already-created approved records accurately. Once items are resolved, recalculate automatically and return to quantity fitting and review.

### Estimate review

Next to each known label fact, show the calculated value. An exact fact shows the point difference. A less-than fact is consistent when the calculation is at or below the bound, and a rounded label fact keeps its rounding token instead of a false point residual. Serving facts are scaled to the meal before comparison. Show estimated versus measured quantities with plausible ranges, solver residuals, and non-unique or infeasible flags. Show the source and quality of each derived nutrient. Quantities stay editable, and edits recalculate without AI.

### Nutrition and database screens

Display core totals, a fat breakout, carbohydrate/fiber detail, vitamins/minerals, and evidence coverage. Keep expanded detail collapsed by default on mobile. Give each nutrient a measured/reported/estimated/unknown status and access to sources. Alias, variant, revision, source-refresh, and affected-recipe management lives in the Ingredient Library tab.

Display only relevant comparison targets. Do not create minimum targets for trans fat, saturated fat, or every newly added field simply because existing registry groups contain daily floors. Preserve existing energy, banking, and true-up behavior.

## AI, offline, and shared-module boundaries

### AI boundary

The website performs every calculation without AI. Models never compute totals, scale portions, match confirmed IDs, or alter known facts.

1. **The external assistant is the interpreter.** Photos, recipes, labels, and descriptions are interpreted outside the site and arrive as a validated ingredient list ([contracts](assistant-contracts.md)). The site has no required OCR or vision step. Its only AI touchpoints are the research packet (default) and the optional direct route.
2. **Research packets (default, cost-free).** For identities or fields left unresolved by official sources, #62 builds a text-only research request with a unique request ID and digest. James sends it to assistants on subscriptions he already pays for, or to ChatGPT project instructions, and pastes the response back. The response must echo the ID and digest. Stale responses are rejected: the request expired or was cancelled, was already answered, or a target's profile revision or the registry version changed after it was issued. Packets are size-bounded, batched, and chunked. No metered site API call is required.
3. **Optional direct provider route (#71, deferred).** Provider-agnostic, off by default, feature-flagged, $0 budget cap until James explicitly raises it, same request/response schemas, a durable server-side budget reservation before every call, and signed-in non-anonymous users only (reject `signInAnonymously` guests). Keys stay in server configuration. It is never a prerequisite for the primary flow.
4. **Strict schemas and citation verification.** Requests ask for strict JSON-schema output; invalid or freeform nutrition text is rejected rather than parsed. Assistant-sourced values start unverified; curated revisions require verified sources, private revisions may be approved on reviewer attestation and stay labeled. Results enter the same review as any other research before a profile revision is saved. See [research response v1](assistant-contracts.md#research-response-v1).

### Offline-capable calculation

A versioned local cache (#61) holds the profile revisions and conversions a user has used or approved. Matching, aggregation, scaling, and quantity fitting run offline from it. Entries are keyed by namespace/catalog plus profile ID and revision, bounded, revalidated on reconnect, scoped to the signed-in owner, and cleared on sign-out. A missing or stale entry is reported as such, never treated as zero. Saves made offline are queued or fail visibly; success is reported only after commit. This cache is separate from the existing service-worker app-shell cache.

### Shared modules

The tracker and Recipe Standardizer use one nutrient registry (#60), one set of ingredient identities, profiles, and conversions (#61), one research-job workflow (#62), one calculation and solver module (#64, #65), and shared resolution/review components (#66). One research pipeline serves bulk population, Ingredient Library research, and missing-ingredient research, and one calculation module serves both tools. Neither tool keeps its own copy of these data models or research flows. Recipe Standardizer P7 enrichment routes to #62 (research packets), #67 (import), and #70 (workspace) rather than a second implementation.

## ChatGPT and import compatibility

The legacy paste parser remains supported, but structured ingredient-level data is the primary future interface. The canonical bridge to ChatGPT project instructions and other assistants is ingredient-list import plus research request/response ([assistant contracts](assistant-contracts.md)); the 24-field block is the fallback. The project's current installed instructions cover full ingredient estimation, source hierarchy, scaling, hidden ingredients, weighted fiber, FODMAP equivalents, adjusted carbs, and the fixed 24-field copy format. The updated chat workflow should apply the database-first and evidence rules above without pretending a connector can access the live Firebase database.

The #60 registry and readers are in the tree. v2 food and day writes stay off (`NUTRIENT_V2_WRITES_ENABLED` is false). #64 Part A calculation and #65 fitting are implemented; #64 Part B meal saving is not. The [requirements review](REQUIREMENTS_REVIEW_2026-11-09.md) records what is implemented versus deployed:

- The 24-field paste block still parses. Anchored subtype labels fill the staged record and do not overwrite parent totals. While storage is v1, those detail values are not written.
- Preserve the legacy copy block's historical fiber meaning and disclose the distinction next to it. Classify it only as `total`, `weighted_legacy`, or `unknown`, and only with evidence. Use standard total fiber in the additional details.
- Do not emit expanded v2 JSON to a caller that is still on storage v1 and expect nulls to be stored. Null legacy keys are review-only until the flag is on. Do not erase missing values to satisfy a numeric-only contract.
- If any legacy core nutrient is genuinely unknown, present a review-only result or a supported explicit estimate, not an import-ready block claiming to preserve unknowns. An `unknown` string is not a safe v1 persistence mechanism.
- Once Settings shows storage v2, use exact registry labels and the expanded contract. Carry unknowns, evidence, and versioned ingredient references through import.
- Use an authorized database connector or supplied export when available. If neither is available, state that reuse/save could not be verified. Offer batched research or an import-ready result without claiming it reached the website.

The website is the durable home for ingredient data. A chat response, generated file, or GitHub code change does not itself save a user's meal to Firestore.

## Sources

- **S1:** [USDA FoodData Central Foundation Foods documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/): data definitions, energy, fatty acids, limits of quantification, and portion scaling.
- **S2:** [FDA dietary fiber questions and answers](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/questions-and-answers-dietary-fiber): standard dietary-fiber definition and recognized isolated fibers.
- **S3:** [21 CFR 101.4](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.4): ingredient order, compound ingredients, and low-percentage exceptions. [21 CFR 101.9](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.9): label declarations and rounding.
- **S4:** [FDA allulose labeling guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-declaration-allulose-and-calories-allulose-nutrition-and-supplement-facts-labels): distinction among carbohydrate, sugars, and energy.
- **S5:** [NIH omega-3 fact sheet](https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/): separate ALA, EPA, and DHA identities.
- **S6:** [USDA nutrient retention factors, Release 6](https://www.ars.usda.gov/ARSUserFiles/80400530/pdf/retn06.pdf): method-specific nutrient retention.

Accessed 2026-11-05. Recheck current primary sources while implementing adapters. These sources support data definitions; the custom weighted-fiber and adjusted-carb settings are explicit project conventions.
