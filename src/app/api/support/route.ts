import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { createTicket, SUPPORT_CATEGORIES } from '@/lib/support';

const TicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  category: z.enum(SUPPORT_CATEGORIES),
});

// GET /api/support - the user's tickets, newest first, with the conversation
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, subject, description, category, status, created_at, updated_at, messages:support_messages(id, is_from_admin, content, created_at)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  const tickets = (data ?? []).map((ticket) => ({
    ...ticket,
    messages: [...((ticket.messages as Array<{ created_at: string }>) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
  return NextResponse.json({ tickets, email: user.email ?? null });
}

// POST /api/support {subject, description, category} - open a ticket
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit({ key: `support_ticket:${user.id}`, limit: 5, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = TicketSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    return NextResponse.json({ ticket: await createTicket(user, parse.data) }, { status: 201 });
  } catch (error) {
    console.error('[support] ticket not opened', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
