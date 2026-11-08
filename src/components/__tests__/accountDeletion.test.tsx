import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { AccountDeletion } from '@/components/AccountDeletion';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/i18n/routing', () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }) }));

const mockSignOut = jest.fn(async () => ({ error: null }));
jest.mock('@/lib/supabase/browser', () => ({ createClient: () => ({ auth: { signOut: mockSignOut } }) }));

let reply: { status: number; body: unknown } = { status: 200, body: { success: true } };
type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const fetchMock = jest.fn<Promise<Reply>, [string, RequestInit?]>(async () => ({
  ok: reply.status >= 200 && reply.status < 300,
  status: reply.status,
  json: async () => reply.body,
}));

beforeEach(() => {
  jest.clearAllMocks();
  reply = { status: 200, body: { success: true } };
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

/** Opens the confirmation and fills it in. */
function confirmDeletion(email = 'ana@example.com') {
  fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
  const form = screen.getByRole('form', { name: 'Confirm account deletion' });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Your email address' }), { target: { value: email } });
  fireEvent.change(within(form).getByRole('textbox', { name: 'Type DELETE to confirm' }), { target: { value: 'DELETE' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Delete account permanently' }));
  return form;
}

describe('AccountDeletion', () => {
  it('says a paid plan is cancelled too, and asks for no reason', () => {
    render(<AccountDeletion />);
    expect(screen.getByText('Any paid plan, cancelled at once (the rest of the period isn’t refunded)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const form = screen.getByRole('form', { name: 'Confirm account deletion' });
    expect(within(form).getAllByRole('textbox')).toHaveLength(2);
    expect(within(form).queryByText(/Why are you leaving/)).not.toBeInTheDocument();
  });

  it('deletes, signs this browser out, then goes home after the confirmation', async () => {
    jest.useFakeTimers();
    render(<AccountDeletion />);
    confirmDeletion();

    expect(await screen.findByText('Account deleted')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/settings/account');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ confirm_email: 'ana@example.com' });
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    // No request to a sign-out route that doesn't exist.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockPush).toHaveBeenCalledWith('/');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('keeps the account and says why when the subscription couldn’t be cancelled', async () => {
    reply = { status: 502, body: { error: 'billing_cancel_failed' } };
    render(<AccountDeletion />);
    const form = confirmDeletion();

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Your subscription couldn’t be cancelled, so your account wasn’t deleted. Try again in a few minutes.',
    );
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.queryByText('Account deleted')).not.toBeInTheDocument();
  });

  it('falls back to a general message for an error it has no words for', async () => {
    reply = { status: 500, body: { error: 'delete_failed' } };
    render(<AccountDeletion />);
    const form = confirmDeletion();
    expect(await within(form).findByRole('alert')).toHaveTextContent('Your account wasn\'t deleted. Try again.');
  });
});
