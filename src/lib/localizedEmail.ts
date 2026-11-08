import { createFormatter, createTranslator } from 'next-intl';
import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/locales';
import { absoluteUrl, renderEmail } from '@/lib/emailTemplates';
import { notificationText, type NotificationI18n } from '@/lib/notificationText';

/**
 * Notification emails in the user's app language (Settings → App language is
 * saved to user_settings.language), with dates in their time zone.
 */

type Messages = Record<string, unknown>;

async function messagesFor(locale: Locale): Promise<Messages> {
  return (await import(`@/messages/${locale}.json`)).default as Messages;
}

export async function userLocaleAndZone(userId: string): Promise<{ locale: Locale; timeZone: string }> {
  const admin = createAdminClient();
  const [{ data: settings }, { data: profile }] = await Promise.all([
    admin.from('user_settings').select('language, timezone').eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('language, timezone').eq('id', userId).maybeSingle(),
  ]);
  const language = (settings?.language ?? profile?.language) as string | undefined;
  const locale = LOCALES.includes(language as Locale) ? (language as Locale) : DEFAULT_LOCALE;
  const zone = (settings?.timezone ?? profile?.timezone) as string | undefined;
  let timeZone = 'UTC';
  try {
    if (zone) {
      new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
      timeZone = zone;
    }
  } catch {
    // unknown zone: UTC
  }
  return { locale, timeZone };
}

/** A message lookup for one namespace, as next-intl's `t`. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Everything an email needs to read in the user's language: translators per namespace, dates in their zone. */
export async function emailKit(userId: string) {
  const { locale, timeZone } = await userLocaleAndZone(userId);
  return { ...(await kitFor(locale, timeZone)), locale, timeZone };
}

/** The same, for a known language (the person may not have an account yet). */
export async function kitFor(locale: Locale, timeZone = 'UTC') {
  const messages = await messagesFor(locale);
  return {
    t: (namespace: string) => createTranslator({ locale, messages, namespace } as never) as unknown as Translate,
    format: createFormatter({ locale, timeZone }),
  };
}

/** The notification as an email in the user's language. */
export async function localizedNotificationEmail(
  userId: string,
  notification: { title: string; message: string; url?: string; i18n?: NotificationI18n },
) {
  const { locale, timeZone } = await userLocaleAndZone(userId);
  const messages = await messagesFor(locale);
  const t = createTranslator({ locale, messages, namespace: 'Notifications' }) as unknown as Parameters<typeof notificationText>[1];
  const tEmail = createTranslator({ locale, messages, namespace: 'Email' }) as unknown as (key: string) => string;
  const format = createFormatter({ locale, timeZone });
  const text = notificationText({ ...notification, data: { i18n: notification.i18n } }, t, format, timeZone);
  const email = renderEmail({
    title: text.title,
    paragraphs: [text.message],
    button: { label: tEmail('open'), url: absoluteUrl(notification.url ?? '/dashboard') },
    footer: tEmail('footer'),
    settingsLabel: tEmail('changeSettings'),
  });
  return { subject: text.title, ...email };
}
