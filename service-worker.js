const CACHE_NAME = 'llms-shell-v4';
const getAppShell = () => {
    const base = self.location.origin;
    return [
        `${base}/`,
        `${base}/index.html`,
        `${base}/manifest.json`,
        `${base}/styles.css`,
        `${base}/script.js`
    ];
};

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(getAppShell()))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE_NAME)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // bypass non-GET
    if (request.method !== 'GET') {
        return;
    }

    // network-first for ollama api so responses are always fresh
    if (url.hostname === 'ollama.houseofmates.space') {
        event.respondWith(
            fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503 }))
        );
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // cache-first for shell assets
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                return cached;
            }
            return fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => cached);
        })
    );
});
