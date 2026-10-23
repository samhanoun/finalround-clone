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

// Badges are awarded by the server with the service role (migration 0029).
