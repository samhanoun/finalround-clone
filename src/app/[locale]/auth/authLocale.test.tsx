import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import AuthPage from './page';

/** Signing in on another device opens the app in the language saved to the account. */

let mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockParams,
}));

const mockPush = jest.fn();
jest.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/auth',
}));

let mockSaved: { language: string } | null = { language: 'es' };
const mockSettingsQuery = jest.fn();
const mockAuth = {
  signInWithPassword: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
  signInWithOAuth: jest.fn(async () => ({ error: null })),
};
jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: mockAuth,
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          mockSettingsQuery(table, column, value);
          return { maybeSingle: async () => ({ data: mockSaved, error: null }) };
        },
      }),
    }),
  }),
}));

beforeEach(() => {
  mockParams = new URLSearchParams();
  mockSaved = { language: 'es' };
  jest.clearAllMocks();
});

async function signIn() {
  render(<AuthPage />);
  const form = screen.getByRole('form', { name: 'Sign in' });
  fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'correct horse' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(mockPush).toHaveBeenCalled());
}

describe('AuthPage: the saved app language after signing in', () => {
  it('opens the next page in the saved language when the page is in another one', async () => {
    mockParams = new URLSearchParams('next=/teams/join?token=t1');
    await signIn();
    expect(mockSettingsQuery).toHaveBeenCalledWith('user_settings', 'user_id', 'user-1');
    expect(mockPush).toHaveBeenCalledWith('/teams/join?token=t1', { locale: 'es' });
  });

  it('keeps the page language when nothing is saved, or the same one is', async () => {
    mockSaved = null;
    await signIn();
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('keeps a language the link named itself, without looking up the saved one', async () => {
    mockParams = new URLSearchParams('next=/fr/goals');
    await signIn();
    expect(mockSettingsQuery).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/goals');
  });

  it('asks the auth callback to restore it after Google sign-in', async () => {
    render(<AuthPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(mockAuth.signInWithOAuth).toHaveBeenCalled());
    const [{ options }] = mockAuth.signInWithOAuth.mock.calls[0] as unknown as [{ options: { redirectTo: string } }];
    const redirect = new URL(options.redirectTo);
    expect(redirect.pathname).toBe('/api/auth/callback');
    expect(redirect.searchParams.get('next')).toBe('/en/dashboard');
    expect(redirect.searchParams.get('restoreLocale')).toBe('1');
  });
});
