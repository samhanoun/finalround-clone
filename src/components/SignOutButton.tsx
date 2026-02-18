'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

export function SignOutButton() {
  const router = useRouter();

  async function onClick() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <button 
      className="button" 
      type="button" 
      onClick={onClick}
      aria-label="Sign out of your account"
    >
      Sign out
    </button>
  );
}
