/**
 * Notifications are stored with English text plus an optional message key
 * (data.i18n), so each reader sees them in their own language: the bell
 * translates in the browser, emails on the server (src/lib/notify.ts).
 */

export type NotificationI18n = {
  /** A key under "Notifications" in src/messages/*.json, with .title and .message. */
  key: string;
  params?: Record<string, string | number>;
  /** ISO timestamps, formatted in the reader's language and time zone. */
  dates?: Record<string, string>;
};

type Translator = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

type DateFormatter = { dateTime(value: Date, options?: Intl.DateTimeFormatOptions): string };

const WHEN: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

export function readI18n(data: unknown): NotificationI18n | null {
  const value = (data as { i18n?: NotificationI18n } | null)?.i18n;
  return value && typeof value.key === 'string' ? value : null;
}

export function notificationText(
  notification: { title: string; message: string; data?: unknown },
  t: Translator,
  format: DateFormatter,
  timeZone?: string,
): { title: string; message: string } {
  const i18n = readI18n(notification.data);
  if (!i18n || !t.has(`${i18n.key}.title`)) return { title: notification.title, message: notification.message };
  const values: Record<string, string | number> = { ...(i18n.params ?? {}) };
  for (const [name, iso] of Object.entries(i18n.dates ?? {})) {
    values[name] = format.dateTime(new Date(iso), timeZone ? { ...WHEN, timeZone } : WHEN);
  }
  return {
    title: t(`${i18n.key}.title`, values),
    message: t.has(`${i18n.key}.message`) ? t(`${i18n.key}.message`, values) : notification.message,
  };
}
