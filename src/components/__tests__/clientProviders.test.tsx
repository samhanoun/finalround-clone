import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ClientProviders } from '@/components/ClientProviders';
import { useToastHook } from '@/components/Toast';

// Uses toasts the way DashboardClient, JobsClient, ResumeClient and SettingsClient do.
function SaveButton() {
  const toast = useToastHook();
  return (
    <button type="button" onClick={() => toast.success('Saved', 'Your changes are live.')}>
      Save
    </button>
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

    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('Saved');
    expect(toast).toHaveTextContent('Your changes are live.');
  });

  it('is what the consumers need: without it, useToast throws', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SaveButton />)).toThrow('useToast must be used within a ToastProvider');
    consoleError.mockRestore();
  });
});
