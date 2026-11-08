import type { SupabaseClient } from '@supabase/supabase-js';

/** Supabase Auth bans for a duration; a suspension lasts until it's lifted, so this is a century. */
export const SUSPENSION_DURATION = '876000h';

/**
 * Suspends or reinstates an account. A banned user can't sign in or refresh a session, so their
 * current one ends within the hour. Throws when Supabase Auth refuses, so the admin is told it failed.
 */
export async function setSuspended(admin: SupabaseClient, userId: string, suspended: boolean): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: suspended ? SUSPENSION_DURATION : 'none' });
  if (error) throw new Error(`Could not ${suspended ? 'suspend' : 'reinstate'} the account: ${error.message}`);
}

/** Whether an account is suspended now, from Supabase Auth's banned_until. */
export function isSuspended(user: { banned_until?: string | null }, now = Date.now()): boolean {
  return !!user.banned_until && Date.parse(user.banned_until) > now;
}
