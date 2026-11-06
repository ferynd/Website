import type { VariantDims } from './ingredientVariants';

/** Interpretation version for new inputs; does not change #61 deterministic IDs. */
export const VOCABULARY_VERSION: 1;
export const STATE_SLUGS: readonly string[];
export const PREPARATION_TERMS: readonly string[];
/** Recognizes catalog descriptors and state synonyms; map with stateToDims before use. */
export function isKnownState(value: unknown): boolean;
/** Recognizes scalar preparation terms/synonyms, excluding compound form descriptors. */
export function isKnownPreparation(value: unknown): boolean;
/** Comma-separated words or tokens. Exact normalized lookup; conflicts throw. */
export function parseFormWords(words: string | readonly string[]): {
    dims: Partial<VariantDims>;
    unknownWords: string[];
};
/** Unknown state returns unspecified dimensions and needsReview, never a guess. */
export function stateToDims(catalogState: unknown): {
    dims: VariantDims;
    needsReview: boolean;
    unknownWords: string[];
};
/** Canonical form words; non-vocabulary dimensions belong in paste key=value. */
export function formWordsFor(dims?: Partial<VariantDims>): string[];
