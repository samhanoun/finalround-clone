import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  createVideoSession,
  getActiveVideoSession,
  updateVideoSessionState,
  endVideoSession,
  recordScreenShareEvent,
  recordAudioEvent,
  detectPlatform,
} from '@/lib/videoConferencing';

/**
 * POST /api/video-sessions
 * Create a new video session (when joining a meeting)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { platform = 'auto', url, sessionInfo } = body;
    
    // Auto-detect platform if requested
    let detectedPlatform = platform;
    if (platform === 'auto' && url) {
      const detection = detectPlatform(url);
      detectedPlatform = detection.platform;
    }
    
    // Check for existing active session
    const existingSession = await getActiveVideoSession(supabase, user.id);
    if (existingSession) {
      return NextResponse.json({
        message: 'Active session already exists',
        session: existingSession,
      });
    }
    
    const session = await createVideoSession(
      supabase,
      user.id,
      detectedPlatform === 'auto' ? 'unknown' : detectedPlatform,
      sessionInfo
    );
    
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error('Error creating video session:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/video-sessions
 * Get active video session for current user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const session = await getActiveVideoSession(supabase, user.id);
    
    if (!session) {
      return NextResponse.json({ session: null });
    }
    
    return NextResponse.json({ session });
  } catch (error) {
    console.error('Error fetching video session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}
