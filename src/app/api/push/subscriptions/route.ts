import { NextRequest, NextResponse } from 'next/server';
import webPush from 'web-push';

// In-memory store for subscriptions (in production, use a database)
// This is for demonstration - in production, store in your database
const subscriptions: Map<string, PushSubscriptionJSON> = new Map();

// Generate these keys using: npx web-push generate-vapid-keys
// Store these in your environment variables in production
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'UUxI4O8-FbRouAf7-7OTt9GH4o-4VNgoBFQX6rR3lWE';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@finalround.ai';

webPush.setVapidDetails(
  vapidSubject,
  vapidPublicKey,
  vapidPrivateKey
);

interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
}

// GET /api/push/subscriptions - List all subscriptions (admin only in production)
export async function GET() {
  // In production, add admin authentication check
  const allSubscriptions = Array.from(subscriptions.entries()).map(([id, sub]) => ({
    id,
    ...sub,
  }));

  return NextResponse.json({
    count: subscriptions.size,
    subscriptions: allSubscriptions,
  });
}

// POST /api/push/subscriptions - Register a new subscription
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const subscription = body.subscription as PushSubscriptionJSON;

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json(
        { error: 'Invalid subscription object' },
        { status: 400 }
      );
    }

    // Generate a unique ID for this subscription
    const id = Buffer.from(subscription.endpoint).toString('base64').slice(0, 32);
    
    subscriptions.set(id, subscription);

    console.log(`Push subscription added: ${id}`);

    return NextResponse.json({
      success: true,
      id,
      message: 'Subscription registered successfully',
    });
  } catch (error) {
    console.error('Error registering subscription:', error);
    return NextResponse.json(
      { error: 'Failed to register subscription' },
      { status: 500 }
    );
  }
}

// DELETE /api/push/subscriptions - Remove a subscription
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Subscription ID required' },
        { status: 400 }
      );
    }

    const deleted = subscriptions.delete(id);

    return NextResponse.json({
      success: deleted,
      message: deleted ? 'Subscription removed' : 'Subscription not found',
    });
  } catch (error) {
    console.error('Error removing subscription:', error);
    return NextResponse.json(
      { error: 'Failed to remove subscription' },
      { status: 500 }
    );
  }
}

// Helper to send push notifications (can be called from other parts of your app)
export async function sendPushNotification(
  title: string,
  body: string,
  options?: {
    tag?: string;
    url?: string;
    actions?: Array<{ action: string; title: string }>;
  }
) {
  const notificationPayload = {
    title,
    body,
    tag: options?.tag || 'default',
    url: options?.url || '/',
    actions: options?.actions || [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' },
    ],
    id: Date.now().toString(),
    renotify: true,
  };

  const results = await Promise.allSettled(
    Array.from(subscriptions.entries()).map(async ([id, subscription]) => {
      try {
        await webPush.sendNotification(
          subscription as unknown as PushSubscriptionJSON,
          JSON.stringify(notificationPayload)
        );
        return { id, success: true };
      } catch (error) {
        console.error(`Failed to send to ${id}:`, error);
        // Remove invalid subscriptions
        subscriptions.delete(id);
        return { id, success: false };
      }
    })
  );

  return results;
}

// Export VAPID public key for client
export async function VAPID_PUBLIC_KEY() {
  return vapidPublicKey;
}
