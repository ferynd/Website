import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  NUTRIENT_V2_WRITES_ENABLED,
  resolveNutrientWriteVersion,
} from '../../../shared/nutrition/capabilities.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', 'coverage']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe('nutrient write capability', () => {
  it('NUTRIENT_V2_WRITES_ENABLED defaults to false and resolveNutrientWriteVersion returns 1', () => {
    expect(NUTRIENT_V2_WRITES_ENABLED).toBe(false);
    expect(resolveNutrientWriteVersion()).toBe(1);
  });

  it('no other module hard-codes write version 2', () => {
    const pattern = /writeVersion\s*[:=]\s*2/;
    const hits = [];
    for (const path of walk(REPO_ROOT)) {
      const ext = path.slice(path.lastIndexOf('.'));
      if (!CODE_EXT.has(ext)) continue;
      if (path.includes(`${join('nutrition', 'capabilities.js')}`)) continue;
      if (path.includes('.test.') || path.includes('__tests__') || path.includes(`${join('tests', '')}`)) continue;
      const text = readFileSync(path, 'utf8');
      if (pattern.test(text)) hits.push(path.slice(REPO_ROOT.length + 1));
    }
    expect(hits).toEqual([]);
  });
});
