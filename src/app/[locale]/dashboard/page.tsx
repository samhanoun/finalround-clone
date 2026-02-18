import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { createClient } from '@/lib/supabase/server';
import { DashboardClient } from '@/components/DashboardClient';
import { UsageWidget } from '@/components/UsageWidget';
import { AnalyticsReconciliation } from '@/components/AnalyticsReconciliation';
import { DashboardStats } from '@/components/DashboardStats';
import { RecentActivity } from '@/components/RecentActivity';
import { QuickActions } from '@/components/QuickActions';
import { BadgesList } from '@/components/BadgesList';
import { ReferralPanel } from '@/components/ReferralPanel';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  // Check if onboarding is completed
  if (data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', data.user.id)
      .single();

    if (!profile?.onboarding_completed) {
      redirect('/onboarding');
    }
  }

  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id,title,status,created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: docs } = await supabase
    .from('resume_documents')
    .select('id,filename,created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <AppShell title="Dashboard">
      <RequireAuth>
        <div className="stack">
          <p className="help">Welcome{data.user?.email ? `, ${data.user.email}` : ''}.</p>

          <QuickActions />

          <DashboardStats />

          <RecentActivity />

          <UsageWidget />

          <AnalyticsReconciliation />

          {/* Social Features: Badges & Referrals */}
          <div className="grid2">
            <BadgesList />
            <ReferralPanel />
          </div>

          <DashboardClient />

          <section id="sessions" className="card">
            <div className="cardInner stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="cardTitle">Recent interview sessions</h2>
                <Link className="button" href="/dashboard">
                  Refresh
                </Link>
              </div>

              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {(sessions ?? []).length ? (
                  (sessions ?? []).map((s) => (
                    <li key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <Link href={`/interview/${s.id}`}>{s.title}</Link>
                      <span className="row" style={{ gap: 10 }}>
                        <span className="badge">{s.status}</span>
                        <span className="small mono">{new Date(s.created_at).toLocaleString()}</span>
                      </span>
                    </li>
                  ))
                ) : (
                  <li className="small">No sessions yet.</li>
                )}
              </ul>
            </div>
          </section>

          <section id="resume" className="card">
            <div className="cardInner stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 className="cardTitle">Recent resume uploads</h2>
                <Link className="button buttonPrimary" href="/resume">
                  Open Resume Builder
                </Link>
              </div>
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {(docs ?? []).length ? (
                  (docs ?? []).map((d) => (
                    <li key={d.id} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{d.filename ?? d.id}</span>
                      <span className="small mono">{new Date(d.created_at).toLocaleString()}</span>
                    </li>
                  ))
                ) : (
                  <li className="small">No documents yet.</li>
                )}
              </ul>
            </div>
          </section>
        </div>
      </RequireAuth>
    </AppShell>
  );
}
