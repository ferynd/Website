import fs from 'node:fs';
import { CATALOGUES, catalogueHrefs } from './lib/catalogue.mjs';
import { scriptChunks } from './lib/smoke.mjs';
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--profile', '--base-url', '--target'].includes(args[i]) || !args[i + 1]) { console.error('Invalid smoke arguments'); process.exit(2); }
  options[args[i].slice(2)] = args[i + 1];
}
let base;
const targets = { production: 'https://jamesberto.com', 'workers-dev': 'https://jamesberto-website.arkkahdarkkahd.workers.dev' };
try {
  if (options.profile === 'local' && !options.target) {
    base = new URL(options['base-url']);
    if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error();
  } else if (options.profile === 'deployed' && !options['base-url'] && Object.hasOwn(targets, options.target)) base = new URL(targets[options.target]);
  else throw Error();
} catch { console.error('Only local loopback URLs or the two deployed targets are allowed'); process.exit(2); }
let failed = false;
const cache = new Map();
async function request(path, method = 'GET') {
  const key = `${method} ${path}`;
  if (cache.has(key)) return cache.get(key);
  // No redirects: a public endpoint cannot redirect a probe to another host.
  let result;
  try {
    const response = await fetch(new URL(path, base), { method, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    result = { status: response.status, headers: response.headers, body: await response.text() };
  } catch { result = { status: 0, headers: new Headers(), body: '' }; }
  cache.set(key, result);
  return result;
}
function check(ok, method, path, status, name) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path} ${status} ${name}`);
  if (!ok) failed = true;
}
const catalogues = Object.fromEntries(CATALOGUES.map((path) => [path, catalogueHrefs(fs.readFileSync(`app${path}/page.tsx`, 'utf8'))]));
const paths = [...new Set(['/', ...CATALOGUES, '/style-guide', ...Object.values(catalogues).flat(), '/shared-styles.css'])];
for (const path of paths) {
  const response = await request(path);
  check(response.status === 200 && !/EvalError|Code generation from strings/.test(response.body), 'GET', path, response.status, 'route');
}
for (const [path, hrefs] of Object.entries(catalogues)) {
  const response = await request(path);
  for (const href of hrefs) check(response.body.includes(`href="${href}"`) || response.body.includes(`href='${href}'`), 'GET', path, response.status, `server-html-link:${href}`);
}
for (const path of ['/trips/JapanTrip.html', ...(options.profile === 'deployed' ? ['/tools/CalorieTracker/node_modules/vitest/package.json'] : [])]) {
  const response = await request(path);
  check(response.status === 404, 'GET', path, response.status, 'private-path-absent');
}
for (const path of ['/', '/tools/social-security/index.html']) {
  const response = await request(path);
  check(response.headers.get('x-content-type-options') === 'nosniff' && !!response.headers.get('referrer-policy'), 'GET', path, response.status, 'security-headers');
}
{
  const path = '/api/transcriber/status', response = await request(path);
  let body;
  try { body = JSON.parse(response.body); } catch { /* reported without the body below */ }
  check(response.status === 200 && body?.signedIn === false && body.transcribeKeyConfigured === null && body.correctionKeyConfigured === null, 'GET', path, response.status, 'unauthenticated-status');
}
{
  const path = '/api/transcriber/transcribe', response = await request(path, 'POST');
  check([401, 403].includes(response.status), 'POST', path, response.status, 'auth-before-work');
}
{
  // Probe the map for every chunk referenced by any smoked page, not just the first one on /.
  const chunks = new Set();
  for (const path of paths) for (const chunk of scriptChunks((await request(path)).body)) chunks.add(chunk);
  if (!chunks.size) check(false, 'GET', '/', (await request('/')).status, 'source-map-chunk-discovery');
  for (const chunk of [...chunks].sort()) {
    const path = `${chunk}.map`, response = await request(path);
    check(response.status === 404, 'GET', path, response.status, 'source-map-absent');
  }
}
if (options.profile === 'deployed') {
  const response = await request('/');
  console.log(`PASS GET / ${response.status} x-opennext-cache:${response.headers.has('x-opennext-cache') ? 'present' : 'absent'}-informational`);
  console.log('TODO F-152/AR-01: deployed commit SHA and same-release rules verification');
}
console.log(`SMOKE ${failed ? 'FAIL' : 'PASS'}`);
process.exitCode = failed ? 1 : 0;
