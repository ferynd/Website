import type { IngredientFirestorePort } from './ingredientPort';
import { RevisionConflictError } from './ingredientStore';
import type { MealBlocker, MealRecord, MealRef } from './mealSnapshot';

export const MEAL_COLLECTIONS: Readonly<{ meals: 'mealRecords'; versions: 'mealRecordVersions' }>;
export class MealVersionConflictError extends RevisionConflictError {
}

export interface MealPendingSave {
    idempotencyKey: string;
    operation: 'saveMealVersion';
    payload: { record: MealRecord; baseVersion: number | null };
    createdAt: number;
}
export interface MealOutbox {
    putPendingSave(save: MealPendingSave): Promise<unknown>;
    deletePendingSave(key: string): Promise<unknown>;
    listPendingSaves(): Promise<any[]>;
}
export interface SavedMealVersion { mealRef: MealRef; deduped: boolean }

export function createMealStore(options: {
    port: IngredientFirestorePort;
    namespace: string;
    ownerUid: string;
    cache?: MealOutbox;
    now?: () => number;
}): {
    saveMealVersion(record: MealRecord, options?: { baseVersion?: number | null }): Promise<SavedMealVersion>;
    getMealVersion(ref: MealRef): Promise<{ status: 'fresh'; ref: MealRef; record: MealRecord } | { status: 'missing' | 'corrupt'; ref: MealRef }>;
    getMealHead(mealId: string): Promise<Record<string, any> | null>;
    listPendingSaves(): Promise<MealPendingSave[]>;
    retirePendingSave(key: string): Promise<void>;
    retryPendingSave(key: string, replacement?: { record: MealRecord; baseVersion?: number | null }): Promise<SavedMealVersion>;
};
export type MealStore = ReturnType<typeof createMealStore>;

export type CommitWorkspaceMealResult =
    | { ok: true; committed: true; writes: boolean; deduped: boolean; logged: false; modelCalls: 0; mealRef: MealRef; workspace: any }
    | { ok: false; error: string; committed: false; logged: false; writes: false; modelCalls: 0; blockers?: MealBlocker[]; errors?: string[]; retained?: boolean; record?: MealRecord; message?: string };

/** Returns saveWorkspace(workspace) synchronously while save is off; otherwise a promise. */
export function commitWorkspaceMeal(input?: {
    store?: MealStore | null; workspace?: any; baseVersion?: number | null; mealId?: string | null; title?: string | null; nestedMeals?: MealRecord[];
}): any | Promise<CommitWorkspaceMealResult>;
