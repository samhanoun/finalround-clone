import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';

/** Tickets still needing someone: what the Support tickets tab lists. */
const OPEN_TICKET_STATUSES = ['open', 'in_progress', 'waiting_user'];
/** Subscriptions that are running (a past-due one is in trouble, and counted as such by Stripe). */
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * GET /api/admin/analytics: the Overview's figures, counted from the live tables on each request.
 * `period` (7d, 30d or 90d; 30d by default) sets the window for new sign-ups.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(MANAGE_ROLES);
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();
    const days = PERIOD_DAYS[new URL(request.url).searchParams.get('period') ?? ''] ?? 30;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const count = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true });
    const results = await Promise.all([
      count('profiles'),
      count('profiles').gte('created_at', start.toISOString()),
      count('stripe_subscriptions').in('status', ACTIVE_SUBSCRIPTION_STATUSES),
      count('support_tickets').in('status', OPEN_TICKET_STATUSES),
      count('fraud_flags').eq('resolved', false),
    ]);

    // A figure that couldn't be counted isn't shown as zero.
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error('[admin analytics] a count failed', failed.error.message);
      return NextResponse.json({ error: 'load_failed' }, { status: 500 });
    }

    const [totalUsers, newUsers, activeSubscriptions, openTickets, openFraudFlags] = results.map((result) => result.count ?? 0);
    return NextResponse.json({
      period: { days, start: start.toISOString(), end: end.toISOString() },
      totals: { totalUsers, newUsers, activeSubscriptions, openTickets, openFraudFlags },
    });
  } catch (error) {
    console.error('Admin analytics API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
