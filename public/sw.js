// Apex Round service worker (plain JavaScript: browsers load this file as is).
// - Navigations fall back to an offline page when the network is down.
// - Push messages show a notification; clicking it opens the linked page.
// Nothing else is cached: API calls, live audio and answers always go to the
// network, so nothing stale is ever shown during an interview.

const CACHE = 'apex-round-offline-v1';
const OFFLINE_URL = '/offline.html';
const OFFLINE_ASSETS = [OFFLINE_URL, '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Apex Round', {
      body: data.body || 'You have a new notification.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'apex-round',
      data: { url: data.url || '/dashboard' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === url && 'focus' in client);
      if (open) return open.focus();
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }),
  );
});
