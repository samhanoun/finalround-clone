import { render, screen } from '@testing-library/react';
import React from 'react';
import { RequireAuth } from '@/components/RequireAuth';

let mockUser: { id: string } | null = null;

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: mockUser } }) } }),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/support',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
  redirect: jest.fn(),
}));

describe('RequireAuth', () => {
  it('shows the page to a signed-in user', async () => {
    mockUser = { id: 'u1' };
    render(
      <RequireAuth>
        <p>Your requests</p>
      </RequireAuth>,
    );
    expect(await screen.findByText('Your requests')).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in, and comes back here afterwards', async () => {
    mockUser = null;
    render(
      <RequireAuth>
        <p>Your requests</p>
      </RequireAuth>,
    );
    expect(await screen.findByRole('heading', { name: 'You’re signed out' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth?next=%2Fsupport');
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute('href', '/');
    expect(screen.queryByText('Your requests')).not.toBeInTheDocument();
  });

  it('says it is loading while the session is checked', () => {
    mockUser = null;
    render(
      <RequireAuth>
        <p>Your requests</p>
      </RequireAuth>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});
