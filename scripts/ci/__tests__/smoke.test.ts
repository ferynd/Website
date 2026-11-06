import { describe, expect, it } from 'vitest';
import { scriptChunks } from '../lib/smoke.mjs';

describe('source-map chunk discovery', () => {
  it('returns every referenced Next.js chunk, not only the first script tag', () => {
    const html = [
      '<script src="/_next/static/chunks/webpack-0a1b.js" async=""></script>',
      '<script src="/_next/static/chunks/main-app-2c3d.js?dpl=synthetic" async=""></script>',
      "<link rel=\"preload\" as=\"script\" href='/_next/static/chunks/app/tools/page-4e5f.js'/>",
      '<script src="https://jamesberto.example/_next/static/chunks/abs-6a7b.js"></script>',
      '<script src="/_next/static/chunks/webpack-0a1b.js"></script>',
      '<link rel="stylesheet" href="/_next/static/css/app.css"/>',
      '<script src="https://cdn.example/lib.js"></script>',
      '<script>self.__next_f.push([1,"/_next/static/chunks/inline.js"])</script>',
    ].join('\n');
    expect(scriptChunks(html)).toEqual([
      '/_next/static/chunks/abs-6a7b.js',
      '/_next/static/chunks/app/tools/page-4e5f.js',
      '/_next/static/chunks/main-app-2c3d.js',
      '/_next/static/chunks/webpack-0a1b.js',
    ]);
  });
  it('returns nothing for pages without Next.js chunks', () => {
    expect(scriptChunks('<html><body>static</body></html>')).toEqual([]);
  });
});
