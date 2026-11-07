import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { meetingSettingsFromRow, meetingSettingsToRow, type MeetingSettings } from '@/lib/meetingSettings';

/** Settings → Meeting apps (src/lib/meetingSettings.ts). */

const SettingsSchema = z.object({
  platform: z.enum(['auto', 'zoom', 'google_meet', 'ms_teams']),
  desktopApp: z.boolean(),
  askForLink: z.boolean(),
  autoStartListening: z.boolean(),
  endWhenSharingStops: z.boolean(),
  useMicrophone: z.boolean(),
});

async function load(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<MeetingSettings> {
  const { data } = await supabase.from('video_conferencing_settings').select('*').eq('user_id', userId).maybeSingle();
  return meetingSettingsFromRow(data);
}

// GET /api/settings/video-conferencing
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ settings: await load(supabase, user.id) });
}

// PATCH /api/settings/video-conferencing - the whole settings object
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parse = SettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { error } = await supabase
    .from('video_conferencing_settings')
    .upsert(
      { user_id: user.id, ...meetingSettingsToRow(parse.data), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) {
    console.error('[settings] meeting apps not saved', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ settings: await load(supabase, user.id) });
}
