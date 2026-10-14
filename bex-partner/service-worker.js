const CACHE_NAME = "bex-partner-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/icons/bex-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Do not cache API, authentication, or dashboard data responses.
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/") || url.pathname.includes("supabase")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put("/index.html", response.clone()));
      return response;
    }).catch(() => caches.match("/index.html")));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req)));
});
