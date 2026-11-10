export function libraryCapabilities(): Readonly<{ affectedMeals: false; curatedWrites: false; privateWrites: boolean; directAi: false }>;
export function searchLibrary(input?: { query?: string; sources?: any[]; pageSize?: number; cursor?: any }): Promise<any>;
export function reviewLibraryProfile(input?: any): any;
export function filterLibraryGaps(rows?: any[], kind?: string): any[];

/** A manual or label value: a number, or an object with its evidence. */
export type LibraryPatchField = number | null | {
    value: number | null;
    status?: string;
    unit?: string;
    qualifier?: string;
    roundingInterval?: number;
    upperBound?: number;
    range?: { min: number; max: number };
    /** Maps to provenance.range ({min,max}) and quality upperBound/roundingInterval only. */
    uncertainty?: { min?: number; max?: number; upperBound?: number; roundingInterval?: number };
    confidence?: number;
    comparator?: string | Record<string, unknown>;
    derivation?: string;
    sourceNutrientId?: string;
    source?: LibrarySource;
};
export interface LibrarySource {
    type: string;
    datasetId?: string; recordId?: string; title?: string; url?: string; version?: string;
    publishedAt?: string; accessedAt?: string; originalBasis?: string; permittedUse?: string; checksum?: string;
}
export interface LibraryPatch {
    nutrients?: Record<string, LibraryPatchField>;
    source?: LibrarySource | null;
    /** An applied #73 research item: nutrients tagged with requestId plus researchEvidence. */
    research?: any;
}
export interface StagedLibraryEdit {
    ok: true; writes: false; staged: true; committed: false; readyForSave: false; diaryUntouched: true;
    draft: {
        ownerUid: string; baseRevision: number | null; baseRevisionId: string | null; baseContentHash: string | null;
        nextRevision: number; pendingNutrients: Record<string, LibraryPatchField>; pendingSource: LibrarySource | null; pendingResearch: any;
    };
}
export interface LibraryRefusal { ok: false; error: string; writes: false; diaryUntouched: true; [key: string]: unknown }
export function stageLibraryEdit(input?: { scope?: string; ownerUid?: string; viewerUid?: string; base?: any; patch?: LibraryPatch }): StagedLibraryEdit | LibraryRefusal;

export interface LibraryCreate {
    identity: { canonicalName: string; category: string; kind: string; aliases?: any[] };
    variant: { dims?: any; overrides?: { catalogId: string; variantId: string; revision?: number } | null };
    basis?: { kind: 'per_100g_edible'; state: string };
    basedOn?: any;
    identityId?: string;
    confirmNew?: boolean;
}
export interface Unrepresented { field: string; reason: string; value?: unknown }
export type LibraryDraftResult =
    | { ok: true; readyForSave: true; writes: false; committed: false; diaryUntouched: true; draft: any; patchedFields: string[]; unrepresented: Unrepresented[] }
    | { ok: false; error: string; readyForSave: false; writes: false; diaryUntouched: true; errors?: string[]; unrepresented?: Unrepresented[] };
export function buildLibraryDraft(input?: { staged?: any; base?: any; create?: LibraryCreate | null }): Promise<LibraryDraftResult>;

export type LibraryCommitResult =
    | { ok: true; committed: true; writes: true; ref: any; diaryUntouched: true; patchedFields: string[]; unrepresented: Unrepresented[] }
    | { ok: false; error: string; writes: boolean; committed: false; diaryUntouched: true; retained?: boolean; staged?: any; draft?: any; errors?: string[]; unrepresented?: Unrepresented[]; message?: string };
/** Synchronous writes_disabled result while the store flag is off; otherwise a promise. */
export function commitLibraryEdit(input?: { store?: any; staged?: any; base?: any; create?: LibraryCreate | null; scope?: string }): LibraryCommitResult | Promise<LibraryCommitResult>;

export function researchLibraryFields(input?: {
    lineId?: string | null; name?: string; missingFields?: string[]; revisionsByLine?: Record<string, any>;
    revision?: any; ref?: any; ownerUid?: string | null; namespace?: string | null;
}): Promise<any>;
