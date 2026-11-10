/**
 * Operator-local configuration (#62 Part B). Live pins now exist for FDC bulk
 * use: each dataset names its official download URL, the archive checksum, and
 * the extracted JSON file plus its checksum. The `sha256` field pins the
 * EXTRACTED JSON file, because that is what fdcBulkReader verifies; the
 * `archiveSha256` lets an operator verify the download before extracting it.
 * The dataset files live outside the checkout and are never committed.
 * Bulk downloads need no key. The FDC API adapter stays unused and no API key
 * is configured anywhere.
 */
export const RESEARCH_CONFIG = Object.freeze({
    datasets: [
        {
            id: 'foundation', dataType: 'Foundation', release: '2026-10-29',
            downloadUrl: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip',
            archiveSha256: 'sha256:dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579',
            fileName: 'FoodData_Central_foundation_food_json_2026-10-29.json',
            sha256: 'sha256:990e7731dcec30cecbbb212896a0fe4333f38c65ce7f525e2b679f0dc27658a1' as string | null,
            fixtureOnly: false,
        },
        {
            id: 'sr-legacy', dataType: 'SR Legacy', release: '2018-04',
            downloadUrl: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip',
            archiveSha256: 'sha256:0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef',
            fileName: 'FoodData_Central_sr_legacy_food_json_2018-04.json',
            sha256: 'sha256:70d4235ae3a2bdf48a7b9eaa1286a83fa67b6f3270436c9ce8b008213f500129' as string | null,
            fixtureOnly: false,
        },
    ],
    apiBase: 'https://api.nal.usda.gov/fdc/v1/',
    minRequestMs: 1000, maxRequestsPerHour: 1000,
    batchSize: 25, retry: { maxAttempts: 3, baseMs: 1000, maxMs: 30000 },
});
