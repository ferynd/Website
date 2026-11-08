export function createImportDraft(list: unknown, source?: any): { ok: boolean; draft?: any; errors?: any[]; warnings?: any[] };
export function applyLineCorrection(draft: any, lineId: string, patch: any): { ok: boolean; draft?: any; errors?: any[] };
export function effectiveLine(draft: any, lineId: string): any;
