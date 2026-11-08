import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { GoalsTab } from '@/components/goals/GoalsTab';
import type { WorkspaceData } from '@/components/goals/GoalsWorkspace';
import { ToastProvider } from '@/components/Toast';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push }) }));
// Only the save, archive and delete handlers talk to Supabase; these tests don't save.
jest.mock('@/lib/supabase/browser', () => ({ createClient: () => ({}) }));

const DATA: WorkspaceData = {
  goals: [
    {
      id: 'g1',
      name: 'Staff engineer at Acme',
      company: 'Acme',
      role: 'Staff Engineer',
      round: 'technical',
      resume_document_id: 'r1',
      job_description: 'Own payments reliability.',
      job_application_id: null,
      playbook_id: 'p1',
      notes: null,
      archived: false,
      updated_at: '2026-11-01T10:00:00Z',
      material_ids: ['m1'],
    },
  ],
  materials: [{ id: 'm1', title: 'Payments notes', kind: 'project', content: 'Led the migration.', source_filename: null, created_at: '2026-11-01T10:00:00Z' }],
  playbooks: [{ id: 'p1', name: 'Calm and concrete', instructions: 'Open with one sentence.', updated_at: '2026-11-01T10:00:00Z' }],
  memories: [],
  resumes: [{ id: 'r1', filename: 'cv.pdf' }],
  jobs: [{ id: 'j1', company: 'Globex', title: 'Platform Engineer', notes: 'Referred by a former colleague', job_url: null }],
  memoryEnabled: true,
};

function renderTab(fromJob: string | null = null) {
  return render(
    <ToastProvider>
      <GoalsTab data={DATA} reload={jest.fn(async () => undefined)} fromJob={fromJob} />
    </ToastProvider>,
  );
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  push.mockClear();
});

describe('GoalsTab', () => {
  it('lists each goal with its role, round and what it uses, with one primary action on the page', () => {
    renderTab();
    const goal = screen.getByRole('heading', { name: 'Staff engineer at Acme' }).closest('li') as HTMLElement;
    expect(within(goal).getByText('Staff Engineer at Acme')).toBeInTheDocument();
    expect(within(goal).getByText('Technical')).toBeInTheDocument();
    expect(within(goal).getByText('Résumé: cv.pdf')).toBeInTheDocument();
    expect(within(goal).getByText('Job description added')).toBeInTheDocument();
    expect(within(goal).getByText('1 material')).toBeInTheDocument();
    expect(within(goal).getByText('Playbook: Calm and concrete')).toBeInTheDocument();
    expect(within(goal).getByRole('link', { name: 'Start live session' })).toHaveAttribute('href', '/copilot/live?goal=g1');

    const primaries = screen.getAllByRole('button').filter((button) => button.classList.contains('buttonPrimary'));
    expect(primaries.map((button) => button.textContent)).toEqual(['New goal']);
  });

  it('starts a practice interview filled in from the goal', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ session: { id: 's9' } }) })) as unknown as typeof fetch;
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/interview/s9?goal=g1'));
  });

  it('edits goals in a sheet; a job from the board opens a new goal filled in from it', () => {
    renderTab('j1');
    const sheet = screen.getByRole('dialog', { name: 'New goal' });
    expect(within(sheet).getByLabelText('Goal name')).toHaveValue('Platform Engineer at Globex');
    expect(within(sheet).getByLabelText('Role')).toHaveValue('Platform Engineer');
    expect(within(sheet).getByLabelText('Notes for yourself')).toHaveValue('Referred by a former colleague');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('dialog', { name: 'Edit goal' });
    expect(within(editor).getByLabelText('Company')).toHaveValue('Acme');
    expect(within(editor).getByRole('checkbox', { name: 'Payments notes' })).toBeChecked();
  });

  it('shows a first-run empty state with the one action', () => {
    render(
      <ToastProvider>
        <GoalsTab data={{ ...DATA, goals: [] }} reload={jest.fn(async () => undefined)} fromJob={null} />
      </ToastProvider>,
    );
    expect(screen.getByText('No goals yet. Make one for each job you’re interviewing for.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New goal' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show archived' })).not.toBeInTheDocument();
  });
});
