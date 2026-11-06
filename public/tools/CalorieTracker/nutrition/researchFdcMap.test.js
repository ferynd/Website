import { it, expect, describe } from 'vitest';
import { V2_KEYS, getNutrient, convertUnit } from '../../../shared/nutrition/nutrientRegistry.js';
import { FDC_NUTRIENT_ENTRIES, ENERGY_PREFERENCE_ORDER, getFdcMapping, getFdcMappingByNumber, validateFdcNutrientMappings } from '../../../shared/nutrition/research/fdcNutrientMap.js';
describe('FDC Nutrient Map', () => {
    it('validates that every mapped nutrient targets a valid V2 key with a convertible unit', () => {
        const errors = validateFdcNutrientMappings();
        expect(errors).toEqual([]);
    });
    it('contains entries targeting keys exclusively within V2_KEYS', () => {
        for (const entry of FDC_NUTRIENT_ENTRIES) {
            expect(V2_KEYS).toContain(entry.key);
            const def = getNutrient(entry.key);
            expect(def).toBeDefined();
            if (entry.policy !== 'gap') {
                const res = convertUnit(entry.key, 1, entry.sourceUnit);
                expect(res.error).toBeUndefined();
                expect(res.value).toBeGreaterThan(0);
            }
        }
    });
    it('defines the required energy preference order (1008, then 2048, then 2047)', () => {
        expect(ENERGY_PREFERENCE_ORDER).toEqual([1008, 2048, 2047]);
    });
    it('maps definition mismatches as gap policy with definition_mismatch reason', () => {
        const folateMismatch = getFdcMapping(1177);
        expect(folateMismatch).not.toBeNull();
        expect(folateMismatch.policy).toBe('gap');
        expect(folateMismatch.gapReason).toBe('definition_mismatch');
        const vitAMismatch = getFdcMapping(1104);
        expect(vitAMismatch).not.toBeNull();
        expect(vitAMismatch.policy).toBe('gap');
        expect(vitAMismatch.gapReason).toBe('definition_mismatch');
        const vitKMismatch = getFdcMapping(1185);
        expect(vitKMismatch).not.toBeNull();
        expect(vitKMismatch.policy).toBe('gap');
        expect(vitKMismatch.gapReason).toBe('definition_mismatch');
        const omega3Mismatch = getFdcMapping(1270);
        expect(omega3Mismatch).not.toBeNull();
        expect(omega3Mismatch.policy).toBe('gap');
        expect(omega3Mismatch.gapReason).toBe('definition_mismatch');
    });
    it('finds mappings by FDC nutrient ID and nutrient number', () => {
        const byId = getFdcMapping(1003);
        expect(byId?.key).toBe('protein');
        const byNum = getFdcMappingByNumber('203');
        expect(byNum?.key).toBe('protein');
        expect(getFdcMapping(999999)).toBeNull();
    });
    it('assigns USDA nutrient number 957 to Atwater-specific energy and rejects duplicate numbers', () => {
        expect(getFdcMapping(2047).nutrientNumber).toBe('957');
        expect(getFdcMappingByNumber('957').fdcNutrientId).toBe(2047);
        expect(getFdcMappingByNumber('957').key).toBe('calories');
        expect(getFdcMapping(2000).nutrientNumber).toBe('269');
        expect(getFdcMappingByNumber('269').key).toBe('sugarsTotal');
        expect(validateFdcNutrientMappings()).toEqual([]);
        const duplicate = validateFdcNutrientMappings([
            getFdcMapping(2000),
            { ...getFdcMapping(2047), nutrientNumber: '269' },
        ]);
        expect(duplicate.some(error => error.includes('Duplicate nutrient number 269'))).toBe(true);
    });
});
