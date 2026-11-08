/** @jest-environment node */

// A module, so these names don't clash with other test files'.
export {};

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

type Quota = { used: number | null; limit_val: number };

/** get_user_plan and check_quota as the database answers them, per counter. */
function setup(plan: { plan_id: string; plan_name: string } | null, quotas: Record<string, Quota>, failing?: string) {
  const rpc = jest.fn(async (name: string, args: { p_counter_type?: string }) => {
    if (failing && (name === failing || args.p_counter_type === failing)) return { data: null, error: { message: 'connection refused' } };
    if (name === 'get_user_plan') return { data: plan ? [plan] : [], error: null };
    const quota = quotas[args.p_counter_type ?? ''];
    return { data: quota ? [{ allowed: true, remaining: 0, ...quota }] : [], error: null };
  });
  createAdminClient.mockReturnValue({ rpc });
  return { rpc };
}

async function get() {
  const { GET } = await import('./route');
  const res = (await GET()) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } });
});

describe('GET /api/usage', () => {
  it('shows a Tester plan’s own limits, as a paid plan', async () => {
    const { rpc } = setup(
      { plan_id: 'tester', plan_name: 'Tester' },
      {
        copilot_minutes: { used: 61, limit_val: 2000 },
        copilot_session_minutes: { used: 12, limit_val: 120 },
        copilot_daily_minutes: { used: 30, limit_val: 180 },
        resume_deep_reviews: { used: 2, limit_val: 50 },
      },
    );

    expect(await get()).toEqual({
      status: 200,
      body: {
        plan: 'Tester',
        isPro: true,
        limits: { copilot_minutes_monthly: 2000, copilot_session_minutes: 120, copilot_daily_minutes: 180, resume_deep_reviews_monthly: 50 },
        usage: { copilot_minutes_monthly: 61, copilot_session_minutes: 12, copilot_daily_minutes: 30, resume_deep_reviews_monthly: 2 },
      },
    });
    // Smart mode doesn't exist, so it isn't counted.
    expect(rpc.mock.calls.map(([, args]) => args.p_counter_type).filter(Boolean)).toEqual([
      'copilot_minutes',
      'copilot_session_minutes',
      'copilot_daily_minutes',
      'resume_deep_reviews',
    ]);
  });

  it('shows Pro’s limits from the plan, not from figures in the code', async () => {
    setup({ plan_id: 'pro', plan_name: 'Pro' }, {
      copilot_minutes: { used: 0, limit_val: 500 },
      copilot_session_minutes: { used: null, limit_val: 30 },
      copilot_daily_minutes: { used: null, limit_val: 45 },
      resume_deep_reviews: { used: 1, limit_val: 10 },
    });
    const { body } = await get();
    expect(body).toMatchObject({ plan: 'Pro', isPro: true, limits: { copilot_minutes_monthly: 500 }, usage: { copilot_session_minutes: 0 } });
  });

  it('is the free plan when there is no active plan', async () => {
    setup(null, {
      copilot_minutes: { used: 4, limit_val: 10 },
      copilot_session_minutes: { used: 4, limit_val: 10 },
      copilot_daily_minutes: { used: 4, limit_val: 10 },
      resume_deep_reviews: { used: 0, limit_val: 0 },
    });
    const { body } = await get();
    expect(body).toMatchObject({ plan: 'Free', isPro: false, limits: { copilot_minutes_monthly: 10, resume_deep_reviews_monthly: 0 } });
  });

  it('fails rather than showing zeros when a figure can’t be read', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    setup({ plan_id: 'pro', plan_name: 'Pro' }, {}, 'copilot_daily_minutes');
    expect(await get()).toEqual({ status: 500, body: { error: 'usage_unavailable' } });

    setup(null, {}, 'get_user_plan');
    expect((await get()).status).toBe(500);
    error.mockRestore();
  });

  it('needs sign-in', async () => {
    setup(null, {});
    createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await get()).status).toBe(401);
  });
});
