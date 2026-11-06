import { it, expect, describe } from 'vitest';
import {
  createManualAdapter,
  createLabelAdapter,
  getFdaRoundingInterval
} from '../../../shared/nutrition/research/manualAdapters.js';
import { normalizeSourceResult } from '../../../shared/nutrition/research/sourceResult.js';

describe('Manual and Label Adapters', () => {
  describe('FDA rounding intervals', () => {
    it('calculates FDA rounding intervals for key nutrients', () => {
      expect(getFdaRoundingInterval('calories', 40)).toBe(5);
      expect(getFdaRoundingInterval('calories', 120)).toBe(10);
      expect(getFdaRoundingInterval('fat', 3)).toBe(0.5);
      expect(getFdaRoundingInterval('fat', 12)).toBe(1);
      expect(getFdaRoundingInterval('sodium', 80)).toBe(5);
      expect(getFdaRoundingInterval('sodium', 240)).toBe(10);
      expect(getFdaRoundingInterval('cholesterol', 10)).toBe(5);
      expect(getFdaRoundingInterval('carbs', 0.8)).toBe(0.5);
      expect(getFdaRoundingInterval('protein', 5)).toBe(1);
    });
  });

  describe('Manual Adapter', () => {
    it('creates manual source result and enforces comparator requirement for estimates', async () => {
      const adapter = createManualAdapter();

      // Estimate without comparatorRef or derivation must throw
      await expect(
        adapter.toSourceResult({
          recordId: 'man-1',
          nutrients: {
            protein: { value: 12, status: 'estimated_from_comparable' },
          },
        })
      ).rejects.toThrow('comparatorRef or derivation');

      // Estimate with comparatorRef succeeds
      const result = await adapter.toSourceResult({
        recordId: 'man-1',
        title: 'Estimated beef cut',
        nutrients: {
          protein: {
            value: 12,
            status: 'estimated_from_comparable',
            comparatorRef: 'catalog:beef-chuck-raw',
          },
        },
      });

      expect(result.type).toBe('manual');
      expect(result.recordId).toBe('man-1');
      expect(result.nutrients[0].status).toBe('estimated_from_comparable');
      expect(result.nutrients[0].comparatorRef).toBe('catalog:beef-chuck-raw');
    });
  });

  describe('Label Adapter', () => {
    it('attaches label_reported status and FDA rounding interval to label values including label 0', async () => {
      const adapter = createLabelAdapter();
      const raw = {
        recordId: 'lbl-1',
        brand: 'TestBrand',
        productName: 'Low Fat Crackers',
        servingSize: 30,
        servingSizeUnit: 'g',
        nutrients: {
          calories: 120,
          fat: 0, // label zero!
          sodium: 150,
          protein: 2,
        },
      };

      const result = await adapter.toSourceResult(raw);
      expect(result.type).toBe('label');
      expect(result.servingSize).toBe(30);

      const fatNutrient = result.nutrients.find(n => n.key === 'fat');
      expect(fatNutrient.amount).toBe(0);
      expect(fatNutrient.status).toBe('label_reported');
      expect(fatNutrient.roundingInterval).toBe(0.5);
    });

    it('produces gap:unit_not_convertible when serving basis is in mL with no density', async () => {
      const adapter = createLabelAdapter();
      const raw = {
        recordId: 'lbl-2',
        productName: 'Salad Dressing',
        servingSize: 30,
        servingSizeUnit: 'mL', // mL without density!
        nutrients: {
          calories: 100,
          fat: 10,
        },
      };

      const result = await adapter.toSourceResult(raw);
      const proposal = normalizeSourceResult(result);

      expect(proposal.nutrients.calories).toBeNull();
      expect(proposal.nutrientMeta.quality.calories.qualifier).toBe('gap:unit_not_convertible');
      expect(proposal.gaps.calories).toBe('unit_not_convertible');
    });

    it('rejects photos in curated scope', async () => {
      const adapter = createLabelAdapter();
      const rawWithPhoto = {
        recordId: 'lbl-3',
        productName: 'Yogurt',
        photos: ['https://example.com/user-upload.jpg'],
        nutrients: { calories: 80 },
      };

      await expect(
        adapter.toSourceResult(rawWithPhoto, { scope: 'curated' })
      ).rejects.toThrow('Photos cannot enter curated data');
    });
  });
});
