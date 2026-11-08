import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';
import { isSuspended, setSuspended } from '../_lib/suspension';

// Profile columns an admin may edit. id, email (owned by Supabase Auth) and
// organization_id (tenant boundary) are deliberately excluded.
const EDITABLE_PROFILE_FIELDS = [
  'full_name',
  'avatar_url',
  'target_roles',
  'years_experience',
  'industry',
  'language',
  'timezone',
  'email_notifications',
  'onboarding_completed',
] as const;

function pickEditableProfileFields(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) return {};
  const source = data as Record<string, unknown>;
  return Object.fromEntries(
    EDITABLE_PROFILE_FIELDS.filter((field) => field in source).map((field) => [field, source[field]]),
  );
}

/** Every admin PATCH has one shape: the action, the id of what it acts on, and the action's own fields under `data`. */
const PatchSchema = z.object({
  action: z.string().min(1),
  user_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const SetAdminData = z.object({
  role: z.enum(['admin', 'super_admin', 'support_agent']).default('admin'),
  permissions: z.array(z.string()).default(['read', 'write']),
});

const MAX_PAGE_SIZE = 100;

/** Subscription states that still give the plan, preferred when someone has several rows. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

type SubscriptionRow = { user_id: string; status: string; stripe_price_id: string | null; current_period_end: string | null };

/** The subscription to show for a user: a live one first, then the one whose period ends last. */
function pickSubscription(current: SubscriptionRow | undefined, next: SubscriptionRow): SubscriptionRow {
  if (!current) return next;
  const live = (row: SubscriptionRow) => LIVE_STATUSES.has(row.status);
  if (live(current) !== live(next)) return live(next) ? next : current;
  return (next.current_period_end ?? '') > (current.current_period_end ?? '') ? next : current;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = Math.max(parseInt(searchParams.get('page') || '1') || 1, 1);
    // Each listed user costs a Supabase Auth lookup (their suspension), so a page is at most 100.
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20') || 20, 1), MAX_PAGE_SIZE);
    const search = searchParams.get('search') || '';
    const offset = (page - 1) * limit;

    // Every user, subscribed or not. (Subscriptions are read below: profiles and stripe_subscriptions
    // have no foreign key between them to embed, and an inner join would hide everyone on Free.)
    let query = supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, created_at, updated_at', { count: 'exact' });

    // Characters with a meaning in PostgREST's or=(…) syntax, or as wildcards, are dropped from the term.
    const term = search.replace(/[%*,()\\"]/g, ' ').trim();
    if (term) {
      query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%`);
    }

    const { data: profiles, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const userIds = profiles?.map((p) => p.id) || [];

    const [subscriptions, suspended] = await Promise.all([
      userIds.length > 0
        ? supabase.from('stripe_subscriptions').select('user_id, status, stripe_price_id, current_period_end').in('user_id', userIds)
        : Promise.resolve({ data: [] as SubscriptionRow[], error: null }),
      // Suspension lives in Supabase Auth (banned_until). Unknown (null) when it can't be read: the list
      // still loads, and suspending again is harmless.
      Promise.all(
        userIds.map(async (id) => {
          const { data, error: authError } = await supabase.auth.admin.getUserById(id);
          if (authError || !data.user) {
            console.warn('[admin users] could not read the sign-in status', { userId: id, error: authError?.message });
            return null;
          }
          return isSuspended(data.user);
        }),
      ),
    ]);

    if (subscriptions.error) {
      console.error('Error fetching subscriptions:', subscriptions.error);
      return NextResponse.json({ error: subscriptions.error.message }, { status: 500 });
    }

    const subscriptionMap = new Map<string, SubscriptionRow>();
    for (const row of (subscriptions.data ?? []) as SubscriptionRow[]) {
      subscriptionMap.set(row.user_id, pickSubscription(subscriptionMap.get(row.user_id), row));
    }

    const users = profiles?.map((profile, i) => ({
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      subscription: subscriptionMap.get(profile.id) || null,
      suspended: suspended[i],
    })) || [];

    return NextResponse.json({
      users,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin users API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(MANAGE_ROLES);
  if (!auth.ok) return auth.response;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid_body', parsed.error.flatten());
  const { action, user_id: userId, data = {} } = parsed.data;

  try {
    const supabase = createAdminClient();

    switch (action) {
      case 'update_profile': {
        const updates = pickEditableProfileFields(data);
        if (Object.keys(updates).length === 0) return jsonError(400, 'no_editable_fields');
        const { data: rows, error } = await supabase.from('profiles').update(updates).eq('id', userId).select('id');
        if (error) throw error;
        if (!rows?.length) return jsonError(404, 'not_found');
        return NextResponse.json({ success: true });
      }

      case 'suspend_user': {
        // An admin locking themselves out has no way back in from here.
        if (userId === auth.userId) return jsonError(400, 'cannot_suspend_self');
        await setSuspended(supabase, userId, true);
        // The record of it, in the fraud flags.
        const { error } = await supabase.from('fraud_flags').insert({
          user_id: userId,
          flag_type: 'suspicious_activity',
          severity: 'high',
          description: 'User suspended by admin',
          metadata: { suspended_by: auth.userId },
        });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'unsuspend_user': {
        await setSuspended(supabase, userId, false);
        return NextResponse.json({ success: true });
      }

      case 'set_admin': {
        if (auth.role !== 'super_admin') return jsonError(403, 'forbidden');
        const grant = SetAdminData.safeParse(data);
        if (!grant.success) return jsonError(400, 'invalid_body', grant.error.flatten());
        const { error } = await supabase
          .from('admin_users')
          .upsert({ user_id: userId, role: grant.data.role, permissions: grant.data.permissions }, { onConflict: 'user_id' });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return jsonError(400, 'unknown_action');
    }
  } catch (error) {
    console.error('[admin users] action failed', { action, userId, error: (error as { message?: string })?.message ?? error });
    return jsonError(500, 'action_failed');
  }
}
