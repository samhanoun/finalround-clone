import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function ResumePage() {
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

  const { data: docs } = await supabase
    .from('resume_documents')
    .select('id,filename,created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <main style={{ padding: 16, maxWidth: 800 }}>
      <h1>/resume</h1>
      <p>
        <Link href="/dashboard">Back</Link>
      </p>

      <p>
        Upload via API: <code>POST /api/resume/upload</code> (multipart/form-data, field: <code>file</code>).
      </p>

      <h2>Documents</h2>
      <ul>
        {(docs ?? []).map((d) => (
          <li key={d.id}>
            {d.filename ?? d.id} ({new Date(d.created_at).toLocaleString()})
          </li>
        ))}
      </ul>
    </main>
  );
}
