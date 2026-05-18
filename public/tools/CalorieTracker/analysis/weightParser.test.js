/**
 * @file analysis/weightParser.test.js
 * @description Test harness for weightParser.js (vitest).
 * Run via root: npx vitest run public/tools/CalorieTracker/analysis/weightParser.test.js
 * Or via CalorieTracker dir: npm test
 */

import { describe, it, expect } from 'vitest';
import { parseWeightCSV, PARSER_VERSION } from './weightParser.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function ok(entries, count, label) {
  expect(entries.length, `${label}: expected ${count} entries`).toBe(count);
}

// ── 1. Basic tab-delimited smart-scale export ─────────────────────────────────

describe('tab-delimited smart-scale export', () => {
  const tsv = [
    'Weight (lb)\tBody Fat\tMuscle Mass\tWater\tBMI\tBone Mass\tDate/Time',
    '185.8\t19.80%\t43.10%\t59.20%\t25.9\t0%\tJul 13 2017 07:20:13 AM',
    '186.2\t19.90%\t43.00%\t59.00%\t25.9\t0%\tJul 14 2017 08:15:00 AM',
    '185.0\t19.70%\t43.20%\t59.30%\t25.8\t0%\tJul 15 2017 07:05:45 AM',
  ].join('\r\n');

  it('parses all 3 data rows', () => {
    const { entries, diagnostics } = parseWeightCSV(tsv);
    ok(entries, 3, 'tab TSV');
    expect(diagnostics.detectedDelimiter).toBe('tab');
    expect(diagnostics.weightUnit).toBe('lb');
    expect(diagnostics.detectedColumns.weight).toBe('Weight (lb)');
    expect(diagnostics.detectedColumns.datetime).toBe('Date/Time');
  });

  it('correctly parses weight and timestamp', () => {
    const { entries } = parseWeightCSV(tsv);
    expect(entries[0].weight_lb).toBe(185.8);
    expect(entries[0].timestamp).toBe('2017-07-13T07-20-13');
    expect(entries[0].date).toBe('2017-07-13');
    expect(entries[0].time_min).toBe(7 * 60 + 20);
  });

  it('uses timestamp as docId when time is present', () => {
    const { entries } = parseWeightCSV(tsv);
    expect(entries[0].docId).toBe('2017-07-13T07-20-13');
  });

  it('attaches parserVersion and originalUnit', () => {
    const { entries } = parseWeightCSV(tsv);
    expect(entries[0].parserVersion).toBe(PARSER_VERSION);
    expect(entries[0].originalUnit).toBe('lb');
  });
});

// ── 2. Comma-delimited with quotes ────────────────────────────────────────────

describe('comma-delimited quoted CSV', () => {
  const csv = [
    '"Weight (lb)","Date/Time","Notes"',
    '"185.8","Jul 13, 2017 07:20:13 AM","morning"',
    '"184.6","Jul 14, 2017 08:00:00 AM","post workout"',
  ].join('\n');

  it('parses comma-quoted CSV correctly', () => {
    const { entries, diagnostics } = parseWeightCSV(csv);
    ok(entries, 2, 'quoted CSV');
    expect(diagnostics.detectedDelimiter).toBe('comma');
    expect(entries[0].weight_lb).toBe(185.8);
  });

  it('handles month-name date with comma variant "Jul 13, 2017 07:20:13 AM"', () => {
    const { entries } = parseWeightCSV(csv);
    expect(entries[0].date).toBe('2017-07-13');
    expect(entries[0].time_min).toBe(7 * 60 + 20);
  });
});

// ── 3. Semicolon-delimited (European) ────────────────────────────────────────

describe('semicolon-delimited European CSV', () => {
  const csv = [
    'Date;Weight (lb);Notes',
    '2023-01-10;185,8;ok',
    '2023-01-11;184,6;',
  ].join('\n');

  it('detects semicolon delimiter', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.detectedDelimiter).toBe('semicolon');
  });

  it('converts comma-as-decimal to dot for weight parsing', () => {
    const { entries } = parseWeightCSV(csv);
    ok(entries, 2, 'semicolon CSV');
    expect(entries[0].weight_lb).toBe(185.8);
    expect(entries[1].weight_lb).toBe(184.6);
  });
});

// ── 4. kg column → lb conversion ─────────────────────────────────────────────

