import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsClient } from '@/components/SettingsClient';
import { createClient } from '@/lib/supabase/server';
import { UsageWidget } from '@/components/UsageWidget';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <AppShell title="Settings">
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { data: settings } = await supabase
    .from('llm_settings')
    .select('provider,model,temperature,max_tokens')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  return (
    <AppShell title="Settings">
      <RequireAuth>
        <div className="stack">
          <p className="help">
            <Link href="/dashboard">← Back to dashboard</Link>
          </p>
          
          <UsageWidget />
          
          <SettingsClient initial={(settings ?? null) as any} />

          <div className="card">
            <div className="cardInner stack">
              <h2 className="cardTitle">Security notes (MVP)</h2>
              <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
                <li>API routes require auth and validate payloads with Zod.</li>
                <li>RLS isolates per-user data; storage is private.</li>
                <li>Provider API keys stay server-side (Vercel env vars).</li>
              </ul>
            </div>
          </div>
        </div>
      </RequireAuth>
    </AppShell>
  );
}
