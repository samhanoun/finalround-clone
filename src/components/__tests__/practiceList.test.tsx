import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { PracticeList, type PracticeListItem } from '@/components/practice/PracticeList';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }) }));

const ITEMS: PracticeListItem[] = [
  { id: 'iv-1', title: 'Staff Engineer at Acme', status: 'completed', statusLabel: 'Completed', score: 72, date: 'Nov 7, 2026' },
  { id: 'iv-2', title: null, status: 'draft', statusLabel: 'Not started', score: null, date: 'Nov 6, 2026' },
];

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function renderList(items = ITEMS) {
  return render(
    <section aria-labelledby="practice-heading">
      <h2 id="practice-heading" tabIndex={-1}>
        Your practice interviews
      </h2>
      <PracticeList items={items} headingId="practice-heading" />
    </section>,
  );
}

function openMenu(title: string) {
  const button = screen.getByRole('button', { name: `Options for ${title}` });
  fireEvent.click(button);
  return screen.getByRole('menu', { name: `Options for ${title}` });
}

describe('PracticeList', () => {
  it('lists each interview as a link, with a quiet menu per row', () => {
    renderList();
    const link = screen.getByRole('link', { name: /Staff Engineer at Acme/ });
    expect(link).toHaveAttribute('href', '/interview/iv-1');
    expect(link).toHaveTextContent('Completed');
    expect(link).toHaveTextContent('72');
    // An interview without a title shows the default name.
    expect(screen.getByRole('link', { name: /Practice interview/ })).toHaveAttribute('href', '/interview/iv-2');

    const button = screen.getByRole('button', { name: 'Options for Staff Engineer at Acme' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the menu on the first item, moves with the arrow keys and closes with Escape', () => {
    renderList();
    const menu = openMenu('Staff Engineer at Acme');
    const [rename, remove] = within(menu).getAllByRole('menuitem');
    expect(rename).toHaveTextContent('Rename');
    expect(remove).toHaveTextContent('Delete');
    expect(rename).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(rename).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Options for Staff Engineer at Acme' })).toHaveFocus();
  });

  it('renames an interview in place', async () => {
    renderList();
    fireEvent.click(within(openMenu('Staff Engineer at Acme')).getByRole('menuitem', { name: 'Rename' }));

    const form = screen.getByRole('form', { name: 'Rename Staff Engineer at Acme' });
    const field = within(form).getByLabelText('Interview name');
    expect(field).toHaveValue('Staff Engineer at Acme');
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: '  Acme final round  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('link', { name: /Acme final round/ })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/interviews/iv-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Acme final round' }),
    });
    expect(screen.getByRole('status')).toHaveTextContent('Renamed to “Acme final round”');
    expect(screen.getByRole('button', { name: 'Options for Acme final round' })).toHaveFocus();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('cancels a rename with Escape, and says so when saving fails', async () => {
    renderList();
    fireEvent.click(within(openMenu('Staff Engineer at Acme')).getByRole('menuitem', { name: 'Rename' }));
    fireEvent.keyDown(screen.getByLabelText('Interview name'), { key: 'Escape' });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    fireEvent.click(within(openMenu('Staff Engineer at Acme')).getByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Interview name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("The new name wasn't saved. Try again.");
    expect(screen.getByLabelText('Interview name')).toHaveValue('New name');
  });

  it('deletes only after the confirmation in the row, and Keep leaves it', async () => {
    renderList();
    fireEvent.click(within(openMenu('Staff Engineer at Acme')).getByRole('menuitem', { name: 'Delete' }));

    const confirm = screen.getByRole('group', { name: 'Delete Staff Engineer at Acme' });
    expect(confirm).toHaveTextContent('Delete “Staff Engineer at Acme”? Its questions, answers and report go with it.');
    expect(within(confirm).getByRole('button', { name: 'Keep' })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('link', { name: /Staff Engineer at Acme/ })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(openMenu('Staff Engineer at Acme')).getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Staff Engineer at Acme' })).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: /Staff Engineer at Acme/ })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/interviews/iv-1', { method: 'DELETE' });
    expect(screen.getByRole('status')).toHaveTextContent('Deleted “Staff Engineer at Acme”');
    expect(screen.getByRole('heading', { name: 'Your practice interviews' })).toHaveFocus();
    expect(screen.getByRole('link', { name: /Practice interview/ })).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('keeps the row and says so when the delete fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    renderList();
    fireEvent.click(within(openMenu('Staff Engineer at Acme')).getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Staff Engineer at Acme' })).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("The interview wasn't deleted. Try again.");
    expect(screen.getByRole('group', { name: 'Delete Staff Engineer at Acme' })).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
