import type { IngredientProfileRef } from './ingredientRefs';

export const MEAL_RECORD_KIND: 'nutrition.mealRecord';
export const MEAL_SCHEMA_VERSION: 1;
export const MEAL_SNAPSHOT_VERSION: 1;
export const MEAL_EXPORT_KIND: 'nutrition.mealRecordExport';
export const MEAL_STORE_FIELDS: readonly string[];

export interface MealRef {
    refVersion: 1;
    kind: 'meal';
    namespace: string;
    mealId: string;
    version: number;
    versionId: string;
    contentHash: string;
}

export type MealLineProfile =
    | { kind: 'ingredient'; ref: IngredientProfileRef }
    | { kind: 'meal'; mealRef: MealRef };

export interface MealRecordLine {
    lineId: string;
    name: string;
    order: number | null;
    kind: string | null;
    parentLineId: string | null;
    /** False for a compound parent whose children are counted instead. */
    counted: boolean;
    profile: MealLineProfile | null;
    quantity: { g: number | null; unit: 'g'; basis: string | null; gMin: number | null; gMax: number | null; original: any };
    preparation: {
        yieldRetention: number | null; waterDeltaG: number | null; mealWater: boolean;
        fatAbsorbedG: number | null; fatDiscardedG: number | null; fatAbsorbedExternal: boolean | null;
    };
    fiber: { category: string | null; components: any[] | null };
    /** Per-100 g values the calculation used, with their status. */
    nutrients: Record<string, { value: number | null; status?: string; low?: number; high?: number; [key: string]: unknown }>;
    resolution: { kind: string | null; source: string | null; estimate: boolean; officialAttempts: any[]; researchEvidence: any[] };
    origin: { lineId: string; origin: string; sourceKind: string } | null;
}

export interface MealRecord {
    kind: 'nutrition.mealRecord';
    schemaVersion: 1;
    snapshotVersion: 1;
    ownerUid: string;
    mealId: string;
    title: string;
    meal: { kind: string | null; servings: number | null; yield: any };
    lines: MealRecordLine[];
    graph: { nestedMealIds: string[] };
    /** Stated facts with provenance. Never merged into `calculated`. */
    knownFacts: any[];
    /** The complete calculateMeal result frozen at review. */
    calculated: any;
    review: { comparisons: any[]; uncertainties: any[]; needsReview?: boolean };
    assumptions: {
        constraints: any[]; declaredCookedG: number | null; declaredRawG: number | null; mealWater: boolean;
        totalGrams: number | null; incomplete: boolean; research: Array<{ lineId: string; requestId: string; text: string }>;
    };
    fit: any | null;
    provenance: { source: any; origins: any[]; importSchemaVersion: number | null };
    versions: { snapshot: number; calculation: number; fit: number; fiberWeight: number; adjustedCarb: number; fodmapEquivalent: number };
    rebuiltFrom?: { mealId: string; version: number | null; contentHash: string };
    contentHash: string;
    idempotencyKey: string;
    /** Store fields, present on saved versions only. */
    namespace?: string;
    version?: number;
    versionId?: string;
    supersedes?: { version: number; versionId: string; contentHash: string } | null;
    createdAt?: unknown;
}

export interface MealBlocker { lineId: string; name: string; reason: 'missing_profile' | 'needs_confirmation' | 'unpinned_revision' | 'revision_mismatch' | 'unpinned_meal' | 'nested_meal_unavailable' }

export type BuildMealSnapshotResult =
    | { ok: true; record: MealRecord; writes: false; modelCalls: 0 }
    | { ok: false; error: string; writes: false; modelCalls: 0; blockers?: MealBlocker[]; errors?: string[]; mealId?: string };

export function mealIdFor(ownerUid: string, key: string): Promise<string>;
export function mealVersionIdFor(mealId: string, version: number): string;
export function parseMealRef(raw: unknown): MealRef | null;
export function mealRefOf(record: Partial<MealRecord> | null | undefined): MealRef | null;
export function mealContent(record: MealRecord): Omit<MealRecord, 'contentHash' | 'idempotencyKey' | 'namespace' | 'version' | 'versionId' | 'supersedes' | 'createdAt'>;
export function recalculateMealRecord(record: Pick<MealRecord, 'lines'>): { calculation: any; modelCalls: 0 };
export function mealNutrientsPer100g(record: MealRecord): Record<string, { value: number | null; low?: number | null; high?: number | null; status: string }> | null;
export function useSavedMealForLine(workspace: any, lineId: string, record: MealRecord): { ok: boolean; error?: string; workspace: any };
export function buildMealSnapshot(workspace: any, options?: { mealId?: string | null; title?: string | null; nestedMeals?: MealRecord[] }): Promise<BuildMealSnapshotResult>;
export function verifyMealRecord(record: unknown): Promise<string[]>;
export function exportMealRecord(record: MealRecord): string;
export function importMealRecord(json: string | object): Promise<{ ok: true; record: MealRecord; writes: false } | { ok: false; error: string; errors?: string[]; writes: false }>;
export function referencesForIngredient(records: MealRecord[], ref: Partial<IngredientProfileRef> & { variantId: string }): Array<{
    mealId: string; version: number | null; versionId: string | null; contentHash: string; title: string;
    lines: Array<{ lineId: string; grams: number | null; revision: number }>;
}>;
export function rebuildMealRecord(record: MealRecord, options?: { revisions?: Record<string, { ref: IngredientProfileRef; revision: any }> }): Promise<
    | { ok: true; record: MealRecord; modelCalls: 0; writes: false }
    | { ok: false; error: string; lineId?: string; modelCalls: 0 }>;
