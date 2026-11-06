import { it, expect, describe } from 'vitest';
import fs from 'node:fs';
import {
  parseFdcFood,
  extractStateWords,
  PermanentSourceError
} from '../../../shared/nutrition/research/fdcFood.js';

function loadFixture(relPath) {
  const url = new URL(`../../../../scripts/fixtures/nutrition/fdc/${relPath}`, import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8'));
}

describe('FDC Food Parser', () => {
  it('parses bulk Foundation food fixture and extracts nutrients, portions, and state words', async () => {
    const raw = loadFixture('apple-bulk.json');
    const result = await parseFdcFood(raw, { release: '2024-10-31' });

    expect(result.type).toBe('fdc');
    expect(result.recordId).toBe('110001');
    expect(result.fdcId).toBe(110001);
    expect(result.dataType).toBe('Foundation');
    expect(result.title).toBe('Apples, raw, with skin, synthetic test item');
    expect(result.release).toBe('2024-10-31');
    expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.extractedStateWords).toContain('raw');

    // Check nutrients parsed
    const energy = result.nutrients.find(n => n.nutrientId === 1008);
    expect(energy).toBeDefined();
    expect(energy.amount).toBe(52);
    expect(energy.unitName).toBe('kcal');

    // Check portions: density is never inferred, only household or piece
    expect(result.portions.length).toBe(2);
    for (const p of result.portions) {
      expect(['household', 'piece']).toContain(p.kind);
      expect(p.grams).toBeGreaterThan(0);
      expect(p.amount).toBeGreaterThan(0);
    }
  });

  it('parses flat API food shape with identical nutrient values', async () => {
    const raw = loadFixture('apple-api.json');
    const result = await parseFdcFood(raw, { release: '2024-10-31' });

    expect(result.recordId).toBe('110001');
    const energy = result.nutrients.find(n => n.nutrientId === 1008);
    expect(energy?.amount).toBe(52);
    const carbs = result.nutrients.find(n => n.nutrientId === 1005);
    expect(carbs?.amount).toBe(13.8);
  });

  it('identifies LOQ values and flags them with isBelowLoq', async () => {
    const raw = loadFixture('loq-food.json');
    const result = await parseFdcFood(raw, { release: '2024-10-31' });

    const fat = result.nutrients.find(n => n.nutrientId === 1004);
    expect(fat).toBeDefined();
    expect(fat.amount).toBe(0);
    expect(fat.isBelowLoq).toBe(true);
    expect(fat.loq).toBe(0.05);

    const sodium = result.nutrients.find(n => n.nutrientId === 1093);
    expect(sodium).toBeDefined();
    expect(sodium.isBelowLoq).toBe(true);
    expect(sodium.loq).toBe(0.2);
  });

  it('throws PermanentSourceError on malformed inputs', async () => {
    await expect(parseFdcFood(null)).rejects.toThrow(PermanentSourceError);
    await expect(parseFdcFood({})).rejects.toThrow(PermanentSourceError);

    const missingId = loadFixture('malformed-missing-id.json');
    await expect(parseFdcFood(missingId)).rejects.toThrow(PermanentSourceError);

    const stringAmount = loadFixture('malformed-string-amount.json');
    await expect(parseFdcFood(stringAmount)).rejects.toThrow(PermanentSourceError);

    const duplicateNutrient = loadFixture('malformed-duplicate-nutrient.json');
    await expect(parseFdcFood(duplicateNutrient)).rejects.toThrow(PermanentSourceError);
  });

  it('extracts state words accurately for conflict checking', () => {
    expect(extractStateWords('Apples, raw, with skin')).toEqual(['raw']);
    expect(extractStateWords('Lentils, mature seeds, cooked, boiled, without salt')).toEqual(
      expect.arrayContaining(['cooked', 'boiled', 'unsalted'])
    );
    expect(extractStateWords('Chicken, pan-fried, drained')).toEqual(
      expect.arrayContaining(['pan-fried', 'drained'])
    );
    expect(extractStateWords('Plain flour')).toEqual([]);
  });
});
