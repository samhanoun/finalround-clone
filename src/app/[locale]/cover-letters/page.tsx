import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { createClient } from '@/lib/supabase/server';
import { CoverLetters, type CoverLetter, type ResumeOption } from '@/components/coverLetters/CoverLetters';

export default async function CoverLettersPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const [{ data: letters }, { data: resumes }] = userData.user
    ? await Promise.all([
        supabase
          .from('cover_letters')
          .select('id, title, content, tone, status, metadata, created_at, updated_at')
          .eq('user_id', userData.user.id)
          .order('updated_at', { ascending: false })
          .limit(50),
        supabase
          .from('resume_documents')
          .select('id, filename')
          .not('parsed_text', 'is', null)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <AppShell
      title="Cover letters"
      actions={
        <Link className="button" href="/resume">
          Résumé
        </Link>
      }
    >
      <RequireAuth>
        <CoverLetters initialLetters={(letters ?? []) as CoverLetter[]} resumes={(resumes ?? []) as ResumeOption[]} />
      </RequireAuth>
    </AppShell>
  );
}
