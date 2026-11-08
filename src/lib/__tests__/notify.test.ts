jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => true) }));
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() } }));
jest.mock('@/lib/localizedEmail', () => {
  // A translator over the real message files, standing in for next-intl's.
  const files: Record<string, unknown> = { en: jest.requireActual('@/messages/en.json'), es: jest.requireActual('@/messages/es.json') };
  const translator = (locale: string, namespace: string) => {
    const lookup = (key: string) =>
      `${namespace}.${key}`.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], files[locale]);
    const t = (key: string, values: Record<string, string | number> = {}) =>
      String(lookup(key)).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
    return Object.assign(t, { has: (key: string) => typeof lookup(key) === 'string' });
  };
  return {
    localizedNotificationEmail: jest.fn(async (_u: string, n: { title: string; message: string }) => ({ subject: n.title, text: n.message, html: n.message })),
    userLocaleAndZone: jest.fn(async () => ({ locale: 'en', timeZone: 'UTC' })),
    kitFor: jest.fn(async (locale: string) => ({
      t: (namespace: string) => translator(locale, namespace),
      format: { dateTime: (value: Date) => value.toISOString() },
    })),
  };
});

import webPush from 'web-push';
import { channelsFor, DEFAULT_NOTIFICATION_PREFS, notify } from '@/lib/notify';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { sendEmail } = jest.requireMock('@/lib/email') as { sendEmail: jest.Mock };
const { userLocaleAndZone, kitFor } = jest.requireMock('@/lib/localizedEmail') as { userLocaleAndZone: jest.Mock; kitFor: jest.Mock };
const sendNotification = webPush.sendNotification as jest.Mock;

type Row = Record<string, unknown>;

function mockAdmin({
  prefs = null as Row | null,
  claimed = true,
  pushRows = [] as Row[],
}: { prefs?: Row | null; claimed?: boolean; pushRows?: Row[] } = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const deletes: string[] = [];
  createAdminClient.mockReturnValue({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sam@example.com' } } }) } },
    from: (table: string) => ({
      upsert: () => ({ select: async () => ({ data: claimed ? [{ dedupe_key: 'k' }] : [], error: null }) }),
      insert: async (row: Row) => {
        inserts.push({ table, row });
        return { error: null };
      },
      select: () => ({
        eq: () =>
          table === 'push_subscriptions'
            ? Promise.resolve({ data: pushRows })
            : { maybeSingle: async () => ({ data: prefs }) },
      }),
      delete: () => ({
        eq: async (_column: string, id: string) => {
          deletes.push(id);
          return { error: null };
        },
      }),
    }),
  });
  return { inserts, deletes };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe('channelsFor', () => {
  it('follows the per-type preferences', () => {
    expect(channelsFor('ai_suggestion', DEFAULT_NOTIFICATION_PREFS)).toEqual({ inApp: true, email: true });
    expect(
      channelsFor('interview_reminder', { ...DEFAULT_NOTIFICATION_PREFS, in_app_interview_reminders: false, email_interview_reminders: false }),
    ).toEqual({ inApp: false, email: false });
  });

  it('always shows system notices in the app, and emails them only when asked', () => {
    expect(channelsFor('system', DEFAULT_NOTIFICATION_PREFS)).toEqual({ inApp: true, email: false });
    expect(channelsFor('system', DEFAULT_NOTIFICATION_PREFS, true)).toEqual({ inApp: true, email: true });
  });
});

describe('notify', () => {
  it('adds the notification to the bell and emails it', async () => {
    const { inserts } = mockAdmin();
    const result = await notify('user-1', { type: 'ai_suggestion', title: 'Ready', message: 'Your résumé is ready', url: '/resume' });
    expect(result).toEqual({ inApp: true, email: true, push: 0 });
    expect(inserts).toEqual([
      {
        table: 'notifications',
        row: { user_id: 'user-1', type: 'ai_suggestion', title: 'Ready', message: 'Your résumé is ready', data: { url: '/resume' } },
      },
    ]);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'sam@example.com', subject: 'Ready' }));
  });

  it('respects turned-off preferences', async () => {
    const { inserts } = mockAdmin({ prefs: { in_app_ai_suggestions: false, email_ai_suggestions: false } });
    expect(await notify('user-1', { type: 'ai_suggestion', title: 'Ready', message: 'x' })).toEqual({ inApp: false, email: false, push: 0 });
    expect(inserts).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends a scheduled notice only once per key', async () => {
    const { inserts } = mockAdmin({ claimed: false });
    expect(await notify('user-1', { type: 'interview_reminder', title: 'Soon', message: 'x', dedupeKey: 'interview:1:24h' })).toMatchObject({
      duplicate: true,
    });
    expect(inserts).toEqual([]);
  });

  it('pushes to the user’s devices and forgets ones the browser dropped', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    const { deletes } = mockAdmin({
      pushRows: [
        { id: 'device-1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
        { id: 'device-2', endpoint: 'https://push.example/2', p256dh: 'p', auth: 'a' },
      ],
    });
    sendNotification.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    const result = await notify('user-1', { type: 'system', title: 'Joined', message: 'x', url: '/teams' });
    expect(result.push).toBe(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({ title: 'Joined', body: 'x', url: '/teams', tag: 'system' });
    expect(deletes).toEqual(['device-2']);
  });

  it('pushes in the user’s app language, as emails are', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    mockAdmin({ pushRows: [{ id: 'device-1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }] });
    userLocaleAndZone.mockResolvedValueOnce({ locale: 'es', timeZone: 'Europe/Madrid' });
    sendNotification.mockResolvedValueOnce({});

    await notify('user-1', {
      type: 'ai_suggestion',
      title: 'Practice report: 72/100',
      message: 'Open it to see your scores and what to work on.',
      url: '/interview/s1',
      i18n: { key: 'practiceReport', params: { score: 72 } },
    });

    expect(kitFor).toHaveBeenCalledWith('es', 'Europe/Madrid');
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({
      title: 'Informe de práctica: 72/100',
      body: 'Ábrelo para ver tus puntuaciones y qué mejorar.',
      url: '/interview/s1',
      tag: 'ai_suggestion',
    });
  });

  it('pushes the English text when there is no message key or the language can’t be read, and skips the lookup without devices', async () => {
    process.env.VAPID_PUBLIC_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAdmin({ pushRows: [{ id: 'device-1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }] });
    sendNotification.mockResolvedValue({});

    await notify('user-1', { type: 'system', title: 'Joined', message: 'x' });
    expect(userLocaleAndZone).not.toHaveBeenCalled();

    userLocaleAndZone.mockRejectedValueOnce(new Error('no service role'));
    await notify('user-1', { type: 'system', title: 'Invitation to join Acme', message: 'Sam invited you', i18n: { key: 'teamInvite', params: { team: 'Acme' } } });
    expect(JSON.parse(sendNotification.mock.calls[1][1])).toMatchObject({ title: 'Invitation to join Acme', body: 'Sam invited you' });

    mockAdmin({ pushRows: [] });
    await notify('user-1', { type: 'system', title: 'x', message: 'y', i18n: { key: 'proActive' } });
    expect(userLocaleAndZone).toHaveBeenCalledTimes(1);
    sendNotification.mockReset();
  });

  it('never throws', async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error('no service role');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(notify('user-1', { type: 'system', title: 'x', message: 'y' })).resolves.toEqual({ inApp: false, email: false, push: 0 });
  });
});
