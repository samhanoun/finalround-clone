import { formatCopilotActionError } from '@/components/liveCopilotDataControls';

describe('liveCopilotDataControls', () => {
  it('maps known API error codes to user-friendly copy', () => {
    expect(formatCopilotActionError({ error: 'rate_limited' }, 'Fallback')).toBe(
      'Too many requests right now. Please wait a moment and try again.',
    );
    expect(formatCopilotActionError({ error: 'session_active' }, 'Fallback')).toBe(
      'Stop active sessions before deleting copilot data.',
    );
    expect(formatCopilotActionError({ error: 'session_expired' }, 'Fallback')).toBe(
      'This copilot session has expired. Start a new session to continue.',
    );
  });

  it('includes request id for internal errors when present', () => {
    expect(
      formatCopilotActionError({ error: 'internal_error', extra: { requestId: 'req-123' } }, 'Fallback'),
    ).toBe('Something went wrong on our side. Reference: req-123');
    expect(formatCopilotActionError({ error: 'internal_error' }, 'Fallback')).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('falls back when payload is missing or unknown', () => {
    expect(formatCopilotActionError(null, 'Fallback')).toBe('Fallback');
    expect(formatCopilotActionError({ error: 'weird_error' }, 'Fallback')).toBe('Fallback');
  });
});
