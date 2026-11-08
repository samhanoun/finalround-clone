import { NextRequest, NextResponse } from 'next/server';
import { getServerOrganizationClient, createOrganization, getUserOrganizations } from '@/lib/organizations';
import { createAdminClient } from '@/lib/supabase/admin';

// GET /api/teams - List user's organizations
export async function GET() {
  try {
    const supabase = await getServerOrganizationClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const organizations = await getUserOrganizations(supabase);
    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}

// POST /api/teams - Create new organization
export async function POST(request: NextRequest) {
  try {
    const supabase = await getServerOrganizationClient();
    const body = await request.json();
    const { name, slug } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Other teams' rows aren't visible to the user under RLS, so the check runs with the
    // service role; the unique index still decides if two requests race.
    const admin = createAdminClient();
    const { data: existing } = await admin.from('organizations').select('id').eq('slug', slug).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
    }

    const organization = await createOrganization(admin, user.id, { name, slug });
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
    }
    console.error('Error creating organization:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
