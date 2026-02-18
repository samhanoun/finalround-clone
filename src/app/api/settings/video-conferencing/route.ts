import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  getVideoConferencingSettings, 
  createVideoConferencingSettings,
  updateVideoConferencingSettings 
} from '@/lib/videoConferencing';

/**
 * GET /api/settings/video-conferencing
 * Get user's video conferencing settings
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    let settings = await getVideoConferencingSettings(supabase, user.id);
    
    // Create default settings if none exist
    if (!settings) {
      settings = await createVideoConferencingSettings(supabase, user.id);
    }
    
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Error fetching video conferencing settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/video-conferencing
 * Update user's video conferencing settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    
    // Validate allowed fields
    const allowedFields = [
      'zoom_enabled',
      'zoom_auto_capture',
      'zoom_screen_share_detection',
      'google_meet_enabled',
      'google_meet_auto_capture',
      'google_meet_screen_share_detection',
      'ms_teams_enabled',
      'ms_teams_auto_capture',
      'ms_teams_screen_share_detection',
      'audio_capture_enabled',
      'audio_input_device_id',
      'audio_sample_rate',
      'audio_channels',
      'screen_share_detection_enabled',
      'screen_share_callback_url',
      'preferred_platform',
      'auto_detect_platform',
    ];
    
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }
    
    // Ensure settings exist
    let settings = await getVideoConferencingSettings(supabase, user.id);
    if (!settings) {
      settings = await createVideoConferencingSettings(supabase, user.id);
    }
    
    // Update settings
    const updated = await updateVideoConferencingSettings(supabase, user.id, updates);
    
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating video conferencing settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
