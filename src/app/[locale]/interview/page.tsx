import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import { createClient } from '@/lib/supabase/server';
import styles from '../dashboard/dashboard.module.css';

/** Practice interviews: answer questions in a mock session and get feedback. */
export default async function PracticePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <AppShell title="Practice">
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id,title,status,created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <AppShell title="Practice" actions={<NewPracticeButton primary label="New practice interview" />}>
      <RequireAuth>
        <section className="card" aria-labelledby="practice-heading">
          <div className="cardInner stack">
            <div>
              <h2 className="cardTitle" id="practice-heading">
                Your practice interviews
              </h2>
              <p className="cardDesc">Answer interview questions, then read the score and feedback on each session.</p>
            </div>
            <ul className={styles.list}>
              {(sessions ?? []).length ? (
                (sessions ?? []).map((s) => (
                  <li key={s.id} className={styles.listRow}>
                    <Link href={`/interview/${s.id}`} className={styles.rowLink}>
                      {s.title}
                    </Link>
                    <span className={styles.rowMeta}>
                      <span className="badge">{s.status}</span>
                      <span>{new Date(s.created_at).toLocaleDateString()}</span>
                    </span>
                  </li>
                ))
              ) : (
                <li className={styles.empty}>No practice interviews yet. Start one to get a score and feedback.</li>
              )}
            </ul>
          </div>
        </section>
      </RequireAuth>
    </AppShell>
  );
}
