import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getServerOrganizationClient,
  getOrganizationMembers,
  updateMemberRole,
  removeMember,
  checkOrganizationAccess,
} from '@/lib/organizations';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/teams/[id]/members - List team members, with their names, emails and photos
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

    // Profiles are private to each person: teammates' names are read with the service role, for this team only.
    const members = await getOrganizationMembers(supabase, id, createAdminClient());
    return NextResponse.json({ members });
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

const ManageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove'), member_id: z.string().uuid() }),
  z.object({ action: z.literal('update_role'), member_id: z.string().uuid(), role: z.enum(['admin', 'member', 'viewer']) }),
]);

/**
 * PATCH /api/teams/[id]/members {member_id, action: 'remove' | 'update_role', role?}
 *
 * Owners and admins manage members. The database lets only owners write
 * member rows, so after the checks below the change is made with the service
 * role. The rules:
 * - nobody changes or removes an owner;
 * - nobody makes someone an owner here (admins never; ownership isn't handed over through this form);
 * - you can't change your own role.
 * 404: no such member in this team. 409: the member changed in the meantime, so nothing was written.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await getServerOrganizationClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    if (!(await checkOrganizationAccess(supabase, id, ['owner', 'admin']))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const raw = (await request.json().catch(() => null)) as { action?: unknown; role?: unknown } | null;
    if (raw?.action === 'update_role' && raw.role === 'owner') {
      return NextResponse.json({ error: 'cannot_make_owner' }, { status: 403 });
    }
    const parse = ManageSchema.safeParse(raw);
    if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    const body = parse.data;

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from('organization_members')
      .select('id, user_id, role')
      .eq('id', body.member_id)
      .eq('organization_id', id)
      .maybeSingle<{ id: string; user_id: string; role: string }>();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (target.role === 'owner') return NextResponse.json({ error: 'owner_protected' }, { status: 403 });

    if (body.action === 'remove') {
      const removed = await removeMember(admin, id, target.id);
      if (!removed) return NextResponse.json({ error: 'conflict' }, { status: 409 });
      return NextResponse.json({ success: true });
    }

    if (target.user_id === user.id) return NextResponse.json({ error: 'own_role' }, { status: 403 });
    const updated = await updateMemberRole(admin, id, target.id, body.role);
    if (!updated) return NextResponse.json({ error: 'conflict' }, { status: 409 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error managing member:', error);
    return NextResponse.json({ error: 'Failed to manage member' }, { status: 500 });
  }
}
