import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { JoinTeam } from './JoinTeam';
import type { InvitationPreview } from '@/lib/teamInvites';

const mockPush = jest.fn();
jest.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}));

const invitation: InvitationPreview = {
  teamName: 'Northwind Platform',
  email: 'ada@example.com',
  role: 'member',
  status: 'pending',
  invitedBy: 'Grace',
  expiresAt: '2026-11-21T00:00:00Z',
};

beforeEach(() => {
  mockPush.mockReset();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

describe('JoinTeam', () => {
  it('asks a signed-out visitor to sign in, with one primary action', () => {
    const { container } = render(<JoinTeam token={'t'.repeat(20)} invitation={invitation} signedInAs={null} />);
    expect(screen.getByRole('heading', { name: 'Join Northwind Platform' })).toBeInTheDocument();
    const signIn = screen.getByRole('link', { name: 'Sign in to accept' });
    expect(signIn).toHaveClass('buttonPrimary');
    expect(signIn.getAttribute('href')).toMatch(/^\/auth\?next=/);
    expect(screen.getByRole('link', { name: 'Create an account' })).not.toHaveClass('buttonPrimary');
    expect(container.querySelectorAll('.buttonPrimary')).toHaveLength(1);
  });

  it('accepts for the invited account and opens Teams', async () => {
    render(<JoinTeam token={'t'.repeat(20)} invitation={invitation} signedInAs="ada@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: 'Join Northwind Platform' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/teams'));
  });

  it('names "A teammate" when the inviter has deleted their account', () => {
    render(<JoinTeam token={'t'.repeat(20)} invitation={{ ...invitation, invitedBy: null }} signedInAs="ada@example.com" />);
    expect(screen.getByText(/^A teammate invited/)).toHaveTextContent('A teammate invited ada@example.com to join as a member.');
    expect(screen.getByRole('button', { name: 'Join Northwind Platform' })).toBeInTheDocument();
  });

  it('explains a wrong account instead of offering to join', () => {
    render(<JoinTeam token={'t'.repeat(20)} invitation={invitation} signedInAs="someone@example.com" />);
    expect(screen.getByRole('alert')).toHaveTextContent('This invitation is for a different email address');
    expect(screen.queryByRole('button', { name: 'Join Northwind Platform' })).not.toBeInTheDocument();
  });

  it('says plainly when the link is not valid, with one way on', () => {
    const { container, rerender } = render(<JoinTeam token="" invitation={null} signedInAs={null} />);
    expect(screen.getByRole('heading', { name: 'This invitation link isn’t valid' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Apex Round' })).toHaveAttribute('href', '/');
    expect(container.querySelectorAll('.buttonPrimary')).toHaveLength(1);

    rerender(<JoinTeam token="" invitation={null} signedInAs="ada@example.com" />);
    expect(screen.getByRole('link', { name: 'Open Teams' })).toHaveAttribute('href', '/teams');
  });
});
