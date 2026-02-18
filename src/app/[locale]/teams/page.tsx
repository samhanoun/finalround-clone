import { redirect } from 'next/navigation';
import { getServerOrganizationClient, getUserOrganizationContext } from '@/lib/organizations';
import TeamsClient from './TeamsClient';

export default async function TeamsPage() {
  const supabase = getServerOrganizationClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth');
  }

  const { organization, role } = await getUserOrganizationContext(supabase);

  return <TeamsClient userId={user.id} initialOrganization={organization} role={role} />;
}
