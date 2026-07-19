import { describe, expect, it } from 'vitest';
import { CHATGPT_CONVERSION_PROMPT as PROMPT } from '../lib/prompt';
import { SUPPORTED_TECHNIQUE_IDS } from '../lib/techniques';

describe('CHATGPT_CONVERSION_PROMPT', () => {
  it('contains no long worked example (the old cookie walkthrough is gone)', () => {
    expect(PROMPT.toLowerCase()).not.toContain('cookie');
  });

  it('does not invite schema drift with "add fields if necessary"', () => {
    expect(PROMPT.toLowerCase()).not.toContain('add fields');
    expect(PROMPT).toContain('no extra fields');
  });

  it('never requests generic equipment inventories', () => {
    expect(PROMPT).toContain('Never produce equipment inventories');
    expect(PROMPT).not.toContain('"equipment"');
  });

  it('requires the exact v2 shape with the workflow fields', () => {
    expect(PROMPT).toContain('"schemaVersion":2');
    expect(PROMPT).toContain('"prepGroups"');
    expect(PROMPT).toContain('"timeline"');
    expect(PROMPT).toContain('"usesPrepGroupIds"');
    expect(PROMPT).toContain('"usesResultIds"');
    expect(PROMPT).toContain('"result":null');
  });

  it('leaves derived/initialized data out of the shape', () => {
    expect(PROMPT).not.toContain('shoppingList');
    expect(PROMPT).not.toContain('nutritionLink');
  });

  it('explains the prep-timing union including during-wait and just-in-time', () => {
    expect(PROMPT).toContain('"during-wait"');
    expect(PROMPT).toContain('"just-in-time"');
    expect(PROMPT).toContain('"after-section"');
    expect(PROMPT).toContain('waitEntryId');
    expect(PROMPT).toContain('beforeStepId');
  });

  it('requires the exact first-use step and holding info for prep groups', () => {
    expect(PROMPT).toContain('firstUseStepId');
    expect(PROMPT).toContain('exact first consuming step');
    expect(PROMPT).toContain('holdNote');
  });

  it('requires stable ids for prep groups and named results', () => {
    expect(PROMPT).toContain('stable id');
    expect(PROMPT).toContain('every id unique');
  });

  it('defines prep as named inputs and forbids execution transformations in prep', () => {
    expect(PROMPT).toContain('NAMED INPUT');
    expect(PROMPT).toContain('NOT prep');
    expect(PROMPT).toContain('never a prep note');
  });

  it('requires steps to reference named groups/results without re-enumerating ingredients', () => {
    expect(PROMPT).toContain('never re-list ingredients');
  });

  it('keeps technique help site-owned via the supported id list', () => {
    SUPPORTED_TECHNIQUE_IDS.forEach((id) => expect(PROMPT).toContain(id));
    expect(PROMPT).toContain('never invent values');
  });

  it('ends with the internal final audit and JSON-only output', () => {
    expect(PROMPT).toContain('Final audit');
    expect(PROMPT).toContain('Reconstruct the recipe');
    expect(PROMPT).toMatch(/10\. Output is one valid JSON object/);
    expect(PROMPT).toContain('Output one valid JSON object only');
  });

  it('stays within a generous size budget to prevent uncontrolled growth', () => {
    // Old prompt: 5878 chars / ~1319 GPT tokens; new: 5695 chars / ~1301.
    // The cap only guards against future bloat — it is not a shrinking test.
    expect(PROMPT.length).toBeLessThan(7000);
  });
});
