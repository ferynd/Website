/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * The copyable ChatGPT conversion prompt. The website never calls an AI API —
 * the user pastes this prompt plus their recipe into ChatGPT manually, then
 * pastes the strict-JSON result back into the Import panel.
 *
 * Keep the JSON shape here in sync with lib/types.ts and lib/schema.ts.
 * There is deliberately no `shoppingList` in the shape — the tool always
 * derives the shopping/grocery views from ingredients, so the prompt spends
 * the model's effort on accurate section/grocery/reference metadata instead.
 * (The importer still tolerates and ignores a pasted `shoppingList`.)
 */
export const CHATGPT_CONVERSION_PROMPT = `Convert the recipe I provide into strict JSON for my Recipe Standardizer tool.

Output valid JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Goal:
Reorganize the recipe into a workflow-first format that makes it easier to prep, stage, cook, and scale.

General rules:
- Use grams as the primary measurement wherever possible.
- Include common equivalent measurements as secondary display values, such as cups, tablespoons, teaspoons, pieces, cloves, etc.
- Preserve important source details, but reorganize the recipe for practical kitchen workflow.
- Estimate missing gram weights when reasonable and note uncertainty.
- Estimate final recipe yield weight in grams when possible and note uncertainty.
- Separate prep steps from active cooking/baking steps.
- Group ingredients and steps by actual kitchen workflow, not grocery category.
- Include ingredient IDs and reference those IDs in steps where useful.
- Flag assumptions, uncertain conversions, or missing details in notes.
- Do not calculate nutrition.
- Do not output a shopping list — the tool derives shopping and grocery views from the ingredients, so ingredient metadata must be accurate instead.

Ingredient metadata accuracy (important — the tool builds every view from these fields):
- Give each ingredient a clean, specific displayName (e.g. "unsalted butter", not "butter (unsalted, softened)") — put preparation details in prepNote instead.
- Set sectionIds to every section where the ingredient is actually used, and primarySectionId to the section where it is first measured or staged.
- Set groceryCategory on every ingredient using common store sections (e.g. Produce, Dairy, Meat, Baking, Pantry, Spices, Frozen).
- Write a useful prepNote whenever the ingredient needs preparation (softened, chopped, room temperature, divided, etc.).
- In every prep and active step, list the ids of the ingredients that step uses in ingredientRefs — the tool renders live quantities from these references.

Workflow grouping rules:
Use a hybrid prep + execution structure.

A workflow section is a group of ingredients and steps that belong together because they are:
- Measured into the same bowl/container
- Chopped, whisked, beaten, melted, cooked, chilled, or rested together
- Needed before another step can happen
- Added to the recipe at the same time
- Part of a distinct component, such as dough, sauce, filling, topping, glaze, marinade, dressing, garnish, or final assembly

Do not group ingredients only by broad ingredient type. For example, "Dry Mix" is useful only when those dry ingredients are actually combined together. "Wet Base" is useful only when those ingredients are actually mixed or staged together.

Preferred structure:
- Prep sections first
- Execution sections second

For each section, include:
- Section name
- Section purpose
- Ingredients used
- Prep steps
- Active/execution steps
- Equipment or container notes where useful
- Timing, temperature, texture, and visual cues where useful
- Dependency notes where useful, such as "do this early because it needs to chill"

Example sectioning for a cookie recipe:
Prep Mix-Ins:
- Chop chocolate and nuts.
- Chill while preparing dough.

Prep Dry Bowl:
- Measure dry ingredients into one bowl.
- Whisk and set aside.

Prep Wet Ingredients:
- Soften butter.
- Measure sugars into mixer bowl.
- Crack eggs separately.
- Measure vanilla.

Prep Baking Setup:
- Preheat oven.
- Line baking sheets.
- Prepare scoop or scale.

Make Wet Base:
- Cream butter and sugars.
- Add eggs and vanilla.

Build Dough:
- Add dry mix.
- Fold in chilled mix-ins.

Portion, Bake, and Finish:
- Portion dough.
- Bake.
- Cool.
- Store.

This example shows the intended organization, not the full level of detail. The actual output should include more specific prep methods, quantities, equipment, timing, visual cues, temperatures, and dependency notes when the source recipe supports them.

Use this JSON shape. Add fields if necessary, but keep it predictable. Every section id, ingredient id, and step id must be unique. Every sectionId, sectionIds entry, primarySectionId, dependsOn entry, and ingredientRefs entry must exactly match one of the declared ids:

{
  "schemaVersion": 1,
  "recipeId": null,
  "name": "",
  "source": {
    "type": "",
    "url": "",
    "notes": ""
  },
  "servings": {
    "baselineServings": null,
    "currentServings": null,
    "portionCount": null,
    "portionSizeG": null
  },
  "yield": {
    "estimatedFinalWeightG": null,
    "actualFinalWeightG": null,
    "yieldNotes": ""
  },
  "sections": [
    {
      "id": "",
      "name": "",
      "type": "prep|execution|combined",
      "purpose": "",
      "order": 1,
      "dependsOn": [],
      "equipment": [],
      "notes": ""
    }
  ],
  "ingredients": [
    {
      "id": "",
      "displayName": "",
      "quantityG": null,
      "equivalent": "",
      "prepNote": "",
      "sectionIds": [],
      "primarySectionId": "",
      "groceryCategory": "",
      "optional": false,
      "substitutionNotes": "",
      "conversionNotes": "",
      "nutritionLink": {
        "status": "unlinked",
        "foodItemId": null,
        "matchedName": null,
        "matchConfidence": null,
        "needsUserReview": true
      }
    }
  ],
  "prepSteps": [
    {
      "id": "",
      "sectionId": "",
      "text": "",
      "ingredientRefs": [],
      "equipment": [],
      "timing": "",
      "temperature": "",
      "visualCue": "",
      "dependencyNote": "",
      "order": 1
    }
  ],
  "activeSteps": [
    {
      "id": "",
      "sectionId": "",
      "text": "",
      "ingredientRefs": [],
      "equipment": [],
      "timing": "",
      "temperature": "",
      "visualCue": "",
      "dependencyNote": "",
      "order": 1
    }
  ],
  "notes": []
}

Now convert the following recipe:
[PASTE RECIPE HERE]`;
