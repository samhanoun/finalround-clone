import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <AppShell>
      <section className="card">
        <div className="cardInner stack" style={{ padding: 22 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 10, maxWidth: 680 }}>
              <h1 style={{ fontSize: '2.2rem', margin: 0, letterSpacing: -0.4 }}>Prepare interviews. Ship better resumes.</h1>
              <p className="help" style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>
                A clean MVP: an <b>Interview Copilot</b> (chat + feedback/score) and a <b>Resume Builder</b> (upload + job
                description + generation history) backed by Supabase.
              </p>
              <div className="row">
                {data.user ? (
                  <Link className="button buttonPrimary" href="/dashboard">
                    Go to dashboard
                  </Link>
                ) : (
                  <Link className="button buttonPrimary" href="/auth">
                    Login
                  </Link>
                )}
                <Link className="button" href="/settings">
                  Settings
                </Link>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <span className="badge">Next.js App Router</span>
                <span className="badge">Supabase Auth + RLS</span>
                <span className="badge">Server-only API keys</span>
              </div>
            </div>

            <div className="card" style={{ boxShadow: 'none', background: 'rgba(255,255,255,0.04)', maxWidth: 360 }}>
              <div className="cardInner stack">
                <h2 className="cardTitle">Quick links</h2>
                <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  <li>
                    <Link href="/dashboard">Dashboard</Link>
                  </li>
                  <li>
                    <Link href="/resume">Resume Builder</Link>
                  </li>
                  <li>
                    <Link href="/settings">LLM Settings</Link>
                  </li>
                </ul>
                <p className="small">A11y: use “Skip to content” (Tab) and semantic headings.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ height: 16 }} />

      <section className="grid2">
        <div className="card">
          <div className="cardInner stack">
            <h2 className="cardTitle">Interview Copilot</h2>
            <p className="cardDesc">Create a session, keep a chat log, store feedback & scoring, export notes.</p>
            <Link className="button" href="/dashboard">
              Open
            </Link>
          </div>
        </div>

        <div className="card">
          <div className="cardInner stack">
            <h2 className="cardTitle">Resume Builder</h2>
            <p className="cardDesc">Upload a CV, paste a job description, request variants and track history.</p>
            <Link className="button" href="/resume">
              Open
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
