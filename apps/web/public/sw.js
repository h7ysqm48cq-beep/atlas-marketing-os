const CACHE_NAME = "atlas-pwa-v6";

const STATIC_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];


self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined)
  );
});


self.addEventListener("activate", (event) => {
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
  );

  self.clients.claim();
});


self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});


self.addEventListener("fetch", (event) => {

  const request = event.request;

  if (request.method !== "GET") {
    return;
  }


  const url = new URL(request.url);


  if (url.origin !== self.location.origin) {
    return;
  }


  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/")
  ) {
    return;
  }


  if (request.mode === "navigate") {

    event.respondWith(
      fetch(request)
        .catch(async () => {

          const cached =
            await caches.match("/offline.html");

          return cached || Response.error();

        })
    );

    return;
  }


  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  ) {

    event.respondWith(
      caches.match(request)
        .then(async (cached)=>{

          if(cached){
            return cached;
          }

          const response =
            await fetch(request);

          if(response.ok){

            const cache =
              await caches.open(CACHE_NAME);

            cache.put(
              request,
              response.clone()
            );
          }

          return response;

        })
    );
  }

});
