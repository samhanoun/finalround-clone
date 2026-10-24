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

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        not: () => ({ order: () => ({ limit: () => Promise.resolve({ data: mockRows, error: null }) }) }),
      }),
    }),
  }),
}));

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
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).toBeChecked();
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

describe('setupStartBody', () => {
  it('sends only filled fields with a title built from role and company', () => {
    expect(
      setupStartBody({ ...EMPTY_SETUP, mode: 'coding', noFullCode: true, company: ' Acme ', role: 'Staff Engineer', jobDescription: '\n' }),
    ).toEqual({
      title: 'Staff Engineer at Acme',
      metadata: { mode: 'coding', beta: true, noFullCodeMode: true },
      company: 'Acme',
      role: 'Staff Engineer',
    });
  });

  it('only sends the guardrail for coding interviews', () => {
    expect(setupStartBody({ ...EMPTY_SETUP, mode: 'general', noFullCode: true }).metadata.noFullCodeMode).toBe(false);
    expect(setupStartBody(EMPTY_SETUP).title).toBe('Live general session');
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
