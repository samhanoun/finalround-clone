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
jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn(() => null) }));
jest.mock('@/lib/billing', () => ({ cancelBillingForDeletion: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { getStripe } = jest.requireMock('@/lib/stripe') as { getStripe: jest.Mock };
const { cancelBillingForDeletion } = jest.requireMock('@/lib/billing') as { cancelBillingForDeletion: jest.Mock };

/** What happened, in order: billing cancelled, then the user deleted. */
let steps: string[] = [];

function setup({ authEmail = 'Ana@Example.com' as string | null, profileEmail = 'old-address@example.com' as string | null } = {}) {
  const deleteUser = jest.fn(async () => {
    steps.push('delete user');
    return { error: null };
  });
  const admin = { auth: { admin: { deleteUser } } };
  createAdminClient.mockReturnValue(admin);
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: authEmail } } }) },
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { email: profileEmail }, error: null }) };
      return query;
    },
  });
  return { deleteUser, admin };
}

async function remove(confirmEmail: string, extra: Record<string, unknown> = {}) {
  const { DELETE } = await import('./route');
  const res = (await DELETE(new Request('http://localhost/api/settings/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirm_email: confirmEmail, ...extra }),
  }))) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  steps = [];
  getStripe.mockReturnValue(null);
  cancelBillingForDeletion.mockImplementation(async () => {
    steps.push('cancel billing');
    return ['sub_1'];
  });
});

describe('DELETE /api/settings/account', () => {
  it('refuses an address that is not the account’s, without deleting anything', async () => {
    const { deleteUser } = setup();
    expect(await remove('someone-else@example.com')).toEqual({ status: 400, body: { error: 'email_mismatch' } });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('checks against the sign-in address, whatever its case, not a stale copy on the profile', async () => {
    const { deleteUser } = setup();
    expect((await remove('old-address@example.com')).status).toBe(400);
    expect(deleteUser).not.toHaveBeenCalled();
    expect((await remove(' ana@example.COM ')).status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('falls back to the profile’s address when the account has none', async () => {
    const { deleteUser } = setup({ authEmail: null, profileEmail: 'ana@example.com' });
    expect((await remove('ANA@example.com')).status).toBe(200);
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('needs sign-in and an email', async () => {
    setup();
    createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null } }) } });
    expect((await remove('ana@example.com')).status).toBe(401);
    expect((await remove('not an email')).body.error).toBe('invalid_body');
  });

  it('no longer takes a reason: one the client still sends is ignored, not logged', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { deleteUser } = setup();
    expect((await remove('ana@example.com', { reason: 'Too expensive' })).status).toBe(200);
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('DELETE /api/settings/account: billing', () => {
  it('cancels the Stripe subscriptions first, then deletes the account', async () => {
    const stripe = { stripe: true };
    getStripe.mockReturnValue(stripe);
    const { deleteUser, admin } = setup();

    expect(await remove('ana@example.com')).toEqual({ status: 200, body: { success: true } });
    expect(cancelBillingForDeletion).toHaveBeenCalledWith(stripe, admin, 'user-1');
    expect(deleteUser).toHaveBeenCalledWith('user-1');
    expect(steps).toEqual(['cancel billing', 'delete user']);
  });

  it('keeps the account when billing can’t be cancelled, with a code the page translates', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    getStripe.mockReturnValue({ stripe: true });
    cancelBillingForDeletion.mockRejectedValueOnce(new Error('Stripe is down'));
    const { deleteUser } = setup();

    expect(await remove('ana@example.com')).toEqual({ status: 502, body: { error: 'billing_cancel_failed' } });
    expect(deleteUser).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('skips billing when Stripe isn’t set up on the server', async () => {
    const { deleteUser } = setup();
    expect((await remove('ana@example.com')).status).toBe(200);
    expect(cancelBillingForDeletion).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('reports a deletion that Supabase refused', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deleteUser } = setup();
    deleteUser.mockResolvedValueOnce({ error: { message: 'Database error deleting user' } } as never);
    expect(await remove('ana@example.com')).toEqual({ status: 500, body: { error: 'delete_failed' } });
    error.mockRestore();
  });
});
