'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { LiveCopilotClient } from '@/components/LiveCopilotClient';

/**
 * The live page's frame. While a session runs, the session bar takes the
 * page title's place and phones get the whole height (no tab bar), so the
 * answer card sits at the top and the controls at the bottom.
 */
export function LiveCopilotScreen({
  title,
  initialGoalId,
  debug,
}: {
  title: string;
  initialGoalId: string | null;
  /** `?debug=1`: the support panels (latency, diagnostics, event stream). */
  debug: boolean;
}) {
  const [inSession, setInSession] = useState(false);
  return (
    <AppShell title={inSession ? undefined : title} mobileNav={!inSession}>
      <RequireAuth>
        <LiveCopilotClient initialGoalId={initialGoalId} debug={debug} onSessionChange={setInSession} />
      </RequireAuth>
    </AppShell>
  );
}