describe('kg weight column with conversion', () => {
  const csv = [
    'Date,Weight(kg)',
    '2023-03-01,84.0',
    '2023-03-02,83.5',
  ].join('\n');

  it('converts kg to lb', () => {
    const { entries, diagnostics } = parseWeightCSV(csv);
    ok(entries, 2, 'kg CSV');
    expect(diagnostics.weightUnit).toBe('kg');
    expect(diagnostics.detectedColumns.weight).toBe('Weight(kg)');
    // 84.0 kg × 2.20462 ≈ 185.2 lb (1 decimal rounding)
    expect(entries[0].weight_lb).toBeGreaterThan(185);
    expect(entries[0].weight_lb).toBeLessThan(186);
  });

  it('stores originalUnit as kg', () => {
    const { entries } = parseWeightCSV(csv);
    expect(entries[0].originalUnit).toBe('kg');
  });
});

// ── 5. Date format variants ───────────────────────────────────────────────────

describe('date format variants', () => {
  function singleRow(dateStr) {
    return `Weight (lb),Date/Time\n185.0,${dateStr}`;
  }

  it('YYYY-MM-DD', () => {
    const { entries } = parseWeightCSV(singleRow('2023-06-15'));
    ok(entries, 1, 'YYYY-MM-DD');
    expect(entries[0].date).toBe('2023-06-15');
  });

  it('YYYY-MM-DD HH:mm:ss', () => {
    const { entries } = parseWeightCSV(singleRow('2023-06-15 14:30:00'));
    ok(entries, 1, 'YYYY-MM-DD HH:mm:ss');
    expect(entries[0].date).toBe('2023-06-15');
    expect(entries[0].time_min).toBe(14 * 60 + 30);
  });

  it('MM/DD/YYYY', () => {
    const { entries } = parseWeightCSV(singleRow('06/15/2023'));
    ok(entries, 1, 'MM/DD/YYYY');
    expect(entries[0].date).toBe('2023-06-15');
  });

  it('MM/DD/YYYY HH:mm PM', () => {
    const { entries } = parseWeightCSV(singleRow('06/15/2023 02:30 PM'));
    ok(entries, 1, 'MM/DD/YYYY HH:mm PM');
    expect(entries[0].date).toBe('2023-06-15');
    expect(entries[0].time_min).toBe(14 * 60 + 30);
  });

  it('MM/DD/YYYY HH:mm:ss (24-hour, no AM/PM)', () => {
    const { entries } = parseWeightCSV(singleRow('06/15/2023 14:30:00'));
    ok(entries, 1, 'MM/DD/YYYY 24h');
    expect(entries[0].date).toBe('2023-06-15');
    expect(entries[0].time_min).toBe(14 * 60 + 30);
  });

  it('MM/DD/YYYY HH:mm (24-hour, no seconds, no AM/PM)', () => {
    const { entries } = parseWeightCSV(singleRow('06/15/2023 14:30'));
    ok(entries, 1, 'MM/DD/YYYY 24h no-sec');
    expect(entries[0].date).toBe('2023-06-15');
    expect(entries[0].time_min).toBe(14 * 60 + 30);
  });

  it('Jul 13 2017 07:20:13 AM (no comma)', () => {
    const { entries } = parseWeightCSV(singleRow('Jul 13 2017 07:20:13 AM'));
    ok(entries, 1, 'month-name no-comma');
    expect(entries[0].date).toBe('2017-07-13');
    expect(entries[0].time_min).toBe(7 * 60 + 20);
  });

  it('Jul 13, 2017 07:20:13 AM (with comma — quoted field)', () => {
    // A date containing a comma must be quoted in comma-delimited CSV.
    const csv = 'Weight (lb),Date/Time\n185.0,"Jul 13, 2017 07:20:13 AM"';
    const { entries } = parseWeightCSV(csv);
    ok(entries, 1, 'month-name comma quoted');
    expect(entries[0].date).toBe('2017-07-13');
  });

  it('12:xx PM time converted correctly', () => {
    const { entries } = parseWeightCSV(singleRow('Jul 13 2017 12:00:00 PM'));
    ok(entries, 1, '12 PM');
    expect(entries[0].time_min).toBe(12 * 60);
  });

  it('12:xx AM (midnight) converted correctly', () => {
    const { entries } = parseWeightCSV(singleRow('Jul 13 2017 12:00:00 AM'));
    ok(entries, 1, '12 AM midnight');
    expect(entries[0].time_min).toBe(0);
  });
});

// ── 5b. Newest-first CSV — date range must still be correct ──────────────────

