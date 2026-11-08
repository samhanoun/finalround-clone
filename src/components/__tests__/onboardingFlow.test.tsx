import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import OnboardingFlow from '@/components/OnboardingFlow';

const mockPush = jest.fn();
// Stable, as the real router is (the component reloads its saved step when the router changes).
const mockRouter = { push: mockPush, refresh: jest.fn() };
jest.mock('@/i18n/routing', () => ({
  useRouter: () => mockRouter,
}));

/** What the onboarding_state row holds when the page opens (null: a new account). */
let mockSaved: Record<string, unknown> | null = null;
const mockWrites: Array<{ table: string; method: string; value: unknown; options?: unknown }> = [];
/** Writes to these tables fail (a dropped connection, a constraint). */
const mockFailing = new Set<string>();

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) builder[method] = () => builder;
      builder.maybeSingle = async () => ({ data: table === 'onboarding_state' ? mockSaved : null, error: null });
      const result = () => ({ error: mockFailing.has(table) ? { message: 'duplicate key value violates unique constraint' } : null });
      builder.upsert = async (value: unknown, options?: unknown) => {
        mockWrites.push({ table, method: 'upsert', value, options });
        return result();
      };
      builder.update = (value: unknown) => {
        mockWrites.push({ table, method: 'update', value });
        return { eq: async () => result() };
      };
      return builder;
    },
  }),
}));

const fetchMock = jest.fn<Promise<{ ok: boolean; json: () => Promise<unknown> }>, [string, RequestInit?]>(async () => ({
  ok: false,
  json: async () => ({ error: 'billing_unavailable' }),
}));

