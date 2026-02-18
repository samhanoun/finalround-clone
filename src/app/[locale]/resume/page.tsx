import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { ResumeClient } from '@/components/ResumeClient';
import { createClient } from '@/lib/supabase/server';

export default async function ResumePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <AppShell title="Resume Builder">
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { data: docs } = await supabase
    .from('resume_documents')
    .select('id,filename,created_at')
    .order('created_at', { ascending: false })
    .limit(30);

  const { data: generations } = await supabase
    .from('resume_generations')
    .select('id,status,created_at,input,output,document_id')
    .order('created_at', { ascending: false })
    .limit(30);

  return (
    <AppShell title="Resume Builder">
      <RequireAuth>
        <div className="stack">
          <p className="help">
            <Link href="/dashboard">← Back to dashboard</Link>
          </p>
          <ResumeClient
            initialDocs={(docs ?? []) as unknown as Parameters<typeof ResumeClient>[0]['initialDocs']}
            initialGenerations={(generations ?? []) as unknown as Parameters<typeof ResumeClient>[0]['initialGenerations']}
          />
        </div>
      </RequireAuth>
    </AppShell>
  );
}
