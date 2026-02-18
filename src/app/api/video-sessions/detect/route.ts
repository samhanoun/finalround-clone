import { NextRequest, NextResponse } from 'next/server';
import { detectPlatform } from '@/lib/videoConferencing';

/**
 * POST /api/video-sessions/detect
 * Detect video conferencing platform from URL or page info
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, title } = body;
    
    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }
    
    const result = detectPlatform(url);
    
    return NextResponse.json({
      platform: result.platform,
      confidence: result.confidence,
      isMeetingActive: result.isMeetingActive,
      sessionTitle: title || null,
    });
  } catch (error) {
    console.error('Error detecting platform:', error);
    return NextResponse.json(
      { error: 'Failed to detect platform' },
      { status: 500 }
    );
  }
}
