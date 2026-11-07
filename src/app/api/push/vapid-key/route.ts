import { NextResponse } from 'next/server';
import { isPushConfigured } from '@/lib/notify';

// GET /api/push/vapid-key - the public key browsers subscribe with (404 when push isn't set up)
export async function GET() {
  if (!isPushConfigured()) return NextResponse.json({ error: 'push_not_configured' }, { status: 404 });
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
