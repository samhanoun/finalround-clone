import { NextResponse } from 'next/server';
import webPush from 'web-push';

// VAPID keys - in production, generate and store in environment
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'UUxI4O8-FbRouAf7-7OTt9GH4o-4VNgoBFQX6rR3lWE';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@finalround.ai';

webPush.setVapidDetails(
  vapidSubject,
  vapidPublicKey,
  vapidPrivateKey
);

// GET /api/push/vapid-key - Get the VAPID public key for client registration
export async function GET() {
  return NextResponse.json({
    publicKey: vapidPublicKey,
  });
}
