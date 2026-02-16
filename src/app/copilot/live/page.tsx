import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { LiveCopilotClient } from '@/components/LiveCopilotClient';
import { createClient } from '@/lib/supabase/server';
import { isLiveCopilotBetaEnabled } from '@/lib/features';

export default async function LiveCopilotPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <AppShell title="Live Copilot">
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const isEnabled = isLiveCopilotBetaEnabled();

  return (
    <AppShell title="Live Copilot">
      <RequireAuth>
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="help" style={{ margin: 0 }}>
              <Link href="/dashboard">← Back to dashboard</Link>
            </p>
            <span className="badge">Beta</span>
          </div>

          {isEnabled ? (
            <LiveCopilotClient />
          ) : (
            <div className="card">
              <div className="cardInner stack">
                <h2 className="cardTitle">Beta is currently disabled</h2>
                <p className="cardDesc">
                  Set <code>NEXT_PUBLIC_BETA_LIVE_COPILOT=true</code> to enable this page in your environment.
                </p>
              </div>
            </div>
          )}
        </div>
      </RequireAuth>
    </AppShell>
  );
}
