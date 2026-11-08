jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/notify', () => ({
  notify: jest.fn(async () => ({ inApp: true, email: false, push: 0 })),
  loadNotificationPrefs: jest.fn(),
  userEmail: jest.fn(),
}));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }));

import { createTranslator } from 'next-intl';

import {
  digestEmail,
  digestWeek,
  formatWhen,
  hasDigestContent,
  interviewReminderSlot,
  runFollowUpReminders,
  runInterviewReminders,
  safeTimeZone,
  type DigestData,
} from '@/lib/notificationJobs';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { notify } = jest.requireMock('@/lib/notify') as { notify: jest.Mock };

const NOW = new Date('2026-10-26T07:30:00Z'); // a Monday

/** A query builder that ignores filters and returns the rows for the table. */
function mockTables(tables: Record<string, unknown[]>) {
  createAdminClient.mockReturnValue({
    from: (table: string) => {
      const result = { data: tables[table] ?? [] };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gt', 'gte', 'lt', 'lte', 'in', 'order', 'limit']) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return builder;
    },
  });
}

beforeEach(() => jest.clearAllMocks());

describe('interviewReminderSlot', () => {
  it('reminds a day before and an hour before', () => {
    expect(interviewReminderSlot('2026-10-27T07:00:00Z', NOW)).toBe('24h');
    expect(interviewReminderSlot('2026-10-26T08:30:00Z', NOW)).toBe('1h');
    expect(interviewReminderSlot('2026-10-28T09:00:00Z', NOW)).toBeNull();
    expect(interviewReminderSlot('2026-10-26T07:00:00Z', NOW)).toBeNull();
  });
});

describe('time zones', () => {
  it('falls back to UTC for unknown zones', () => {
    expect(safeTimeZone('Not/AZone')).toBe('UTC');
    expect(safeTimeZone('Europe/Paris')).toBe('Europe/Paris');
    expect(formatWhen('2026-10-27T13:00:00Z', 'Europe/Paris')).toMatch(/14:00/);
  });

  it('picks Monday 08:00–08:59 in the user’s zone for the digest', () => {
    expect(digestWeek(new Date('2026-10-26T08:15:00Z'), 'UTC')).toBe('2026-10-26');
    expect(digestWeek(new Date('2026-10-26T07:15:00Z'), 'Europe/Paris')).toBe('2026-10-26');
    expect(digestWeek(new Date('2026-10-26T09:15:00Z'), 'UTC')).toBeNull();
    expect(digestWeek(new Date('2026-10-27T08:15:00Z'), 'UTC')).toBeNull();
  });
});

describe('runInterviewReminders', () => {
  it('sends the due reminder with a once-only key', async () => {
    mockTables({
      job_applications: [
        { id: 'job-1', user_id: 'user-1', company: 'Acme', title: 'Staff Engineer', stage: 'interview', interview_at: '2026-10-26T08:15:00Z', next_followup_at: null },
        { id: 'job-2', user_id: 'user-1', company: 'Globex', title: 'Engineer', stage: 'interview', interview_at: '2026-10-27T06:00:00Z', next_followup_at: null },
      ],
      user_settings: [{ user_id: 'user-1', timezone: 'Europe/Paris' }],
      profiles: [],
    });
    expect(await runInterviewReminders(NOW)).toBe(2);
    expect(notify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'interview_reminder', title: 'Interview with Acme in 45 min', dedupeKey: 'interview:job-1:2026-10-26T08:15:00Z:1h' }),
    );
    expect(notify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: expect.stringMatching(/^Interview with Globex: .*07:00/), dedupeKey: 'interview:job-2:2026-10-27T06:00:00Z:24h' }),
    );
  });
});

describe('runFollowUpReminders', () => {
  it('reminds on the follow-up date, but not for offers or rejections', async () => {
    mockTables({
      job_applications: [
        { id: 'job-1', user_id: 'user-1', company: 'Acme', title: 'Engineer', stage: 'applied', interview_at: null, next_followup_at: '2026-10-26T07:00:00Z' },
        { id: 'job-2', user_id: 'user-1', company: 'Globex', title: 'Engineer', stage: 'rejected', interview_at: null, next_followup_at: '2026-10-26T07:00:00Z' },
      ],
    });
    expect(await runFollowUpReminders(NOW)).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'application_update', title: 'Time to follow up with Acme', url: '/jobs', dedupeKey: 'followup:job-1:2026-10-26T07:00:00Z' }),
    );
  });
});

describe('digest email', () => {
  const data: DigestData = {
    practiceCount: 2,
    averageScore: 71,
    liveSessions: 1,
    liveMinutes: 32,
    applied: 3,
    interviewing: 1,
    offers: 0,
    upcoming: [{ name: 'Acme <Inc>', when: 'Tue 27 Oct, 14:00' }],
  };

  it('summarises the week and escapes names', () => {
    // The Jest next-intl stand-in reads the real English messages.
    const t = createTranslator({ namespace: 'Digest' } as never) as unknown as (key: string, values?: Record<string, string | number>) => string;
    const email = digestEmail(data, t);
    expect(email.text).toContain('2 practice interviews, average score 71/100');
    expect(email.text).toContain('Acme <Inc>: Tue 27 Oct, 14:00');
    expect(email.html).toContain('Acme &lt;Inc&gt;');
    expect(email.html).not.toContain('Acme <Inc>');
  });

  it('skips a week with nothing in it', () => {
    expect(hasDigestContent(data)).toBe(true);
    expect(
      hasDigestContent({ ...data, practiceCount: 0, liveSessions: 0, applied: 0, interviewing: 0, offers: 0, upcoming: [] }),
    ).toBe(false);
  });
});
