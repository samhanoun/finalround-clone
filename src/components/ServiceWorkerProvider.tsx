'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The service worker (public/sw.js): the offline page, and push notifications
 * for "Notify me on this device" in Settings → Notification preferences.
 */

/** Registers /sw.js once per page load. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('[sw] registration failed', error instanceof Error ? error.message : error);
    });
  }, []);
  return null;
}

export type PushState = 'checking' | 'unsupported' | 'unconfigured' | 'blocked' | 'off' | 'on';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function vapidKey(): Promise<string | null> {
  const res = await fetch('/api/push/vapid-key').catch(() => null);
  if (!res?.ok) return null;
  const json = await res.json().catch(() => null);
  return typeof json?.publicKey === 'string' ? json.publicKey : null;
}

/** Push on this browser: its state, and turning it on or off. */
export function usePushNotifications() {
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setState('unsupported');
        return;
      }
      const key = await vapidKey();
      if (cancelled) return;
      if (!key) return setState('unconfigured');
      if (Notification.permission === 'denied') return setState('blocked');
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!cancelled) setState(subscription ? 'on' : 'off');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const key = await vapidKey();
      if (!key) return setState('unconfigured');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'blocked' : 'off');
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
      const res = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!res.ok) throw new Error('not saved');
      setState('on');
    } catch (error) {
      console.warn('[push] could not turn on', error instanceof Error ? error.message : error);
      setState('off');
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null);
        await subscription.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable };
}
