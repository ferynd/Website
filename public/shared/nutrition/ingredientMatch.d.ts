import type { IngredientProfileRef } from './ingredientRefs';
export function rankCandidates(input: any, candidates: any[]): any[];
export function matchIngredient(input: any, services: {
    privateSearch: (q: string) => Promise<any>;
    curatedSearch: (q: string) => Promise<any>;
    confirmedRefs?: IngredientProfileRef[];
}): Promise<{
    kind: 'exact';
    ref: IngredientProfileRef;
} | {
    kind: 'candidates';
    needsReview: true;
    candidates: any[];
}>;
