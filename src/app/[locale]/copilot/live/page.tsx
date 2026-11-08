import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { LiveCopilotScreen } from '@/components/copilot/LiveCopilotScreen';
import { createClient } from '@/lib/supabase/server';
import { isLiveCopilotEnabled } from '@/lib/features';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LiveCopilotPage({ searchParams }: { searchParams: Promise<{ goal?: string; debug?: string }> }) {
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

  if (!isLiveCopilotEnabled()) {
    return (
      <AppShell title={t('title')}>
        <RequireAuth>
          <div className="emptyState">
            <h2 className="cardTitle">{t('offTitle')}</h2>
            <p style={{ margin: 0 }}>{t('offHelp')}</p>
          </div>
        </RequireAuth>
      </AppShell>
    );
  }

  const { goal, debug } = await searchParams;
  return <LiveCopilotScreen title={t('title')} initialGoalId={goal && UUID.test(goal) ? goal : null} debug={debug === '1'} />;
}