beforeEach(() => {
  mockSaved = null;
  mockWrites.length = 0;
  mockFailing.clear();
  mockPush.mockReset();
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** One primary action per step. */
function primaryButtons(container: HTMLElement) {
  return container.querySelectorAll('.buttonPrimary');
}

const profileUpdates = () => mockWrites.filter((write) => write.table === 'profiles').map((write) => write.value as Record<string, unknown>);

describe('OnboardingFlow', () => {
  it('opens on the first of four steps, with one primary action', async () => {
    const { container } = render(<OnboardingFlow />);

    expect(screen.getByRole('heading', { level: 1, name: 'Set up Apex Round' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(primaryButtons(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a plan' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    await waitFor(() => expect(mockWrites).toContainEqual(expect.objectContaining({ table: 'onboarding_state', method: 'upsert' })));
  });

  it('saves progress to the one row per user, so later saves update it', async () => {
    render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(mockWrites[0]).toMatchObject({
      table: 'onboarding_state',
      value: { user_id: 'user-1', current_step: 'plan', plan: null },
      options: { onConflict: 'user_id' },
    });
  });

  it('says so when progress wasn’t saved, and clears it once a save goes through', async () => {
    mockFailing.add('onboarding_state');
    render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your answers weren’t saved. Check your connection and try again.');

    mockFailing.clear();
    fireEvent.click(within(await screen.findByRole('group', { name: 'Choose a plan' })).getByRole('radio', { name: 'Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'About you' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('asks for a plan as a radio choice before going on', async () => {
    mockSaved = { current_step: 'plan', plan: null, profile_data: null };
    const { container } = render(<OnboardingFlow />);

    const plans = await screen.findByRole('group', { name: 'Choose a plan' });
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();
    expect(within(plans).getAllByRole('radio')).toHaveLength(2);
    expect(primaryButtons(container)).toHaveLength(1);
    // No unverified "Most popular" badge.
    expect(screen.queryByText('Most popular')).not.toBeInTheDocument();

    fireEvent.click(within(plans).getByRole('radio', { name: 'Pro' }));
    expect(within(plans).getByRole('radio', { name: 'Pro' })).toBeChecked();
    expect(continueButton).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set up Apex Round' })).toBeInTheDocument();
  });

  it('lists what Pro includes, with no Smart mode', async () => {
    mockSaved = { current_step: 'plan', plan: null, profile_data: null };
    render(<OnboardingFlow />);
    const plans = await screen.findByRole('group', { name: 'Choose a plan' });
    const pro = within(plans).getByRole('radio', { name: 'Pro' }).closest('div') as HTMLElement;
    expect(within(pro).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '400 minutes of live copilot a month',
      'Sessions up to 30 minutes, 45 minutes a day',
      '10 in-depth résumé reviews a month',
      'Everything in Free',
    ]);
    expect(screen.queryByText(/Smart/)).not.toBeInTheDocument();
  });

  it('asks which currency to pay in once Pro is picked, and saves it with the plan', async () => {
    mockSaved = { current_step: 'plan', plan: null, profile_data: null };
    render(<OnboardingFlow />);
    const plans = await screen.findByRole('group', { name: 'Choose a plan' });
    expect(screen.queryByRole('combobox', { name: 'Pay in' })).not.toBeInTheDocument();

    fireEvent.click(within(plans).getByRole('radio', { name: 'Pro' }));
    const currency = screen.getByRole('combobox', { name: 'Pay in' });
    expect(currency).toHaveValue('usd');
    fireEvent.change(currency, { target: { value: 'eur' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(mockWrites).toContainEqual(
        expect.objectContaining({ table: 'onboarding_state', value: expect.objectContaining({ plan: 'pro', profile_data: expect.objectContaining({ currency: 'eur' }) }) }),
      ),
    );
  });

  it('needs a name, a role and an experience level on the profile step', async () => {
    mockSaved = { current_step: 'profile', plan: 'free', profile_data: null };
    render(<OnboardingFlow />);

    const name = await screen.findByLabelText('Full name');
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();

    fireEvent.change(name, { target: { value: 'Ada Example' } });
    const role = screen.getByRole('button', { name: 'Backend Developer' });
    fireEvent.click(role);
    expect(role).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Years of experience'), { target: { value: '3-5' } });
    expect(continueButton).toBeEnabled();

    fireEvent.click(continueButton);
    expect(await screen.findByText('Step 4 of 4')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockWrites).toContainEqual(
        expect.objectContaining({ table: 'profiles', value: expect.objectContaining({ full_name: 'Ada Example', years_experience: 3 }) }),
      ),
    );
  });

  it('saves entry level (0–1 years) as 0 years, not as nothing', async () => {
    mockSaved = { current_step: 'profile', plan: 'free', profile_data: null };
    render(<OnboardingFlow />);

    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Ada Example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Data Scientist' }));
    fireEvent.change(screen.getByLabelText('Years of experience'), { target: { value: '0-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(profileUpdates()).toHaveLength(1));
    expect(profileUpdates()[0]).toEqual({
      full_name: 'Ada Example',
      target_roles: ['Data Scientist'],
      years_experience: 0,
      industry: null,
    });
  });

  it('shows the four things you can do at once and finishes to Home', async () => {
    mockSaved = { current_step: 'tutorial', plan: 'free', profile_data: null };
    const { container } = render(<OnboardingFlow />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Practice an interview' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
    expect(primaryButtons(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Start using Apex Round' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockWrites).toContainEqual({ table: 'profiles', method: 'update', value: { onboarding_completed: true } });
  });

  it('opens Pro checkout in the app’s language and the saved currency', async () => {
    mockSaved = {
      current_step: 'tutorial',
      plan: 'pro',
      profile_data: { fullName: 'Ada Example', targetRoles: ['Backend Developer'], yearsExperience: '10+', industry: '', currency: 'eur' },
    };
    render(<OnboardingFlow />);
    await screen.findByRole('heading', { level: 2, name: 'Practice an interview' });
    // The saved answers are back before finishing.
    await waitFor(() => expect(mockWrites).toHaveLength(0));

    fireEvent.click(screen.getByRole('button', { name: 'Start using Apex Round' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/billing/checkout');
    expect(JSON.parse(String(init?.body))).toEqual({ currency: 'eur', locale: 'en' });
    // The answers go in again with the finished flag.
    expect(profileUpdates()[0]).toEqual({
      full_name: 'Ada Example',
      target_roles: ['Backend Developer'],
      years_experience: 10,
      industry: null,
      onboarding_completed: true,
    });
    // Billing unavailable: Settings has the upgrade button.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/settings'));
  });

  it('stays on the last step and says so when finishing didn’t save', async () => {
    mockSaved = { current_step: 'tutorial', plan: 'free', profile_data: null };
    mockFailing.add('profiles');
    render(<OnboardingFlow />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start using Apex Round' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your answers weren’t saved.');
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start using Apex Round' })).toBeEnabled();
  });
});
