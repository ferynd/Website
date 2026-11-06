export interface VariantDims {
    state: string;
    preparation: string;
    drained: 'drained' | 'undrained' | 'drained_rinsed' | 'not_applicable' | 'unspecified';
    fatPercent: number | null;
    leanPercent: number | null;
    salt: 'salted' | 'unsalted' | 'low_sodium' | 'not_applicable' | 'unspecified';
    fortification: 'fortified' | 'unfortified' | 'not_applicable' | 'unspecified';
    fortificationDetail: string;
    sweetening: string;
    ediblePortion: string;
    brand: {
        brand: string;
        product: string;
        gtin: string;
        market: string;
        labelDate: string;
        formulationNote: string;
    } | null;
}
export const VARIANT_ENUMS: Readonly<Record<string, readonly string[]>>;
export function normalizeVariantDims(raw?: Partial<VariantDims>): VariantDims;
export function compareVariants(req: Partial<VariantDims>, cand: Partial<VariantDims>): 'exact' | 'underspecified' | 'conflict';
