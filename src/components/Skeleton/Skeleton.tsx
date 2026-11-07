'use client';

import { useTranslations } from 'next-intl';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string;
  height?: string;
  /** Match what the block stands for: 4 a line of text, 6 a tag, 8 a control, 14 a card, 50% an avatar. */
  borderRadius?: string;
  className?: string;
}

export function Skeleton({ width = '100%', height = '16px', borderRadius = '4px', className = '' }: SkeletonProps) {
  return <span className={`${styles.skeleton} ${className}`} style={{ width, height, borderRadius }} aria-hidden="true" />;
}

export function CardSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={styles.cardHeader}>
        <Skeleton width="55%" height="16px" />
        <Skeleton width="56px" height="22px" borderRadius="6px" />
      </div>
      <Skeleton width="90%" height="12px" className={styles.mt} />
      <Skeleton width="70%" height="12px" />
      <div className={styles.cardFooter}>
        <Skeleton width="112px" height="40px" borderRadius="8px" />
        <Skeleton width="96px" height="40px" borderRadius="8px" />
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className={styles.form} aria-hidden="true">
      <Skeleton width="30%" height="12px" />
      <Skeleton width="100%" height="40px" borderRadius="8px" />
      <Skeleton width="25%" height="12px" className={styles.mt} />
      <Skeleton width="100%" height="104px" borderRadius="8px" />
      <div className={`${styles.formRow} ${styles.mt}`}>
        <Skeleton width="50%" height="40px" borderRadius="8px" />
        <Skeleton width="50%" height="40px" borderRadius="8px" />
      </div>
      <Skeleton width="160px" height="40px" borderRadius="8px" className={styles.mt} />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.table} aria-hidden="true">
      <div className={styles.tableHeader}>
        <Skeleton width="60%" height="10px" />
        <Skeleton width="50%" height="10px" />
        <Skeleton width="70%" height="10px" />
        <Skeleton width="50%" height="10px" />
        <Skeleton width="40%" height="10px" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={styles.tableRow}>
          <Skeleton width="80%" height="14px" />
          <Skeleton width="65%" height="14px" />
          <Skeleton width="56px" height="22px" borderRadius="6px" />
          <Skeleton width="60%" height="14px" />
          <Skeleton width="45%" height="14px" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className={styles.dashboard} aria-hidden="true">
      <div className={styles.dashboardGrid}>
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className={styles.dashboardSection}>
        <Skeleton width="160px" height="16px" />
        <TableSkeleton rows={4} />
      </div>
    </div>
  );
}

/** A whole page loading inside the app frame: the title, one main block and two smaller ones. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <span className="srOnly">{label}</span>
      <div className={styles.pageTitle} aria-hidden="true">
        <Skeleton width="200px" height="24px" borderRadius="6px" />
      </div>
      <div className={styles.pageGrid} aria-hidden="true">
        <Skeleton className={styles.pageMain} width="100%" height="280px" borderRadius="var(--radius-card)" />
        <Skeleton width="100%" height="160px" borderRadius="var(--radius-card)" />
        <Skeleton width="100%" height="160px" borderRadius="var(--radius-card)" />
      </div>
    </div>
  );
}

/** A small, quiet spinner with optional text, for loading that has no shape yet. */
export function LoadingSpinner({ text }: { text?: string }) {
  const t = useTranslations('common');
  return (
    <div className={styles.spinnerContainer} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.spinnerText}>{text ?? t('loading')}</span>
    </div>
  );
}

/** Inline loading indicator */
export function LoadingDots() {
  const t = useTranslations('common');
  return (
    <span className={styles.dots} role="status" aria-label={t('loading')}>
      <span aria-hidden="true">.</span>
      <span aria-hidden="true">.</span>
      <span aria-hidden="true">.</span>
    </span>
  );
}
