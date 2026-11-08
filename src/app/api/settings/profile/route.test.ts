/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }) },
}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };

/** A user with a profile and no settings row yet; records the row the route creates. */
function firstVisit() {
  const inserted: Array<Record<string, unknown>> = [];
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.single = async () => ({ data: { id: 'user-1', email: 'a@example.test' }, error: null });
      // No settings row yet.
      query.maybeSingle = async () => ({ data: null, error: null });
      query.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { ...row, timezone: 'UTC' }, error: null }) }) };
      };
      return query;
    },
  });
  return inserted;
}

async function get(cookie?: string) {
  const { GET } = await import('./route');
  const res = (await GET(new Request('http://localhost/api/settings/profile', { headers: cookie ? { cookie } : {} }))) as unknown as {
    json: () => Promise<{ profile: Record<string, unknown> }>;
  };
  return (await res.json()).profile;
}

describe('GET /api/settings/profile, first visit', () => {
  it('starts the settings row in the language the user is using, not always English', async () => {
    const inserted = firstVisit();
    expect((await get('theme=dark; NEXT_LOCALE=es')).language).toBe('es');
    expect(inserted[0]).toEqual({ user_id: 'user-1', language: 'es' });
  });

  it('falls back to English without a known language cookie', async () => {
    const inserted = firstVisit();
    await get('NEXT_LOCALE=xx');
    await get();
    expect(inserted.map((row) => row.language)).toEqual(['en', 'en']);
  });
});
