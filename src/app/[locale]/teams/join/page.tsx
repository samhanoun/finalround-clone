import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { createClient } from '@/lib/supabase/server';
import { previewInvitation } from '@/lib/teamInvites';
import { JoinTeam } from './JoinTeam';
import styles from './join.module.css';

export default async function JoinTeamPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const tPage = await getTranslations('PageTitles');
  const { token = '' } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const invitation = /^[\w-]{16,100}$/.test(token) ? await previewInvitation(token) : null;

  const content = (
    <JoinTeam token={token} invitation={invitation} signedInAs={user?.email ?? null} />
  );

  if (!user) {
    return <main className={styles.standalone}>{content}</main>;
  }
  return <AppShell title={tPage('joinTeam')}>{content}</AppShell>;
}
