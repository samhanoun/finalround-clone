import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type AdminRole = 'admin' | 'super_admin' | 'support_agent';

/** Roles allowed to change users, subscriptions and fraud data. support_agent is read/tickets only. */
export const MANAGE_ROLES: AdminRole[] = ['admin', 'super_admin'];

export type AdminCheck =
  | { ok: true; userId: string; role: AdminRole }
  | { ok: false; response: NextResponse };

/**
 * Require the signed-in caller (from request cookies) to have an admin_users row.
 * Admin routes use the service-role client, which bypasses RLS, so every handler
 * must call this before touching data.
 */
export async function requireAdmin(allowedRoles?: AdminRole[]): Promise<AdminCheck> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle<{ role: AdminRole }>();

  if (!adminUser || (allowedRoles && !allowedRoles.includes(adminUser.role))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { ok: true, userId: user.id, role: adminUser.role };
}
