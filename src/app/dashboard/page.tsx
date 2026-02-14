import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return (
      <main style={{ padding: 16 }}>
        <h1>/dashboard</h1>
        <p>
          Not logged in. Go to <Link href="/auth">/auth</Link>.
        </p>
      </main>
    );
  }

  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id,title,status,created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  await supabase
    .from('resume_documents')
    .select('id,filename,created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <main style={{ padding: 16 }}>
      <h1>/dashboard</h1>
      <p>Logged in as {user.email}</p>

      <ul>
        <li>
          <Link href="/resume">Resume</Link>
        </li>
        <li>
          <Link href="/settings">Settings</Link>
        </li>
      </ul>

      <h2>Interview sessions</h2>
      <ul>
        {(sessions ?? []).map((s) => (
          <li key={s.id}>
            <Link href={`/interview/${s.id}`}>{s.title}</Link> ({s.status})
          </li>
        ))}
      </ul>
    </main>
  );
}
