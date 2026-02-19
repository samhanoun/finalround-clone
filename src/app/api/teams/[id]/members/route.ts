import { NextRequest, NextResponse } from 'next/server';
import { 
  getServerOrganizationClient, 
  getOrganizationMembers, 
  updateMemberRole, 
  removeMember,
  checkOrganizationAccess,
  type OrganizationRole
} from '@/lib/organizations';

// GET /api/teams/[id]/members - List team members
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin', 'member', 'viewer']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const members = await getOrganizationMembers(supabase, id);
    return NextResponse.json({ members });
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// PATCH /api/teams/[id]/members - Update member role or remove member
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();

    // Only admins can manage members
    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { member_id, action, role } = body;

    if (action === 'remove') {
      // Cannot remove owner
      const { data: member } = await supabase
        .from('organization_members')
        .select('role')
        .eq('id', member_id)
        .single();

      if (member?.role === 'owner') {
        return NextResponse.json({ error: 'Cannot remove owner' }, { status: 400 });
      }

      await removeMember(supabase, id, member_id);
      return NextResponse.json({ success: true });
    }

    if (action === 'update_role') {
      if (!role || !['admin', 'member', 'viewer'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }

      // Cannot change owner role
      const { data: member } = await supabase
        .from('organization_members')
        .select('role')
        .eq('id', member_id)
        .single();

      if (member?.role === 'owner') {
        return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 });
      }

      await updateMemberRole(supabase, id, member_id, role as OrganizationRole);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error managing member:', error);
    return NextResponse.json({ error: 'Failed to manage member' }, { status: 500 });
  }
}
