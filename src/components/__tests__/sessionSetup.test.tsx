import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import {
  EMPTY_SETUP,
  SessionSetup,
  loadSavedSetup,
  saveSetup,
  setupStartBody,
  type SessionSetupValue,
} from '@/components/copilot/SessionSetup';

const resumes = [
  { id: 'r1', filename: 'cv-2026.pdf', created_at: '2026-10-01T00:00:00Z' },
  { id: 'r2', filename: null, created_at: '2026-09-01T00:00:00Z' },
];
let mockRows: typeof resumes = resumes;
// Goals, their materials and playbooks: none unless a test adds them.
let mockTables: Record<string, unknown[]> = {};

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    // Résumés for the picker, plus whatever a test puts in mockTables.
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'not', 'eq', 'order', 'limit']) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: table === 'resume_documents' ? mockRows : (mockTables[table] ?? []), error: null }).then(resolve);
      return builder;
    },
  }),
}));

// The answer model list (Settings → Answer model).
global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ options: [{ id: 'gpt-4o', label: 'GPT-4o' }] }) })) as unknown as typeof fetch;

jest.mock('@/i18n/routing', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function Harness({ initial = EMPTY_SETUP, onChange = jest.fn(), onStart = jest.fn() }: {
  initial?: SessionSetupValue;
  onChange?: (value: SessionSetupValue) => void;
  onStart?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SessionSetup
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      onStart={onStart}
      starting={false}
    />
  );
}

beforeEach(() => {
  mockRows = resumes;
  mockTables = {};
  window.localStorage.clear();
});

describe('SessionSetup', () => {
  it('walks through the interview, résumé and job, then starts', async () => {
    const onChange = jest.fn();
    const onStart = jest.fn();
    render(<Harness onChange={onChange} onStart={onStart} />);

    expect(await screen.findByRole('option', { name: /cv-2026\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Untitled/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Staff Engineer' } });
    expect(screen.getByLabelText('Session title')).toHaveAttribute('placeholder', 'Staff Engineer at Acme');
    fireEvent.change(screen.getByLabelText('Résumé'), { target: { value: 'r1' } });
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'You will own the payments API.' } });

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ company: 'Acme', role: 'Staff Engineer', resumeDocumentId: 'r1', jobDescription: 'You will own the payments API.' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('offers the hints-only guardrail for coding interviews only', () => {
    render(<Harness />);
    expect(screen.queryByText(/Hints only/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Interview type'), { target: { value: 'coding' } });
    const hintsOnly = screen.getByRole('checkbox', { name: /Hints only/ });
    fireEvent.click(hintsOnly);
    expect(hintsOnly).toBeChecked();
  });

  it('sends a goal and this session’s choices to the start route', () => {
    expect(
      setupStartBody({ ...EMPTY_SETUP, goalId: 'g1', answerModel: 'gpt-4o', language: 'fr', codingLanguage: 'go', singleMic: true, playbookId: 'p1' }, TITLES),
    ).toMatchObject({ goalId: 'g1', answerModel: 'gpt-4o', language: 'fr', codingLanguage: 'go', singleMic: true, playbookId: 'p1' });
    expect(setupStartBody(EMPTY_SETUP, TITLES)).not.toHaveProperty('goalId');
  });

  it('sums up a picked goal and keeps its fields behind Edit for this session', async () => {
    mockTables = {
      goals: [
        {
          id: 'g1',
          name: 'Acme staff role',
          company: 'Acme',
          role: 'Staff Engineer',
          round: 'technical',
          resume_document_id: 'r1',
          job_description: 'Own the payments API.',
          playbook_id: 'p1',
        },
      ],
      goal_materials: [{ goal_id: 'g1' }, { goal_id: 'g1' }, { goal_id: 'other' }],
      playbooks: [{ id: 'p1', name: 'STAR stories' }],
    };
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    expect(await screen.findByRole('option', { name: 'Acme staff role' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'g1' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ goalId: 'g1', company: 'Acme', mode: 'coding', resumeDocumentId: 'r1' }));

    const summary = screen.getByLabelText('Goal details');
    expect(summary).toHaveTextContent('CompanyAcme');
    expect(summary).toHaveTextContent('RoleStaff Engineer');
    expect(summary).toHaveTextContent('RoundTechnical');
    expect(summary).toHaveTextContent('Résumécv-2026.pdf');
    expect(summary).toHaveTextContent('Materials2');
    expect(summary).toHaveTextContent('PlaybookSTAR stories');
    expect(screen.getByRole('option', { name: 'STAR stories (from the goal)' })).toBeInTheDocument();

    // The by-hand fields stay out of the way until asked for.
    expect(screen.queryByLabelText('Company')).not.toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit for this session' });
    expect(edit).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(edit);
    expect(edit).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme Payments' } });
    expect(screen.getByLabelText('Goal details')).toHaveTextContent('CompanyAcme Payments');
  });

  it('keeps phone or in-person mode and the meeting link next to Start session', async () => {
    const failed = 'The session did not start.';
    render(<SessionSetup value={EMPTY_SETUP} onChange={jest.fn()} onStart={jest.fn()} starting={false} askForLink error={failed} />);
    expect(await screen.findByRole('option', { name: /cv-2026\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Phone or in person' })).toHaveAccessibleDescription(/One microphone/);
    expect(screen.getByLabelText('Meeting link')).toHaveAccessibleDescription(/Optional/);
    expect(screen.getByRole('status')).toHaveTextContent(failed);
    expect(screen.getAllByRole('button').filter((button) => button.className.includes('buttonPrimary'))).toHaveLength(1);
  });

  it('points to the résumé page when nothing is parsed yet', async () => {
    mockRows = [];
    render(<Harness />);
    expect(await screen.findByRole('link', { name: /Upload one on the Résumé page/ })).toHaveAttribute('href', '/resume');
  });

  it('forgets a remembered résumé that no longer exists', async () => {
    const onChange = jest.fn();
    render(<Harness initial={{ ...EMPTY_SETUP, resumeDocumentId: 'deleted-id' }} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ resumeDocumentId: '' })));
  });
});

// English title patterns, as the live page passes them from SessionSetup.titleAt / titleDefault.
const TITLES = { at: (role: string, company: string) => `${role} at ${company}`, fallback: (mode: string) => `Live ${mode} session` };

describe('setupStartBody', () => {
  it('sends only filled fields with a title built from role and company', () => {
    expect(
      setupStartBody({ ...EMPTY_SETUP, mode: 'coding', noFullCode: true, company: ' Acme ', role: 'Staff Engineer', jobDescription: '\n' }, TITLES),
    ).toEqual({
      title: 'Staff Engineer at Acme',
      metadata: { mode: 'coding', beta: true, noFullCodeMode: true },
      company: 'Acme',
      role: 'Staff Engineer',
    });
  });

  it('only sends the guardrail for coding interviews', () => {
    expect(setupStartBody({ ...EMPTY_SETUP, mode: 'general', noFullCode: true }, TITLES).metadata.noFullCodeMode).toBe(false);
    expect(setupStartBody(EMPTY_SETUP, TITLES).title).toBe('Live general session');
  });
});

describe('remembered setup', () => {
  it('round-trips through local storage and ignores junk', () => {
    const value: SessionSetupValue = { ...EMPTY_SETUP, mode: 'video', company: 'Acme', resumeDocumentId: 'r1' };
    saveSetup(value);
    expect(loadSavedSetup()).toEqual(value);

    window.localStorage.setItem('apex.sessionSetup.v1', JSON.stringify({ mode: 'astrology', company: 42 }));
    expect(loadSavedSetup()).toEqual(EMPTY_SETUP);

    window.localStorage.setItem('apex.sessionSetup.v1', '{not json');
    expect(loadSavedSetup()).toEqual(EMPTY_SETUP);
  });
});
