import webPush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { appUrl } from '@/lib/emailTemplates';
import { localizedNotificationEmail } from '@/lib/localizedEmail';
import type { NotificationI18n } from '@/lib/notificationText';

/**
 * One place that delivers a notification, following Settings → Notification
 * preferences:
 * - in-app: a row in `notifications` (the bell), plus a push message to every
 *   browser where the user turned on "Notify me on this device";
 * - email: through SendGrid, when the user allows that type by email.
 * "system" notices (team invites, billing) always go in-app; they are emailed
 * only when `emailAlways` is set. Never throws: a notification must not break
 * the action that caused it.
 */

export type NotificationType = 'interview_reminder' | 'application_update' | 'ai_suggestion' | 'system';

export type NotificationPrefs = {
  email_interview_reminders: boolean;
  email_application_updates: boolean;
  email_ai_suggestions: boolean;
  email_weekly_digest: boolean;
  in_app_interview_reminders: boolean;
  in_app_application_updates: boolean;
  in_app_ai_suggestions: boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  email_interview_reminders: true,
  email_application_updates: true,
  email_ai_suggestions: true,
  email_weekly_digest: false,
  in_app_interview_reminders: true,
  in_app_application_updates: true,
  in_app_ai_suggestions: true,
};

const PREF_SUFFIX: Record<Exclude<NotificationType, 'system'>, string> = {
  interview_reminder: 'interview_reminders',
  application_update: 'application_updates',
  ai_suggestion: 'ai_suggestions',
};

export type NotifyInput = {
  type: NotificationType;
  title: string;
  message: string;
  /** App path to open, e.g. "/jobs". */
  url?: string;
  data?: Record<string, unknown>;
  /** The message key for other languages (src/lib/notificationText.ts); title and message stay as the English fallback. */
  i18n?: NotificationI18n;
  /** Scheduled notices: sent at most once per user and key. */
  dedupeKey?: string;
  /** Email even a "system" notice (e.g. a team invitation). */
  emailAlways?: boolean;
};

export type NotifyResult = { inApp: boolean; email: boolean; push: number; duplicate?: boolean };

export function channelsFor(
  type: NotificationType,
  prefs: NotificationPrefs,
  emailAlways = false,
): { inApp: boolean; email: boolean } {
  if (type === 'system') return { inApp: true, email: emailAlways };
  const suffix = PREF_SUFFIX[type];
  return {
    inApp: prefs[`in_app_${suffix}` as keyof NotificationPrefs] !== false,
    email: emailAlways || prefs[`email_${suffix}` as keyof NotificationPrefs] !== false,
  };
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function loadNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const { data } = await createAdminClient()
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<Partial<NotificationPrefs>>();
  return { ...DEFAULT_NOTIFICATION_PREFS, ...stripNulls(data ?? {}) };
}

function stripNulls<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'boolean')) as Partial<T>;
}

/** The address a user signed in with. */
export async function userEmail(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

type PushRow = { id: string; endpoint: string; p256dh: string; auth: string };

/** Sends to every device the user enabled; forgets devices the browser has dropped. */
export async function sendPush(userId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  if (!isPushConfigured()) return 0;
  const admin = createAdminClient();
  const { data: rows } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  if (!rows?.length) return 0;

  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || appUrl() || 'mailto:support@apexround.app',
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string,
  );
  let sent = 0;
  for (const row of rows as PushRow[]) {
    try {
      await webPush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('id', row.id);
      else console.error('[notify] push failed', { status });
    }
  }
  return sent;
}

export async function notify(userId: string, input: NotifyInput): Promise<NotifyResult> {
  const result: NotifyResult = { inApp: false, email: false, push: 0 };
  try {
    const admin = createAdminClient();

    if (input.dedupeKey) {
      const { data: claimed, error } = await admin
        .from('notification_log')
        .upsert({ user_id: userId, dedupe_key: input.dedupeKey }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
        .select('dedupe_key');
      if (error) throw error;
      if (!claimed?.length) return { ...result, duplicate: true };
    }

    const prefs = await loadNotificationPrefs(userId);
    const channels = channelsFor(input.type, prefs, input.emailAlways);

    if (channels.inApp) {
      const { error } = await admin.from('notifications').insert({
        user_id: userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: { ...(input.data ?? {}), ...(input.url ? { url: input.url } : {}), ...(input.i18n ? { i18n: input.i18n } : {}) },
      });
      if (error) console.error('[notify] in-app insert failed', error.message);
      else result.inApp = true;
      result.push = await sendPush(userId, { title: input.title, body: input.message, url: input.url, tag: input.type });
    }

    if (channels.email) {
      const to = await userEmail(userId);
      if (to) {
        const email = await localizedNotificationEmail(userId, input);
        result.email = await sendEmail({ to, subject: email.subject, text: email.text, html: email.html });
      }
    }
  } catch (error) {
    console.error('[notify] failed', { type: input.type, error: error instanceof Error ? error.message : error });
  }
  return result;
}
