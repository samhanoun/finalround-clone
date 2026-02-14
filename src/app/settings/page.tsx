import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function SettingsPage() {
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

  const { data: settings } = await supabase
    .from('llm_settings')
    .select('*')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  return (
    <main style={{ padding: 16, maxWidth: 800 }}>
      <h1>/settings</h1>
      <p>
        <Link href="/dashboard">Back</Link>
      </p>

      <h2>LLM settings</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(settings, null, 2)}</pre>
      <p>Update via API: PATCH /api/settings/llm</p>
    </main>
  );
}
