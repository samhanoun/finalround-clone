'use client';

import { useRouter } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/browser';
import { useTranslations } from 'next-intl';
import { SignOutIcon } from './icons';

/** `compact`: an icon button for the navigation rail. */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const t = useTranslations('SignOutButton');

  async function onClick() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <button
      className={compact ? 'iconButton' : 'button'}
      type="button"
      onClick={onClick}
      aria-label={t('label')}
      title={compact ? t('short') : undefined}
    >
      {compact ? <SignOutIcon size={18} /> : t('short')}
    </button>
  );
}
