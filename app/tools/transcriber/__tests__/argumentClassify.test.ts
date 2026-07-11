import { describe, expect, it } from 'vitest';
import {
  aggregateClassifications,
  applyBlockClassifications,
  buildClassifyPrompt,
  buildClassifyResponseSchema,
  buildClassifyUnits,
  buildClassifyWindows,
  parseClassifyResponse,
  windowToRequestBlocks,
} from '../lib/argumentClassify';
import type { BlockClassification, TurnBlock } from '../lib/types';

function block(id: string, start: number, text = `text of ${id}`): TurnBlock {
  return { id, start, end: start + 10, speaker: 'Kait', text, segmentCount: 1, segmentIds: [id] };
}

describe('buildClassifyUnits', () => {
  it('keeps normal blocks as single units with the block id on the wire', () => {
    const units = buildClassifyUnits([block('t0', 0), block('t1', 10)]);
    expect(units.map((u) => u.unitId)).toEqual(['t0', 't1']);
    expect(units.map((u) => u.blockId)).toEqual(['t0', 't1']);
  });

  it('splits an exceptionally long turn into parts sharing the block id', () => {
    const longText = Array(60).fill('This is a fairly long sentence to pad things out.').join(' ');
    const units = buildClassifyUnits([block('t0', 0, longText)], 500);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((u) => u.blockId === 't0')).toBe(true);
    expect(new Set(units.map((u) => u.unitId)).size).toBe(units.length);
    expect(units.every((u) => u.text.length <= 500)).toBe(true);
    // No content lost.
    expect(units.map((u) => u.text).join(' ').replace(/\s+/g, ' ')).toBe(longText.replace(/\s+/g, ' '));
  });

  it('gives blocks without ids a stable fallback id', () => {
    const anonymous: TurnBlock = { start: 0, end: 5, speaker: 'Kait', text: 'hello', segmentCount: 1 };
    const units = buildClassifyUnits([anonymous]);
    expect(units[0].blockId).toBe('b0');
  });
});

describe('buildClassifyWindows', () => {
  it('covers every unit with overlapping windows', () => {
    const units = buildClassifyUnits(Array.from({ length: 100 }, (_, i) => block(`t${i}`, i * 10)));
    const windows = buildClassifyWindows(units, { blocksPerWindow: 40, overlapBlocks: 6 });
    expect(windows.length).toBeGreaterThan(1);
    const covered = new Set(windows.flatMap((w) => w.units.map((u) => u.unitId)));
    expect(covered.size).toBe(100);
    // Consecutive windows share overlapBlocks units.
    const w0Ids = windows[0].units.map((u) => u.unitId);
    const w1Ids = windows[1].units.map((u) => u.unitId);
    expect(w0Ids.slice(-6)).toEqual(w1Ids.slice(0, 6));
  });

  it('emits a single window when everything fits', () => {
    const units = buildClassifyUnits([block('t0', 0)]);
    const windows = buildClassifyWindows(units, { blocksPerWindow: 40, overlapBlocks: 6 });
    expect(windows).toHaveLength(1);
  });

  it('returns [] for no units', () => {
    expect(buildClassifyWindows([], {})).toEqual([]);
  });
});

describe('prompt + schema + response validation', () => {
  it('prompt asks for id-only classifications and includes tag guidance', () => {
    const units = buildClassifyUnits([block('t0', 0)]);
    const prompt = buildClassifyPrompt(windowToRequestBlocks({ index: 0, units }), 'Recorded at home.');
    expect(prompt).toContain('{"classifications": [{"blockId": string, "tag": string, "confidence": number}]}');
    expect(prompt).toContain('argument_conflict');
    expect(prompt).toContain('Never return text');
    expect(prompt).toContain('Recorded at home.');
  });

  it('schema restricts tags to the six valid values', () => {
    const schema = buildClassifyResponseSchema() as {
      properties: { classifications: { items: { properties: { tag: { enum: string[] } } } } };
    };
    expect(schema.properties.classifications.items.properties.tag.enum).toContain('argument_conflict');
    expect(schema.properties.classifications.items.properties.tag.enum).toHaveLength(6);
  });

  it('parse drops unknown ids, invalid tags, and bad confidence; clamps valid ones', () => {
    const raw = JSON.stringify({
      classifications: [
        { blockId: 't0', tag: 'argument_conflict', confidence: 0.91 },
        { blockId: 'ghost', tag: 'unclear', confidence: 0.5 },
        { blockId: 't1', tag: 'made_up_tag', confidence: 0.5 },
        { blockId: 't2', tag: 'repair_attempt', confidence: 3 },
      ],
    });
    expect(parseClassifyResponse(raw, ['t0', 't1', 't2'])).toEqual([
      { blockId: 't0', tag: 'argument_conflict', confidence: 0.91 },
      { blockId: 't2', tag: 'repair_attempt', confidence: 1 },
    ]);
  });

  it('parse throws on invalid JSON or wrong shape', () => {
    expect(() => parseClassifyResponse('nope', ['t0'])).toThrow('invalid JSON');
    expect(() => parseClassifyResponse(JSON.stringify({ foo: [] }), ['t0'])).toThrow('{classifications: [...]}');
  });
});

