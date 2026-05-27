const CACHE_NAME = 'hamster-chat-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/variables.css',
    './css/style.css',
    './css/glass.css',
    './css/animations.css',
    './js/app.js',
    './js/firebase-config.js',
    './js/auth.js',
    './js/calls.js',
    './js/ai.js',
    './js/stories.js',
    './js/ui.js',
    './js/admin.js',
    './js/settings.js',
    './js/media.js',
    './js/E2E.js',
    './assets/logo.jpg',
    './assets/icons/icon-192.png',
    './assets/icons/app_icon_512_1772927838563.png',
    'https://unpkg.com/lucide@latest',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap'
];

// Install: Cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('SW: Pre-caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: Cleanup old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Network First falling back to Cache
self.addEventListener('fetch', event => {
    // Skip non-GET requests (like Firebase analytics)
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // If network works, clone it and put in cache
                return caches.open(CACHE_NAME).then(cache => {
                    // Only cache successful responses and some external ones
                    if (networkResponse.status === 200 || networkResponse.type === 'opaque') {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                });
            })
            .catch(() => {
                // If network fails, try the cache (ignoring search query parameters for seamless offline PWA experience)
                return caches.match(event.request, { ignoreSearch: true });
            })
    );
});
