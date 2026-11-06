import { describe, expect, it } from 'vitest';
import { catalogueErrors, catalogueHrefs, routeCandidates } from '../lib/catalogue.mjs';
import { docLinkErrors, hasBackLink } from '../lib/docs.mjs';

describe('catalogue resolution', () => {
  it('parses literal JSX and object hrefs and deduplicates', () => {
    expect(catalogueHrefs('<Link href="/tools"/><a href={"/games"}/> {href: "/tools"} <a href="//external.test"/>')).toEqual(['/tools', '/games']);
  });
  it('resolves App Router and static public targets', () => {
    const pages = { 'app/tools/page.tsx': '<a href="/tools/example"/><a href="/games/example/index.html"/>' };
    const exists = (file: string) => ['app/tools/example/page.tsx', 'public/games/example/index.html'].includes(file);
    expect(catalogueErrors(pages, exists)).toEqual([]);
    expect(catalogueErrors(pages, () => false)).toHaveLength(2);
    expect(routeCandidates('/tools/example?x=1#target')).toContain('app/tools/example/page.tsx');
    expect(routeCandidates('/../private')).toEqual([]);
  });
});

describe('documentation checks', () => {
  it('requires a static return link', () => {
    for (const href of ['/', '/tools', '/games', '/trips', '../']) expect(hasBackLink(`<a href="${href}">Back</a>`)).toBe(true);
    expect(hasBackLink('<a href="https://example.com">Outside</a>')).toBe(false);
  });
  it('resolves relative links and repository code paths', () => {
    const source = '[Guide](../README.md#intro) and `scripts/ci/check-contract.mjs`';
    expect(docLinkErrors('docs/ci.md', source, (file: string) => ['README.md', 'scripts/ci/check-contract.mjs'].includes(file))).toEqual([]);
    expect(docLinkErrors('docs/ci.md', source, () => false)).toHaveLength(2);
  });
  it('ignores external URLs, fenced examples and known historical absences', () => {
    const source = '[External](https://example.com) [Removed](/public/trips/JapanTrip.html) `CURRENT_WORK.md`\n```md\n[Example](missing.md)\n```';
    expect(docLinkErrors('README.md', source, () => false)).toEqual([]);
  });
  it('still validates archive links while allowing historical code paths', () => {
    expect(docLinkErrors('backlogs/example-completed.md', '[Broken](gone.md) `app/gone.ts`', () => false, { checkCodePaths: false })).toEqual(['doc-link: backlogs/example-completed.md -> gone.md']);
  });
  it('rejects documentation links that escape the repository', () => {
    const errors = docLinkErrors('docs/a.md', '[x](../../../etc/passwd)', () => true);
    expect(errors.some((e: string) => e.includes('doc-link'))).toBe(true);
  });
});
