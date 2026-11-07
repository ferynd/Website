/** Operator-local configuration. Live pins are deliberately unset until #62 Part B. */
export const RESEARCH_CONFIG = Object.freeze({
    datasets: [{ id: 'foundation', dataType: 'Foundation', release: 'unconfigured', fileName: 'foundation.json', sha256: null as string | null, fixtureOnly: true }],
    apiBase: 'https://api.nal.usda.gov/fdc/v1/',
    minRequestMs: 1000, maxRequestsPerHour: 1000,
    batchSize: 25, retry: { maxAttempts: 3, baseMs: 1000, maxMs: 30000 },
});
