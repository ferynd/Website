export const RESOLUTION_CAPABILITIES: Readonly<{ fitPanel: false; libraryDeepLink: false; directAiRoute: false }>;
/** Cooked grams of the counted lines, or null unless every counted line has a valid mass. */
export function cookedTotal(lines: any[]): number | null;
export function buildResolution(input?: { lines?: any[]; matches?: any[]; nutrientsByLine?: Record<string, any>; revisionsByLine?: Record<string, any>; servings?: number | null; totalGrams?: number | null }): any;
export function chooseExisting(state: any, lineId: string, choice: any): any;
/** Official-attempt outcomes. Only `resolved` and `not_found` mean a lookup ran. */
export const OFFICIAL_OUTCOMES: readonly ['resolved', 'not_found', 'not_performed'];
export const LIVE_SOURCES_DISABLED: string;
/**
 * Record one official attempt. `resolved`/`not_found` keep the consulted adapter and release
 * (default `curated` / `nutrition-curated@0`). `not_performed` records `{ adapter: 'none', release: null }`,
 * still opens the packet step, and leaves a resolved line resolved. Any other outcome returns `invalid_outcome`.
 */
export function lookupOfficial(state: any, lineId: string, attempt: { outcome: 'resolved' | 'not_found' | 'not_performed'; adapter?: string; release?: string; reason?: string; unresolvedFields?: string[]; nutrients?: any }): any;
export function researchPacket(state: any, lineIds: string[], options?: { override?: boolean; ownerUid?: string; namespace?: string }): Promise<any>;
export function manualEntry(state: any, lineId: string, nutrients: any): any;
export function saveIncomplete(state: any): any;
export function cancelResolution(state: any): any;
export function resolutionLines(state: any): any[];
export function recalculateResolution(state: any, options?: any): any;
export function reviewResolution(state: any, calculation: any, facts?: any[]): any;
