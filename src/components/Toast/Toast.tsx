'use client';

import { useState } from 'react';
import { useToast, Toast as ToastType } from './ToastContext';
import styles from './Toast.module.css';

// Icons for each toast type
const icons: Record<ToastType['type'], string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

function ToastItem({ toast, onClose }: { toast: ToastType; onClose: () => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = () => {
    setIsExiting(true);
  };

  const handleAnimationEnd = () => {
    if (isExiting) {
      onClose();
    }
  };

  return (
    <div 
      className={`${styles.toast} ${styles[toast.type]} ${isExiting ? styles.exiting : ''}`}
      role="alert"
      aria-live="polite"
      onAnimationEnd={handleAnimationEnd}
    >
      <span className={styles.icon} aria-hidden="true">{icons[toast.type]}</span>
      <div className={styles.content}>
        <p className={styles.title}>{toast.title}</p>
        {toast.message && <p className={styles.message}>{toast.message}</p>}
      </div>
      <button 
        className={styles.closeButton}
        onClick={handleClose}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem 
          key={toast.id} 
          toast={toast} 
          onClose={() => removeToast(toast.id)} 
        />
      ))}
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
