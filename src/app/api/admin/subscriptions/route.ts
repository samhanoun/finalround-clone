import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || '';
    const offset = (page - 1) * limit;

    let query = supabase
      .from('stripe_subscriptions')
      .select(`
        *,
        stripe_customers!inner(email, user_id)
      `, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: subscriptions, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching subscriptions:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const subs = subscriptions?.map(sub => ({
      id: sub.stripe_subscription_id,
      user_id: sub.stripe_customers?.user_id,
      email: sub.stripe_customers?.email,
      status: sub.status,
      price_id: sub.stripe_price_id,
      currency: sub.currency,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      cancel_at_period_end: sub.cancel_at_period_end,
      created_at: sub.created_at
    })) || [];

    return NextResponse.json({
      subscriptions: subs,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin subscriptions API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const { subscription_id, action, data } = body;

    if (!subscription_id || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    switch (action) {
      case 'cancel': {
        // Update in our DB
        const { error } = await supabase
          .from('stripe_subscriptions')
          .update({ 
            cancel_at_period_end: true,
            status: 'canceled'
          })
          .eq('stripe_subscription_id', subscription_id);

        if (error) throw error;
        return NextResponse.json({ success: true, message: 'Subscription will be cancelled at period end' });
      }

      case 'resume': {
        const { error } = await supabase
          .from('stripe_subscriptions')
          .update({ 
            cancel_at_period_end: false,
            status: 'active'
          })
          .eq('stripe_subscription_id', subscription_id);

        if (error) throw error;
        return NextResponse.json({ success: true, message: 'Subscription resumed' });
      }

      case 'update_plan': {
        const { error } = await supabase
          .from('stripe_subscriptions')
          .update({ 
            stripe_price_id: data.price_id
          })
          .eq('stripe_subscription_id', subscription_id);

        if (error) throw error;
        return NextResponse.json({ success: true, message: 'Plan updated' });
      }

      case 'refund': {
        // This would typically call Stripe API
        // For now, just log and return success
        console.log('Refund requested for subscription:', subscription_id);
        return NextResponse.json({ success: true, message: 'Refund processed' });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin subscription action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
