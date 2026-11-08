import { createAdminClient } from '@/lib/supabase/admin';
import { notify } from '@/lib/notify';

/**
 * Help & support: users open tickets and follow the conversation; admins
 * reply from Admin → Support tickets. Writes go through the API with the
 * service role (migration 0031), so users can't set priority, status or the
 * assignee themselves.
 */

import { SUPPORT_CATEGORIES, type SupportCategory, type SupportTicket } from '@/lib/supportTypes';

export { SUPPORT_CATEGORIES, type SupportCategory, type SupportTicket };

export async function createTicket(
  user: { id: string; email?: string | null },
  input: { subject: string; description: string; category: SupportCategory },
) {
  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const { data, error } = await admin
    .from('support_tickets')
    .insert({
      user_id: user.id,
      email: user.email ?? '',
      full_name: (profile?.full_name as string | null) ?? null,
      subject: input.subject,
      description: input.description,
      category: input.category,
      priority: 'medium',
      status: 'open',
    })
    .select('id, subject, description, category, status, created_at, updated_at')
    .single();
  if (error || !data) throw new Error(`Could not open the ticket: ${error?.message}`);

  // Tell the support team in the app.
  const { data: staff } = await admin.from('admin_users').select('user_id');
  for (const member of staff ?? []) {
    await notify(member.user_id as string, {
      type: 'system',
      title: `New support ticket: ${input.subject}`,
      message: input.description.slice(0, 160),
      url: '/admin',
      i18n: { key: 'supportNewTicket', params: { subject: input.subject.slice(0, 120) } },
    });
  }
  return { ...data, messages: [] } as SupportTicket;
}

/** The user's reply on their own ticket; a resolved ticket opens again. */
export async function replyAsUser(userId: string, ticketId: string, content: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: ticket } = await admin.from('support_tickets').select('id, user_id, status').eq('id', ticketId).maybeSingle();
  if (!ticket || ticket.user_id !== userId) return false;
  const { error } = await admin.from('support_messages').insert({ ticket_id: ticketId, user_id: userId, is_from_admin: false, content });
  if (error) throw new Error(`Could not save the reply: ${error.message}`);
  await admin
    .from('support_tickets')
    .update({ status: ticket.status === 'in_progress' ? 'in_progress' : 'open', resolved_at: null, updated_at: new Date().toISOString() })
    .eq('id', ticketId);
  return true;
}

/** A support reply: saved, the ticket waits on the user, and they're told in the app and by email. */
export async function replyAsAdmin(adminUserId: string, ticketId: string, content: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: ticket } = await admin.from('support_tickets').select('id, user_id, subject').eq('id', ticketId).maybeSingle();
  if (!ticket) return false;
  const { error } = await admin.from('support_messages').insert({ ticket_id: ticketId, user_id: adminUserId, is_from_admin: true, content });
  if (error) throw new Error(`Could not save the reply: ${error.message}`);
  await admin.from('support_tickets').update({ status: 'waiting_user', updated_at: new Date().toISOString() }).eq('id', ticketId);
  if (ticket.user_id) {
    await notify(ticket.user_id as string, {
      type: 'system',
      title: `Support replied: ${ticket.subject}`,
      message: content.slice(0, 200),
      url: '/support',
      emailAlways: true,
      i18n: { key: 'supportReply', params: { subject: String(ticket.subject).slice(0, 120), reply: content.slice(0, 200) } },
    });
  }
  return true;
}
