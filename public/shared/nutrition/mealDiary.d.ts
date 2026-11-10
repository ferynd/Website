import type { MealRecord, MealRef } from './mealSnapshot';

export const DIARY_MEAL_SNAPSHOT_VERSION: 1;
export const NEW_DATA_NOTICE: string;

export interface DiaryMealSnapshot {
    readonly schemaVersion: 1;
    readonly mealRef: MealRef;
    readonly title: string;
    readonly servings: number | null;
    readonly cookedG: number | null;
    readonly calculationVersion: number | null;
    readonly nutrients: Readonly<Record<string, Readonly<{ value: number | null; low: number | null; high: number | null; status: string }>>>;
    readonly adjustedCarbs: any;
    readonly fodmapEquivalents: any;
    readonly pins: ReadonlyArray<Readonly<{ lineId: string; kind: 'ingredient' | 'meal'; variantId?: string; revision?: number; mealId?: string; version?: number; contentHash: string }>>;
}

export type MealPortion = { servings: number } | { grams: number } | { fraction: number };

/** A legacy v1 diary item (24 v1 numbers for the portion) plus the meal link and frozen snapshot. */
export interface DiaryMealEntry {
    id: string;
    name: string;
    quantity: 1;
    timestamp: string | null;
    [nutrient: string]: unknown;
    mealRef: MealRef;
    mealPortion: MealPortion & { fraction: number };
    mealSnapshot: DiaryMealSnapshot;
}

export type DiaryEntryResult =
    | { ok: true; entry: DiaryMealEntry; zeroFilled: string[]; modelCalls: 0; writes: false }
    | { ok: false; error: 'meal_not_saved' | 'id_required' | 'invalid_portion' | 'not_a_meal_entry'; modelCalls: 0; writes: false };

export function buildDiaryMealEntry(record: MealRecord, options?: { portion?: MealPortion; id?: string | null; timestamp?: string | null; name?: string | null }): DiaryEntryResult;
export function reportionDiaryMealEntry(entry: DiaryMealEntry, portion: MealPortion): DiaryEntryResult;
export function diaryDayHash(dayDoc: unknown): Promise<string>;
export function planDiaryMealAdd(dayDoc: Record<string, any> | null, entry: DiaryMealEntry, expectedDayHash: string): Promise<
    | { ok: true; day: Record<string, any>; dayHash: string; writes: false }
    | { ok: false; error: 'stale_day' | 'invalid_entry' | 'already_added'; writes: false }>;
export function readDiaryItem<T>(item: T): { kind: 'flat' | 'meal' | 'invalid_meal'; item: T; mealRef: MealRef | null };
export function checkMealEntryFreshness(entry: DiaryMealEntry, heads?: Map<string, number | { headRevision?: number; headVersion?: number }> | Record<string, number | { headRevision?: number; headVersion?: number }>): {
    newDataAvailable: boolean;
    behind: Array<{ lineId: string; kind: 'ingredient' | 'meal'; key: string; pinned: number; head: number }>;
    notice: string | null;
    modelCalls: 0;
    writes: false;
};
