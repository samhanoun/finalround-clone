'use client';

import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  className?: string;
}

export function Skeleton({ width = '100%', height = '20px', borderRadius = '8px', className = '' }: SkeletonProps) {
  return (
    <div 
      className={`${styles.skeleton} ${className}`}
      style={{ width, height, borderRadius }}
      aria-hidden="true"
    />
  );
}

export function CardSkeleton() {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Skeleton width="60%" height="24px" />
        <Skeleton width="80px" height="24px" borderRadius="999px" />
      </div>
      <Skeleton width="90%" height="16px" className={styles.mt} />
      <Skeleton width="70%" height="16px" className={styles.mt} />
      <div className={styles.cardFooter}>
        <Skeleton width="120px" height="36px" borderRadius="12px" />
        <Skeleton width="100px" height="36px" borderRadius="12px" />
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className={styles.form}>
      <Skeleton width="30%" height="16px" />
      <Skeleton width="100%" height="44px" borderRadius="12px" />
      <Skeleton width="25%" height="16px" className={styles.mt} />
      <Skeleton width="100%" height="96px" borderRadius="12px" />
      <div className={styles.formRow}>
        <Skeleton width="48%" height="44px" borderRadius="12px" />
        <Skeleton width="48%" height="44px" borderRadius="12px" />
      </div>
      <Skeleton width="160px" height="44px" borderRadius="12px" className={styles.mt} />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.table}>
      <div className={styles.tableHeader}>
        <Skeleton width="20%" height="16px" />
        <Skeleton width="25%" height="16px" />
        <Skeleton width="15%" height="16px" />
        <Skeleton width="20%" height="16px" />
        <Skeleton width="20%" height="16px" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.tableRow}>
          <Skeleton width="20%" height="20px" />
          <Skeleton width="25%" height="20px" />
          <Skeleton width="15%" height="20px" borderRadius="999px" />
          <Skeleton width="20%" height="20px" />
          <Skeleton width="20%" height="20px" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className={styles.dashboard}>
      <div className={styles.dashboardGrid}>
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className={styles.dashboardSection}>
        <Skeleton width="40%" height="28px" />
        <TableSkeleton rows={4} />
      </div>
    </div>
  );
}

// Loading spinner with optional text
export function LoadingSpinner({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className={styles.spinnerContainer} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <span className={styles.spinnerText}>{text}</span>
    </div>
  );
}

// Inline loading indicator
export function LoadingDots() {
  return (
    <span className={styles.dots} role="status" aria-label="Loading">
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}
