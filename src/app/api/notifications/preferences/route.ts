import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const preferencesSchema = z.object({
  email_interview_reminders: z.boolean().optional(),
  email_application_updates: z.boolean().optional(),
  email_ai_suggestions: z.boolean().optional(),
  email_weekly_digest: z.boolean().optional(),
  in_app_interview_reminders: z.boolean().optional(),
  in_app_application_updates: z.boolean().optional(),
  in_app_ai_suggestions: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: preferences, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return defaults if not set
  if (!preferences) {
    return NextResponse.json({
      preferences: {
        email_interview_reminders: true,
        email_application_updates: true,
        email_ai_suggestions: true,
        email_weekly_digest: false,
        in_app_interview_reminders: true,
        in_app_application_updates: true,
        in_app_ai_suggestions: true,
      },
    });
  }

  return NextResponse.json({ preferences });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const result = preferencesSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json({ error: result.error.issues }, { status: 400 });
  }

  // Upsert preferences
  const { data: preferences, error } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: user.id,
      ...result.data,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ preferences });
}
