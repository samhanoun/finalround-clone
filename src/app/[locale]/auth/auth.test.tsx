import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import AuthPage from './page';

let mockParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockParams,
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
  usePathname: () => '/auth',
}));

const mockAuth = {
  signInWithPassword: jest.fn(async () => ({ error: null })),
  signUp: jest.fn(async () => ({ data: { session: {} }, error: null })),
  signInWithOAuth: jest.fn(async () => ({ error: null })),
  resetPasswordForEmail: jest.fn(async () => ({ error: null })),
  signInWithSSO: jest.fn(async () => ({ data: null, error: { message: 'no provider' } })),
};
jest.mock('@/lib/supabase/browser', () => ({ createClient: () => ({ auth: mockAuth }) }));

beforeEach(() => {
  mockParams = new URLSearchParams();
  mockPush.mockReset();
  mockReplace.mockReset();
  Object.values(mockAuth).forEach((fn) => fn.mockClear());
});

describe('AuthPage', () => {
  it('signs in with the form the end-to-end tests use', async () => {
    const { container } = render(<AuthPage />);

    const form = screen.getByRole('form', { name: 'Sign in' });
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(container.querySelector('input[type=email]')).toBeInTheDocument();
    expect(container.querySelector('input[type=password]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    // One primary action: the submit button.
    expect(container.querySelectorAll('.buttonPrimary')).toHaveLength(1);

    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct horse' }));
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('reaches the password field before "Forgot your password?" when tabbing', () => {
    render(<AuthPage />);
    const password = screen.getByLabelText('Password');
    const forgot = screen.getByRole('button', { name: 'Forgot your password?' });
    expect(password.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the reset and single sign-on paths', async () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    const reset = screen.getByRole('form', { name: 'Reset your password' });
    fireEvent.change(within(reset).getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(within(reset).getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ada@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use single sign-on (SSO)' }));
    expect(screen.getByRole('form', { name: 'Sign in with single sign-on' })).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('switches the page language from the foot line, keeping the address query', () => {
    window.history.pushState({}, '', '/en/auth?next=%2Fgoals');
    render(<AuthPage />);

    const picker = screen.getByRole('combobox', { name: 'Language' });
    expect(picker).toHaveValue('en');
    // Each language in its own name.
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'English',
      'Español',
      'Français',
      'Deutsch',
      'Português',
    ]);

    fireEvent.change(picker, { target: { value: 'fr' } });
    expect(mockReplace).toHaveBeenCalledWith('/auth?next=%2Fgoals', { locale: 'fr' });
    window.history.pushState({}, '', '/');
  });

  it('opens on sign-up from ?mode=signup', () => {
    mockParams = new URLSearchParams('mode=signup');
    render(<AuthPage />);
    expect(screen.getByRole('form', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I’m new here' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('At least 8 characters');
  });
});
