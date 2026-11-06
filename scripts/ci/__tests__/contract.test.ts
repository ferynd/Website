import { describe, expect, it } from 'vitest';
import { calorieErrors, ownershipErrors, quarantineErrors, retryErrors, stageErrors, workflowErrors } from '../lib/contract.mjs';
import contract from '../../../.github/ci/contract.json';

const now = new Date('2026-11-05T12:00:00Z');
const file = 'scripts/ci/example.test.ts';
const stages = [{ id: 'unit-core', tests: ['^scripts/.*\\.test\\.ts$'] }];
const entry = {
  id: 'Q-001', stage: 'unit-core', test: `${file} > example > case`, owner: '@ferynd',
  issue: 'https://github.com/ferynd/Website/issues/1', added: '2026-11-01', expires: '2026-11-20', reason: 'Synthetic fixture',
};
const suppressed = '// ci-quarantine: Q-001\n' + "it.skip('case', () => {});";
const check = (entries = [entry], source = suppressed) => quarantineErrors(
  { version: 1, maxDays: 30, entries }, { [file]: source }, stages, now,
);

describe('quarantine contract', () => {
  it('accepts a matching marker and emits an active-entry warning', () => {
    expect(check()).toEqual({ errors: [], warnings: [`quarantine: Q-001 ${file}`] });
  });
  it('rejects expired, ownerless, overlong and issue-less entries', () => {
    for (const change of [{ expires: '2026-11-04' }, { owner: '' }, { expires: '2026-12-20' }, { issue: '' }]) {
      expect(check([{ ...entry, ...change }]).errors).toContain('quarantine: incomplete or expired Q-001');
    }
  });
  it('rejects orphaned entries', () => {
    expect(check([entry], "it('case', () => {});").errors).toContain('quarantine-orphan: Q-001');
  });
  it('requires the marker immediately above and matching file and stage', () => {
    for (const source of ["it.skip('case', () => {});", '// ci-quarantine: Q-002\n' + "test.todo('case');", suppressed.replace('\n', '\n\n')]) {
      expect(check([entry], source).errors.some((error: string) => error.startsWith('quarantine-marker:'))).toBe(true);
    }
    expect(check([{ ...entry, test: 'app/other.test.ts > case' }]).errors).toContain(`quarantine-marker: ${file}:2`);
    expect(check([{ ...entry, stage: 'api-contract' }]).errors).toContain(`quarantine-marker: ${file}:2`);
  });
  it('rejects exclusive calls even with a marker', () => {
    expect(check([], "it.only('case', () => {});").errors).toContain(`only: ${file}:1`);
  });
  it('recognizes all suppression forms but ignores quoted fixtures', () => {
    for (const call of ['it.skip', 'test.todo', 'test.fails', 'xit', 'xdescribe', 'describe.skip', 'test.skipIf(true)']) {
      expect(check([], `${call}('case', () => {});`).errors).toContain(`quarantine-marker: ${file}:1`);
    }
    expect(check([], 'const fixture = "it.only(\'case\')";').errors).toEqual([]);
  });
});

describe('test ownership and workflow policy', () => {
  it('rejects unowned and multiply owned tests', () => {
    expect(ownershipErrors([file], stages)).toEqual([]);
    expect(ownershipErrors(['elsewhere/a.test.ts'], stages)).toEqual(['ownership: elsewhere/a.test.ts has 0 owners']);
    expect(ownershipErrors([file], [...stages, { ...stages[0], id: 'other' }])).toEqual([`ownership: ${file} has 2 owners`]);
  });
  it('requires standalone CalorieTracker tests in its explicit script', () => {
    const path = 'public/tools/CalorieTracker/tests/a.test.js';
    expect(calorieErrors([path], 'vitest run tests/a.test.js')).toEqual([]);
    expect(calorieErrors([path], 'vitest run')).toEqual([`calorie-list: ${path}`]);
  });
  it('requires pinned actions, read permissions and credential-free checkout', () => {
    const workflow = `permissions:\n  contents: read\njobs:\n  example:\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)} # v7\n        with:\n          persist-credentials: false\n`;
    const validate = (source: string) => workflowErrors({ '.github/workflows/ci.yml': source });
    expect(validate(workflow)).toEqual([]);
    expect(validate(workflow.replace('a'.repeat(40), 'v7'))).toContain('action-pin: .github/workflows/ci.yml:6');
    expect(validate(workflow.replace('persist-credentials: false', 'persist-credentials: true')).join()).toContain('checkout-credentials:');
    expect(validate(workflow.replace('contents: read', 'contents: write')).join()).toContain('permissions:');
    expect(validate(workflow.replace('actions/checkout', 'actions/upload-artifact')).join()).toContain('artifacts:');
    expect(validate(workflow + '# secrets.EXAMPLE\n').join()).toContain('secrets:');
  });
  it('rejects config and command retries', () => {
    expect(retryErrors({ 'vitest.config.ts': 'test: { retry: 1 }' }, { test: 'vitest --retry 1' })).toHaveLength(2);
    expect(retryErrors({}, { test: 'vitest run' })).toEqual([]);
  });
  it('requires every blocking stage in the gate and pending stages without jobs', () => {
    const blocking = contract.stages.filter((stage) => stage.status === 'blocking').map((stage) => stage.id);
    const ci = 'jobs:\n' + blocking.map((id) => `  ${id}:\n    name: ${id}\n`).join('') + `  ci-gate:\n    needs: [${blocking.join(', ')}]\n`;
    const workflows = { '.github/workflows/ci.yml': ci, '.github/workflows/deploy-smoke.yml': 'jobs:\n  deploy-smoke:\n    name: deploy-smoke\n' };
    expect(stageErrors(contract, workflows, now)).toEqual([]);
    expect(stageErrors(contract, { ...workflows, '.github/workflows/ci.yml': ci.replace('needs: [lint, ', 'needs: [') }, now)).toContain('stages: ci-gate needs must equal blocking stages');
    expect(stageErrors(contract, { ...workflows, '.github/workflows/ci.yml': ci + '  browser-auth:\n    name: browser-auth\n' }, now)).toContain('stages: pending job browser-auth');
    expect(stageErrors(contract, workflows, new Date('2027-02-02')).join()).toContain('stages: invalid pending');
  });
});
