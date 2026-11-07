import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { LiveCopilotClient } from '@/components/LiveCopilotClient';
import { createClient } from '@/lib/supabase/server';
import { isLiveCopilotBetaEnabled } from '@/lib/features';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LiveCopilotPage({ searchParams }: { searchParams: Promise<{ goal?: string }> }) {
  const t = await getTranslations('LivePage');
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <AppShell title={t('title')}>
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { goal } = await searchParams;
  const isEnabled = isLiveCopilotBetaEnabled();

  return (
    <AppShell title={t('title')} actions={<span className="badge">{t('beta')}</span>}>
      <RequireAuth>
        {isEnabled ? (
          <LiveCopilotClient initialGoalId={goal && UUID.test(goal) ? goal : null} />
        ) : (
          <div className="card">
            <div className="cardInner stack">
              <h2 className="cardTitle">{t('offTitle')}</h2>
              <p className="cardDesc">{t.rich('offHelp', { code: (chunks) => <code>{chunks}</code> })}</p>
            </div>
          </div>
        )}
      </RequireAuth>
    </AppShell>
  );
}
