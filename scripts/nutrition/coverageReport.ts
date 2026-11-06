import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { waveOf, type ManifestEntry } from './manifestReader';
export function coverageReport(entries: ManifestEntry[], jobs: ResearchJob[]) {
    const curated = jobs.filter(j => j.scope === 'curated'), byId = new Map(curated.map(j => [j.target.manifestId, j]));
    const groups: Record<string, Record<string, number>> = {}, nutrients: Record<string, Record<string, number>> = {};
    const blocked = curated.filter(j => j.state === 'blocked').map(j => ({ id: j.target.manifestId, ...j.blocked }));
    for (const e of entries) {
        const j = byId.get(e.id);
        for (const key of ['all', 'wave:' + waveOf(e), 'priority:' + e.priority, 'category:' + e.category]) {
            const g = groups[key] ??= { total: 0, attempted: 0, resolved: 0, approved: 0, imported: 0, blocked: 0, remaining: 0 };
            g.total++;
            if (j?.attempts.length || j?.requests?.length)
                g.attempted++;
            if (j && ['matched', 'needs_review', 'approved', 'imported'].includes(j.state))
                g.resolved++;
            if (j?.state === 'approved')
                g.approved++;
            if (j?.state === 'imported')
                g.imported++;
            if (j?.state === 'blocked')
                g.blocked++;
            if (!j || !['approved', 'imported'].includes(j.state))
                g.remaining++;
        }
    }
    for (const j of curated)
        for (const key of PROFILE_FIELDS) {
            const q = j.proposal?.revisionDraft?.nutrientMeta?.quality?.[key];
            if (!q)
                continue;
            const group = nutrients[key] ??= {};
            group[q.status] = (group[q.status] || 0) + 1;
            if (q.status === 'unknown') {
                const reason = q.qualifier || 'unknown';
                group[reason] = (group[reason] || 0) + 1;
            }
        }
    const json = { groups, nutrients, blocked };
    const markdown = ['# Research coverage', '', ...Object.entries(groups).map(([key, g]) => `- ${key}: ${g.approved}/${g.total} approved; ${g.remaining} remaining; ${g.blocked} blocked`), '', '## Blocked', ...blocked.map(b => `- ${b.id}: ${b.code}: ${b.needs}`)].join('\n');
    return { json, markdown };
}
