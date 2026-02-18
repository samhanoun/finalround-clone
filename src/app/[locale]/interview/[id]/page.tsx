import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { createClient } from '@/lib/supabase/server';
import { InterviewClient } from '@/components/InterviewClient';

export default async function InterviewPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return (
      <AppShell title="Interview">
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id,title,status,created_at')
    .eq('id', id)
    .single();

  const { data: messages } = await supabase
    .from('interview_session_messages')
    .select('id,role,content,created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true });

  const { data: feedback } = await supabase
    .from('interview_session_feedback')
    .select('id,score,notes,rubric,created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <AppShell title={session?.title ?? 'Interview'}>
      <RequireAuth>
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="help">
              <Link href="/dashboard">← Back to dashboard</Link>
            </p>
            <span className="badge">{session?.status ?? 'unknown'}</span>
          </div>

          <InterviewClient
            sessionId={id}
            initialMessages={(messages ?? []) as unknown as Parameters<typeof InterviewClient>[0]['initialMessages']}
            initialFeedback={(feedback ?? []) as unknown as Parameters<typeof InterviewClient>[0]['initialFeedback']}
          />
        </div>
      </RequireAuth>
    </AppShell>
  );
}
