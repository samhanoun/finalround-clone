import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppShell } from '@/components/AppShell';

jest.mock('next/navigation', () => ({
  usePathname: () => '/en/dashboard',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));

let avatarUrl: string | null = null;
const profileReads: Array<{ table: string; column: string; value: unknown }> = [];

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'maya@example.com', user_metadata: {} } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          profileReads.push({ table, column, value });
          return { maybeSingle: async () => ({ data: { avatar_url: avatarUrl }, error: null }) };
        },
      }),
    }),
  }),
}));

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  avatarUrl = null;
  profileReads.length = 0;
});

const accountRow = async () => (await screen.findByText('Signed in as maya@example.com')).closest('div') as HTMLElement;

describe('AppShell profile photo', () => {
  it('shows the photo from the user’s own profile in the account row', async () => {
    avatarUrl = 'https://cdn.example/maya.png';
    render(<AppShell title="Home">page</AppShell>);
    const row = await accountRow();
    await waitFor(() => expect(row.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/maya.png'));
    const photo = row.querySelector('img') as HTMLImageElement;
    expect(photo).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(photo).toHaveAttribute('alt', '');
    expect(profileReads).toEqual([{ table: 'profiles', column: 'id', value: 'user-1' }]);
  });

  it('falls back to the initial when there is no photo, or it doesn’t load', async () => {
    render(<AppShell title="Home">page</AppShell>);
    const row = await accountRow();
    await waitFor(() => expect(profileReads).toHaveLength(1));
    expect(row.querySelector('img')).toBeNull();
    expect(within(row).getByText('M')).toBeInTheDocument();
  });

  it('shows the initial again when the photo fails to load', async () => {
    avatarUrl = 'https://cdn.example/broken.png';
    render(<AppShell title="Home">page</AppShell>);
    const row = await accountRow();
    await waitFor(() => expect(row.querySelector('img')).not.toBeNull());
    fireEvent.error(row.querySelector('img') as HTMLImageElement);
    expect(row.querySelector('img')).toBeNull();
    expect(within(row).getByText('M')).toBeInTheDocument();
  });

  it('only shows web addresses', async () => {
    avatarUrl = 'javascript:alert(1)';
    render(<AppShell title="Home">page</AppShell>);
    const row = await accountRow();
    await waitFor(() => expect(profileReads).toHaveLength(1));
    expect(row.querySelector('img')).toBeNull();
  });

  it('shows it in the phone More sheet too', async () => {
    avatarUrl = 'https://cdn.example/maya.png';
    render(<AppShell title="Home">page</AppShell>);
    await waitFor(() => expect((document.querySelector('aside img') as HTMLImageElement | null)?.src).toBe('https://cdn.example/maya.png'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(sheet.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/maya.png');
    expect(within(sheet).getByText('maya@example.com')).toBeInTheDocument();
  });
});
