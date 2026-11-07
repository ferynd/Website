import type { ResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { waveOf, type ManifestEntry } from './manifestReader';
function passesFor(jobs: ResearchJob[]) {
    const byId = new Map<string, ResearchJob[]>();
    for (const job of jobs) {
        const id = job.target.manifestId;
        if (!id)
            continue;
        const passes = byId.get(id);
        if (passes)
            passes.push(job);
        else
            byId.set(id, [job]);
    }
    return byId;
}
function mergedQuality(passes: ResearchJob[], key: string) {
    const rows = passes.map(job => ({
        quality: job.proposal?.revisionDraft?.nutrientMeta?.quality?.[key],
        approved: job.state === 'approved' || job.state === 'imported',
    })).filter(row => row.quality?.status);
    return rows.find(row => row.approved && row.quality.status !== 'unknown')?.quality
        || rows.find(row => row.quality.status !== 'unknown')?.quality
        || rows.find(row => row.approved)?.quality
        || rows[0]?.quality
        || null;
}
export function coverageReport(entries: ManifestEntry[], jobs: ResearchJob[]) {
    const curated = jobs.filter(j => j.scope === 'curated'), byId = passesFor(curated);
    const groups: Record<string, Record<string, number>> = {}, nutrients: Record<string, Record<string, number>> = {};
    const blocked: { id: string; code?: string; needs?: string }[] = [];
    for (const [id, passes] of byId) {
        const states = passes.map(j => j.state);
        if (states.includes('blocked') && !states.includes('approved') && !states.includes('imported')) {
            const job = [...passes].reverse().find(j => j.state === 'blocked');
            blocked.push({ id, ...job?.blocked });
        }
    }
    for (const e of entries) {
        const passes = byId.get(e.id) || [];
        const states = passes.map(j => j.state);
        const approved = states.includes('approved');
        const imported = states.includes('imported');
        const attempted = passes.some(j => j.attempts.length || j.requests?.length);
        const resolved = passes.some(j => ['matched', 'needs_review', 'approved', 'imported'].includes(j.state));
        const isBlocked = states.includes('blocked') && !approved && !imported;
        for (const key of ['all', 'wave:' + waveOf(e), 'priority:' + e.priority, 'category:' + e.category]) {
            const g = groups[key] ??= { total: 0, attempted: 0, resolved: 0, approved: 0, imported: 0, blocked: 0, remaining: 0 };
            g.total++;
            if (attempted)
                g.attempted++;
            if (resolved)
                g.resolved++;
            if (approved)
                g.approved++;
            if (imported)
                g.imported++;
            if (isBlocked)
                g.blocked++;
            if (!approved && !imported)
                g.remaining++;
        }
    }
    for (const passes of byId.values())
        for (const key of PROFILE_FIELDS) {
            const q = mergedQuality(passes, key);
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
