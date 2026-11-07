'use client';

import { ToastProvider, ToastContainer } from '@/components/Toast';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerProvider';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ToastContainer />
      <ServiceWorkerRegistrar />
    </ToastProvider>
  );
}
