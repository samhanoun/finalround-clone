import { NextResponse } from 'next/server';

// Simple health check endpoint for offline detection
export async function HEAD() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'finalround-api'
  });
}
