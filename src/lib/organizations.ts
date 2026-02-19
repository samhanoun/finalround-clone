import { createClient } from '@supabase/supabase-js';
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
  user_email?: string;
  user_full_name?: string;
  user_avatar_url?: string;
}

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  invited_by: string;
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
export async function createOrganization(
  supabase: ReturnType<typeof createServerClient>,
  data: { name: string; slug: string; plan?: OrganizationPlan }
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Create organization
  const { data: organization, error } = await supabase
    .from('organizations')
    .insert({
      name: data.name,
      slug: data.slug,
      plan: data.plan || 'free',
    })
    .select()
    .single();

  if (error) throw error;

  // Add creator as owner
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({
      organization_id: organization.id,
      user_id: user.id,
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
export async function getOrganizationMembers(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<OrganizationMember[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  
  // If we have members, fetch their profile data
  if (data && data.length > 0) {
    const userIds = data.map((m: { user_id: string }) => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url')
      .in('id', userIds);
    
    const profileMap = new Map<string, { id: string; email?: string; full_name?: string; avatar_url?: string }>(
      profiles?.map((p: { id: string; email?: string; full_name?: string; avatar_url?: string }) => [p.id, p]) || []
    );
    
    return data.map((member: OrganizationMember) => ({
      ...member,
      user_email: profileMap.get(member.user_id)?.email,
      user_full_name: profileMap.get(member.user_id)?.full_name,
      user_avatar_url: profileMap.get(member.user_id)?.avatar_url,
    }));
  }
  
  return data || [];
}

export async function updateMemberRole(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  memberId: string,
  newRole: OrganizationRole
): Promise<void> {
  const { error } = await supabase
    .from('organization_members')
    .update({ role: newRole })
    .eq('id', memberId)
    .eq('organization_id', organizationId);

  if (error) throw error;
}

export async function removeMember(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  memberId: string
): Promise<void> {
  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', organizationId);

  if (error) throw error;
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

export async function cancelInvitation(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  invitationId: string
): Promise<void> {
  const { error } = await supabase
    .from('organization_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invitationId)
    .eq('organization_id', organizationId);

  if (error) throw error;
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

// Calculate team stats
export async function getTeamStats(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<{
  totalMembers: number;
  activeMembers: number;
  pendingInvitations: number;
  totalInterviews: number;
  interviewsThisMonth: number;
}> {
  // Get member counts
  const { data: members } = await supabase
    .from('organization_members')
    .select('status')
    .eq('organization_id', organizationId);

  const totalMembers = members?.length || 0;
  const activeMembers = members?.filter((m: { status: string }) => m.status === 'active').length || 0;

  // Get pending invitations
  const { count: pendingInvitations } = await supabase
    .from('organization_invitations')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'pending')
    .gte('expires_at', new Date().toISOString());

  // Get interview counts (from org members)
  const { data: orgMembers } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId);

  const userIds = orgMembers?.map((m: { user_id: string }) => m.user_id) || [];
  
  let totalInterviews = 0;
  let interviewsThisMonth = 0;

  if (userIds.length > 0) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: total } = await supabase
      .from('interviews')
      .select('*', { count: 'exact', head: true })
      .in('user_id', userIds);

    const { count: monthCount } = await supabase
      .from('interviews')
      .select('*', { count: 'exact', head: true })
      .in('user_id', userIds)
      .gte('created_at', startOfMonth.toISOString());

    totalInterviews = total || 0;
    interviewsThisMonth = monthCount || 0;
  }

  return {
    totalMembers,
    activeMembers,
    pendingInvitations: pendingInvitations || 0,
    totalInterviews,
    interviewsThisMonth,
  };
}

// Check if user is org member with required role
export async function checkOrganizationAccess(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  requiredRoles?: OrganizationRole[]
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role, status')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();

  if (!membership || membership.status !== 'active') return false;
  if (requiredRoles && !requiredRoles.includes(membership.role)) return false;

  return true;
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
