import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backdropFilter: 'blur(10px)',
          background: 'rgba(11, 15, 25, 0.75)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="container"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0' }}
        >
          <div className="row" style={{ gap: 12 }}>
            <Link href="/" style={{ fontWeight: 750, fontSize: '1.25rem', letterSpacing: 0.2 }} aria-label="Home">
              FinalRound
            </Link>
          </div>

          <nav aria-label="Primary" className="row" style={{ gap: 24, fontSize: '0.95rem' }}>
            <Link href="#features" style={{ color: 'var(--muted)' }}>Features</Link>
            <Link href="#pricing" style={{ color: 'var(--muted)' }}>Pricing</Link>
            <Link href="/dashboard">Dashboard</Link>
          </nav>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {data.user ? (
              <Link className="button buttonPrimary" href="/dashboard">
                Go to Dashboard
              </Link>
            ) : (
              <Link className="button buttonPrimary" href="/auth">
                Get Started
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section
        style={{
          padding: '100px 0 80px',
          textAlign: 'center',
        }}
      >
        <div className="container" style={{ maxWidth: 800 }}>
          <div style={{ marginBottom: 20 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '6px 14px',
                borderRadius: 20,
                background: 'rgba(124, 92, 255, 0.2)',
                color: 'var(--brand2)',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              AI-Powered Interview Prep
            </span>
          </div>
          
          <h1
            style={{
              fontSize: 'clamp(2.5rem, 5vw, 3.5rem)',
              fontWeight: 750,
              letterSpacing: -0.5,
              lineHeight: 1.15,
              margin: '0 0 24px',
            }}
          >
            Ace Your Next Interview with{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Real-Time AI Copilot
            </span>
          </h1>

          <p
            style={{
              fontSize: '1.2rem',
              lineHeight: 1.6,
              color: 'var(--muted)',
              margin: '0 0 40px',
              maxWidth: 600,
              marginInline: 'auto',
            }}
          >
            Get instant answer suggestions, practice with mock interviews, and build ATS-optimized resumes. 
            Your personal interview coach available 24/7.
          </p>

          <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
            {data.user ? (
              <Link className="button buttonPrimary" href="/dashboard" style={{ padding: '14px 28px', fontSize: '1.05rem' }}>
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link className="button buttonPrimary" href="/auth" style={{ padding: '14px 28px', fontSize: '1.05rem' }}>
                  Start Free Trial
                </Link>
                <Link href="#features" className="button" style={{ padding: '14px 28px', fontSize: '1.05rem' }}>
                  Learn More
                </Link>
              </>
            )}
          </div>

          {/* Trust indicators */}
          <div
            style={{
              marginTop: 60,
              paddingTop: 40,
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'center',
              gap: 40,
              flexWrap: 'wrap',
              color: 'var(--muted)',
              fontSize: '0.9rem',
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <span style={{ color: 'var(--brand2)' }}>✓</span> Free to start
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ color: 'var(--brand2)' }}>✓</span> No credit card required
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span style={{ color: 'var(--brand2)' }}>✓</span> 99.9% uptime SLA
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" style={{ padding: '80px 0', background: 'rgba(255,255,255,0.02)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 16px' }}>Everything You Need to Land Your Dream Job</h2>
            <p style={{ color: 'var(--muted)', fontSize: '1.1rem', maxWidth: 500, marginInline: 'auto' }}>
              Comprehensive interview preparation tools powered by advanced AI
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 24,
            }}
          >
            {/* Feature 1: Live Copilot */}
            <div
              className="card"
              style={{
                padding: 32,
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                  fontSize: '1.5rem',
                }}
              >
                🎯
              </div>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 650, margin: '0 0 12px' }}>Live Interview Copilot</h3>
              <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                Real-time answer suggestions during your interview. Get context-aware prompts, STAR method templates, 
                and confidence boosters without missing a beat.
              </p>
              <ul style={{ marginTop: 16, paddingLeft: 20, color: 'var(--muted)', lineHeight: 1.8 }}>
                <li>Instant transcription & analysis</li>
                <li>STAR response templates</li>
                <li>Clarifying question suggestions</li>
                <li>Follow-up probe prompts</li>
              </ul>
            </div>

            {/* Feature 2: Mock Interview */}
            <div
              className="card"
              style={{
                padding: 32,
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #4dd6ff 0%, #7c5cff 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                  fontSize: '1.5rem',
                }}
              >
                🎤
              </div>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 650, margin: '0 0 12px' }}>AI Mock Interviews</h3>
              <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                Practice with AI-powered mock interviews tailored to your target role. Receive detailed scoring 
                rubrics and actionable feedback to improve continuously.
              </p>
              <ul style={{ marginTop: 16, paddingLeft: 20, color: 'var(--muted)', lineHeight: 1.8 }}>
                <li>Role-based question banks</li>
                <li>Timer-driven practice sessions</li>
                <li>Auto-scoring & evaluation</li>
                <li>Session replay & transcripts</li>
              </ul>
            </div>

            {/* Feature 3: Resume Builder */}
            <div
              className="card"
              style={{
                padding: 32,
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, #ff5c8a 0%, #7c5cff 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                  fontSize: '1.5rem',
                }}
              >
                📄
              </div>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 650, margin: '0 0 12px' }}>Resume Builder & Optimizer</h3>
              <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                Upload your resume and get AI-powered optimization. Match against job descriptions, 
                rewrite bullets for impact, and pass ATS scanners with confidence.
              </p>
              <ul style={{ marginTop: 16, paddingLeft: 20, color: 'var(--muted)', lineHeight: 1.8 }}>
                <li>ATS compatibility scoring</li>
                <li>JD-to-resume gap analysis</li>
                <li>Bullet rewrite suggestions</li>
                <li>Multi-variant generation</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" style={{ padding: '80px 0' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 16px' }}>Simple, Transparent Pricing</h2>
            <p style={{ color: 'var(--muted)', fontSize: '1.1rem', maxWidth: 500, marginInline: 'auto' }}>
              Choose the plan that fits your career goals. Upgrade or downgrade anytime.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 24,
              maxWidth: 1000,
              marginInline: 'auto',
            }}
          >
            {/* Free Tier */}
            <div className="card" style={{ padding: 32, border: '1px solid var(--border)' }}>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 8px' }}>Starter</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: '2.5rem', fontWeight: 750 }}>$0</span>
                  <span style={{ color: 'var(--muted)' }}>/month</span>
                </div>
                <p style={{ color: 'var(--muted)', marginTop: 8 }}>Perfect for getting started</p>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', lineHeight: 2 }}>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> 3 Mock Interviews</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Basic Resume Analysis</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> 5 Resume Optimizations</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Job Tracking (up to 10)</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Community Support</li>
              </ul>
              <Link
                href="/auth"
                className="button"
                style={{ width: '100%', justifyContent: 'center', display: 'flex' }}
              >
                Get Started Free
              </Link>
            </div>

            {/* Pro Tier */}
            <div
              className="card"
              style={{
                padding: 32,
                border: '2px solid var(--brand)',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--brand)',
                  color: 'white',
                  padding: '4px 16px',
                  borderRadius: 20,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                MOST POPULAR
              </div>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 8px' }}>Pro</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: '2.5rem', fontWeight: 750 }}>$19</span>
                  <span style={{ color: 'var(--muted)' }}>/month</span>
                </div>
                <p style={{ color: 'var(--muted)', marginTop: 8 }}>For serious job seekers</p>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', lineHeight: 2 }}>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Unlimited Mock Interviews</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Advanced Resume Analysis</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Unlimited Resume Optimizations</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Live Copilot Access</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Unlimited Job Tracking</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Priority Support</li>
              </ul>
              <Link
                href="/auth"
                className="button buttonPrimary"
                style={{ width: '100%', justifyContent: 'center', display: 'flex' }}
              >
                Start Pro Trial
              </Link>
            </div>

            {/* Enterprise Tier */}
            <div className="card" style={{ padding: 32, border: '1px solid var(--border)' }}>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 8px' }}>Team</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: '2.5rem', fontWeight: 750 }}>$49</span>
                  <span style={{ color: 'var(--muted)' }}>/month</span>
                </div>
                <p style={{ color: 'var(--muted)', marginTop: 8 }}>For career coaches & teams</p>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', lineHeight: 2 }}>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Everything in Pro</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Team Management</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Custom Interview Questions</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Analytics Dashboard</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> API Access</li>
                <li className="row" style={{ gap: 10 }}><span style={{ color: 'var(--brand2)' }}>✓</span> Dedicated Support</li>
              </ul>
              <Link
                href="/auth"
                className="button"
                style={{ width: '100%', justifyContent: 'center', display: 'flex' }}
              >
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section
        style={{
          padding: '80px 0',
          background: 'linear-gradient(135deg, rgba(124, 92, 255, 0.15) 0%, rgba(77, 214, 255, 0.1) 100%)',
          textAlign: 'center',
        }}
      >
        <div className="container" style={{ maxWidth: 600 }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 16px' }}>
            Ready to Land Your Dream Job?
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '1.1rem', marginBottom: 32 }}>
            Join thousands of candidates who&apos;ve improved their interview performance with FinalRound.
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
            {data.user ? (
              <Link className="button buttonPrimary" href="/dashboard" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link className="button buttonPrimary" href="/auth" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                  Start Free Trial
                </Link>
                <Link href="/dashboard" className="button" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                  View Demo
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '40px 0', borderTop: '1px solid var(--border)' }}>
        <div className="container">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 20,
            }}
          >
            <div className="row" style={{ gap: 12 }}>
              <span style={{ fontWeight: 700 }}>FinalRound</span>
              <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>© 2026 All rights reserved</span>
            </div>
            <div className="row" style={{ gap: 24, fontSize: '0.9rem', color: 'var(--muted)' }}>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/resume">Resume</Link>
              <Link href="/settings">Settings</Link>
            </div>
          </div>
          <p className="small" style={{ marginTop: 24, textAlign: 'center', color: 'var(--muted)' }}>
            Built with Next.js + Supabase. Secure & compliant (SOC2 ready).
          </p>
        </div>
      </footer>
    </div>
  );
}