describe('aggregateClassifications', () => {
  it('aggregates every window deterministically — never only the final window', () => {
    const units = buildClassifyUnits([block('t0', 0), block('t1', 10), block('t2', 20)]);
    // Window 0 classified t0+t1; window 1 classified t1+t2 (overlap on t1).
    const w0: BlockClassification[] = [
      { blockId: 't0', tag: 'argument_conflict', confidence: 0.95 },
      { blockId: 't1', tag: 'unclear', confidence: 0.4 },
    ];
    const w1: BlockClassification[] = [
      { blockId: 't1', tag: 'repair_attempt', confidence: 0.9 },
      { blockId: 't2', tag: 'logistics_or_normal', confidence: 0.85 },
    ];
    const aggregated = aggregateClassifications(units, [w0, w1]);
    // t0 survives from window 0 even though window 1 never saw it.
    expect(aggregated.byBlockId.get('t0')).toEqual({ tag: 'argument_conflict', confidence: 0.95 });
    // t1's higher-confidence vote wins across windows.
    expect(aggregated.byBlockId.get('t1')).toEqual({ tag: 'repair_attempt', confidence: 0.9 });
    expect(aggregated.missingBlockIds).toEqual([]);
  });

  it('collapses long-turn part votes onto the one block id', () => {
    const longText = Array(60).fill('A long sentence for splitting purposes, yes indeed.').join(' ');
    const units = buildClassifyUnits([block('t0', 0, longText)], 500);
    const votes: BlockClassification[] = units.map((u, i) => ({
      blockId: u.unitId,
      tag: i === 0 ? 'logistics_or_normal' : 'argument_conflict',
      confidence: i === 0 ? 0.6 : 0.92,
    }));
    const aggregated = aggregateClassifications(units, [votes]);
    expect(aggregated.byBlockId.size).toBe(1);
    expect(aggregated.byBlockId.get('t0')).toEqual({ tag: 'argument_conflict', confidence: 0.92 });
  });

  it('ties break by tag priority (conflict over neutral), deterministically', () => {
    const units = buildClassifyUnits([block('t0', 0)]);
    const aggregated = aggregateClassifications(units, [
      [{ blockId: 't0', tag: 'logistics_or_normal', confidence: 0.8 }],
      [{ blockId: 't0', tag: 'argument_conflict', confidence: 0.8 }],
    ]);
    expect(aggregated.byBlockId.get('t0')!.tag).toBe('argument_conflict');
  });

  it('reports blocks no window classified as coverage gaps', () => {
    const units = buildClassifyUnits([block('t0', 0), block('t1', 10)]);
    const aggregated = aggregateClassifications(units, [[{ blockId: 't0', tag: 'unclear', confidence: 0.5 }]]);
    expect(aggregated.missingBlockIds).toEqual(['t1']);
  });
});

describe('applyBlockClassifications', () => {
  it('tags blocks immutably and falls back to unclear for coverage gaps', () => {
    const blocks = [block('t0', 0), block('t1', 10)];
    const units = buildClassifyUnits(blocks);
    const aggregated = aggregateClassifications(units, [[{ blockId: 't0', tag: 'emotional_support', confidence: 0.9 }]]);
    const tagged = applyBlockClassifications(blocks, aggregated);
    expect(tagged[0].tag).toBe('emotional_support');
    expect(tagged[1].tag).toBe('unclear');
    expect(blocks[0].tag).toBeUndefined();
  });
});
