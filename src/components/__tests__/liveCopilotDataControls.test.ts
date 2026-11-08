import { createTranslator } from 'next-intl';
import { formatCopilotActionError, type CopilotErrorTranslator } from '@/components/liveCopilotDataControls';

const t = createTranslator({ namespace: 'CopilotErrors' } as never) as unknown as CopilotErrorTranslator;

describe('liveCopilotDataControls', () => {
  it('maps known API error codes to user-friendly copy', () => {
    expect(formatCopilotActionError({ error: 'rate_limited' }, 'Fallback', t)).toBe(
      'Too many requests right now. Please wait a moment and try again.',
    );
    expect(formatCopilotActionError({ error: 'session_active' }, 'Fallback', t)).toBe(
      'Stop active sessions before deleting copilot data.',
    );
    expect(formatCopilotActionError({ error: 'session_expired' }, 'Fallback', t)).toBe(
      'This copilot session has expired. Start a new session to continue.',
    );
  });

  it('includes request id for internal errors when present', () => {
    expect(formatCopilotActionError({ error: 'internal_error', extra: { requestId: 'req-123' } }, 'Fallback', t)).toBe(
      'Something went wrong on our side. Reference: req-123',
    );
    expect(formatCopilotActionError({ error: 'internal_error' }, 'Fallback', t)).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('falls back when payload is missing or unknown', () => {
    expect(formatCopilotActionError(null, 'Fallback', t)).toBe('Fallback');
    expect(formatCopilotActionError({ error: 'weird_error' }, 'Fallback', t)).toBe('Fallback');
  });
});
