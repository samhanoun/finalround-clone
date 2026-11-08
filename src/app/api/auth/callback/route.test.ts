import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: { redirect: (url: URL) => ({ status: 307, location: url.toString() }) },
}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/sso', () => ({ joinSsoOrganization: jest.fn(async () => undefined) }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

function mockAuth({ language = 'es' as string | null, signedIn = true } = {}) {
  createClient.mockResolvedValue({
    auth: {
      exchangeCodeForSession: async () =>
        signedIn ? { data: { user: { id: 'user-1' } }, error: null } : { data: { user: null }, error: { message: 'bad code' } },
    },
  });
  const settingsFor = jest.fn();
  createAdminClient.mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          settingsFor(table, column, value);
          return { maybeSingle: async () => ({ data: language ? { language } : null, error: null }) };
        },
      }),
    }),
  });
  return settingsFor;
}

async function callback(query: string) {
  const { GET } = await import('./route');
  const res = (await GET({ url: `https://apex.test/api/auth/callback?${query}` } as NextRequest)) as unknown as { location: string };
  return res.location;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/auth/callback', () => {
  it('opens next in the saved app language when the sign-in page asked for it', async () => {
    const settingsFor = mockAuth({ language: 'es' });
    expect(await callback(`code=abc&next=${encodeURIComponent('/en/dashboard')}&restoreLocale=1`)).toBe('https://apex.test/es/dashboard');
    expect(settingsFor).toHaveBeenCalledWith('user_settings', 'user_id', 'user-1');
  });

  it('keeps next as it is without the flag, with nothing saved, or when it already matches', async () => {
    mockAuth({ language: 'es' });
    expect(await callback(`code=abc&next=${encodeURIComponent('/en/teams/join?token=t1')}`)).toBe('https://apex.test/en/teams/join?token=t1');

    mockAuth({ language: null });
    expect(await callback(`code=abc&next=${encodeURIComponent('/fr/onboarding')}&restoreLocale=1`)).toBe('https://apex.test/fr/onboarding');

    mockAuth({ language: 'fr' });
    expect(await callback(`code=abc&next=${encodeURIComponent('/fr/dashboard')}&restoreLocale=1`)).toBe('https://apex.test/fr/dashboard');
  });

  it('still signs in when the saved language can’t be read', async () => {
    mockAuth();
    createAdminClient.mockImplementation(() => {
      throw new Error('no service role');
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await callback(`code=abc&next=${encodeURIComponent('/de/dashboard')}&restoreLocale=1`)).toBe('https://apex.test/de/dashboard');
    spy.mockRestore();
  });

  it('sends a failed sign-in back to the sign-in page in its language, without reading settings', async () => {
    const settingsFor = mockAuth({ signedIn: false });
    expect(await callback(`code=abc&next=${encodeURIComponent('/es/dashboard')}&restoreLocale=1`)).toBe('https://apex.test/es/auth?error=signin_failed');
    expect(settingsFor).not.toHaveBeenCalled();
  });

  it('never leaves the site, whatever next says', async () => {
    mockAuth({ language: 'es' });
    expect(await callback(`code=abc&next=${encodeURIComponent('https://evil.example/x')}&restoreLocale=1`)).toBe('https://apex.test/es/dashboard');
  });
});
