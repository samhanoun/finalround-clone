import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const category = searchParams.get('category');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('support_tickets')
      .select(`
        *,
        profiles!inner(email, full_name)
      `, { count: 'exact' });

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
      email: ticket.profiles?.email || ticket.email,
      full_name: ticket.profiles?.full_name || ticket.full_name,
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

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    const body = await request.json();
    const { ticket_id, action, data, assigned_to } = body;

    if (!ticket_id || !action) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    switch (action) {
      case 'assign': {
        const { error } = await supabase
          .from('support_tickets')
          .update({ 
            assigned_to,
            assigned_at: new Date().toISOString(),
            status: 'in_progress'
          })
          .eq('id', ticket_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'update_status': {
        const updateData: Record<string, unknown> = { status: data.status };
        if (data.status === 'resolved' || data.status === 'closed') {
          updateData.resolved_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from('support_tickets')
          .update(updateData)
          .eq('id', ticket_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'update_priority': {
        const { error } = await supabase
          .from('support_tickets')
          .update({ priority: data.priority })
          .eq('id', ticket_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'reply': {
        // Add message to ticket
        const { error: msgError } = await supabase
          .from('support_messages')
          .insert({
            ticket_id,
            is_from_admin: true,
            content: data.content,
            user_id: data.admin_user_id
          });

        if (msgError) throw msgError;

        // Update ticket status
        const { error } = await supabase
          .from('support_tickets')
          .update({ 
            status: 'in_progress',
            updated_at: new Date().toISOString()
          })
          .eq('id', ticket_id);

        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Admin ticket action error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
