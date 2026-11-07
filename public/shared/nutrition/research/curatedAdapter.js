import { compareVariants } from '../ingredientVariants.js';
import { verifyRevisionHash } from '../ingredientProfile.js';
/** Reuses a confirmed catalog variant. Search/ambiguous identity confirmation belongs to #67. */
export function createCuratedResearchAdapter({ catalog }) {
    return { id: 'curated', scope: ['curated', 'private'], runsIn: ['browser', 'cli'], requiresSecret: false,
        release: async () => 'nutrition-curated-v1',
        async match(target) {
            const id = target.variantId || target.manifestId;
            if (!id)
                return null;
            const variant = await catalog.getVariant(id);
            if (!variant || compareVariants(target.dims, variant.dims) !== 'exact')
                return null;
            return { sourceAdapter: 'curated', sourceId: id, sourceRelease: variant.headContentHash, revision: variant.headRevision };
        },
        async fetch(id) {
            const variant = await catalog.getVariant(id);
            if (!variant)
                throw new Error('Curated variant missing');
            const revision = await catalog.getRevision(id, variant.headRevision);
            if (revision?.ownerUid || revision?.variantId !== id || revision?.identityId !== variant.identityId || revision?.contentHash !== variant.headContentHash || !await verifyRevisionHash(revision))
                throw new Error('Invalid curated revision');
            return { revision, variant };
        },
        async toSourceResult(raw) { return { existingRevision: raw.revision, variant: raw.variant }; }
    };
}
