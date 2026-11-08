import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { ResumeClient } from '@/components/ResumeClient';
import { createClient } from '@/lib/supabase/server';

export default async function ResumePage() {
  const tPage = await getTranslations('PageTitles');
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const actions = (
    <Link className="button" href="/cover-letters">
      {tPage('coverLetters')}
    </Link>
  );

  if (!userData.user) {
    return (
      <AppShell title={tPage('resume')} actions={actions}>
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const [{ data: docs }, { data: generations }] = await Promise.all([
    supabase.from('resume_documents').select('id,filename,created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('resume_generations').select('id,status,created_at,input,output,document_id').order('created_at', { ascending: false }).limit(30),
  ]);

  return (
    <AppShell title={tPage('resume')} actions={actions}>
      <RequireAuth>
        <ResumeClient
          initialDocs={(docs ?? []) as unknown as Parameters<typeof ResumeClient>[0]['initialDocs']}
          initialGenerations={(generations ?? []) as unknown as Parameters<typeof ResumeClient>[0]['initialGenerations']}
        />
      </RequireAuth>
    </AppShell>
  );
}
