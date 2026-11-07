jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => true) }));
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() } }));
jest.mock('@/lib/localizedEmail', () => ({ localizedNotificationEmail: jest.fn(async (_u: string, n: { title: string; message: string }) => ({ subject: n.title, text: n.message, html: n.message })) }));

import webPush from 'web-push';
import { channelsFor, DEFAULT_NOTIFICATION_PREFS, notify } from '@/lib/notify';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { sendEmail } = jest.requireMock('@/lib/email') as { sendEmail: jest.Mock };
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
        eq: (_column: string, _value: string) =>
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

  it('never throws', async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error('no service role');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(notify('user-1', { type: 'system', title: 'x', message: 'y' })).resolves.toEqual({ inApp: false, email: false, push: 0 });
  });
});
