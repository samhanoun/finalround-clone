import { NextRequest, NextResponse } from 'next/server';
import { getServerOrganizationClient, createOrganization, getUserOrganizations } from '@/lib/organizations';
import { requireEnv } from '@/lib/env';

// GET /api/teams - List user's organizations
export async function GET(request: NextRequest) {
  try {
    const supabase = getServerOrganizationClient();
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
    const supabase = getServerOrganizationClient();
    const body = await request.json();
    const { name, slug, plan } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 });
    }

    // Check if slug is taken
    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
    }

    const organization = await createOrganization(supabase, { name, slug, plan });
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    console.error('Error creating organization:', error);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }
}
