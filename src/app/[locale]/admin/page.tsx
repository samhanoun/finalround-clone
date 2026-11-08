import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { requireAdmin } from '@/lib/adminAuth';
import AdminClient from './AdminClient';

/** Staff only: anyone else gets a plain 404, so the page's existence isn't advertised. */
export default async function AdminPage() {
  const tPage = await getTranslations('PageTitles');
  const check = await requireAdmin();
  if (!check.ok) notFound();

  return (
    <AppShell title={tPage('admin')}>
      <AdminClient role={check.role} />
    </AppShell>
  );
}
