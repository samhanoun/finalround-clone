import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Types for enterprise features
export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';
export type OrganizationPlan = 'free' | 'team' | 'enterprise';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';
export type SAMLStatus = 'pending' | 'active' | 'disabled' | 'error';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  plan: OrganizationPlan;
  sso_enabled: boolean;
  sso_provider: 'saml' | 'oidc' | null;
  sso_config: Record<string, unknown>;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  status: 'active' | 'pending' | 'invited';
  invited_by: string | null;
  invitation_token: string | null;
  invitation_expires_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined with profile data
  user_email?: string | null;
  user_full_name?: string | null;
  user_avatar_url?: string | null;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  /** Null once the person who sent it has deleted their account (migration 0033). */
  invited_by: string | null;
  token: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
}

export interface OrganizationAnalytics {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  metric_type: string;
  metric_value: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SAMLConnection {
  id: string;
  organization_id: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  sp_entity_id: string;
  sp_acs_url: string;
  sp_metadata_url: string | null;
  attribute_mapping: Record<string, string>;
  status: SAMLStatus;
  last_sync_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// Helper to get server client
export async function getServerOrganizationClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

// Organization CRUD
/**
 * Creates a team and makes `ownerId` its owner. Pass the service-role client:
 * users can't insert organizations, and nobody can add the first owner before
 * one exists. The plan always starts free; it changes through billing only.
 */
export async function createOrganization(
  supabase: SupabaseClient,
  ownerId: string,
  data: { name: string; slug: string }
) {
  // Create organization
  const { data: organization, error } = await supabase
    .from('organizations')
    .insert({
      name: data.name,
      slug: data.slug,
      plan: 'free',
    })
    .select()
    .single();

  if (error) throw error;

  // Add creator as owner
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({
      organization_id: organization.id,
      user_id: ownerId,
      role: 'owner',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

  if (memberError) throw memberError;

  return organization;
}

export async function getOrganization(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<Organization | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', organizationId)
    .single();

  if (error) return null;
  return data;
}

export async function getUserOrganizations(
  supabase: ReturnType<typeof createServerClient>
): Promise<Organization[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('organization_members')
    .select('organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error) return [];
  return data?.map((d: { organizations: Organization | null }) => d.organizations).filter(Boolean) || [];
}

// Team Members
type MemberProfile = { id: string; email: string | null; full_name: string | null; avatar_url: string | null };

/**
 * The team's members, each with their name, email and photo. The membership
 * rows come through the caller's client (RLS: members of the team only).
 * `profiles` only lets people read their own row, so the teammates' profiles
 * are read with `profileReader`, the service-role client, and only for the
 * people in this team. Call it after checkOrganizationAccess.
 */
export async function getOrganizationMembers(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  profileReader: SupabaseClient
): Promise<OrganizationMember[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  const members = (data ?? []) as OrganizationMember[];
  if (!members.length) return [];

  const userIds = [...new Set(members.map((member) => member.user_id))];
  const { data: profiles, error: profileError } = await profileReader
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .in('id', userIds);
  if (profileError) throw profileError;

  const byId = new Map(((profiles ?? []) as MemberProfile[]).map((profile) => [profile.id, profile]));
  return members.map((member) => {
    const profile = byId.get(member.user_id);
    return {
      ...member,
      user_email: profile?.email ?? null,
      user_full_name: profile?.full_name ?? null,
      user_avatar_url: profile?.avatar_url ?? null,
    };
  });
}

/**
 * Member rows are written with the service role (`admin`): the database lets
 * only owners manage members, while owners and admins may through the API, so
 * the route checks who may do what first. Owners are never changed or removed
 * here (`neq('role', 'owner')`), even if one became owner in the meantime.
 * Both return how many rows changed: 0 means nothing did.
 */
/**
 * Member writes (service role, after the route's checks) only touch the row while it still has
 * the role the checks saw: 0 when it changed in the meantime (made an owner or an admin), so the
 * caller answers 409 rather than acting on a role it wasn't allowed to manage.
 */
export async function updateMemberRole(
  admin: SupabaseClient,
  organizationId: string,
  memberId: string,
  currentRole: Exclude<OrganizationRole, 'owner'>,
  newRole: Exclude<OrganizationRole, 'owner'>
): Promise<number> {
  const { data, error } = await admin
    .from('organization_members')
    .update({ role: newRole })
    .eq('id', memberId)
    .eq('organization_id', organizationId)
    .eq('role', currentRole)
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}

export async function removeMember(
  admin: SupabaseClient,
  organizationId: string,
  memberId: string,
  currentRole: Exclude<OrganizationRole, 'owner'>
): Promise<number> {
  const { data, error } = await admin
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', organizationId)
    .eq('role', currentRole)
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}

// Invitations
export async function createInvitation(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  data: { email: string; role: OrganizationRole }
): Promise<OrganizationInvitation> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: invitation, error } = await supabase
    .from('organization_invitations')
    .insert({
      organization_id: organizationId,
      email: data.email,
      role: data.role,
      invited_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return invitation;
}

export async function getPendingInvitations(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<OrganizationInvitation[]> {
  const { data, error } = await supabase
    .from('organization_invitations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** How many invitations were cancelled: 0 when none matched, or the database didn't let this user change it. */
export async function cancelInvitation(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  invitationId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('organization_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invitationId)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}

export async function acceptInvitation(
  supabase: ReturnType<typeof createServerClient>,
  token: string
): Promise<void> {
  const { data: invitation, error: getError } = await supabase
    .from('organization_invitations')
    .select('*')
    .eq('token', token)
    .single();

  if (getError || !invitation) throw new Error('Invalid invitation');
  if (invitation.status !== 'pending') throw new Error('Invitation already processed');
  if (new Date(invitation.expires_at) < new Date()) throw new Error('Invitation expired');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Add user to organization
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({
      organization_id: invitation.organization_id,
      user_id: user.id,
      role: invitation.role,
      status: 'active',
      invited_by: invitation.invited_by,
      joined_at: new Date().toISOString(),
    });

  if (memberError) throw memberError;

  // Update invitation status
  await supabase
    .from('organization_invitations')
    .update({ status: 'accepted' })
    .eq('id', invitation.id);
}

// Analytics
export async function getOrganizationAnalytics(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  startDate: string,
  endDate: string
): Promise<OrganizationAnalytics[]> {
  const { data, error } = await supabase
    .from('organization_analytics')
    .select('*')
    .eq('organization_id', organizationId)
    .gte('period_start', startDate)
    .lte('period_end', endDate)
    .order('period_start', { ascending: true });

  if (error) throw error;
  return data || [];
}

export type TeamStats = {
  totalMembers: number;
  activeMembers: number;
  pendingInvitations: number;
  /** Practice interviews the members started (interview_sessions): all time, and this calendar month (UTC). */
  practiceInterviews: { total: number; thisMonth: number };
  /** Live sessions the members ran (copilot_sessions): all time, and started this calendar month (UTC). */
  liveSessions: { total: number; thisMonth: number };
};

/**
 * The team header's figures. Members and invitations come through the
 * caller's client (RLS). Each person can only read their own sessions, so the
 * members' practice interviews and live sessions are counted with `counter`,
 * the service-role client, limited to this team's members. Call it after
 * checkOrganizationAccess. Months are UTC calendar months, as on Home.
 */
export async function getTeamStats(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  counter: SupabaseClient,
  now: Date = new Date()
): Promise<TeamStats> {
  const [{ data: members, error: membersError }, { count: pendingInvitations, error: invitesError }] = await Promise.all([
    supabase.from('organization_members').select('user_id, status').eq('organization_id', organizationId),
    supabase
      .from('organization_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .gte('expires_at', now.toISOString()),
  ]);
  if (membersError) throw membersError;
  if (invitesError) throw invitesError;

  const rows = (members ?? []) as Array<{ user_id: string; status: string }>;
  const userIds = [...new Set(rows.map((member) => member.user_id))];
  const practiceInterviews = { total: 0, thisMonth: 0 };
  const liveSessions = { total: 0, thisMonth: 0 };

  if (userIds.length > 0) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const count = async (table: 'interview_sessions' | 'copilot_sessions', since?: { column: string; from: string }) => {
      let query = counter.from(table).select('id', { count: 'exact', head: true }).in('user_id', userIds);
      if (since) query = query.gte(since.column, since.from);
      const { count: found, error } = await query;
      if (error) throw error;
      return found ?? 0;
    };
    [practiceInterviews.total, practiceInterviews.thisMonth, liveSessions.total, liveSessions.thisMonth] = await Promise.all([
      count('interview_sessions'),
      count('interview_sessions', { column: 'created_at', from: monthStart }),
      count('copilot_sessions'),
      count('copilot_sessions', { column: 'started_at', from: monthStart }),
    ]);
  }

  return {
    totalMembers: rows.length,
    activeMembers: rows.filter((member) => member.status === 'active').length,
    pendingInvitations: pendingInvitations ?? 0,
    practiceInterviews,
    liveSessions,
  };
}

// Check if user is org member with required role
/** The signed-in user's role in the team, or null when they aren't an active member of it. */
export async function getMemberRole(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<OrganizationRole | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role, status')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();

  return membership && membership.status === 'active' ? (membership.role as OrganizationRole) : null;
}

export async function checkOrganizationAccess(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  requiredRoles?: OrganizationRole[]
): Promise<boolean> {
  const role = await getMemberRole(supabase, organizationId);
  if (!role) return false;
  return !requiredRoles || requiredRoles.includes(role);
}

// Get current user's organization context
export async function getUserOrganizationContext(
  supabase: ReturnType<typeof createServerClient>
): Promise<{ organization: Organization | null; role: OrganizationRole | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { organization: null, role: null };

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (!membership) return { organization: null, role: null };

  const { data: organization } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', membership.organization_id)
    .single();

  return { 
    organization: organization || null, 
    role: membership.role as OrganizationRole 
  };
}
