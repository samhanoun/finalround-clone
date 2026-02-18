/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE_NAME = `finalround-cache-${version}`;
const ASSETS = [...build, ...files];

// Install event - cache assets
self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (except for fonts)
  if (url.origin !== location.origin && !url.hostname.includes('fonts')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached response if available
      if (cached) {
        // Fetch in background to update cache
        event.waitUntil(
          fetch(event.request).then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response.clone());
              });
            }
          }).catch(() => {
            // Network failed, that's okay - we served from cache
          })
        );
        return cached;
      }

      // Not in cache, fetch from network
      return fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (response.ok && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed, show offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });
    })
  );
});

// Push notification event
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  const data = event.data.json();
  const options: NotificationOptions = {
    body: data.body || 'You have a new notification',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      dateOfArrival: Date.now(),
      primaryKey: data.id || '1',
    },
    actions: data.actions || [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' },
    ],
    tag: data.tag || 'default',
    renotify: data.renotify || true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'FinalRound', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Background sync event (for offline actions)
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'sync-interviews') {
    event.waitUntil(syncInterviews());
  }
});

async function syncInterviews() {
  // This would sync any offline interview data when back online
  // Implementation depends on your data storage strategy
  console.log('Background sync: syncing interviews');
}

// Extend types for service worker
declare const self: ServiceWorkerGlobalScope & {
  registration: ServiceWorkerRegistration;
  skipWaiting: () => Promise<void>;
  clients: Clients;
};

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

interface PushEvent extends Event {
  data: unknown;
}

interface NotificationEvent extends ExtendableEvent {
  notification: Notification;
  action: string;
}

interface SyncEvent extends ExtendableEvent {
  tag: string;
}
