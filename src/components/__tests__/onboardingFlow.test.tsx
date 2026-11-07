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
const mockWrites: Array<{ table: string; method: string; value: unknown }> = [];

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) builder[method] = () => builder;
      builder.single = async () => ({ data: table === 'onboarding_state' ? mockSaved : null, error: null });
      builder.upsert = async (value: unknown) => {
        mockWrites.push({ table, method: 'upsert', value });
        return { error: null };
      };
      builder.update = (value: unknown) => {
        mockWrites.push({ table, method: 'update', value });
        return { eq: async () => ({ error: null }) };
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  mockSaved = null;
  mockWrites.length = 0;
  mockPush.mockReset();
});

/** One primary action per step. */
function primaryButtons(container: HTMLElement) {
  return container.querySelectorAll('.buttonPrimary');
}

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
        expect.objectContaining({ table: 'profiles', value: expect.objectContaining({ full_name: 'Ada Example' }) }),
      ),
    );
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
});
