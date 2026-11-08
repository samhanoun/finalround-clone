'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from '@/components/icons';
import { useToast, Toast as ToastType } from './ToastContext';
import styles from './Toast.module.css';

/** The meaning, as a small icon in its colour; the panel itself stays neutral. */
const ICONS = {
  success: CheckIcon,
  error: AlertIcon,
  warning: AlertIcon,
  info: InfoIcon,
} as const;

/** Errors and warnings interrupt; confirmations wait for a pause. */
const isUrgent = (toast: ToastType) => toast.type === 'error' || toast.type === 'warning';

function ToastItem({ toast, onClose }: { toast: ToastType; onClose: () => void }) {
  const t = useTranslations('Toast');
  const [isExiting, setIsExiting] = useState(false);
  const Icon = ICONS[toast.type];

  return (
    <div
      className={`${styles.toast} ${styles[toast.type]} ${isExiting ? styles.exiting : ''}`}
      onAnimationEnd={() => {
        if (isExiting) onClose();
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className={styles.content}>
        <p className={styles.title}>{toast.title}</p>
        {toast.message && <p className={styles.message}>{toast.message}</p>}
      </div>
      <button type="button" className={styles.closeButton} onClick={() => setIsExiting(true)} aria-label={t('dismiss')}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

/**
 * Two live regions that are always in the page (empty when there is nothing
 * to say), so screen readers hear each toast as it arrives: a polite one for
 * confirmations and an assertive one for errors and warnings.
 */
export function ToastContainer() {
  const t = useTranslations('Toast');
  const { toasts, removeToast } = useToast();
  const item = (toast: ToastType) => <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />;

  return (
    <div className={styles.container}>
      <div className={styles.region} role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions" aria-label={t('label')}>
        {toasts.filter((toast) => !isUrgent(toast)).map(item)}
      </div>
      <div className={styles.region} role="alert" aria-live="assertive" aria-atomic="false" aria-relevant="additions">
        {toasts.filter(isUrgent).map(item)}
      </div>
    </div>
  );
}

// Standalone Toast hook for use in components
export function useToastHook() {
  const toast = useToast();

  return {
    // Show toast and return toast ID for potential later removal
    show: toast.addToast,
    // Quick methods
    success: toast.success,
    error: toast.error,
    warning: toast.warning,
    info: toast.info,
    // Remove specific toast
    remove: toast.removeToast,
    // Clear all toasts
    clear: toast.clearAll,
  };
}
