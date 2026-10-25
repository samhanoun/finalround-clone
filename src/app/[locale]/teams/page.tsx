import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { getServerOrganizationClient, getUserOrganizationContext } from '@/lib/organizations';
import TeamsClient from './TeamsClient';

export default async function TeamsPage() {
  const supabase = await getServerOrganizationClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth');
  }

  const { organization, role } = await getUserOrganizationContext(supabase);

  return (
    <AppShell title="Teams">
      <TeamsClient initialOrganization={organization} role={role} />
    </AppShell>
  );
}
