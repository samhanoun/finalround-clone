import { NextResponse } from 'next/server';
import { isPushConfigured } from '@/lib/notify';

// GET /api/push/vapid-key - the public key browsers subscribe with; `publicKey: null` when push
// isn't set up on this server (an ordinary answer, not an error: Settings asks on every visit).
export async function GET() {
  if (!isPushConfigured()) return NextResponse.json({ publicKey: null });
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
