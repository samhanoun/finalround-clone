import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsClient } from '@/components/SettingsClient';
import { NotificationPreferences } from '@/components/NotificationPreferences';
import { ProfileSettings } from '@/components/ProfileSettings';
import { AccountDeletion } from '@/components/AccountDeletion';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { createClient } from '@/lib/supabase/server';
import { UsageWidget } from '@/components/UsageWidget';
import { getTranslations } from 'next-intl/server';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
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

  const { data: settings } = await supabase
    .from('llm_settings')
    .select('provider,model,temperature,max_tokens')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  return (
    <AppShell title={t('title')}>
      <RequireAuth>
        <div className="stack">
          <p className="help">
            <Link href="/dashboard">← {t('common.back', { defaultValue: 'Back to dashboard' })}</Link>
          </p>
          
          <UsageWidget />
          
          <ProfileSettings />
          
          {/* Language Settings */}
          <div className="card">
            <div className="cardInner stack">
              <h2 className="cardTitle">{t('language')}</h2>
              <p className="help">{t('languageDescription')}</p>
              <LanguageSwitcher />
            </div>
          </div>
          
          <NotificationPreferences />

          <SettingsClient initial={settings ?? null} />

          <div className="card">
            <div className="cardInner stack">
              <h2 className="cardTitle">{t('securityNotes')}</h2>
              <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
                <li>{t('securityNote1')}</li>
                <li>{t('securityNote2')}</li>
                <li>{t('securityNote3')}</li>
              </ul>
            </div>
          </div>

          <AccountDeletion />
        </div>
      </RequireAuth>
    </AppShell>
  );
}
