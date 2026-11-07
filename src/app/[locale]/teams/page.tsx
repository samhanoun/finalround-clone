import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/routing';
import { AppShell } from '@/components/AppShell';
import { getServerOrganizationClient, getUserOrganizationContext } from '@/lib/organizations';
import TeamsClient from './TeamsClient';

export default async function TeamsPage() {
  const tPage = await getTranslations('PageTitles');
  const supabase = await getServerOrganizationClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return redirect({ href: '/auth', locale: await getLocale() });
  }

  const { organization, role } = await getUserOrganizationContext(supabase);

  return (
    <AppShell title={tPage('teams')}>
      <TeamsClient initialOrganization={organization} role={role} />
    </AppShell>
  );
}
