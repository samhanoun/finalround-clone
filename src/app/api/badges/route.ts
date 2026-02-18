import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/badges - Get all badges for the current user
export async function GET() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: badges, error } = await supabase
    .from('badges')
    .select('*')
    .eq('user_id', user.id)
    .order('awarded_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ badges });
}

// POST /api/badges - Create a new badge (auto-awarded via triggers or manual)
export async function POST(request: Request) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { badge_type, title, description, icon, metadata } = body;

  const { data: badge, error } = await supabase
    .from('badges')
    .insert({
      user_id: user.id,
      badge_type,
      title,
      description,
      icon,
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ badge });
}
