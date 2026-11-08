import { Link } from '@/i18n/routing';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsClient } from '@/components/SettingsClient';
import { NotificationPreferences } from '@/components/NotificationPreferences';
import { ProfileSettings, TimeZoneSetting } from '@/components/ProfileSettings';
import { AccountDeletion } from '@/components/AccountDeletion';
import { DesktopSettings } from '@/components/desktop/DesktopSettings';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { VideoConferencingSettings } from '@/components/VideoConferencingSettings';
import { SignOutButton } from '@/components/SignOutButton';
import { createClient } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';
import { meetingSettingsFromRow } from '@/lib/meetingSettings';
import { loadModelSettings, modelChoices } from '@/lib/answerModels';
import { BillingSection } from './BillingSection';
import { SettingsNav, type SettingsNavItem } from './SettingsNav';
import { SettingRow, SettingsGroup, SettingsSection } from './SettingsUI';
import styles from './Settings.module.css';

/**
 * Settings: one page, one section per subject, in the order people look for
 * them. The section ids are the page's anchors (/settings#notifications).
 */
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

  const [tProfile, tAnswers, tMeetings, tNotifications] = await Promise.all([
    getTranslations('ProfileSettings'),
    getTranslations('AnswerModel'),
    getTranslations('MeetingApps'),
    getTranslations('NotificationPreferences'),
  ]);

  const modelSettings = await loadModelSettings(supabase, userData.user.id);
  const { options: modelOptionList, defaults: modelDefaults } = modelChoices();

  const { data: meetingRow } = await supabase
    .from('video_conferencing_settings')
    .select('*')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  const email = userData.user.email ?? null;

  const sections: SettingsNavItem[] = [
    { id: 'profile', label: t('sections.profile') },
    { id: 'language', label: t('sections.language') },
    { id: 'answers', label: t('sections.answers') },
    { id: 'meeting-apps', label: t('sections.meetings') },
    { id: 'notifications', label: t('sections.notifications') },
    { id: 'desktop', label: t('sections.desktop'), desktopOnly: true },
    { id: 'billing', label: t('sections.billing') },
    { id: 'account', label: t('sections.account') },
  ];

  return (
    <AppShell title={t('title')}>
      <RequireAuth>
        <div className={styles.layout}>
          <SettingsNav items={sections} label={t('sections.label')} />

          <div className={styles.sections}>
            <SettingsSection id="profile" title={t('sections.profile')} desc={tProfile('desc')}>
              <ProfileSettings email={email} />
            </SettingsSection>

            <SettingsSection id="language" title={t('sections.language')} desc={t('descs.language')}>
              <SettingsGroup>
                <LanguageSwitcher />
                <TimeZoneSetting />
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection id="answers" title={t('sections.answers')} desc={tAnswers('desc')}>
              <SettingsClient initial={modelSettings} options={modelOptionList} defaults={modelDefaults} />
            </SettingsSection>

            <SettingsSection id="meeting-apps" title={t('sections.meetings')} desc={tMeetings('desc')}>
              <VideoConferencingSettings initial={meetingSettingsFromRow(meetingRow)} />
            </SettingsSection>

            <SettingsSection id="notifications" title={t('sections.notifications')} desc={tNotifications('desc')}>
              <NotificationPreferences email={email} emailConfigured={Boolean(process.env.SENDGRID_API_KEY)} />
            </SettingsSection>

            {/* Desktop app: this section and its link only show inside the desktop app (html[data-desktop], set by DesktopFrame). */}
            <SettingsSection id="desktop" title={t('sections.desktop')} desc={t('descs.desktop')} desktopOnly>
              <DesktopSettings />
            </SettingsSection>

            <SettingsSection id="billing" title={t('sections.billing')} desc={t('descs.billing')}>
              <BillingSection />
            </SettingsSection>

            <SettingsSection id="account" title={t('sections.account')} desc={t('descs.account')}>
              <SettingsGroup>
                <SettingRow layout="inline" label={t('signedInAs')} help={email}>
                  <SignOutButton />
                </SettingRow>
                <SettingRow layout="inline" label={t('team')} help={t('teamHelp')}>
                  <Link className="button" href="/teams">
                    {t('manageTeam')}
                  </Link>
                </SettingRow>
              </SettingsGroup>
              <h3 className={styles.subhead}>{t('dangerZone')}</h3>
              <AccountDeletion />
            </SettingsSection>
          </div>
        </div>
      </RequireAuth>
    </AppShell>
  );
}
