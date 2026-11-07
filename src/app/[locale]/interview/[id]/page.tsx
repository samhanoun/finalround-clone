import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { createClient } from '@/lib/supabase/server';
import {
  PracticeInterview,
  type PracticePrefill,
  type PracticeQuestion,
  type PracticeReport,
  type ResumeOption,
} from '@/components/practice/PracticeInterview';
import type { StoredPracticeSetup } from '@/lib/practice/practice';

const STATUSES = ['draft', 'in_progress', 'completed'] as const;

export default async function InterviewPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const t = await getTranslations('PracticePages');
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return (
      <AppShell title={t('interviewTitle')}>
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id, title, status, meta, created_at')
    .eq('id', id)
    .maybeSingle<{ id: string; title: string; status: string; meta: Record<string, unknown> | null; created_at: string }>();
  if (!session) notFound();

  const [{ data: questions }, { data: reports }, { data: resumes }] = await Promise.all([
    supabase
      .from('interview_questions')
      .select('id, question_text, question_type, difficulty, order_index, response_text, response_score, rubric, answered_at')
      .eq('session_id', id)
      .order('order_index', { ascending: true })
      // A follow-up shares its question's order_index and comes after it.
      .order('created_at', { ascending: true }),
    supabase
      .from('interview_reports')
      .select('overall_score, hiring_signal, summary, strengths, weaknesses, next_steps, rubric')
      .eq('session_id', id)
      .order('generated_at', { ascending: false })
      .limit(1),
    supabase
      .from('resume_documents')
      .select('id, filename')
      .not('parsed_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const setup = (session.meta?.practice ?? null) as StoredPracticeSetup | null;
  const status = (STATUSES as readonly string[]).includes(session.status) ? t(`status.${session.status}`) : session.status;
  // "Practice these" in the question bank: /interview/<id>?company=Acme&bank=1
  const company = typeof search.company === 'string' ? search.company.trim().slice(0, 120) : '';
  const prefill: PracticePrefill | undefined = company ? { company, fromBank: search.bank === '1' } : undefined;

  return (
    <AppShell
      title={session.title || t('interviewTitle')}
      actions={<span className={`badge ${session.status === 'completed' ? 'badgeLive' : ''}`}>{status}</span>}
    >
      <RequireAuth>
        <PracticeInterview
          sessionId={id}
          setup={setup}
          questions={(questions ?? []) as PracticeQuestion[]}
          report={(reports?.[0] ?? null) as PracticeReport | null}
          resumes={(resumes ?? []) as ResumeOption[]}
          prefill={prefill}
        />
      </RequireAuth>
    </AppShell>
  );
}