describe('newest-first export date range', () => {
  // Many apps (e.g. Garmin, Withings) export most-recent row first
  const csv = [
    'Weight (lb),Date/Time',
    '183.0,2023-12-01 07:00:00',  // newest
    '184.0,2023-06-15 07:00:00',
    '185.0,2023-01-10 07:00:00',  // oldest
  ].join('\n');

  it('reports correct from/to regardless of row order', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.detectedDateRange.from).toBe('2023-01-10');
    expect(diagnostics.detectedDateRange.to).toBe('2023-12-01');
  });
});

// ── 6. Separate Date + Time columns ──────────────────────────────────────────

describe('separate Date and Time columns', () => {
  const csv = [
    'Date,Time,Weight',
    '2022-03-22,07:00:00,185.8',
    '2022-03-23,08:15:00,185.2',
  ].join('\n');

  it('combines date and time columns', () => {
    const { entries, diagnostics } = parseWeightCSV(csv);
    ok(entries, 2, 'separate date/time');
    expect(diagnostics.detectedColumns.date).toBe('Date');
    expect(diagnostics.detectedColumns.time).toBe('Time');
    expect(entries[0].date).toBe('2022-03-22');
    expect(entries[0].time_min).toBe(7 * 60);
  });
});

// ── 7. UTF-8 BOM handling ─────────────────────────────────────────────────────

describe('UTF-8 BOM', () => {
  const bom = '﻿';
  const csv = bom + 'Weight (lb),Date/Time\n185.0,2023-01-10';

  it('strips BOM and parses correctly', () => {
    const { entries } = parseWeightCSV(csv);
    ok(entries, 1, 'BOM');
    expect(entries[0].weight_lb).toBe(185.0);
  });
});

// ── 8. Deduplication ─────────────────────────────────────────────────────────

describe('deduplication', () => {
  const csv = [
    'Weight (lb),Date/Time',
    '185.0,2023-01-10 07:00:00',
    '185.0,2023-01-10 07:00:00',
    '185.2,2023-01-11 07:00:00',
  ].join('\n');

  it('skips duplicate rows within a file', () => {
    const { entries, diagnostics } = parseWeightCSV(csv);
    ok(entries, 2, 'dedup');
    expect(diagnostics.duplicateRows).toBe(1);
    expect(diagnostics.skippedReasons['duplicate_in_file']).toBe(1);
  });

  it('re-uploading same CSV produces identical docIds', () => {
    const { entries: a } = parseWeightCSV(csv);
    const { entries: b } = parseWeightCSV(csv);
    expect(a.map(e => e.docId)).toEqual(b.map(e => e.docId));
  });
});

// ── 9. Diagnostics ────────────────────────────────────────────────────────────

describe('diagnostics accuracy', () => {
  const csv = [
    'Weight (lb),Date/Time',
    '185.0,2023-01-10 07:00:00',  // ok
    'abc,2023-01-11 07:00:00',    // invalid_weight
    '185.0,not-a-date',           // invalid_date
    '30.0,2023-01-13 07:00:00',   // weight_out_of_range (< 50)
    '186.0,2023-01-14 08:00:00',  // ok
  ].join('\n');

  it('counts totalRows correctly', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.totalRows).toBe(5);
  });

  it('counts parsedRows correctly', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.parsedRows).toBe(2);
  });

  it('counts skippedRows correctly', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.skippedRows).toBe(3);
  });

  it('records skip reasons with example row numbers', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.skippedReasons['invalid_weight']).toBeGreaterThanOrEqual(1);
    expect(diagnostics.skippedReasons['invalid_date']).toBeGreaterThanOrEqual(1);
    expect(diagnostics.skippedReasons['weight_out_of_range']).toBeGreaterThanOrEqual(1);
    expect(diagnostics.skippedExamples['invalid_weight'][0]).toBeGreaterThan(1);
  });

  it('reports detectedDateRange', () => {
    const { diagnostics } = parseWeightCSV(csv);
    expect(diagnostics.detectedDateRange.from).toBe('2023-01-10');
    expect(diagnostics.detectedDateRange.to).toBe('2023-01-14');
  });
});

