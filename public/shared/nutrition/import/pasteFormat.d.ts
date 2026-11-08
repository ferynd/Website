export const PASTE_HEADER: string;
export function parseIngredientPaste(text: string): { ok: boolean; list?: any; errors?: any[]; warnings?: any[]; factUses?: any };
export function renderIngredientPaste(list: unknown): { ok: boolean; text?: string; reason?: string; fields?: string[]; errors?: any[]; warnings?: any[] };
