'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { SignOutIcon } from './icons';

/** `compact`: an icon button for the navigation rail. */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();

  async function onClick() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <button
      className={compact ? 'button buttonGhost' : 'button'}
      type="button"
      onClick={onClick}
      aria-label="Sign out of your account"
      title={compact ? 'Sign out' : undefined}
      style={compact ? { padding: 0, width: 44 } : undefined}
    >
      {compact ? <SignOutIcon size={20} /> : 'Sign out'}
    </button>
  );
}
