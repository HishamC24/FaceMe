const CACHE_NAME = "pwa-cache";
const ASSETS = [
    "./",
    "./index.html",
    "./index.css",
    "./index.js",
    "./pwa.js",
    "./manifest.json"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(clients.claim());
});

self.addEventListener("fetch", event => {
    event.respondWith(
        (async () => {
            try {
                const networkResponse = await fetch(event.request);
                const cache = await caches.open(CACHE_NAME);
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
            } catch (err) {
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) return cachedResponse;
                if (event.request.mode === "navigate") {
                    return caches.match("./index.html");
                }
                throw err;
            }
        })()
    );
});
