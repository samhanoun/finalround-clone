import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { absoluteUrl, renderEmail } from '@/lib/emailTemplates';
import { notify } from '@/lib/notify';
import { kitFor, userLocaleAndZone } from '@/lib/localizedEmail';
import type { Locale } from '@/i18n/locales';

/**
 * Team invitations. An owner or admin invites an email address; the invitee
 * opens the link (/teams/join?token=…) or sees it on their Teams page, and
 * joins once signed in with that same address. Joining writes the membership
 * with the service role: only owners may add members through the API.
 */

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitePath(token: string): string {
  return `/teams/join?token=${encodeURIComponent(token)}`;
}

export type InvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  invited_by: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export type InvitationPreview = {
  teamName: string;
  role: string;
  email: string;
  invitedBy: string | null;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expiresAt: string;
};

export function isExpired(invitation: Pick<InvitationRow, 'expires_at'>, now = new Date()): boolean {
  return new Date(invitation.expires_at).getTime() < now.getTime();
}

async function displayName(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
  return (data?.full_name as string | null) || (data?.email as string | null) || null;
}

/**
 * Emails the invitation link, in the inviter's language (the invitee may not
 * have an account, so theirs isn't known). False when email isn't set up (the
 * link can still be shared by hand).
 */
export async function sendInvitationEmail(input: {
  to: string;
  teamName: string;
  inviter: string | null;
  role: string;
  token: string;
  locale: Locale;
}) {
  const url = absoluteUrl(invitePath(input.token));
  if (!url) return false;
  const { t } = await kitFor(input.locale);
  const tInvite = t('InviteEmail');
  const tRoles = t('JoinTeam');
  const role = ['admin', 'member', 'viewer'].includes(input.role) ? tRoles(`roles.${input.role}`) : input.role;
  const title = tInvite('title', { team: input.teamName });
  const email = renderEmail({
    title,
    paragraphs: [
      tInvite('invited', { inviter: input.inviter ?? tInvite('teammate'), team: input.teamName, role }),
      tInvite('signIn', { email: input.to }),
    ],
    button: { label: tInvite('accept'), url },
    footer: tInvite('footer'),
    settingsLabel: t('Email')('changeSettings'),
  });
  return sendEmail({ to: input.to, subject: title, text: email.text, html: email.html });
}

/** After an invitation is created: email it, and tell the invitee in-app if they already have an account. */
export async function deliverInvitation(invitation: InvitationRow, teamName: string) {
  const inviter = await displayName(invitation.invited_by);
  const { locale } = await userLocaleAndZone(invitation.invited_by);
  const emailSent = await sendInvitationEmail({
    to: invitation.email,
    teamName,
    inviter,
    role: invitation.role,
    token: invitation.token,
    locale,
  });

  const { data: invitee } = await createAdminClient()
    .from('profiles')
    .select('id')
    .eq('email', normalizeEmail(invitation.email))
    .maybeSingle();
  if (invitee?.id) {
    await notify(invitee.id as string, {
      type: 'system',
      title: `Invitation to join ${teamName}`,
      message: `${inviter ?? 'A teammate'} invited you as ${ROLE_LABEL[invitation.role]?.toLowerCase() ?? invitation.role}.`,
      url: invitePath(invitation.token),
      i18n: { key: 'teamInvite', params: { team: teamName, inviter: inviter ?? '', role: invitation.role } },
    });
  }
  return { emailSent };
}

async function loadByToken(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('organization_invitations')
    .select('id, organization_id, email, role, invited_by, token, status, expires_at, created_at')
    .eq('token', token)
    .maybeSingle<InvitationRow>();
  if (!data) return null;
  const { data: org } = await admin.from('organizations').select('name').eq('id', data.organization_id).maybeSingle();
  return { invitation: data, teamName: (org?.name as string | undefined) ?? 'a team' };
}

function previewStatus(invitation: InvitationRow): InvitationPreview['status'] {
  if (invitation.status === 'accepted') return 'accepted';
  if (invitation.status === 'cancelled') return 'cancelled';
  if (invitation.status === 'expired' || isExpired(invitation)) return 'expired';
  return 'pending';
}

export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  const found = await loadByToken(token);
  if (!found) return null;
  const { invitation, teamName } = found;
  return {
    teamName,
    role: invitation.role,
    email: invitation.email,
    invitedBy: await displayName(invitation.invited_by),
    status: previewStatus(invitation),
    expiresAt: invitation.expires_at,
  };
}

export type RespondResult =
  | { ok: true; outcome: 'joined' | 'declined'; organizationId: string; teamName: string }
  | { ok: false; error: 'not_found' | 'not_pending' | 'expired' | 'wrong_account' };

export async function respondToInvitation(token: string, user: Pick<User, 'id' | 'email'>, action: 'accept' | 'decline'): Promise<RespondResult> {
  const found = await loadByToken(token);
  if (!found) return { ok: false, error: 'not_found' };
  const { invitation, teamName } = found;
  if (invitation.status !== 'pending') return { ok: false, error: 'not_pending' };
  if (isExpired(invitation)) return { ok: false, error: 'expired' };
  if (!user.email || normalizeEmail(user.email) !== normalizeEmail(invitation.email)) return { ok: false, error: 'wrong_account' };

  const admin = createAdminClient();
  if (action === 'accept') {
    const { error } = await admin.from('organization_members').upsert(
      {
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
        status: 'active',
        invited_by: invitation.invited_by,
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,user_id', ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not add the member: ${error.message}`);
  }

  // Only a still-pending invitation changes, so two clicks can't both count.
  const { data: updated, error: updateError } = await admin
    .from('organization_invitations')
    .update({ status: action === 'accept' ? 'accepted' : 'cancelled' })
    .eq('id', invitation.id)
    .eq('status', 'pending')
    .select('id');
  if (updateError) throw new Error(`Could not update the invitation: ${updateError.message}`);

  if (action === 'accept' && updated?.length) {
    const who = (await displayName(user.id)) ?? user.email;
    await notify(invitation.invited_by, {
      type: 'system',
      title: `${who} joined ${teamName}`,
      message: `They accepted your invitation as ${ROLE_LABEL[invitation.role]?.toLowerCase() ?? invitation.role}.`,
      url: '/teams',
      i18n: { key: 'memberJoined', params: { who, team: teamName, role: invitation.role } },
    });
  }
  return { ok: true, outcome: action === 'accept' ? 'joined' : 'declined', organizationId: invitation.organization_id, teamName };
}

/** Pending invitations sent to this user's address (shown on their Teams page). */
export async function invitationsForUser(email: string | undefined) {
  if (!email) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from('organization_invitations')
    .select('id, organization_id, email, role, invited_by, token, status, expires_at, created_at')
    .eq('email', normalizeEmail(email))
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as InvitationRow[];
  if (!rows.length) return [];
  const { data: orgs } = await admin
    .from('organizations')
    .select('id, name')
    .in('id', rows.map((row) => row.organization_id));
  const names = new Map((orgs ?? []).map((org) => [org.id as string, org.name as string]));
  return rows.map((row) => ({
    token: row.token,
    teamName: names.get(row.organization_id) ?? 'A team',
    role: row.role,
    expiresAt: row.expires_at,
  }));
}
