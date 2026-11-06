import { it, expect, describe } from 'vitest';
import { emptyStagedRecord, V2_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { createResearchJob } from '../../../shared/nutrition/research/researchJob.js';
import {
  buildRevisionDiff,
  buildReviewPacket,
  applyReviewDecision,
  CHECKLIST_VERSION
} from '../../../shared/nutrition/research/researchReview.js';

async function makeJobWithDraft(values = { protein: 10, calories: 40 }) {
  const staged = emptyStagedRecord();
  for (const k of V2_KEYS) {
    staged.values[k] = values[k] !== undefined ? values[k] : null;
    staged.quality[k] = { status: values[k] !== null && values[k] !== undefined ? 'measured' : 'unknown' };
  }

  const draft = await buildRevisionDraft({
    identityId: 'pi-11111111111111111111',
    variantId: 'pv-22222222222222222222',
    basis: { kind: 'per_100g_edible', state: 'raw' },
    stagedRecord: staged,
    fieldProvenance: {
      protein: { sourceKey: 'src-1' },
      calories: { sourceKey: 'src-1' },
    },
    sources: {
      'src-1': {
        type: 'manual',
        title: 'Source',
        version: '1',
        accessedAt: '2026-11-06',
        permittedUse: 'CC0 1.0',
      },
    },
  });

  const job = await createResearchJob({
    scope: 'curated',
    targetKind: 'catalog',
    target: { manifestId: 'apple-raw-with-skin' },
    state: 'needs_review',
  });

  job.proposal = {
    revisionDraft: draft,
    conversions: [],
  };
  job.validation = {
    isValid: true,
    errors: [],
    warnings: [],
  };

  return { job, draft };
}

describe('Research Review', () => {
  it('correctly calculates revision diffs between base and draft', async () => {
    const { draft } = await makeJobWithDraft({ protein: 10, calories: 40 });
    const { draft: updatedDraft } = await makeJobWithDraft({ protein: 15, calories: 60 });

    const diff = buildRevisionDiff(draft, updatedDraft);
    expect(diff.hasChanges).toBe(true);
    expect(diff.nutrientChanges.protein).toBeDefined();
    expect(diff.nutrientChanges.protein.oldValue).toBe(10);
    expect(diff.nutrientChanges.protein.newValue).toBe(15);
    expect(diff.nutrientChanges.calories.oldValue).toBe(40);
    expect(diff.nutrientChanges.calories.newValue).toBe(60);

    const sameDiff = buildRevisionDiff(draft, draft);
    expect(sameDiff.hasChanges).toBe(false);
  });

  it('builds review packet with JSON, Markdown and checklist v1', async () => {
    const { job } = await makeJobWithDraft();
    const packet = buildReviewPacket(job);

    expect(packet.json.checklistVersion).toBe(CHECKLIST_VERSION);
    expect(packet.json.jobId).toBe(job.jobId);
    expect(packet.markdown).toContain('# Research Review');
    expect(packet.markdown).toContain('identity_verified');
    expect(packet.markdown).toContain('warnings_acknowledged');
  });

  it('approves a job when approvedContentHash matches and warnings are acknowledged', async () => {
    const { job, draft } = await makeJobWithDraft();
    const approvedJob = applyReviewDecision(job, {
      decision: 'approve',
      reviewer: 'James',
      approvedContentHash: draft.contentHash,
      acknowledgedWarnings: [],
    });

    expect(approvedJob.state).toBe('approved');
    expect(approvedJob.review.reviewer).toBe('James');
    expect(approvedJob.review.approvedContentHash).toBe(draft.contentHash);
    expect(approvedJob.version).toBe(2);
  });

  it('rejects approval if contentHash does not match approvedContentHash', async () => {
    const { job } = await makeJobWithDraft();
    expect(() =>
      applyReviewDecision(job, {
        decision: 'approve',
        reviewer: 'James',
        approvedContentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        acknowledgedWarnings: [],
      })
    ).toThrow('Approved content hash mismatch');
  });

  it('blocks approval if there are unacknowledged validation warnings', async () => {
    const { job, draft } = await makeJobWithDraft();
    job.validation.warnings = ['Target food state is unspecified'];

    expect(() =>
      applyReviewDecision(job, {
        decision: 'approve',
        reviewer: 'James',
        approvedContentHash: draft.contentHash,
        acknowledgedWarnings: [], // omitted acknowledgment!
      })
    ).toThrow('unacknowledged warnings');

    // With acknowledgment, it passes
    const approvedJob = applyReviewDecision(job, {
      decision: 'approve',
      reviewer: 'James',
      approvedContentHash: draft.contentHash,
      acknowledgedWarnings: ['Target food state is unspecified'],
    });
    expect(approvedJob.state).toBe('approved');
  });

  it('blocks approval if there are validation errors', async () => {
    const { job, draft } = await makeJobWithDraft();
    job.validation.errors = ['Explicit conflict: target is raw but source is cooked'];

    expect(() =>
      applyReviewDecision(job, {
        decision: 'approve',
        reviewer: 'James',
        approvedContentHash: draft.contentHash,
        acknowledgedWarnings: [],
      })
    ).toThrow('Cannot approve job with validation errors');
  });
});
