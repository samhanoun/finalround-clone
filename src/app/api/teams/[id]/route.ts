import { NextRequest, NextResponse } from 'next/server';
import { getServerOrganizationClient, getOrganization, checkOrganizationAccess } from '@/lib/organizations';

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
    const { name, logo_url, settings, plan } = body;

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (logo_url !== undefined) updates.logo_url = logo_url;
    if (settings) updates.settings = settings;
    if (plan) updates.plan = plan;

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

    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting organization:', error);
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
