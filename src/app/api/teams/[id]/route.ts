import { NextRequest, NextResponse } from 'next/server';
import { getServerOrganizationClient, getOrganization, checkOrganizationAccess } from '@/lib/organizations';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeSamlProvider, SsoSetupError } from '@/lib/sso';

// GET /api/teams/[id] - Get organization details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    // Check access
    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin', 'member', 'viewer']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const organization = await getOrganization(supabase, id);
    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ organization });
  } catch (error) {
    console.error('Error fetching organization:', error);
    return NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 });
  }
}

// PATCH /api/teams/[id] - Update organization
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    // Only owners can update organization
    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    // The plan is billing data: it changes through billing, never from this form.
    const { name, logo_url, settings } = body;

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (logo_url !== undefined) updates.logo_url = logo_url;
    if (settings) updates.settings = settings;

    const { data: organization, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ organization });
  } catch (error) {
    console.error('Error updating organization:', error);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}

// DELETE /api/teams/[id] - Delete organization
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    // Only owners can delete organization
    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Users have no delete policy on organizations, so after the owner check
    // the delete runs with the service role. Members, invitations and the
    // team's records go with it (on delete cascade); everyone keeps their
    // own account.
    const admin = createAdminClient();
    const { data: org } = await admin
      .from('organizations')
      .select('id, sso_config')
      .eq('id', id)
      .maybeSingle<{ id: string; sso_config: { provider_id?: string } | null }>();
    if (!org) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // The team's identity provider is registered at Supabase too: remove it
    // first, so its domains are free again and nobody can sign in through it.
    const providerId = org.sso_config?.provider_id;
    if (providerId) {
      try {
        await removeSamlProvider(providerId);
      } catch (error) {
        console.error('Error removing the team identity provider:', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: error instanceof SsoSetupError ? `sso_${error.code}` : 'sso_failed' }, { status: 502 });
      }
    }

    const { data: deleted, error } = await admin.from('organizations').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!deleted?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting organization:', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
