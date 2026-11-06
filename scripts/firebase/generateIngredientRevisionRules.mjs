/** Regenerate only the marked revision validators; no Firebase access. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { V2_KEYS } from '../../public/shared/nutrition/nutrientRegistry.js';
const start = '    // BEGIN GENERATED INGREDIENT REVISION VALIDATORS';
const end = '    // END GENERATED INGREDIENT REVISION VALIDATORS';
export function generateIngredientRevisionRules() {
  const words = V2_KEYS.join('|');
  const chunks = [
    start,
    '    // Run: node scripts/firebase/generateIngredientRevisionRules.mjs',
    `    function ingredientNutrientKeys() { return [${V2_KEYS.map(k => `'${k}'`).join(',')}]; }`,
    '    function ingredientRevisionKeys(keys) {',
    '      let joined = keys.join(\'|\');',
    '      // Round-trip blocks keys containing the separator; regexp membership',
    '      // avoids evaluating a 68-element literal on each write.',
    '      return keys.size() == 0 ? true : (keys == joined.split(\'[|]\')',
    `        && joined.matches('(${words})([|](${words}))*'));`,
    '    }',
    end,
  ];
  return chunks.join('\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL('../../firestore.rules', import.meta.url);
  const source = readFileSync(path, 'utf8');
  const begin = source.indexOf(start), finish = source.indexOf(end);
  if (begin < 0 || finish < begin) throw new Error('Missing generated rules markers');
  writeFileSync(path, source.slice(0,begin) + generateIngredientRevisionRules() + source.slice(finish+end.length));
}
