export function fromRecipeStandardizerRecipe(recipe: any, meta?: any): { ok: boolean; draft?: any; errors?: any[]; warnings?: any[] };
export function fromSavedMeal(entry: any): { ok: boolean; draft?: any; errors?: any[]; warnings?: any[] };
export function fromSavedRecipe(doc: any): { ok: boolean; draft?: any; errors?: any[]; warnings?: any[] };
export function fromLegacyPaste(text: string, options?: { name?: string; quantity?: number }): { ok: boolean; draft?: any; errors?: any[]; warnings?: any[] };
