import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { invitationsForUser, invitePath } from '@/lib/teamInvites';

// GET /api/teams/invitations - pending invitations sent to the signed-in user's address
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const invitations = await invitationsForUser(user.email);
  return NextResponse.json({
    invitations: invitations.map(({ token, ...rest }) => ({ ...rest, invitePath: invitePath(token) })),
  });
}
