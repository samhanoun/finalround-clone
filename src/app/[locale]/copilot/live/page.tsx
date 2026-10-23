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
      <AppShell title="Live copilot">
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const isEnabled = isLiveCopilotBetaEnabled();

  return (
    <AppShell title="Live copilot" actions={<span className="badge">Beta</span>}>
      <RequireAuth>
        {isEnabled ? (
          <LiveCopilotClient />
        ) : (
          <div className="card">
            <div className="cardInner stack">
              <h2 className="cardTitle">Live copilot is switched off</h2>
              <p className="cardDesc">
                Set <code>NEXT_PUBLIC_BETA_LIVE_COPILOT=true</code> to turn it on in this environment.
              </p>
            </div>
          </div>
        )}
      </RequireAuth>
    </AppShell>
  );
}
