// Temporary source parser; AR-07 replaces literal hrefs with a typed manifest.
export const CATALOGUES = ['/tools', '/games', '/trips'];
export function catalogueHrefs(source) {
  return [...new Set([...source.matchAll(/\bhref\s*(?::|=)\s*(?:\{\s*)?['"](\/[^'"\s]*)['"]/g)]
    .map((match) => match[1]).filter((href) => !href.startsWith('//')))];
}
export function routeCandidates(href) {
  const path = decodeURIComponent(href.split(/[?#]/)[0]).replace(/^\/+|\/+$/g, '');
  if (path.split('/').includes('..')) return [];
  return [path ? `app/${path}/page.tsx` : 'app/page.tsx', `public/${path}`];
}
export function catalogueErrors(pages, exists) {
  return Object.entries(pages).flatMap(([file, source]) => catalogueHrefs(source)
    .filter((href) => !routeCandidates(href).some(exists))
    .map((href) => `catalogue: ${file} -> ${href}`));
}
