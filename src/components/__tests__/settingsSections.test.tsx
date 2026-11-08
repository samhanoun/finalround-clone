import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { ProfileSettings, TimeZoneSetting } from '@/components/ProfileSettings';
import { SettingsClient } from '@/components/SettingsClient';
import { VideoConferencingSettings } from '@/components/VideoConferencingSettings';
import { NotificationPreferences } from '@/components/NotificationPreferences';
import { DEFAULT_MEETING_SETTINGS } from '@/lib/meetingSettings';
import { DEFAULT_MODEL_SETTINGS } from '@/lib/answerStyle';

jest.mock('@/components/ServiceWorkerProvider', () => ({
  usePushNotifications: () => ({ state: 'unconfigured', busy: false, enable: jest.fn(), disable: jest.fn() }),
}));

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
/** Answers by URL and method; anything not listed is a plain 200. */
let answers: Record<string, { ok: boolean; body?: unknown }> = {};

const PROFILE = {
  id: 'u1',
  email: 'ana@example.com',
  full_name: 'Ana Ruiz',
  avatar_url: null,
  target_roles: ['Frontend Developer'],
  language: 'en',
  timezone: 'Europe/Paris',
  email_notifications: true,
};

beforeEach(() => {
  calls = [];
  answers = { 'GET /api/settings/profile': { ok: true, body: { profile: PROFILE } } };
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${url}`] ?? { ok: true, body: {} };
    return { ok: answer.ok, status: answer.ok ? 200 : 500, json: async () => answer.body ?? {} } as Response;
  }) as unknown as typeof fetch;
});

describe('Settings → Profile', () => {
  it('saves name and roles with one button, which stays quiet until something changes', async () => {
    render(<ProfileSettings email="ana@example.com" />);
    const name = await screen.findByLabelText('Full name');
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeDisabled();
    expect(screen.getByText('1 of 10')).toBeInTheDocument();

    fireEvent.change(name, { target: { value: 'Ana Ruiz Soto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Backend Developer' }));
    expect(screen.getByRole('button', { name: 'Backend Developer' })).toHaveAttribute('aria-pressed', 'true');
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await screen.findByText('Saved');
    const patch = calls.find((call) => call.method === 'PATCH');
    // The time zone is saved on its own (Language & region), never with the profile.
    expect(patch?.body).toEqual({ full_name: 'Ana Ruiz Soto', avatar_url: null, target_roles: ['Frontend Developer', 'Backend Developer'] });
    expect(save).toBeDisabled();
  });

  it('adds and removes a role of your own', async () => {
    render(<ProfileSettings />);
    const input = await screen.findByLabelText('Add another role');
    fireEvent.change(input, { target: { value: 'Staff Engineer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Staff Engineer')).toBeInTheDocument();
    expect(screen.getByText('2 of 10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Staff Engineer' }));
    expect(screen.queryByText('Staff Engineer')).not.toBeInTheDocument();
  });

  it('says when saving failed', async () => {
    answers['PATCH /api/settings/profile'] = { ok: false };
    render(<ProfileSettings />);
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Your profile didn.t save/);
  });
});

describe('Settings → Language & region → Time zone', () => {
  it('saves as soon as it changes', async () => {
    render(<TimeZoneSetting />);
    const select = (await screen.findByLabelText('Time zone')) as HTMLSelectElement;
    expect(select.value).toBe('Europe/Paris');
    fireEvent.change(select, { target: { value: 'Asia/Tokyo' } });
    await screen.findByText('Saved');
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ timezone: 'Asia/Tokyo' });
  });

  it('goes back to the saved zone when saving fails', async () => {
    answers['PATCH /api/settings/profile'] = { ok: false };
    render(<TimeZoneSetting />);
    const select = (await screen.findByLabelText('Time zone')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Asia/Tokyo' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The time zone wasn’t saved. Try again.');
    expect(select.value).toBe('Europe/Paris');
  });
});

describe('Settings → Answers', () => {
  const options = [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: '', provider: 'openai' as const },
    { id: 'gpt-4o', label: 'GPT-4o', note: '', provider: 'openai' as const },
  ];
  const defaults = { answer: 'gpt-4o-mini', coding: 'gpt-4o-mini', codingIsSeparate: false };

  it('saves the model, style and length together', async () => {
    render(<SettingsClient initial={DEFAULT_MODEL_SETTINGS} options={options} defaults={defaults} />);
    expect(screen.getByRole('form', { name: 'Answer model settings' })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Writing style' })).getByLabelText('Precise'));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Answer length' })).getByLabelText('Short'));
    expect(screen.getByText('Sticks closely to your résumé and the question')).toBeInTheDocument();
    expect(screen.getByText('about 80 words')).toBeInTheDocument();

    fireEvent.click(save);
    await screen.findByText('Saved');
    expect(calls[0]).toMatchObject({
      url: '/api/settings/llm',
      method: 'PATCH',
      body: { answerModel: null, codingModel: null, style: 'precise', length: 'short' },
    });
    expect(save).toBeDisabled();
  });

  it('explains when the server has no model to offer', () => {
    render(<SettingsClient initial={DEFAULT_MODEL_SETTINGS} options={[]} defaults={defaults} />);
    expect(screen.getByRole('status')).toHaveTextContent('No AI provider is set up on this server yet');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('Settings → Meeting apps', () => {
  it('saves a switch at once and shows Saved', async () => {
    render(<VideoConferencingSettings initial={DEFAULT_MEETING_SETTINGS} />);
    const autoStart = screen.getByRole('switch', { name: 'Start listening as soon as the session starts' });
    expect(autoStart).not.toBeChecked();
    fireEvent.click(autoStart);
    await screen.findByText('Saved');
    expect(calls[0].body).toMatchObject({ autoStartListening: true });
    expect(autoStart).toBeChecked();
  });

  it('puts the switch back when saving fails', async () => {
    answers['PATCH /api/settings/video-conferencing'] = { ok: false };
    render(<VideoConferencingSettings initial={DEFAULT_MEETING_SETTINGS} />);
    const microphone = screen.getByRole('switch', { name: 'Use my microphone too' });
    fireEvent.click(microphone);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved. Try again.');
    expect(microphone).toBeChecked();
  });
});

describe('Settings → Notifications', () => {
  it('names each checkbox by kind and channel, and saves on request', async () => {
    answers['GET /api/notifications/preferences'] = { ok: true, body: { preferences: { email_weekly_digest: false } } };
    render(<NotificationPreferences email="ana@example.com" emailConfigured />);
    const digest = await screen.findByRole('checkbox', { name: 'Weekly digest Email' });
    const save = screen.getByRole('button', { name: 'Save preferences' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Emails go to ana@example.com')).toBeInTheDocument();

    fireEvent.click(digest);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Interview reminders In the app' }));
    fireEvent.click(save);
    await screen.findByText('Saved');
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toMatchObject({ email_weekly_digest: true, in_app_interview_reminders: false });
  });
});
