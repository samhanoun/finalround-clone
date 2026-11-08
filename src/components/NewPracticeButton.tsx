'use client';

import { useRouter } from '@/i18n/routing';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToastHook } from '@/components/Toast';

/**
 * Creates a practice interview and opens its setup; `query` fills that setup
 * in (e.g. "company=Acme&bank=1", or "goal=<id>" for everything a goal knows).
 * Opening the setup is the confirmation, so only a failure shows a toast.
 */
export function NewPracticeButton({
  primary = false,
  small = false,
  label,
  query,
}: {
  primary?: boolean;
  /** The 32px size, for buttons inside list rows. */
  small?: boolean;
  label?: string;
  query?: string;
}) {
  const t = useTranslations('NewPractice');
  const router = useRouter();
  const toast = useToastHook();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const statusId = useId();

  async function createInterview() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t('defaultTitle'), status: 'draft', meta: {} }),
      });
      if (!res.ok) throw new Error(t('failed'));

      const json = await res.json();
      router.push(`/interview/${json.session.id}${query ? `?${query}` : ''}`);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : t('failed');
      setError(message);
      toast.error(t('notCreated'), message);
    } finally {
      setLoading(false);
    }
  }

  const className = ['button', primary ? 'buttonPrimary' : '', small ? 'buttonSmall' : ''].filter(Boolean).join(' ');

  return (
    <>
      <button
        className={className}
        onClick={createInterview}
        disabled={loading}
        type="button"
        aria-describedby={loading ? statusId : error ? errorId : undefined}
      >
        {loading ? t('creating') : (label ?? t('label'))}
      </button>
      {loading ? (
        <span id={statusId} className="srOnly">
          {t('creatingStatus')}
        </span>
      ) : null}
      {error ? (
        <div className="error" role="alert" id={errorId} style={{ flexBasis: '100%' }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
