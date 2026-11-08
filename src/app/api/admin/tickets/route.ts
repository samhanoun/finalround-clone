import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/adminAuth';
import { replyAsAdmin } from '@/lib/support';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const category = searchParams.get('category');
    const offset = (page - 1) * limit;

    // One ticket's conversation.
    const ticketId = searchParams.get('ticket_id');
    if (ticketId) {
      const { data: messages, error } = await supabase
        .from('support_messages')
        .select('id, is_from_admin, content, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ messages: messages ?? [] });
    }

    let query = supabase
      .from('support_tickets')
      .select('*', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }
    if (priority) {
      query = query.eq('priority', priority);
    }
    if (category) {
      query = query.eq('category', category);
    }

    const { data: tickets, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching tickets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formattedTickets = tickets?.map(ticket => ({
      id: ticket.id,
      user_id: ticket.user_id,
      email: ticket.email,
      full_name: ticket.full_name,
      subject: ticket.subject,
      description: ticket.description,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      assigned_to: ticket.assigned_to,
      assigned_at: ticket.assigned_at,
      resolved_at: ticket.resolved_at,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at
    })) || [];

    // Get status counts
    const { data: statusData } = await supabase
      .from('support_tickets')
      .select('status');

    const statusCounts = (statusData || []).reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      tickets: formattedTickets,
      stats: {
        total: count || 0,
        ...statusCounts
      },
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin tickets API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Every admin PATCH has one shape: the action, the id of what it acts on, and the action's own fields under `data`. */
const PatchSchema = z.object({
  action: z.string().min(1),
  ticket_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const StatusData = z.object({ status: z.enum(['open', 'in_progress', 'waiting_user', 'resolved', 'closed']) });
const PriorityData = z.object({ priority: z.enum(['low', 'medium', 'high', 'urgent']) });
const AssignData = z.object({ assigned_to: z.string().uuid().nullable() });

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid_body', parsed.error.flatten());
  const { action, ticket_id: ticketId, data = {} } = parsed.data;

  try {
    const supabase = createAdminClient();

    /** Applies an update to the ticket; false when there's no such ticket. */
    const update = async (values: Record<string, unknown>) => {
      const { data: rows, error } = await supabase.from('support_tickets').update(values).eq('id', ticketId).select('id');
      if (error) throw error;
      return (rows?.length ?? 0) > 0;
    };

    switch (action) {
      case 'assign': {
        const assign = AssignData.safeParse(data);
        if (!assign.success) return jsonError(400, 'invalid_body', assign.error.flatten());
        const found = await update({ assigned_to: assign.data.assigned_to, assigned_at: new Date().toISOString(), status: 'in_progress' });
        return found ? NextResponse.json({ success: true }) : jsonError(404, 'not_found');
      }

      case 'update_status': {
        const status = StatusData.safeParse(data);
        if (!status.success) return jsonError(400, 'invalid_body', status.error.flatten());
        const values: Record<string, unknown> = { status: status.data.status };
        if (status.data.status === 'resolved' || status.data.status === 'closed') {
          values.resolved_at = new Date().toISOString();
        }
        return (await update(values)) ? NextResponse.json({ success: true }) : jsonError(404, 'not_found');
      }

      case 'update_priority': {
        const priority = PriorityData.safeParse(data);
        if (!priority.success) return jsonError(400, 'invalid_body', priority.error.flatten());
        return (await update({ priority: priority.data.priority })) ? NextResponse.json({ success: true }) : jsonError(404, 'not_found');
      }

      case 'reply': {
        const content = typeof data.content === 'string' ? data.content.trim().slice(0, 5000) : '';
        if (!content) return jsonError(400, 'empty_reply');
        // Saved as the signed-in admin; the user is notified in the app and by email.
        if (!(await replyAsAdmin(auth.userId, ticketId, content))) return jsonError(404, 'not_found');
        return NextResponse.json({ success: true });
      }

      default:
        return jsonError(400, 'unknown_action');
    }
  } catch (error) {
    console.error('[admin tickets] action failed', { action, ticketId, error: (error as { message?: string })?.message ?? error });
    return jsonError(500, 'action_failed');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();
    const body = await request.json();
    const { user_id, email, full_name, subject, description, category, priority } = body;

    if (!email || !subject || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id,
        email,
        full_name,
        subject,
        description,
        category: category || 'other',
        priority: priority || 'medium'
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, ticket: data });
  } catch (error) {
    console.error('Admin ticket create error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
