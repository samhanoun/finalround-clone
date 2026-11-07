'use client';

import { useRouter } from '@/i18n/routing';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToastHook } from '@/components/Toast';

/** Creates a practice interview and opens it; `query` fills in its setup (e.g. "company=Acme&bank=1"). */
export function NewPracticeButton({
  primary = false,
  label,
  query,
}: {
  primary?: boolean;
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
      toast.success(t('createdTitle'), t('createdBody'));
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

  return (
    <>
      <button
        className={primary ? 'button buttonPrimary' : 'button'}
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
