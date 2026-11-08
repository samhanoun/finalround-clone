import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QuestionBank } from '@/components/practice/QuestionBank';
import { ToastProvider } from '@/components/Toast';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));

const MINE = {
  id: 'q1',
  company: 'Acme',
  role: null,
  question_text: 'How would you migrate a payments ledger?',
  question_type: 'technical',
  source: 'reported',
  shared: false,
  created_at: '2026-11-01T10:00:00Z',
};
const SHARED = { question_text: 'Tell me about a hard deadline.', question_type: 'behavioral', reports: 3, last_reported_at: '2026-10-20T10:00:00Z' };

const calls: Array<{ url: string; method: string; body?: unknown }> = [];
const realFetch = global.fetch;

beforeEach(() => {
  calls.length = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'PATCH') return { ok: true, json: async () => ({ question: { ...MINE, shared: true } }) };
    if (url.includes('company=')) return { ok: true, json: async () => ({ company: 'Acme', mine: [MINE], shared: [SHARED] }) };
    return { ok: true, json: async () => ({ companies: [{ company: 'Acme', mine: 1, shared: 1 }] }) };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function renderBank() {
  return render(
    <ToastProvider>
      <QuestionBank initialCompany="Acme" />
    </ToastProvider>,
  );
}

describe('QuestionBank', () => {
  it('opens a company and shares one of your questions with its switch', async () => {
    renderBank();
    const bank = await screen.findByRole('region', { name: 'Acme' });
    expect(within(bank).getByText('2 questions')).toBeInTheDocument();
    expect(within(bank).getByText('Reported by 3 people')).toBeInTheDocument();
    expect(within(bank).getByRole('button', { name: 'Practice these questions' })).toHaveClass('buttonPrimary');

    const share = within(bank).getByRole('switch', { name: 'Share with other candidates' });
    expect(share).toHaveAttribute('aria-checked', 'false');
    await act(async () => {
      fireEvent.click(share);
    });
    await waitFor(() => expect(share).toHaveAttribute('aria-checked', 'true'));
    expect(calls.find((call) => call.method === 'PATCH')).toMatchObject({ url: '/api/question-bank/q1', body: { shared: true } });
  });

  it('lists companies with a plain count, and goes back to them from an open bank', async () => {
    renderBank();
    const company = await screen.findByRole('button', { name: /^Acme/ });
    expect(company).toHaveTextContent('2');
    await screen.findByRole('region', { name: 'Acme' });

    fireEvent.click(screen.getByRole('button', { name: 'All companies' }));
    expect(screen.queryByRole('region', { name: 'Acme' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Acme/ })).toBeInTheDocument();
  });
});
