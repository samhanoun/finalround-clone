import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { SupportCenter } from '@/components/support/SupportCenter';
import type { SupportTicket } from '@/lib/supportTypes';

const waiting: SupportTicket = {
  id: '11111111-1111-4111-8111-111111111111',
  subject: 'Live answers stop after 20 minutes',
  description: 'The answer card stopped updating.',
  category: 'technical',
  status: 'waiting_user',
  created_at: '2026-11-05T09:00:00Z',
  updated_at: '2026-11-06T09:00:00Z',
  messages: [{ id: 'm1', is_from_admin: true, content: 'Did you share the whole screen?', created_at: '2026-11-05T10:00:00Z' }],
};
const closed: SupportTicket = {
  id: '22222222-2222-4222-8222-222222222222',
  subject: 'Change my sign-in email',
  description: 'New address, please.',
  category: 'account',
  status: 'closed',
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-02T09:00:00Z',
  messages: [],
};

let tickets: SupportTicket[] = [];
const posts: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  tickets = [waiting, closed];
  posts.length = 0;
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!init?.method || init.method === 'GET') {
      return { ok: true, json: async () => ({ tickets, email: 'ana@example.com' }) } as Response;
    }
    const body = JSON.parse(String(init.body));
    posts.push({ url, body });
    if (url === '/api/support') {
      const ticket: SupportTicket = { ...closed, id: '33333333-3333-4333-8333-333333333333', subject: body.subject, description: body.description, status: 'open', messages: [] };
      return { ok: true, status: 201, json: async () => ({ ticket }) } as Response;
    }
    return { ok: true, status: 201, json: async () => ({ ok: true }) } as Response;
  }) as unknown as typeof fetch;
});

describe('SupportCenter', () => {
  it('lists requests with a quiet status and opens the one waiting for you as a conversation', async () => {
    render(<SupportCenter />);
    const list = await screen.findByRole('region', { name: /Your requests/ });
    expect(await within(list).findByText('Waiting for you')).toBeInTheDocument();
    expect(within(list).getByText('Closed')).toBeInTheDocument();

    const thread = await screen.findByRole('article', { name: waiting.subject });
    expect(within(thread).getByText('The answer card stopped updating.')).toBeInTheDocument();
    expect(within(thread).getByText('Did you share the whole screen?').closest('li')).toHaveAttribute('data-from', 'support');
    expect(within(thread).getByText('The answer card stopped updating.').closest('li')).toHaveAttribute('data-from', 'you');
  });

  it('replies on an open request and reloads the conversation', async () => {
    render(<SupportCenter />);
    const thread = await screen.findByRole('article', { name: waiting.subject });
    fireEvent.change(within(thread).getByLabelText('Your reply'), { target: { value: 'The Zoom window only.' } });
    fireEvent.click(within(thread).getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(posts).toEqual([{ url: `/api/support/${waiting.id}/messages`, body: { content: 'The Zoom window only.' } }]));
  });

  it('shows no reply box on a closed request', async () => {
    render(<SupportCenter />);
    fireEvent.click(await screen.findByRole('button', { name: /Change my sign-in email/ }));
    const thread = await screen.findByRole('article', { name: closed.subject });
    expect(within(thread).queryByLabelText('Your reply')).not.toBeInTheDocument();
    expect(within(thread).getByText(/This request is closed/)).toBeInTheDocument();
  });

  it('opens a new request and then shows it, with where the reply will go', async () => {
    render(<SupportCenter />);
    fireEvent.click(await screen.findByRole('button', { name: 'New request' }));
    const form = screen.getByRole('form', { name: 'Ask for help' });
    fireEvent.change(within(form).getByLabelText('Subject'), { target: { value: 'Invoice for October' } });
    fireEvent.change(within(form).getByLabelText('What’s going on?'), { target: { value: 'I need the October invoice.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send to support' }));

    expect(await screen.findByRole('article', { name: 'Invoice for October' })).toBeInTheDocument();
    expect(screen.getByText('Sent. We’ll reply to ana@example.com and here.')).toBeInTheDocument();
    expect(posts[0]).toEqual({ url: '/api/support', body: { subject: 'Invoice for October', category: 'technical', description: 'I need the October invoice.' } });
  });

  it('goes straight to the form when there are no requests yet', async () => {
    tickets = [];
    render(<SupportCenter />);
    expect(await screen.findByText('No requests yet.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Ask for help' })).toBeInTheDocument();
  });
});
