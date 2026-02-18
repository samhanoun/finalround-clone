import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const resolved = searchParams.get('resolved');
    const severity = searchParams.get('severity');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('fraud_flags')
      .select(`
        *,
        profiles!inner(email, full_name)
      `, { count: 'exact' });

    if (resolved !== null && resolved !== undefined) {
      query = query.eq('resolved', resolved === 'true');
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    const { data: flags, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching fraud flags:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const fraudFlags = flags?.map(flag => ({
      id: flag.id,
      user_id: flag.user_id,
      user_email: flag.profiles?.email,
      user_name: flag.profiles?.full_name,
      flag_type: flag.flag_type,
      severity: flag.severity,
      description: flag.description,
      metadata: flag.metadata,
      resolved: flag.resolved,
      resolved_by: flag.resolved_by,
      resolved_at: flag.resolved_at,
      created_at: flag.created_at
    })) || [];

    // Get counts by severity and status
    const [{ data: severityCounts }, { data: statusCounts }] = await Promise.all([
      supabase.from('fraud_flags').select('severity'),
      supabase.from('fraud_flags').select('resolved')
    ]);

    const bySeverity = (severityCounts || []).reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const openCount = (statusCounts || []).filter(f => !f.resolved).length;
    const resolvedCount = (statusCounts || []).filter(f => f.resolved).length;

    return NextResponse.json({
      flags: fraudFlags,
      stats: {
        total: count || 0,
        open: openCount,
        resolved: resolvedCount,
        bySeverity
      },
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin fraud API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const { flag_id, action, data, resolved_by } = body;

    if (!flag_id || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    switch (action) {
      case 'resolve': {
        const { error } = await supabase
          .from('fraud_flags')
          .update({ 
            resolved: true,
            resolved_by: resolved_by,
            resolved_at: new Date().toISOString()
          })
          .eq('id', flag_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'escalate': {
        const severities = ['low', 'medium', 'high', 'critical'];
        const { data: flag } = await supabase
          .from('fraud_flags')
          .select('severity')
          .eq('id', flag_id)
          .single();

        const currentIndex = severities.indexOf(flag?.severity || 'low');
        const newSeverity = severities[Math.min(currentIndex + 1, severities.length - 1)];

        const { error } = await supabase
          .from('fraud_flags')
          .update({ severity: newSeverity })
          .eq('id', flag_id);

        if (error) throw error;
        return NextResponse.json({ success: true, severity: newSeverity });
      }

      case 'update_metadata': {
        const { error } = await supabase
          .from('fraud_flags')
          .update({ metadata: data.metadata })
          .eq('id', flag_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'suspend_user': {
        // Get user_id from flag
        const { data: flag } = await supabase
          .from('fraud_flags')
          .select('user_id')
          .eq('id', flag_id)
          .single();

        if (flag?.user_id) {
          // Add another flag for the suspension
          await supabase.from('fraud_flags').insert({
            user_id: flag.user_id,
            flag_type: 'suspicious_activity',
            severity: 'critical',
            description: data.description || 'User suspended due to fraud flag',
            metadata: { original_flag_id: flag_id }
          });
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin fraud action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const { user_id, flag_type, severity, description, metadata } = body;

    if (!user_id || !flag_type || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('fraud_flags')
      .insert({
        user_id,
        flag_type,
        severity: severity || 'medium',
        description,
        metadata: metadata || {}
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, flag: data });
  } catch (error) {
    console.error('Admin fraud create error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
