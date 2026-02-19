import { NextRequest, NextResponse } from 'next/server';
import { 
  getServerOrganizationClient, 
  checkOrganizationAccess 
} from '@/lib/organizations';
import {
  getSAMLConnection,
  createSAMLConnection,
  updateSAMLConnection,
  deleteSAMLConnection,
  enableOrganizationSSO,
  disableOrganizationSSO,
  generateSPMetadata,
} from '@/lib/sso';

// GET /api/teams/[id]/sso - Get SSO configuration
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const samlConnection = await getSAMLConnection(supabase, id);
    
    const { data: organization } = await supabase
      .from('organizations')
      .select('sso_enabled, sso_provider')
      .eq('id', id)
      .single();

    const spMetadata = samlConnection 
      ? generateSPMetadata(id, baseUrl)
      : null;

    return NextResponse.json({
      enabled: organization?.sso_enabled || false,
      provider: organization?.sso_provider || null,
      connection: samlConnection,
      spMetadata,
    });
  } catch (error) {
    console.error('Error fetching SSO config:', error);
    return NextResponse.json({ error: 'Failed to fetch SSO configuration' }, { status: 500 });
  }
}

// POST /api/teams/[id]/sso - Create/update SAML connection
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    // Only owners can configure SSO
    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { action, ...config } = body;

    if (action === 'enable') {
      if (!config.provider || !['saml', 'oidc'].includes(config.provider)) {
        return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
      }

      await enableOrganizationSSO(supabase, id, config.provider);
      return NextResponse.json({ success: true });
    }

    if (action === 'disable') {
      await disableOrganizationSSO(supabase, id);
      return NextResponse.json({ success: true });
    }

    if (action === 'configure_saml') {
      const { idp_entity_id, idp_sso_url, idp_certificate, attribute_mapping } = config;
      
      if (!idp_entity_id || !idp_sso_url || !idp_certificate) {
        return NextResponse.json({ error: 'Missing SAML configuration' }, { status: 400 });
      }

      // Check if connection exists
      const existing = await getSAMLConnection(supabase, id);
      
      if (existing) {
        // Update existing
        await updateSAMLConnection(supabase, id, existing.id, {
          status: 'pending',
          error_message: null,
        });
        return NextResponse.json({ connection: existing, updated: true });
      }

      // Create new
      const connection = await createSAMLConnection(supabase, id, {
        idp_entity_id,
        idp_sso_url,
        idp_certificate,
        attribute_mapping,
      });

      return NextResponse.json({ connection }, { status: 201 });
    }

    if (action === 'test_connection') {
      const connection = await getSAMLConnection(supabase, id);
      if (!connection) {
        return NextResponse.json({ error: 'No SAML connection configured' }, { status: 400 });
      }

      // In production, you would actually test the connection here
      await updateSAMLConnection(supabase, id, connection.id, {
        status: 'active',
        last_sync_at: new Date().toISOString(),
      });

      return NextResponse.json({ success: true, status: 'active' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error managing SSO:', error);
    return NextResponse.json({ error: 'Failed to manage SSO' }, { status: 500 });
  }
}

// DELETE /api/teams/[id]/sso - Delete SAML connection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connection_id');

    if (connectionId) {
      await deleteSAMLConnection(supabase, id, connectionId);
    }

    // Disable SSO on organization
    await disableOrganizationSSO(supabase, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting SSO:', error);
    return NextResponse.json({ error: 'Failed to delete SSO configuration' }, { status: 500 });
  }
}
