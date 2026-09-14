/**
 * Entole's service worker.
 *
 * It exists so the installed app opens instantly and says something honest
 * when the phone has no signal. It deliberately does not cache pages.
 *
 * A payment is pending until it is settled, and a cached page is a payment
 * frozen at whatever it looked like last time. Serving one back would be
 * optimistic state under another name, which the product forbids. So page
 * requests always go to the network, and when the network is gone the offline
 * page answers instead of a stale balance.
 *
 * What is cached is only what cannot go stale: the build's fingerprinted
 * assets, the icons, and the offline page itself.
 */

const VERSION = 'v1';
const SHELL = `entole-shell-${VERSION}`;
const ASSETS = `entole-assets-${VERSION}`;
const OFFLINE_URL = '/offline';

/** Immutable by construction — the filename changes when the bytes do. */
const IMMUTABLE = ['/_next/static/', '/icons/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** A newly deployed build should take over without the user closing the app. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function fromNetwork(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(SHELL);
    const offline = await shell.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

async function fromCacheFirst(request) {
  const assets = await caches.open(ASSETS);
  const hit = await assets.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) await assets.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Anything that changes money is never touched. It goes straight out.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fromNetwork(request));
    return;
  }

  if (IMMUTABLE.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(fromCacheFirst(request));
  }
});
