'use client';

import { useEffect, useState } from 'react';

interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface ServiceWorkerStatus {
  supported: boolean;
  registered: boolean;
  subscription: PushSubscriptionJSON | null;
  error?: string;
}

export function useServiceWorker() {
  const [status, setStatus] = useState<ServiceWorkerStatus>({
    supported: false,
    registered: false,
    subscription: null,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      setStatus(prev => ({ ...prev, supported: false }));
      return;
    }

    setStatus(prev => ({ ...prev, supported: true }));

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        console.log('Service Worker registered:', registration.scope);

        // Check for existing subscription
        const subscription = await registration.pushManager.getSubscription();
        
        setStatus(prev => ({
          ...prev,
          registered: true,
          subscription: subscription ? subscription.toJSON() as unknown as PushSubscriptionJSON : null,
        }));

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available
                console.log('New Service Worker version available');
              }
            });
          }
        });
      } catch (error) {
        console.error('Service Worker registration failed:', error);
        setStatus(prev => ({
          ...prev,
          registered: false,
          error: error instanceof Error ? error.message : 'Registration failed',
        }));
      }
    };

    registerServiceWorker();
  }, []);

  const subscribeToPush = async (vapidPublicKey: string): Promise<PushSubscription | null> => {
    if (!status.registered) {
      console.error('Service Worker not registered');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      });

      setStatus(prev => ({
        ...prev,
        subscription: subscription.toJSON() as unknown as PushSubscriptionJSON,
      }));

      return subscription;
    } catch (error) {
      console.error('Push subscription failed:', error);
      return null;
    }
  };

  const unsubscribeFromPush = async (): Promise<boolean> => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        setStatus(prev => ({ ...prev, subscription: null }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Push unsubscribe failed:', error);
      return false;
    }
  };

  return {
    ...status,
    subscribeToPush,
    unsubscribeFromPush,
  };
}

// Utility function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray as BufferSource;
}

export default useServiceWorker;
