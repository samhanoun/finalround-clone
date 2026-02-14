import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function InterviewPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return (
      <main style={{ padding: 16 }}>
        <p>
          Not logged in. Go to <Link href="/auth">/auth</Link>.
        </p>
      </main>
    );
  }

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .single();

  const { data: messages } = await supabase
    .from('interview_session_messages')
    .select('*')
    .eq('session_id', id)
    .order('created_at', { ascending: true });

  return (
    <main style={{ padding: 16, maxWidth: 800 }}>
      <h1>{session?.title ?? 'Interview'}</h1>
      <p>
        <Link href="/dashboard">Back</Link>
      </p>

      <h2>Messages</h2>
      <ul>
        {(messages ?? []).map((m) => (
          <li key={m.id}>
            <b>{m.role}:</b> {m.content}
          </li>
        ))}
      </ul>

      <p>
        This page is SSR read-only. Use API:
        <br />
        POST <code>/api/interviews/{id}/messages</code>
      </p>
    </main>
  );
}
