import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CALORIE_TRACKER_APP_ID } from '../lib/namespaces';
const modules = ['contentHash', 'ingredientIds', 'ingredientVariants', 'ingredientRefs', 'ingredientProfile', 'ingredientConversion', 'ingredientMatch', 'ingredientStore', 'profileCache', 'ingredientCatalog'];
it.each(modules)('%s JS exports have corresponding declarations', async (name) => {
    const js = await import(`../../../../public/shared/nutrition/${name}.js`);
    const declarations = readFileSync(`public/shared/nutrition/${name}.d.ts`, 'utf8');
    for (const key of Object.keys(js))
        expect(declarations).toMatch(new RegExp(`\\b${key}\\b`));
});
it('both Firebase adapters use the shared store and the same pinned namespace', () => {
    const recipe = readFileSync('app/tools/recipe-standardizer/lib/ingredientStore.ts', 'utf8');
    const tracker = readFileSync('public/tools/CalorieTracker/services/ingredientStore.js', 'utf8');
    const config = readFileSync('public/tools/CalorieTracker/config.js', 'utf8');
    expect(recipe).toContain("@/public/shared/nutrition/ingredientStore.js");
    expect(tracker).toContain("../../../shared/nutrition/ingredientStore.js");
    expect(recipe).toMatch(/namespace:\s*CALORIE_TRACKER_APP_ID/);
    expect(tracker).toMatch(/namespace:\s*appId/);
    expect(config).toContain(`'${CALORIE_TRACKER_APP_ID}'`);
    const lib = 'app/tools/recipe-standardizer/lib';
    for (const file of readdirSync(lib).filter(f => /\.tsx?$/.test(f))) {
        const source = readFileSync(`${lib}/${file}`, 'utf8');
        expect(source).not.toMatch(/interface IngredientProfileRef\s*\{|ingredientIdentities\s*['"]/);
    }
});
it('both auth integrations await profile cache clearing before publishing user state', () => {
    const tracker = readFileSync('public/tools/CalorieTracker/main.js', 'utf8');
    const recipe = readFileSync('app/tools/recipe-standardizer/RecipeContext.tsx', 'utf8');
    expect(tracker).toContain('await onIngredientAuthChange(stateObject.userId, null)');
    expect(tracker).toContain('await onIngredientAuthChange(stateObject.userId, user.uid)');
    expect(recipe).toContain('if (previousUid && previousUid !== nextUser?.uid)');
    expect(recipe).toContain('await firebaseSignOut(auth)');
});
