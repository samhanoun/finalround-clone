import webPush from 'web-push';

// VAPID keys should be generated once using: npx web-push generate-vapid-keys
// Store these in your environment variables - NEVER commit to repo
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || process.env.NEXT_PUBLIC_APP_URL || 'mailto:admin@localhost';

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey
  );
}

export { webPush };
