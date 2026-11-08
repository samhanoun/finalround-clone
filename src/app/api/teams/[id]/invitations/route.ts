import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getServerOrganizationClient,
  getPendingInvitations,
  cancelInvitation,
  checkOrganizationAccess,
  getMemberRole,
} from '@/lib/organizations';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rateLimit';
import { deliverInvitation, invitePath, normalizeEmail, type InvitationRow } from '@/lib/teamInvites';
import { canManageRole } from '@/lib/teamRoles';

const INVITE_COLUMNS = 'id, organization_id, email, role, invited_by, token, status, expires_at, created_at';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const InviteSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(['admin', 'member', 'viewer']),
});
const InvitationId = z.string().uuid();

function withLink<T extends { token: string }>(invitation: T) {
  return { ...invitation, invitePath: invitePath(invitation.token) };
}

// GET /api/teams/[id]/invitations - pending invitations, each with its link (owners and admins)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();
    if (!(await checkOrganizationAccess(supabase, id, ['owner', 'admin']))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const invitations = await getPendingInvitations(supabase, id);
    return NextResponse.json({ invitations: invitations.map(withLink) });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
  }
}

/**
 * POST /api/teams/[id]/invitations - invite (or invite again) an email address; only the owner invites an admin.
 *
 * Owners and admins invite. An invitation as admin, new or renewed, is the owner's (teamRoles.ts;
 * migration 0034 holds the database to the same rule). 403 owner_only: an admin asked for the admin
 * role. 403 admin_invitation: the address already has an invitation as admin.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const myRole = await getMemberRole(supabase, id);
    if (myRole !== 'owner' && myRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rl = await rateLimit({ key: `team_invite:${user.id}`, limit: 20, windowMs: 60 * 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

    const parse = InviteSchema.safeParse(await request.json().catch(() => null));
    if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const email = normalizeEmail(parse.data.email);
    const role = parse.data.role;
    if (!canManageRole(myRole, role)) return NextResponse.json({ error: 'owner_only' }, { status: 403 });

    const admin = createAdminClient();
    const [{ data: org }, { data: profile }] = await Promise.all([
      admin.from('organizations').select('name').eq('id', id).maybeSingle(),
      admin.from('profiles').select('id').eq('email', email).maybeSingle(),
    ]);
    if (profile?.id) {
      const { data: member } = await admin
        .from('organization_members')
        .select('id')
        .eq('organization_id', id)
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .maybeSingle();
      if (member) return NextResponse.json({ error: 'already_member' }, { status: 409 });
    }

    // One invitation per address and team: a used, cancelled or expired one is renewed with a fresh link.
    const { data: existing } = await supabase
      .from('organization_invitations')
      .select(INVITE_COLUMNS)
      .eq('organization_id', id)
      .eq('email', email)
      .maybeSingle<InvitationRow>();
    if (existing && !canManageRole(myRole, existing.role)) {
      return NextResponse.json({ error: 'admin_invitation' }, { status: 403 });
    }

    const fresh = {
      role,
      invited_by: user.id,
      status: 'pending',
      token: randomUUID(),
      expires_at: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
    };
    const write = existing
      ? supabase.from('organization_invitations').update(fresh).eq('id', existing.id)
      : supabase.from('organization_invitations').insert({ organization_id: id, email, ...fresh });
    const { data: invitation, error } = await write.select(INVITE_COLUMNS).single<InvitationRow>();
    if (error || !invitation) throw error ?? new Error('No invitation returned');

    const { emailSent } = await deliverInvitation(invitation, (org?.name as string | undefined) ?? 'your team');
    return NextResponse.json({ invitation: withLink(invitation), emailSent }, { status: 201 });
  } catch (error) {
    console.error('Error creating invitation:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/[id]/invitations?invitation_id=… - cancel an invitation; one as admin is the owner's to cancel.
 *
 * 403 owner_only: an admin tried to cancel an invitation as admin. 404: no such invitation in this team.
 * 409: nothing was cancelled (it changed in the meantime).
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();
    const myRole = await getMemberRole(supabase, id);
    if (myRole !== 'owner' && myRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const invitationId = new URL(request.url).searchParams.get('invitation_id');
    if (!invitationId || !InvitationId.safeParse(invitationId).success) {
      return NextResponse.json({ error: 'Invitation ID required' }, { status: 400 });
    }
    const { data: invitation, error: lookupError } = await supabase
      .from('organization_invitations')
      .select('id, role')
      .eq('id', invitationId)
      .eq('organization_id', id)
      .maybeSingle<{ id: string; role: string }>();
    if (lookupError) throw lookupError;
    if (!invitation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (!canManageRole(myRole, invitation.role)) return NextResponse.json({ error: 'owner_only' }, { status: 403 });
    if (!(await cancelInvitation(supabase, id, invitationId))) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error cancelling invitation:', error);
    return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 });
  }
}
