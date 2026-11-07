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
import { practiceTypeForRound, type StoredPracticeSetup } from '@/lib/practice/practice';
import styles from '@/components/practice/PracticeList.module.css';

const STATUSES = ['draft', 'in_progress', 'completed'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GoalRow = {
  name: string;
  company: string | null;
  role: string | null;
  round: string;
  resume_document_id: string | null;
  job_description: string | null;
};

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

  // "Practice" on a goal: /interview/<id>?goal=<goal id> fills the setup from it (RLS keeps it to the user's own goals).
  const goalId = typeof search.goal === 'string' && UUID.test(search.goal) ? search.goal : null;
  const { data: goal } =
    goalId && !setup
      ? await supabase
          .from('goals')
          .select('name, company, role, round, resume_document_id, job_description')
          .eq('id', goalId)
          .maybeSingle<GoalRow>()
      : { data: null };
  // "Practice these" in the question bank: /interview/<id>?company=Acme&bank=1
  const company = typeof search.company === 'string' ? search.company.trim().slice(0, 120) : '';
  let prefill: PracticePrefill | undefined = company ? { company, fromBank: search.bank === '1' } : undefined;
  if (goal) {
    const resumeIds = new Set((resumes ?? []).map((resume) => resume.id as string));
    prefill = {
      goalName: goal.name,
      company: goal.company?.trim().slice(0, 120) || undefined,
      role: goal.role?.trim().slice(0, 120) || undefined,
      type: practiceTypeForRound(goal.round),
      resumeDocumentId: goal.resume_document_id && resumeIds.has(goal.resume_document_id) ? goal.resume_document_id : undefined,
      jobDescription: goal.job_description?.trim().slice(0, 20_000) || undefined,
    };
  }

  return (
    <AppShell
      title={session.title || t('interviewTitle')}
      actions={
        <span className={styles.status} data-status={session.status}>
          <span className={styles.statusDot} aria-hidden="true" />
          {status}
        </span>
      }
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
