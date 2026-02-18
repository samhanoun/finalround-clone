import { NextRequest, NextResponse } from 'next/server';
import { 
  getServerOrganizationClient, 
  getPendingInvitations, 
  createInvitation, 
  cancelInvitation,
  checkOrganizationAccess 
} from '@/lib/organizations';

// GET /api/teams/[id]/invitations - List pending invitations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getServerOrganizationClient();

    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const invitations = await getPendingInvitations(supabase, id);
    return NextResponse.json({ invitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
  }
}

// POST /api/teams/[id]/invitations - Create new invitation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getServerOrganizationClient();

    // Check if user can invite
    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { email, role } = body;

    if (!email || !role) {
      return NextResponse.json({ error: 'Email and role are required' }, { status: 400 });
    }

    if (!['admin', 'member', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check if email is already a member
    const { data: existingMember } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', id)
      .eq('user_id', 
        supabase.from('profiles').select('id').eq('email', email)
      )
      .single();

    if (existingMember) {
      return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
    }

    const invitation = await createInvitation(supabase, id, { email, role });
    
    // TODO: Send invitation email
    
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating invitation:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create invitation';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// DELETE /api/teams/[id]/invitations - Cancel invitation
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getServerOrganizationClient();

    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const invitationId = searchParams.get('invitation_id');

    if (!invitationId) {
      return NextResponse.json({ error: 'Invitation ID required' }, { status: 400 });
    }

    await cancelInvitation(supabase, id, invitationId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error cancelling invitation:', error);
    return NextResponse.json({ error: 'Failed to cancel invitation' }, { status: 500 });
  }
}
