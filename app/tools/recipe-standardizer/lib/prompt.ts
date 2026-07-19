/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * The copyable ChatGPT conversion prompt. The website never calls an AI API —
 * the user pastes this prompt plus their recipe into ChatGPT manually, then
 * pastes the strict-JSON result back into the Import panel.
 *
 * Keep the JSON shape in sync with lib/types.ts and lib/schema.ts. The shape
 * deliberately omits `shoppingList` (always derived from ingredients),
 * `nutritionLink` (the importer initializes it), and `equipment` arrays
 * (generic equipment inventories are noise — a prep group's `destination`
 * carries the useful part). Technique help is site-owned (lib/techniques.ts):
 * recipes emit ids from the supported list instead of repeating explanations.
 */
export const CHATGPT_CONVERSION_PROMPT = `Convert the recipe I provide into strict JSON for my Recipe Standardizer tool.

Output one valid JSON object only — no markdown, commentary, or text outside it.

Model:
- Grams are primary; common secondary measures (cups, tbsp, pieces) go in "equivalent". Estimate missing grams and "estimatedFinalWeightG" when reasonable; flag uncertainty in "notes". No nutrition, no shopping list.
- A prep group is a NAMED INPUT that exists before an execution step and can wait until first use: ingredients measured into one container ("crust ingredients in mixer bowl"); washing/peeling/chopping/zesting/juicing; a strained infusion for later use; gelatin bloomed just before dissolving; chocolate melted just before brushing.
- NOT prep: actions that create or transform the dish — mixing, creaming, folding, cooking, pressing, filling, baking. Those are execution steps ("activeSteps"). "Let the mixer break down the cereal" is execution, never a prep note.
- Steps consume named things: list consumed prep groups in "usesPrepGroupIds" and prior results in "usesResultIds". When a later step needs a step's product, set "result" to {"id","name"} with a stable id and short name ("crust mixture"). Step text says "Mix the crust ingredients in the mixer bowl" or "Transfer the crust mixture" — never re-list ingredients in prose. Still fill "ingredientRefs" accurately (the tool builds verify lists from ids).

Each prep group:
- "timing.when": "start" | "during-wait" (+ "waitEntryId": a wait timeline entry id) | "after-section" (+ "sectionId") | "just-in-time" (+ "beforeStepId": the step it immediately precedes). Put realistic work inside waits; use just-in-time for anything that must not sit (melted chocolate, bloomed gelatin, freshly whipped dairy).
- "firstUseStepId": the exact first consuming step.
- "holdNote": how to hold until use — required for perishable/temperature-sensitive groups ("keep refrigerated until the tea base is almost ready").
- "destination" only when it says where staged ingredients go ("mixer bowl"). Never produce equipment inventories.

Timeline (one recommended path):
- Kinds "prep"|"execution"|"wait"|"serve"; relative "phaseLabel" ("Day before", "While the tart thaws") — never invented clock times or durations.
- Typed "references" drive each entry's title; use "titleOverride" only when no referenced name fits.
- "activeTime" = hands-on work; "passiveTime" = waiting/elapsed — keep them separate.
- Work done during a wait sets "duringEntryId" to that wait's id.
- Alternate paths (refrigerator vs room-temperature thaw) go in "alternatives"; the recommended path stays primary.

Techniques: where one materially affects success, put its id on the group/step where it first matters, ONLY from: bloom-powdered-gelatin, bloom-sheet-gelatin, fold, medium-soft-peaks, stiff-peaks, emulsify, temper-eggs, water-bath, blind-bake, ribbon-stage. The tool owns the explanations; add a "techniqueOverrides" {"id","name","help"} entry only for unusual source-mandated handling. Distinguish powdered vs sheet gelatin when stated; when the source or a package determines an amount, say so — never invent values.

Fidelity: preserve every source ingredient, quantity, order dependency, waiting period, and make-ahead instruction. Sections = one component each (crust, filling, assembly); record order needs in "dependsOn". Every ingredient: clean "displayName" (prep details in "prepNote"), correct "sectionIds"/"primarySectionId", a common-store "groceryCategory" (Produce, Dairy, Baking, Pantry…).

Use exactly this shape — no extra fields; every id unique; every reference must match a declared id:

{
 "schemaVersion":2,
 "name":"",
 "source":{"type":"","url":"","notes":""},
 "servings":{"baselineServings":null,"portionCount":null,"portionSizeG":null},
 "yield":{"estimatedFinalWeightG":null,"yieldNotes":""},
 "sections":[{"id":"","name":"","type":"prep|execution|combined","purpose":"","order":1,"dependsOn":[],"notes":""}],
 "ingredients":[{"id":"","displayName":"","quantityG":null,"equivalent":"","prepNote":"","sectionIds":[],"primarySectionId":"","groceryCategory":"","optional":false,"substitutionNotes":"","conversionNotes":""}],
 "prepGroups":[{"id":"","name":"","ingredientIds":[],"destination":"","instruction":"","timing":{"when":"start","note":""},"firstUseStepId":"","holdNote":"","details":"","techniqueIds":[]}],
 "prepSteps":[],
 "activeSteps":[{"id":"","sectionId":"","text":"","ingredientRefs":[],"timing":"","temperature":"","visualCue":"","dependencyNote":"","order":1,"usesPrepGroupIds":[],"usesResultIds":[],"result":null,"techniqueIds":[]}],
 "timeline":[{"id":"","kind":"prep|execution|wait|serve","phaseLabel":"","references":[{"kind":"section|step|prepGroup","id":""}],"titleOverride":"","activeTime":"","passiveTime":"","duringEntryId":"","alternatives":[{"label":"","activeTime":"","passiveTime":"","note":""}],"order":1}],
 "techniqueOverrides":[],
 "notes":[]
}

Final audit — do internally; output only the JSON:
1. Reconstruct the recipe from first prep through serving using your JSON alone.
2. Every prep group has a correct firstUseStepId and a consuming step.
3. No execution transformation is labeled prep.
4. Perishable or temperature-sensitive groups have suitable holdNote values.
5. Just-in-time items are not staged earlier than needed.
6. Every step references its prep groups or prior results where applicable.
7. Section dependencies are acyclic and chronologically valid.
8. The timeline overlaps work with passive waits sensibly.
9. Every ingredient, quantity, and required method matches the source.
10. Output is one valid JSON object with nothing outside it.

Now convert the following recipe:
[PASTE RECIPE HERE]`;
