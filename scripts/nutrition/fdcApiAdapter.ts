import { parseFdcFood, PermanentSourceError } from '../../public/shared/nutrition/research/fdcFood.js';
import { RESEARCH_CONFIG } from './researchConfig';
import { matchFor, type MatchEntry } from './matchTable';
/** Operator-only adapter. Fetch is injected; no transport exists in browser modules. */
export function createFdcApiAdapter({ live = false, fetch: fetcher, matches = [], now = Date.now, sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)) }: {
    live?: boolean;
    fetch: typeof fetch;
    matches?: MatchEntry[];
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}) {
    let last = -Infinity;
    const timestamps: number[] = [];
    let queue = Promise.resolve();
    return { id: 'fdc_api', scope: ['curated', 'private'] as ('curated' | 'private')[], runsIn: ['cli'] as 'cli'[], requiresSecret: true, release: async () => 'fdc-api-v1', match: async (t: {
            manifestId: string;
        }) => matchFor(matches, t.manifestId, 'fdc_api'),
        async fetch(id: string) {
            if (!live)
                throw new PermanentSourceError('fdc-api requires --live');
            const key = process.env.FDC_API_KEY;
            if (!key)
                throw new PermanentSourceError('FDC_API_KEY is required');
            if (!/^\d+$/.test(id))
                throw new PermanentSourceError('Invalid FDC record ID');
            const work = queue.then(async () => {
                while (timestamps.length && timestamps[0] <= now() - 3600000)
                    timestamps.shift();
                if (timestamps.length >= RESEARCH_CONFIG.maxRequestsPerHour)
                    throw new PermanentSourceError('FDC hourly limit reached');
                await sleep(Math.max(0, RESEARCH_CONFIG.minRequestMs - (now() - last)));
                last = now();
                timestamps.push(last);
                let res: Response;
                try {
                    res = await fetcher(RESEARCH_CONFIG.apiBase + 'food/' + id, { headers: { 'X-Api-Key': key } });
                }
                catch {
                    throw new Error('FDC request failed (details redacted)');
                }
                if (!res.ok) {
                    const message = 'FDC HTTP ' + res.status;
                    if (res.status === 429 || res.status >= 500) {
                        const err = Object.assign(new Error(message), { retryAfterMs: Math.min(30000, Math.max(0, Number(res.headers.get('retry-after')) || 0) * 1000) });
                        throw err;
                    }
                    throw new PermanentSourceError(message);
                }
                try {
                    const raw = await res.json();
                    await parseFdcFood(raw, { release: 'validation' });
                    return raw;
                }
                catch {
                    throw new PermanentSourceError('Invalid FDC JSON (details redacted)');
                }
            });
            queue = work.then(() => { }, () => { });
            return work;
        }, toSourceResult: (raw: {
            dataType?: string;
            publicationDate?: string;
        }) => parseFdcFood(raw, { release: (raw.dataType || 'unknown') + '@' + (raw.publicationDate || 'unknown') }) };
}
