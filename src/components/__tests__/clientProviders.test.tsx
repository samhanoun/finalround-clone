import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ClientProviders } from '@/components/ClientProviders';
import { useToastHook } from '@/components/Toast';

// Uses toasts the way DashboardClient, JobsClient, ResumeClient and NewPracticeButton do.
function SaveButton() {
  const toast = useToastHook();
  return (
    <>
      <button type="button" onClick={() => toast.success('Saved', 'Your changes are live.')}>
        Save
      </button>
      <button type="button" onClick={() => toast.error('Not saved', 'Try again.')}>
        Fail
      </button>
    </>
  );
}

describe('ClientProviders', () => {
  it('lets a useToast consumer render and show a toast', () => {
    render(
      <ClientProviders>
        <SaveButton />
      </ClientProviders>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // A confirmation is announced politely, from a live region that was already in the page.
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Saved');
    expect(toast).toHaveTextContent('Your changes are live.');
  });

  it('announces errors assertively and lets them be dismissed', () => {
    render(
      <ClientProviders>
        <SaveButton />
      </ClientProviders>,
    );
    // Both live regions exist before anything is said.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.click(dismiss);
    // The exit fade ends the toast; jsdom has no animations, so finish it by hand.
    fireEvent.animationEnd(dismiss.closest('div') as HTMLElement);
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('is what the consumers need: without it, useToast throws', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SaveButton />)).toThrow('useToast must be used within a ToastProvider');
    consoleError.mockRestore();
  });
});
