import { NextResponse } from 'next/server';

export function sessionExpiredResponse(session: { id: string; status?: string }, nowIso: string, reason = 'heartbeat_timeout') {
  return NextResponse.json(
    {
      ok: false,
      error: 'session_expired',
      code: 'session_expired',
      state: 'expired',
      message: 'Session expired due to inactivity. Start a new session to continue.',
      expired_reason: reason,
      session: {
        id: session.id,
        status: 'expired',
        stopped_at: nowIso,
      },
    },
    { status: 409 },
  );
}
