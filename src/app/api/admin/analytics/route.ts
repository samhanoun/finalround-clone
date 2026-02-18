import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d'; // 7d, 30d, 90d
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Calculate date range
    let start: Date;
    const end = endDate ? new Date(endDate) : new Date();
    
    if (startDate) {
      start = new Date(startDate);
    } else {
      const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
      start = new Date();
      start.setDate(start.getDate() - days);
    }

    // Get aggregated stats
    const { data: dailyStats, error: statsError } = await supabase
      .from('daily_usage_stats')
      .select('*')
      .gte('date', start.toISOString().split('T')[0])
      .lte('date', end.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (statsError) {
      console.error('Error fetching daily stats:', statsError);
    }

    // Get total counts
    const [{ count: totalUsers }, { count: totalSubscriptions }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('stripe_subscriptions').select('*', { count: 'exact', head: true })
    ]);

    // Get active subscriptions
    const { count: activeSubscriptions } = await supabase
      .from('stripe_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Calculate totals from daily stats
    const initialTotals = {
      totalUsers: totalUsers || 0,
      activeUsers: 0,
      newUsers: 0,
      totalSessions: 0,
      totalApiCalls: 0,
      totalRevenue: 0,
      totalSubscriptions: totalSubscriptions || 0,
      activeSubscriptions: activeSubscriptions || 0,
      churnedSubscriptions: 0,
      fraudFlags: 0,
      ticketsOpened: 0,
      ticketsResolved: 0
    };

    const totals = dailyStats?.reduce((acc, day) => ({
      totalUsers: Math.max(acc.totalUsers, day.total_users),
      activeUsers: acc.activeUsers + day.active_users,
      newUsers: acc.newUsers + day.new_users,
      totalSessions: acc.totalSessions + day.total_sessions,
      totalApiCalls: acc.totalApiCalls + day.total_api_calls,
      totalRevenue: acc.totalRevenue + day.total_stripe_revenue_cents,
      totalSubscriptions: acc.totalSubscriptions + day.total_subscriptions,
      activeSubscriptions: acc.activeSubscriptions + day.active_subscriptions,
      churnedSubscriptions: acc.churnedSubscriptions + day.churned_subscriptions,
      fraudFlags: acc.fraudFlags + day.fraud_flags_raised,
      ticketsOpened: acc.ticketsOpened + day.support_tickets_opened,
      ticketsResolved: acc.ticketsResolved + day.support_tickets_resolved
    }), initialTotals) || initialTotals;

    // Get user growth data
    const { data: userGrowth } = await supabase
      .from('profiles')
      .select('created_at')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());

    const growthByDate = userGrowth?.reduce((acc, u) => {
      const date = new Date(u.created_at).toISOString().split('T')[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    // Get revenue by day
    const revenueByDate = dailyStats?.reduce((acc, day) => {
      acc[day.date] = day.total_stripe_revenue_cents;
      return acc;
    }, {} as Record<string, number>) || {};

    // Calculate churn rate
    const churnRate = totals.totalSubscriptions > 0 
      ? (totals.churnedSubscriptions / totals.totalSubscriptions) * 100 
      : 0;

    // Calculate MRR (assuming all plans are monthly)
    const mrr = totals.activeSubscriptions * 999; // Placeholder - should come from stripe prices

    return NextResponse.json({
      period: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        ...totals,
        mrr,
        churnRate: Math.round(churnRate * 100) / 100
      },
      daily: dailyStats || [],
      charts: {
        userGrowth: growthByDate,
        revenue: revenueByDate
      }
    });
  } catch (error) {
    console.error('Admin analytics API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
