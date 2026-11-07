import { fireEvent, render, screen, within } from '@testing-library/react';
import Home from './page';

let mockUser: { id: string } | null = null;
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mockUser } }) } }),
}));

beforeAll(() => {
  // jsdom has <dialog> but not its methods.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  mockUser = null;
});

async function renderLanding() {
  return render(await Home());
}

describe('Landing page', () => {
  it('leads with the headline, one primary action and the answer card', async () => {
    await renderLanding();

    const hero = screen.getByRole('region', { name: 'The answer, while the question is still in the air' });
    const primary = hero.querySelectorAll('.buttonPrimary');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent('Start free');
    expect(primary[0]).toHaveAttribute('href', '/auth?mode=signup');
    expect(within(hero).getByRole('link', { name: 'Get the Windows app' })).toHaveAttribute('href', '#desktop');

    // The moment: the question in the interviewer's voice, the answer written from the résumé.
    const moment = within(hero).getByRole('figure', { name: 'Example: a question and its suggested answer' });
    expect(within(moment).getByText('How would you design rate limiting for a public API?')).toBeInTheDocument();
    expect(within(moment).getAllByRole('listitem')).toHaveLength(3);
    expect(within(moment).getByText(/^From your résumé/)).toBeInTheDocument();
  });

  it('keeps Sign in as a quiet link and the first Start free link in the header', async () => {
    await renderLanding();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign in' })).not.toHaveClass('button');
    // e2e/auth.spec.ts clicks the first "Start free" link on the page.
    expect(screen.getAllByRole('link', { name: 'Start free' })[0]).toHaveAttribute('href', '/auth?mode=signup');
    expect(within(header).getAllByRole('link', { name: 'Start free' })).toHaveLength(1);
  });

  it('collapses the links into a menu sheet', async () => {
    await renderLanding();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(sheet).getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how');
    expect(within(sheet).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
    expect(within(sheet).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the Windows app shortcuts as keycaps and one primary plan', async () => {
    await renderLanding();

    const desktop = screen.getByRole('region', { name: 'For desktop meeting apps, use the Windows app' });
    expect(within(desktop).getAllByText('Ctrl')).toHaveLength(3);
    expect(within(desktop).getByText('Show or hide the answer window')).toBeInTheDocument();
    expect(within(desktop).getByText('The installer comes with the first public release')).toBeInTheDocument();
    expect(within(desktop).getByRole('img', { name: 'The Windows app’s answer window, pinned over a meeting' })).toBeInTheDocument();

    const pricing = screen.getByRole('region', { name: 'Pricing' });
    expect(pricing.querySelectorAll('.buttonPrimary')).toHaveLength(1);
    expect(within(pricing).getByRole('link', { name: 'Go Pro' })).toHaveClass('buttonPrimary');
  });

  it('sends signed-in visitors into the app', async () => {
    mockUser = { id: 'user-1' };
    await renderLanding();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Open Apex Round' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Start a live session' })).toHaveAttribute('href', '/copilot/live');
    expect(within(screen.getByRole('banner')).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
