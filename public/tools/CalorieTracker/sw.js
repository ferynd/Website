const CACHE_NAME = 'nutritrack-v1';

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
  './utils/time.js',
  './utils/ui.js',
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
      .then((cache) => cache.addAll(APP_SHELL))
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

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
