/** Read-only Part B census. Do not execute during Part A. Admin SDK requires ADC. */
import { constants, closeSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CENSUS_COLLECTIONS, countIngredientPaths, refuseIngredientCensusWrites } from './ingredientStoreCensusLogic';
export async function main(argv = process.argv): Promise<void> {
    const separator = argv.indexOf('--');
    const { values } = parseArgs({ args: argv.slice(separator >= 0 ? separator + 1 : 2), options: {
            project: { type: 'string' }, out: { type: 'string' },
            write: { type: 'boolean' }, apply: { type: 'boolean' }, delete: { type: 'boolean' },
        } });
    refuseIngredientCensusWrites({ ...values, project: values.project ?? '' });
    if (!values.out)
        throw new Error('--out must name an existing private directory outside the checkout');
    const out = realpathSync(resolve(values.out));
    const checkout = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
    const inside = relative(checkout, out);
    if (process.env.FIRESTORE_EMULATOR_HOST)
        throw new Error('Production census cannot use an emulator');
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside)))
        throw new Error('Census output must be outside checkout');
    const { initializeApp, applicationDefault, deleteApp } = await import('firebase-admin/app');
    const { getFirestore, FieldPath } = await import('firebase-admin/firestore');
    const app = initializeApp({ projectId: values.project, credential: applicationDefault() }, 'ingredient-store-census');
    const aggregate = countIngredientPaths([]);
    try {
        const db = getFirestore(app);
        for (const name of CENSUS_COLLECTIONS) {
            let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
            for (;;) {
                let query = db.collectionGroup(name).select().orderBy(FieldPath.documentId()).limit(500);
                if (cursor)
                    query = query.startAfter(cursor);
                const page = await query.get();
                const counts = countIngredientPaths(page.docs.map(d => d.ref.path)).collections[name];
                aggregate.collections[name].trackerNamespace += counts.trackerNamespace;
                aggregate.collections[name].otherPaths += counts.otherPaths;
                if (page.size < 500)
                    break;
                cursor = page.docs.at(-1);
            }
        }
        const report = JSON.stringify(aggregate, null, 2) + '\n';
        const fd = openSync(resolve(out, 'ingredient-store-census.json'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
            writeFileSync(fd, report);
        }
        finally {
            closeSync(fd);
        }
        process.stdout.write(report);
    }
    finally {
        await deleteApp(app);
    }
}
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
    main().catch(() => { console.error('Ingredient census failed; no remote writes attempted.'); process.exitCode = 1; });
}
