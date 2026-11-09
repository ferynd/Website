export function libraryCapabilities(): Readonly<{ affectedMeals: false; curatedWrites: false; privateWrites: boolean; directAi: false }>;
export function searchLibrary(input?: { query?: string; sources?: any[]; pageSize?: number; cursor?: any }): Promise<any>;
export function reviewLibraryProfile(input?: any): any;
export function filterLibraryGaps(rows?: any[], kind?: string): any[];
export function stageLibraryEdit(input?: any): any;
export function commitLibraryEdit(): any;
export function researchLibraryFields(input?: any): Promise<any>;
