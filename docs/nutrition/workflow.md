# Nutrition workflow and data contract

Status: target design for CalorieTracker #59 onward. Current behavior is recorded in [README](README.md). Implementation tasks and their release gates live in [the active backlog](../../backlogs/calorie-tracker.md).

The Nutrition Tracker is the target primary analysis interface: it extracts meal evidence, matches ingredients, resolves gaps, fits quantities, and saves reusable compositions itself. Importing a completed ChatGPT estimate remains supported as a secondary path.

## Contents

1. [Staged meal analysis](#staged-meal-analysis)
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

The tracker's meal-analysis workspace (#70) runs these stages in order. Each stage is resumable from a draft and records whether its output is deterministic, user-entered, or model-assisted.

| Stage | Behavior | Owner |
| --- | --- | --- |
| 1. Extract evidence | Accept a photo, nutrition label, ingredient list, recipe, barcode, free text, saved meal, or legacy paste. Use deterministic parsers and on-device OCR first. If AI vision is needed, default to a cost-free assistant request packet (copyable JSON + images) and schema-validated import; optional paid OpenAI route stays off. Show extracted facts for correction. | #67 |
| 2. Match | Match identities/forms against cached, private, and curated profiles with exact variant compatibility. | #61 |
| 3. Resolve gaps | List missing and ambiguous items together. Per item: choose existing, enter manually, research through official sources, research with AI via assistant packet (default) or optional paid route, save an incomplete draft, or cancel. | #66 (choices), #62 (research jobs), #67 (AI packets) |
| 4. Recalculate | Recalculate automatically through the shared module once records are resolved, without repeating finished research. | #64, #66 |
| 5. Fit quantities | Run the deterministic constrained solver from label calories, macros, sodium, fiber, serving weights, ingredient order, preparation states, and plausible ratios. Respect rounding and uncertainty; never change known facts; flag non-unique or infeasible fits. | #65 |
| 6. Review | Show label-versus-calculated differences, estimated quantities with ranges, and the quality and source of derived nutrition. | #66 |
| 7. Save and reuse | Save composition, quantities, profile revisions, and the complete snapshot; reuse saved meals as future inputs. | #64 |

When the input already contains sufficient structured information, every stage runs with zero model calls. The Ingredient Library tab (#69) manages the profiles these stages use.

## Input and reuse flow

Accept a saved meal, structured recipe, ingredient list, nutrition label, barcode, free text, legacy paste, or photograph. Keep the original evidence and user corrections separate from inferred data. The steps below describe the analysis logic behind the stages above.

1. Identify the meal and meaningful ingredients. Include consequential cooking fat, dairy, sauce, breading, sugar, broth, onion, and garlic. Preserve compound ingredients and nested label order.
2. Estimate ingredient amounts and the total edible quantity. Prefer measured weights and explicit recipes; use serving size, visible count/volume, comparable recipes, and restaurant patterns when needed. Label inferred quantities. A hand, if visible, can use the existing project's 6.5-inch palm-base-to-middle-fingertip assumption, explicitly as a scale assumption.
3. Match identities and forms to the local ingredient index, approved user profiles, and curated source profiles. Reuse profiles before any external research. Search aliases, but distinguish raw/cooked, dry/hydrated, drained/undrained, fat percentage, fortification, salt, and brand formulation.
4. Show missing profiles and ambiguous matches together. A profile can exist while particular nutrients remain unknown. Missing-profile and missing-nutrient lists must be distinct.
5. Resolve missing items through the user's selected action. External research is limited to the selected missing identities or fields. Cache approved results.
6. Apply known quantities, ingredient order, meal facts, yield, and plausible recipe ratios as constraints. Fit only quantities and explicitly permitted preparation assumptions, never canonical ingredient nutrient values.
7. Calculate totals, retain source-reported meal facts, and show estimated ingredients, coverage, assumptions, and unresolved discrepancies.
8. On Save, persist the meal's ingredient list, exact profile revisions, quantities, constraints, known facts, and nutrition snapshot. Create missing approved ingredient profiles once. Reuse existing IDs across meals.

Photo interpretation can still require AI or user correction. A saved recipe with resolved ingredients, a portion change, or an approved structured import must use zero model calls for matching confirmed IDs, scaling, aggregation, and saving. After any missing record is resolved, recalculate the meal from step 6 onward.

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

Historical `fiber` values are ambiguous because the chat workflow used weighted fiber while other tracker imports could use standard fiber. Preserve the original value and mark its meaning `total`, `weighted`, or `unknown` only when evidence supports the classification. Never silently rewrite history or infer the classification solely from the field name. New standard-fiber targets must not be applied to the custom metric.

### Nutrient quality

Every nutrient observation carries:

- Numeric value or `null`, unit, and per-100-g edible basis.
- Status: `measured`, `label_reported`, `calculated`, `estimated_from_comparable`, `below_quantification_limit`, `unknown`, or `not_applicable`.
- Source reference, source nutrient definition/ID, retrieval and publication/version dates when available.
- Derivation and comparator ID/revision for estimates; confidence and a defensible range where useful.
- Rounding interval, detection/quantification limit, or qualifier when supplied.

Zero requires supporting evidence. Label-rounded zero is a label observation, not proof of chemical absence. USDA can return value zero alongside a nonzero limit-of-quantification field [S1]. Unknowns remain null all the way through import, calculations, storage, export, and charts.

Assess coverage per nutrient as well as per ingredient and gram. When inputs are estimated, use an estimate marker. Use a lower-bound indicator only when the included values and omitted nonnegative contributions justify it. "All ingredients linked" does not mean "all micronutrients known."

## Ingredient and meal records

### Ingredient identity and profile

Use a stable ID independent of a display name. A family such as ground beef has separate variants for material differences. Keep aliases for search, not for automatic equivalence.

The current recipe fuzzy matcher treats words such as raw, cooked, dried, salted, and unsalted as noise. It can remain a candidate suggester, but must not become the canonical automatic resolver. Require exact variant compatibility for automatic reuse. Add indexed lookup, pagination, and bounded local caches; do not load the entire expanded catalog every time either tool opens.

Version fingerprints explicitly. The existing fingerprint includes the ordered 24 nutrient keys, so simply adding keys changes old hashes. Keep a v1 verifier for stored confirmed links and export references, and introduce a v2 fingerprint/version together. Reconfirmation, if required, must be visible and deliberate. A legacy reference must never be silently trusted or invalidated merely because the supported nutrient dictionary grew.

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

Preserve the existing namespace contract/constants and honor the separate F-141 migration plan. Current `namespaces.ts` exports pinned constants, not a dual-read resolver. Any resolver is explicit future work. Do not change `default-app-id` as an incidental part of this feature. References must record namespace/catalog plus profile ID and revision. Final Firestore paths and enforcement belong to #61; no new persistence is enabled by this document.

### Meal or recipe version

Store:

- Stable recipe/meal ID and revision, title, preparation state, original input references, and evidence reliability.
- Ingredient lines with profile ID/revision, quantity in grams, state, optional range, whether measured/inferred, constraint group, and source of the estimate.
- Compound-ingredient links or subrecipe versions, with cycle protection. Count either the complete compound profile or its children in a calculation, never both.
- Measured/estimated final edible batch weight, servings/portions, yield, retained/discarded water/fat and retention assumptions.
- Known meal facts, their serving basis, source, and tolerances. Keep these separate from component-derived totals.
- Calculation version, chosen scenario, deviations, alternative plausible quantity ranges, per-nutrient coverage, and resulting nutrition snapshot.
- A frozen saved snapshot and the referenced versions. Opening an old diary entry must not silently apply new ingredient data.

Editing a profile produces a new revision. A recipe may show "new ingredient data available" and offer explicit recalculation. Past logged meals remain reproducible unless the user deliberately updates them. Deleting an ingredient cannot erase the evidence needed by existing snapshots.

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
4. Photo count/size/volume, meal mass estimates, published comparable recipes, and restaurant preparation patterns.
5. Clearly recorded priors where evidence leaves several plausible recipes.

Known quantities constrain weights. Known nutrients constrain the aggregate on the matching serving and cooking basis. Unreported nutrients are absent constraints, never zero targets.

### Fit specification

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

For an ingredient amount `q` grams with a profile per 100 g, nutrient contribution is `q / 100 × profile value`. Missing profile values contribute unknown coverage, not measured zero. Scale ingredient contributions before summing. Keep full internal precision and round only at the display/export boundary.

Use source energy as its own observation. A 4/4/9 macro estimate is a diagnostic, not an unconditional equality: source methods, fiber, polyols, allulose, alcohol, and organic acids can affect the relationship [S1, S4]. Do not add fat, fatty-acid, sugar, or fiber subfields to their parent totals. Fatty-acid sums need not equal total lipid exactly [S1].

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

One entry point in the tracker's meal-analysis workspace (#70) accepts photo, label, recipe, ingredient list, barcode, free text, saved meal, or legacy paste. Show the parsed item and serving basis before final save. A user can correct an identity or quantity without rerunning research for already resolved profiles.

### Ingredient Library tab

A dedicated tracker tab (#69) manages the shared ingredient profiles:

- **Search:** indexed, paginated, alias- and variant-aware; works offline over cached profiles.
- **Add and edit:** private profiles and overrides, saved as new revisions with source and basis. Curated records are never edited in place.
- **Review:** identity, variants, per-field status and provenance, missing nutrient fields, unit conversions, and revision history. Missing fields and missing conversions are separately filterable. An affected recipes/meals view is capability-gated until #64 exposes ingredient-graph references; do not require it in the #69 ship.
- **Import:** label facts, manual measurements, or a reviewed research result.
- **Research:** selected ingredients or selected missing fields through official sources (#62 jobs) first; AI help (once #67 ships) only after a recorded official-source attempt leaves gaps, or via an explicit override. Default AI is the cost-free assistant-packet export/import; the optional paid route stays off. Results stay staged until reviewed, and model citations require evidence verification before approval.

Recipe Standardizer opens the same views from its link editor rather than maintaining a second editor.

### Ingredients and review

Show an editable list: ingredient, exact form, grams, measured/estimated badge, matched profile, source, and missing-field status. Expand a row for nutrient evidence and variants. Provide switches for meal total, serving, portion, and per-100-g edible/cooked basis.

### Missing-data dialog

List all missing/ambiguous ingredients and fields in one review. Offer:

- **Choose existing:** search verified variants and user overrides; explicit substitute selection is recorded as an estimate.
- **Look up selected:** run official-source lookup (#62) for the selected identities or fields. Show progress, result quality, and a review step before persistence. Reuse any approved records if another tab populated them first.
- **Research with AI:** available after a recorded official-source attempt left the selected identity or fields unresolved (or an explicit user override of that gate). **Default:** export a structured assistant request packet (JSON + needed images) for James's already-paid bots or ChatGPT project instructions, then import the schema-validated JSON result. **Optional:** the feature-flagged paid OpenAI route (off by default, $0 cap) may send the same packet schemas when explicitly enabled. Cited sources must be evidence-verified before approval; unverified model output is ineligible for a profile revision.
- **Enter manually:** add a label or measured facts with source and basis.
- **Save incomplete draft:** retain the recipe and unknowns, clearly excluded from claims of complete nutrition.
- **Cancel:** return without committing the meal. Do not launch research or charge an AI request.

A failed lookup leaves the ingredient unresolved with an actionable reason. Never silently drop an ingredient, assume an unknown nutrient is zero, or call a model without the chosen research action. Research cancellation must stop pending work where possible and report any already-created approved records accurately. Once items are resolved, recalculate automatically and return to quantity fitting and review.

### Estimate review

Next to each known label fact, show the calculated value and the difference, with its rounding interval. Show estimated versus measured quantities with plausible ranges, solver residuals, and non-unique or infeasible flags. Show the source and quality of each derived nutrient. Quantities stay editable, and edits recalculate without AI.

### Nutrition and database screens

Display core totals, a fat breakout, carbohydrate/fiber detail, vitamins/minerals, and evidence coverage. Keep expanded detail collapsed by default on mobile. Give each nutrient a measured/reported/estimated/unknown status and access to sources. Alias, variant, revision, source-refresh, and affected-recipe management lives in the Ingredient Library tab.

Display only relevant comparison targets. Do not create minimum targets for trans fat, saturated fat, or every newly added field simply because existing registry groups contain daily floors. Preserve existing energy, banking, and true-up behavior.

## AI, offline, and shared-module boundaries

### AI boundary

The website performs every calculation without AI whenever sufficient structured information is available. Models never compute totals, scale portions, match confirmed IDs, or alter known facts. They may help with image interpretation, difficult ingredient identification, or research left unresolved by official sources.

- **Default (cost-free):** for those model-assisted steps, the site builds a structured **assistant request packet**—copyable JSON plus the needed images, with a unique request ID/digest—and imports a matching JSON result validated against a strict schema that must echo that ID plus purpose, schema version, and selected targets (reject stale/cross-draft responses). James sends the packet to assistant bots that already run on subscriptions he pays for (Claude/Codex/ChatGPT) or to ChatGPT project instructions, then returns the result—the same screenshot-and-return flow. No metered site API call is required. Packets are size-bounded and chunked so assistants can return complete JSON.
- **Optional paid route:** an authenticated server-side OpenAI route (#67) may implement the same schemas later. It is **off by default**, feature-flagged, and capped at **$0** spend until James explicitly enables it and raises the cap. If enabled, it verifies a **non-anonymous** Firebase user (reject anonymous/`signInAnonymously` guests), keeps keys in server configuration only, applies abuse-resistant rate/cost bounds (per verified account plus global/IP or App Check quota), and enforces the spend cap via durable server-side budget reservation before each call.
- Requests (packet or paid) ask for strict JSON-schema output. Invalid or freeform nutrition text is rejected rather than parsed. Cited sources must be retrieved or otherwise evidence-verified before approval; a citation-shaped field alone does not qualify. Unverified model output stays marked unverified and ineligible for a profile revision. Verified results enter the same review as any other research before a profile revision is saved.
- Model-assisted results are labeled as such in provenance and quality. Deterministic calculation remains the primary path.

### Offline-capable calculation

A versioned local cache (#61) holds the profile revisions and conversions a user has used or approved. Matching, aggregation, scaling, and quantity fitting run offline from it. Entries are keyed by namespace/catalog plus profile ID and revision, bounded, revalidated on reconnect, scoped to the signed-in owner, and cleared on sign-out. A missing or stale entry is reported as such, never treated as zero. Saves made offline are queued or fail visibly; success is reported only after commit. This cache is separate from the existing service-worker app-shell cache.

### Shared modules

The tracker and Recipe Standardizer use one nutrient registry (#60), one set of ingredient identities, profiles, and conversions (#61), one research-job workflow (#62), one calculation and solver module (#64, #65), and shared resolution/review components (#66). Neither tool keeps its own copy of these data models or research flows. Recipe Standardizer P7 enrichment routes to #67 rather than a second implementation.

## ChatGPT and import compatibility

The legacy paste parser remains supported, but structured ingredient-level data is the primary future interface. The structured assistant request/response packets (#67) are the preferred bridge to ChatGPT project instructions and other assistants; freeform paste is the fallback. The project's current installed instructions cover full ingredient estimation, source hierarchy, scaling, hidden ingredients, weighted fiber, FODMAP equivalents, adjusted carbs, and the fixed 24-field copy format. The updated chat workflow should apply the database-first and evidence rules above without pretending a connector can access the live Firebase database.

Until #60 and #64 ship and the target capability is verified:

- Keep the existing 24-field tracker copy/import path intact. Display newly requested fat/fiber/sugar detail separately; do not paste unsupported subtype lines into the current parser.
- Preserve the legacy copy block's historical fiber meaning and disclose the distinction next to it. Use standard total fiber in the additional details.
- Do not emit expanded v2 JSON to a v1-only `recipe-nutrition` importer. Do not erase missing values to satisfy its numeric-only contract; show the unsupported gap and use a draft/manual review instead.
- The legacy plain-text path also turns blank or nonnumeric fields into zero on save. If any legacy core nutrient is genuinely unknown, present a review-only result or a supported explicit estimate, not an import-ready block claiming to preserve unknowns. An `unknown` string is not a safe legacy persistence mechanism.
- Once the target declares v2 support, use exact registry labels and the expanded contract. Carry unknowns, evidence, and versioned ingredient references through import.
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
