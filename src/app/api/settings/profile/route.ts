import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const profileSchema = z.object({
  full_name: z.string().max(100).optional(),
  avatar_url: z.string().url().optional(),
  target_roles: z.array(z.string()).max(10).optional(),
  language: z.string().length(2).optional(),
  timezone: z.string().optional(),
  email_notifications: z.boolean().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get profile data
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, target_roles, created_at')
    .eq('id', userData.user.id)
    .single();

  if (profileError) {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }

  // Get user settings
  const { data: settings, error: settingsError } = await supabase
    .from('user_settings')
    .select('language, timezone, email_notifications, marketing_emails, two_factor_enabled')
    .eq('user_id', userData.user.id)
    .single();

  // If no settings exist, create default ones
  if (settingsError && settingsError.code === 'PGRST116') {
    const { data: newSettings } = await supabase
      .from('user_settings')
      .insert({ user_id: userData.user.id })
      .select()
      .single();

    return NextResponse.json({
      profile: {
        ...profile,
        language: newSettings?.language ?? 'en',
        timezone: newSettings?.timezone ?? 'UTC',
        email_notifications: newSettings?.email_notifications ?? true,
        marketing_emails: newSettings?.marketing_emails ?? false,
        two_factor_enabled: newSettings?.two_factor_enabled ?? false,
      },
    });
  }

  if (settingsError) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }

  return NextResponse.json({
    profile: {
      ...profile,
      ...settings,
    },
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const validation = profileSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: validation.error.issues },
      { status: 400 }
    );
  }

  const { full_name, avatar_url, target_roles, language, timezone, email_notifications } = validation.data;

  // Update profile
  const profileUpdate: Record<string, unknown> = {};
  if (full_name !== undefined) profileUpdate.full_name = full_name;
  if (avatar_url !== undefined) profileUpdate.avatar_url = avatar_url;
  if (target_roles !== undefined) profileUpdate.target_roles = target_roles;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update(profileUpdate)
      .eq('id', userData.user.id);

    if (profileError) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
  }

  // Update or insert user settings
  const settingsUpdate: Record<string, unknown> = {};
  if (language !== undefined) settingsUpdate.language = language;
  if (timezone !== undefined) settingsUpdate.timezone = timezone;
  if (email_notifications !== undefined) settingsUpdate.email_notifications = email_notifications;

  if (Object.keys(settingsUpdate).length > 0) {
    // Try to update first
    const { data: existing } = await supabase
      .from('user_settings')
      .select('id')
      .eq('user_id', userData.user.id)
      .single();

    if (existing) {
      const { error: settingsError } = await supabase
        .from('user_settings')
        .update(settingsUpdate)
        .eq('user_id', userData.user.id);

      if (settingsError) {
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
      }
    } else {
      const { error: settingsError } = await supabase
        .from('user_settings')
        .insert({ user_id: userData.user.id, ...settingsUpdate });

      if (settingsError) {
        return NextResponse.json({ error: 'Failed to create settings' }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true });
}
