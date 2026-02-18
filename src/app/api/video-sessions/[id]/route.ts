import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  updateVideoSessionState,
  endVideoSession,
  recordScreenShareEvent,
  recordAudioEvent,
} from '@/lib/videoConferencing';

/**
 * PATCH /api/video-sessions/[id]
 * Update video session state (screen share, audio capture)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { action, ...data } = body;
    
    // Get current session to verify ownership
    const { data: session } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();
    
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    switch (action) {
      case 'screen_share_start': {
        const updates = {
          screen_share_active: true,
          screen_share_started_at: new Date().toISOString(),
        };
        
        await updateVideoSessionState(supabase, sessionId, updates);
        await recordScreenShareEvent(supabase, sessionId, user.id, 'started', {
          screen_width: data.screenWidth,
          screen_height: data.screenHeight,
          source_id: data.sourceId,
          source_name: data.sourceName,
        });
        
        return NextResponse.json({ message: 'Screen share started', screen_share_active: true });
      }
      
      case 'screen_share_stop': {
        const now = new Date().toISOString();
        const startTime = session.screen_share_started_at 
          ? new Date(session.screen_share_started_at).getTime()
          : Date.now();
        
        const updates = {
          screen_share_active: false,
          screen_share_ended_at: now,
          screen_share_duration_seconds: Math.floor((Date.now() - startTime) / 1000),
        };
        
        await updateVideoSessionState(supabase, sessionId, updates);
        await recordScreenShareEvent(supabase, sessionId, user.id, 'stopped', {
          duration_seconds: updates.screen_share_duration_seconds,
        });
        
        return NextResponse.json({ message: 'Screen share stopped', screen_share_active: false });
      }
      
      case 'audio_capture_start': {
        const updates = {
          audio_capture_active: true,
          audio_capture_started_at: new Date().toISOString(),
        };
        
        await updateVideoSessionState(supabase, sessionId, updates);
        await recordAudioEvent(supabase, sessionId, user.id, 'start', {
          device_id: data.deviceId,
          sample_rate: data.sampleRate,
          channels: data.channels,
        });
        
        return NextResponse.json({ message: 'Audio capture started', audio_capture_active: true });
      }
      
      case 'audio_capture_stop': {
        const now = new Date().toISOString();
        const startTime = session.audio_capture_started_at 
          ? new Date(session.audio_capture_started_at).getTime()
          : Date.now();
        
        const updates = {
          audio_capture_active: false,
          audio_capture_ended_at: now,
          audio_capture_duration_seconds: Math.floor((Date.now() - startTime) / 1000),
        };
        
        await updateVideoSessionState(supabase, sessionId, updates);
        await recordAudioEvent(supabase, sessionId, user.id, 'stop', {
          duration_ms: updates.audio_capture_duration_seconds! * 1000,
        });
        
        return NextResponse.json({ message: 'Audio capture stopped', audio_capture_active: false });
      }
      
      case 'update_metadata': {
        await updateVideoSessionState(supabase, sessionId, {
          session_title: data.sessionTitle,
          participant_count: data.participantCount,
        });
        
        return NextResponse.json({ message: 'Metadata updated' });
      }
      
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Error updating video session:', error);
    return NextResponse.json(
      { error: 'Failed to update session' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/video-sessions/[id]
 * End a video session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Verify ownership
    const { data: session } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .single();
    
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    const endedSession = await endVideoSession(supabase, sessionId);
    
    return NextResponse.json(endedSession);
  } catch (error) {
    console.error('Error ending video session:', error);
    return NextResponse.json(
      { error: 'Failed to end session' },
      { status: 500 }
    );
  }
}
