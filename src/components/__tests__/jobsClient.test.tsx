import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { JobsClient } from '@/components/JobsClient';
import { ToastProvider } from '@/components/Toast';

type Row = Record<string, unknown>;

// A Supabase stand-in: every query resolves with the current rows; updates are recorded.
let rows: Row[] = [];
const updates: Array<Record<string, unknown>> = [];
function query() {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'insert', 'delete']) builder[method] = jest.fn(() => builder);
  builder.update = jest.fn((patch: Record<string, unknown>) => {
    updates.push(patch);
    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return builder;
}
const client = { from: jest.fn(() => query()), auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } };
jest.mock('@/lib/supabase/browser', () => ({ createClient: () => client }));

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const job = (over: Row): Row => ({
  user_id: 'u1',
  status: 'active',
  stage: 'saved',
  applied_at: null,
  next_followup_at: null,
  interview_at: null,
  job_url: null,
  notes: null,
  created_at: '2026-11-01T10:00:00Z',
  ...over,
});

const JOBS = [
  job({ id: 'acme', company: 'Acme', title: 'Staff Engineer', stage: 'interview', applied_at: '2026-10-20T10:00:00Z', interview_at: inDays(5) }),
  job({ id: 'north', company: 'Northwind', title: 'Backend Engineer', stage: 'applied', applied_at: '2026-11-03T10:00:00Z', next_followup_at: inDays(-2) }),
  job({ id: 'init', company: 'Initech', title: 'Engineering Manager', notes: 'Remote, EU hours.' }),
];

function setPhone(matches: boolean) {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderJobs() {
  return render(
    <ToastProvider>
      <JobsClient />
    </ToastProvider>,
  );
}

beforeEach(() => {
  rows = JOBS.map((row) => ({ ...row }));
  updates.length = 0;
  setPhone(false);
});

describe('JobsClient', () => {
  it('starts with one sentence and one action when there are no jobs', async () => {
    rows = [];
    renderJobs();
    const add = await screen.findByRole('button', { name: 'Add a job' });
    expect(add).toHaveClass('buttonPrimary');
    expect(screen.queryByRole('region', { name: /Jobs board/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter by stage' })).not.toBeInTheDocument();

    fireEvent.click(add);
    expect(screen.getByRole('dialog', { name: 'Add a job' })).toBeInTheDocument();
  });

  it('shows the board with quiet counts and stage tabs', async () => {
    renderJobs();
    const board = await screen.findByRole('region', { name: /Jobs board/ });
    expect(within(board).getByRole('group', { name: 'Interview: 1 job' })).toHaveTextContent('Acme');
    expect(within(board).getByRole('group', { name: 'Offer: 0 jobs' })).toBeInTheDocument();
    expect(within(board).getByText(/Follow-up was due/)).toBeInTheDocument();

    const tabs = screen.getByRole('group', { name: 'Filter by stage' });
    expect(within(tabs).getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(tabs).getByRole('button', { name: 'Saved 1' }));
    expect(within(tabs).getByRole('button', { name: 'Saved 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(board).getByRole('group', { name: 'Interview: 0 jobs' })).toHaveAttribute('data-dimmed', 'true');

    // The old stats strip is now one quiet line.
    const summary = screen.getByLabelText('Application statistics');
    expect(summary).toHaveTextContent('3 jobs');
    expect(summary).toHaveTextContent('1 interviewing');
    expect(summary).toHaveTextContent('0 offers');
  });

  it('moves a job to another stage from its menu', async () => {
    renderJobs();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Staff Engineer at Acme' }));
    fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'offer' } });

    await waitFor(() => expect(updates).toContainEqual({ stage: 'offer' }));
    const board = screen.getByRole('region', { name: /Jobs board/ });
    await waitFor(() => expect(within(board).getByRole('group', { name: 'Offer: 1 job' })).toHaveTextContent('Acme'));
    // The menu closed and the move was announced.
    expect(screen.queryByLabelText('Move to')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('Moved Staff Engineer to Offer.');
  });

  it('opens the edit dialog from the menu, and closes the menu on Escape', async () => {
    renderJobs();
    const trigger = await screen.findByRole('button', { name: 'Actions for Engineering Manager at Initech' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Engineering Manager at Initech: dates, notes and link' }));
    expect(screen.getByRole('dialog', { name: 'Edit job' })).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Remote, EU hours.');
  });

  it('says when a search matches nothing', async () => {
    renderJobs();
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search jobs' }), { target: { value: 'globex' } });
    expect(screen.getByText('No matching jobs')).toBeInTheDocument();
  });

  it('lists one stage at a time on phones, with the same menu to move a job', async () => {
    setPhone(true);
    renderJobs();
    await screen.findByRole('group', { name: 'Interview: 1 job' });
    expect(screen.queryByRole('region', { name: /Jobs board/ })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by stage' })).getByRole('button', { name: 'Applied 1' }));
    expect(screen.getByText('Northwind')).toBeInTheDocument();
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Backend Engineer at Northwind' }));
    fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'oa' } });
    await waitFor(() => expect(updates).toContainEqual({ stage: 'oa' }));
  });
});
