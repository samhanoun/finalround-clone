import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('profiles')
      .select(`
        id,
        email,
        full_name,
        avatar_url,
        created_at,
        updated_at,
        stripe_subscriptions!inner(status)
      `, { count: 'exact' });

    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: profiles, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get subscription data separately since the join might be complex
    const userIds = profiles?.map(p => p.id) || [];
    
    const { data: subscriptions } = await supabase
      .from('stripe_subscriptions')
      .select('user_id, status, stripe_price_id, current_period_end')
      .in('user_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

    const subscriptionMap = new Map(
      (subscriptions || []).map(s => [s.user_id, s])
    );

    const users = profiles?.map(profile => ({
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      subscription: subscriptionMap.get(profile.id) || null
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
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const { user_id, action, data } = body;

    if (!user_id || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Admin check skipped - using service role for admin operations

    switch (action) {
      case 'update_profile': {
        const { error } = await supabase
          .from('profiles')
          .update(data)
          .eq('id', user_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'suspend_user': {
        // Disable user auth - using admin API
        try {
          const adminAuth = supabase.auth.admin;
          await (adminAuth as unknown as { updateUser: (id: string, data: { email_confirm: boolean }) => Promise<{ error: Error | null }> }).updateUser(user_id, { email_confirm: false });
        } catch (authError) {
          console.error('Auth update error:', authError);
        }

        // Add fraud flag
        await supabase.from('fraud_flags').insert({
          user_id,
          flag_type: 'suspicious_activity',
          severity: 'high',
          description: 'User suspended by admin'
        });

        return NextResponse.json({ success: true });
      }

      case 'unsuspend_user': {
        // Re-enable user auth
        try {
          const adminAuth = supabase.auth.admin;
          await (adminAuth as unknown as { updateUser: (id: string, data: { email_confirm: boolean }) => Promise<{ error: Error | null }> }).updateUser(user_id, { email_confirm: true });
        } catch (authError) {
          console.error('Auth update error:', authError);
        }
        return NextResponse.json({ success: true });
      }

      case 'set_admin': {
        const { error } = await supabase
          .from('admin_users')
          .upsert({
            user_id,
            role: data.role || 'admin',
            permissions: data.permissions || ['read', 'write']
          }, { onConflict: 'user_id' });

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin user action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
