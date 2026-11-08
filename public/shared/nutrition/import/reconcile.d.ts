export function reconcileImport(draft: any, ports?: {
    privateSearch?: (name: string) => Promise<any>;
    curatedSearch?: (name: string) => Promise<any>;
    lineRefs?: Record<string, any>;
    refDims?: Record<string, any>;
}): Promise<any>;
export function proposeConfirmedAlias(line: any, candidate: any): { ok: boolean; reason?: string; writes: false; proposal?: any };
export function confirmMatch(result: any, lineId: string, variantId: string, options?: { acknowledgeConflict?: boolean }): { ok: boolean; reason?: string; writes: false; result?: any };
