'use client';

import { useTranslations } from 'next-intl';

/** The loading screen for pages that fetch on the server (loading.tsx). */
export function PageLoading() {
  const t = useTranslations('common');
  return (
    <div className="loading-container" role="status">
      <div className="loading-content">
        <div className="spinner" aria-hidden="true" />
        <p>{t('loading')}</p>
      </div>

      <style jsx>{`
        .loading-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }

        .loading-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--line);
          border-top-color: var(--ice);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .spinner {
            animation: none;
          }
        }

        p {
          color: var(--mist);
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
