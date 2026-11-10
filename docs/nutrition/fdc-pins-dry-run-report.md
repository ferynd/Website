# FDC bulk pins: dry-run report (#62 Part B)

Generated: 2026-11-10. Run by the orchestrator against the operator-local pinned files outside the checkout. Aggregate counts only. This report names no food, source record id, or nutrient value. Nothing was written to the catalog, Firestore, or any staged shard, and no write flag changed. No FDC API request was made and no API key is configured.

## Method

1. Verify both layers of each pin in `scripts/nutrition/researchConfig.ts`: the downloaded archive against `archiveSha256`, then the extracted JSON against `sha256`. All four checksums matched the staged files exactly.
2. Run `auditPinnedBulk` (the per-record audit path in `scripts/nutrition/fdcBulkReader.ts`) on each extracted JSON. The audit verifies the pin checksum and top-level shape, then parses each record independently: a record that fails parsing is counted with a redacted failure category instead of aborting the run. Duplicate source ids are counted, not parsed twice.

## Results

| Dataset | Release | Records | Parsed | Parse failures | Duplicate ids |
| --- | --- | ---: | ---: | ---: | ---: |
| Foundation | 2026-10-29 | 424 | 414 | 10 | 0 |
| SR Legacy | 2018-04 | 7,793 | 7,793 | 0 | 0 |
| Total |  | 8,217 | 8,207 | 10 | 0 |

Failure categories (numbers in parser messages are normalized to `N` by the audit path, so no value from a source record appears here):

| Category | Count |
| --- | ---: |
| Non-numeric amount for nutrient N in fdcId N: N | 10 |

## Findings

- Both pins verify end to end: archive checksum, extracted-file checksum, top-level shape, and per-record parse all ran against the real releases, not fixtures.
- SR Legacy parses completely: every one of its 7,793 records passes the shared FDC parser, with no duplicate ids.
- Foundation has 10 records (about 2.4 percent) whose nutrient amounts are not numeric and are rejected by the parser. The strict `readPinnedBulk` path therefore throws on the real Foundation file; population work must use the audit path (or equivalent per-record tolerance) and treat those 10 records as a known blocked set for #63 follow-up, not as a reason to loosen the parser.
- The whole SR Legacy file (about 210 MB) loads and audits in seconds with a 4 GB Node heap; no streaming reader is needed at this scale.
