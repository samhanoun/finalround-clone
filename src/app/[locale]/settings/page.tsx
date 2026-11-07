import { Link } from '@/i18n/routing';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsClient } from '@/components/SettingsClient';
import { NotificationPreferences } from '@/components/NotificationPreferences';
import { ProfileSettings } from '@/components/ProfileSettings';
import { AccountDeletion } from '@/components/AccountDeletion';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { VideoConferencingSettings } from '@/components/VideoConferencingSettings';
import { createClient } from '@/lib/supabase/server';
import { UsageWidget } from '@/components/UsageWidget';
import { getTranslations } from 'next-intl/server';
import { meetingSettingsFromRow } from '@/lib/meetingSettings';
import { loadModelSettings, modelChoices } from '@/lib/answerModels';

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

  const modelSettings = await loadModelSettings(supabase, userData.user.id);
  const { options: modelOptionList, defaults: modelDefaults } = modelChoices();

  const { data: meetingRow } = await supabase
    .from('video_conferencing_settings')
    .select('*')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  return (
    <AppShell
      title={t('title')}
      actions={
        <Link className="button" href="/teams">
          {t('teams')}
        </Link>
      }
    >
      <RequireAuth>
        <div className="stack">
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
          
          <NotificationPreferences email={userData.user.email ?? null} emailConfigured={Boolean(process.env.SENDGRID_API_KEY)} />

          <SettingsClient initial={modelSettings} options={modelOptionList} defaults={modelDefaults} />

          <VideoConferencingSettings initial={meetingSettingsFromRow(meetingRow)} />

          <AccountDeletion />
        </div>
      </RequireAuth>
    </AppShell>
  );
}