// ── 10. Edge cases ────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('returns empty entries for empty string', () => {
    const { entries } = parseWeightCSV('');
    expect(entries.length).toBe(0);
  });

  it('returns empty entries for header-only file', () => {
    const { entries } = parseWeightCSV('Weight (lb),Date/Time\n');
    expect(entries.length).toBe(0);
  });

  it('returns empty entries when no weight column found', () => {
    const csv = 'NotWeight,Date/Time\n185.0,2023-01-10';
    const { entries, diagnostics } = parseWeightCSV(csv);
    expect(entries.length).toBe(0);
    expect(diagnostics.skippedReasons['no_weight_column']).toBeTruthy();
  });

  it('returns empty entries when no date column found', () => {
    const csv = 'Weight,Notes\n185.0,morning';
    const { entries, diagnostics } = parseWeightCSV(csv);
    expect(entries.length).toBe(0);
    expect(diagnostics.skippedReasons['no_date_column']).toBeTruthy();
  });

  it('skips rows with too few columns', () => {
    const csv = 'Weight (lb),Date/Time\n185.0\n186.0,2023-01-11 07:00:00';
    const { entries, diagnostics } = parseWeightCSV(csv);
    expect(entries.length).toBe(1);
    expect(diagnostics.skippedReasons['row_too_short']).toBeTruthy();
  });

  it('handles "Body Weight" column name', () => {
    const csv = 'Body Weight,Date/Time\n185.0,2023-01-10 07:00:00';
    const { entries, diagnostics } = parseWeightCSV(csv);
    ok(entries, 1, 'Body Weight column');
    expect(diagnostics.detectedColumns.weight).toBe('Body Weight');
  });

  it('handles "Timestamp" column name', () => {
    const csv = 'Weight,Timestamp\n185.0,2023-01-10 07:00:00';
    const { entries } = parseWeightCSV(csv);
    ok(entries, 1, 'Timestamp column');
  });

  it('handles "Measured At" column name', () => {
    const csv = 'Weight,Measured At\n185.0,2023-01-10 07:00:00';
    const { entries, diagnostics } = parseWeightCSV(csv);
    ok(entries, 1, 'Measured At');
    expect(diagnostics.detectedColumns.datetime).toBe('Measured At');
  });

  it('date-only rows use hash-based docId (stable)', () => {
    const csv = 'Weight (lb),Date\n185.0,2023-01-10';
    const { entries: a } = parseWeightCSV(csv);
    const { entries: b } = parseWeightCSV(csv);
    expect(a[0].docId).toBe(b[0].docId);
    expect(a[0].docId.includes('T')).toBe(false);
  });
});

// ── 11. localDateStr — locale-independent date extraction ─────────────────────

describe('localDateStr — locale-independent date extraction', () => {
  it('date near midnight parses to the correct local date, not UTC', () => {
    // A timestamp that is 11:45 PM local time on Jan 5 (early hours UTC on Jan 6)
    // Parser uses local Date components so should produce 2024-01-05.
    const csv = 'Weight (lb),Date/Time\n185.0,2024-01-05 23:45:00';
    const { entries } = parseWeightCSV(csv);
    expect(entries.length).toBe(1);
    // The date field should reflect the local calendar date (Jan 5), not UTC (Jan 6).
    // Because parseExplicitDate uses new Date(y, m-1, d, h, mi, s) — local time.
    expect(entries[0].date).toBe('2024-01-05');
    expect(entries[0].time_min).toBe(23 * 60 + 45);
  });

  it('date-only row produces YYYY-MM-DD without locale formatting artifacts', () => {
    const csv = 'Weight (lb),Date\n185.0,2024-03-15';
    const { entries } = parseWeightCSV(csv);
    expect(entries[0].date).toBe('2024-03-15');
  });

  it('timestamp docId uses YYYY-MM-DD component, not locale-dependent string', () => {
    const csv = 'Weight (lb),Date/Time\n185.0,2024-12-31 23:59:00';
    const { entries } = parseWeightCSV(csv);
    expect(entries[0].date).toBe('2024-12-31');
    expect(entries[0].docId).toBe('2024-12-31T23-59-00');
  });
});

// ── 12. Large synthetic CSV ───────────────────────────────────────────────────

describe('large synthetic CSV (1000 rows)', () => {
  const rows = ['Weight (lb),Date/Time'];
  const base = new Date('2020-01-01T07:00:00');
  for (let i = 0; i < 1000; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 07:00:00`;
    const w = (180 + (i % 20) * 0.1).toFixed(1);
    rows.push(`${w},${ds}`);
  }
  const csv = rows.join('\n');

  it('parses all 1000 rows without error', () => {
    const { entries, diagnostics } = parseWeightCSV(csv);
    expect(entries.length).toBe(1000);
    expect(diagnostics.skippedRows).toBe(0);
    expect(diagnostics.parsedRows).toBe(1000);
  });
});
