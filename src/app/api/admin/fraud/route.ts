import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';
import { setSuspended } from '../_lib/suspension';

/** Every admin PATCH has one shape: the action, the id of what it acts on, and the action's own fields under `data`. */
const PatchSchema = z.object({
  action: z.string().min(1),
  flag_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(MANAGE_ROLES);
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const resolved = searchParams.get('resolved');
    const severity = searchParams.get('severity');
    const offset = (page - 1) * limit;

    let query = supabase.from('fraud_flags').select('*', { count: 'exact' });

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

    // Who each flag is about. fraud_flags.user_id points at auth.users, not profiles, so there's no
    // relationship to embed: the profiles are a second query.
    const userIds = [...new Set((flags ?? []).map((flag) => flag.user_id as string))];
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabase.from('profiles').select('id, email, full_name').in('id', userIds)
      : { data: [], error: null };
    if (profilesError) {
      console.error('Error fetching flagged users:', profilesError);
      return NextResponse.json({ error: profilesError.message }, { status: 500 });
    }
    const people = new Map((profiles ?? []).map((p) => [p.id as string, p as { email: string | null; full_name: string | null }]));

    const fraudFlags = flags?.map(flag => ({
      id: flag.id,
      user_id: flag.user_id,
      user_email: people.get(flag.user_id)?.email ?? null,
      user_name: people.get(flag.user_id)?.full_name ?? null,
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
  const auth = await requireAdmin(MANAGE_ROLES);
  if (!auth.ok) return auth.response;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid_body', parsed.error.flatten());
  const { action, flag_id: flagId, data = {} } = parsed.data;

  try {
    const supabase = createAdminClient();

    switch (action) {
      case 'resolve': {
        const { data: rows, error } = await supabase
          .from('fraud_flags')
          .update({ resolved: true, resolved_by: auth.userId, resolved_at: new Date().toISOString() })
          .eq('id', flagId)
          .select('id');
        if (error) throw error;
        if (!rows?.length) return jsonError(404, 'not_found');
        return NextResponse.json({ success: true });
      }

      case 'escalate': {
        const { data: flag, error: readError } = await supabase.from('fraud_flags').select('severity').eq('id', flagId).maybeSingle();
        if (readError) throw readError;
        if (!flag) return jsonError(404, 'not_found');

        const currentIndex = SEVERITIES.indexOf(flag.severity);
        const newSeverity = SEVERITIES[Math.min(Math.max(currentIndex, 0) + 1, SEVERITIES.length - 1)];
        const { error } = await supabase.from('fraud_flags').update({ severity: newSeverity }).eq('id', flagId);
        if (error) throw error;
        return NextResponse.json({ success: true, severity: newSeverity });
      }

      case 'update_metadata': {
        const metadata = z.record(z.string(), z.unknown()).safeParse(data.metadata);
        if (!metadata.success) return jsonError(400, 'invalid_body', metadata.error.flatten());
        const { data: rows, error } = await supabase.from('fraud_flags').update({ metadata: metadata.data }).eq('id', flagId).select('id');
        if (error) throw error;
        if (!rows?.length) return jsonError(404, 'not_found');
        return NextResponse.json({ success: true });
      }

      case 'suspend_user': {
        const { data: flag, error: readError } = await supabase.from('fraud_flags').select('user_id').eq('id', flagId).maybeSingle();
        if (readError) throw readError;
        if (!flag?.user_id) return jsonError(404, 'not_found');
        if (flag.user_id === auth.userId) return jsonError(400, 'cannot_suspend_self');

        await setSuspended(supabase, flag.user_id, true);
        // The record of it: a critical flag pointing back at the one acted on.
        const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim().slice(0, 1000) : 'User suspended due to fraud flag';
        const { error } = await supabase.from('fraud_flags').insert({
          user_id: flag.user_id,
          flag_type: 'suspicious_activity',
          severity: 'critical',
          description,
          metadata: { original_flag_id: flagId, suspended_by: auth.userId },
        });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return jsonError(400, 'unknown_action');
    }
  } catch (error) {
    console.error('[admin fraud] action failed', { action, flagId, error: (error as { message?: string })?.message ?? error });
    return jsonError(500, 'action_failed');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(MANAGE_ROLES);
    if (!auth.ok) return auth.response;

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
