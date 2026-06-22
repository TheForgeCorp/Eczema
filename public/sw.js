// Baseline service worker: handles push delivery, notification taps, and an offline shell.

const CACHE = 'baseline-v10';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/capture.js', '/library.js', '/episodes.js', '/insights.js', '/reports.js', '/push.js', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for navigation so the app stays current; fall back to the cached shell offline.
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
  }
});

// A push arrives from the Beelink scheduler even when the app is closed.
self.addEventListener('push', (event) => {
  let data = { title: 'Baseline', body: '', url: '/' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
      tag: data.tag || undefined,
      renotify: !!data.tag
    })
  );
});

// Tapping the notification opens or focuses the app at the deep link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) { try { await client.navigate(url); } catch (_) {} return client.focus(); }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
