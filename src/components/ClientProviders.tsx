'use client';

import { ToastProvider, ToastContainer } from '@/components/Toast';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ToastContainer />
    </ToastProvider>
  );
}
