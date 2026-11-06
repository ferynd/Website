const CACHE_NAME = 'nutritrack-v4';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  '/shared-styles.css',
  './manifest.json',
  './main.js',
  './config.js',
  './constants.js',
  './firebaseConfig.js',
  './icon.svg',
  './icon-192.png',
  './analysis/analysisUI.js',
  './analysis/engine.js',
  './analysis/weightParser.js',
  './analysis/weightUpload.js',
  './events/wire.js',
  './exercise/met.js',
  './exports/exporters.js',
  './food/dropdown.js',
  './food/manager.js',
  './food/save.js',
  './food/stageSavedFood.js',
  './services/ingredientStore.js',
  './services/ingredientSession.js',
  './services/data.js',
  './services/firebase.js',
  './staging/parser.js',
  './state/schema.js',
  './state/store.js',
  './targets/dailyTargetResolver.js',
  './targets/nutritionReferences.js',
  './targets/targetEngine.js',
  './targets/targetUI.js',
  './ui/bankingEngine.js',
  './ui/chart.js',
  './ui/dashboard.js',
  './ui/modals.js',
  './ui/nutrientHelpers.js',
  './ui/nutrientDetail.js',
  './ui/dateRange.js',
  './utils/time.js',
  './utils/ui.js',
  './nutrition/nutrientRecord.js',
  './exports/csvFormat.js',
  '/shared/nutrition/nutrientRegistry.js',
  '/shared/nutrition/capabilities.js',
  '/shared/nutrition/nutrientText.js',
  '/shared/nutrition/contentHash.js',
  '/shared/nutrition/ingredientIds.js',
  '/shared/nutrition/ingredientVariants.js',
  '/shared/nutrition/ingredientRefs.js',
  '/shared/nutrition/ingredientProfile.js',
  '/shared/nutrition/ingredientConversion.js',
  '/shared/nutrition/ingredientStore.js',
  '/shared/nutrition/ingredientMatch.js',
  '/shared/nutrition/ingredientCatalog.js',
  '/shared/nutrition/profileCache.js',
];

const EXTERNAL_RUNTIME = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.0/chart.umd.min.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js',
];

const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /firebasestorage\.googleapis\.com/,
  /google-analytics\.com/,
  /googletagmanager\.com/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all([
        cache.addAll(APP_SHELL),
        ...EXTERNAL_RUNTIME.map((url) =>
          cache.add(new Request(url, { mode: 'cors' })).catch(() => {})
        ),
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (NETWORK_ONLY_PATTERNS.some((re) => re.test(url.href))) return;

  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached || new Response('', { status: 503 }))
      )
    );
    return;
  }

  const path = url.pathname;
  // Content-addressed catalog shards never change under the same URL.
  if (/^\/shared\/nutrition\/catalog\/[^/]+\/(?:search|variants)\/[^/]+\.[a-f0-9]{64}\.json$/.test(path)) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }

  const appShell = /^\/shared\/nutrition\/catalog\/[^/]+\/manifest\.json$/.test(path)
    || event.request.mode === 'navigate'
    || path.endsWith('/')
    || /\.(?:js|mjs|html)$/i.test(path);
  if (appShell) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || new Response('', { status: 503 })))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        });
        return cached || networkFetch;
      })
    )
  );
});
