import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ApexMark } from '@/components/ApexMark';
import styles from './landing.module.css';

const STEPS = [
  { title: 'Add your résumé and the job', body: 'Answers only use facts from what you give it.' },
  { title: 'Share your meeting', body: 'A Meet, Zoom or Teams tab in Chrome, or any meeting app with the Windows app.' },
  { title: 'Questions are picked up', body: 'Small talk is ignored. If one is missed, press A.' },
  { title: 'Read, then say it your way', body: 'An opening line and a few points to cover, in a window that stays on top.' },
];

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const signedIn = Boolean(data.user);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brandLink} aria-label="Apex Round home">
            <ApexMark size={34} />
            <span className={styles.brandName}>Apex Round</span>
          </Link>
          <nav aria-label="Primary" className={styles.headerNav}>
            <a className={styles.navLink} href="#how">How it works</a>
            <a className={styles.navLink} href="#pricing">Pricing</a>
            <a className={styles.navLink} href="#desktop">Windows app</a>
          </nav>
          <div className={styles.headerActions}>
            {signedIn ? (
              <Link className="button buttonPrimary" href="/dashboard">
                Open Apex Round
              </Link>
            ) : (
              <>
                <Link className="button buttonGhost" href="/auth">
                  Sign in
                </Link>
                <Link className="button buttonPrimary" href="/auth?mode=signup">
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <h1 id="hero-title" className={styles.heroTitle}>
              The answer, while the question is still in the air.
            </h1>
            <p className={styles.heroLead}>
              Apex Round listens to your interview, spots each question as it is asked, and puts a suggested answer on
              screen, written from your own résumé.
            </p>
            <div className={styles.heroActions}>
              <Link className={`button buttonPrimary ${styles.bigButton}`} href={signedIn ? '/copilot/live' : '/auth?mode=signup'}>
                {signedIn ? 'Start a live session' : 'Start free'}
              </Link>
              <a className={`button ${styles.bigButton}`} href="#desktop">
                Get the Windows app
              </a>
            </div>
            <p className={styles.heroNote}>Free includes 10 minutes of live help a month. No card needed.</p>
          </div>

          <div className={styles.demo} aria-label="Example: a question and its suggested answer">
            <div className={styles.caption}>
              <span className={styles.captionWho}>Interviewer</span>
              <span>How would you design rate limiting for a public API?</span>
            </div>
            <div className={styles.answerCard}>
              <div className={styles.answerMeta}>
                <span className="badge badgeIce">System design</span>
                <span className={styles.answerTiming}>First words in 0.6 s</span>
              </div>
              <p className={styles.answerLead}>
                I would put a token bucket per API key in front of the service, backed by Redis so every node sees the same
                counts.
              </p>
              <ul className={styles.answerPoints}>
                <li>Limits by key and by route, with burst headroom.</li>
                <li>429 with Retry-After, so clients back off cleanly.</li>
                <li>
                  Trade-off: one Redis round trip per request, so batch or cache locally at high volume.
                  <span className={styles.caret} aria-hidden="true" />
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section id="how" className={styles.band} aria-labelledby="how-title">
          <div className={styles.bandInner}>
            <h2 id="how-title" className={styles.sectionTitle}>
              From joining the call to the first answer in four steps
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li key={step.title} className={styles.step}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <strong className={styles.stepTitle}>{step.title}</strong>
                  <span className={styles.stepBody}>{step.body}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.split} aria-labelledby="screen-title">
          <div className={styles.splitCopy}>
            <h2 id="screen-title" className={styles.sectionTitle}>
              Coding round? Solve the screen.
            </h2>
            <p className={styles.sectionLead}>
              Press S and Apex Round reads the problem in the tab you share, explains an approach, writes the code in the
              language on screen and gives the complexity. Screenshots are never stored.
            </p>
          </div>
          <pre className={styles.code}>
            <code>{`def top_k_frequent(nums, k):
    counts = Counter(nums)
    return [n for n, _ in counts.most_common(k)]

# O(n log k) time, O(n) space`}</code>
          </pre>
        </section>

        <section id="desktop" className={styles.band} aria-labelledby="desktop-title">
          <div className={`${styles.bandInner} ${styles.desktopRow}`}>
            <div className={styles.splitCopy}>
              <h2 id="desktop-title" className={styles.sectionTitle}>
                For desktop meeting apps, use the Windows app.
              </h2>
              <p className={styles.sectionLead}>
                It hears whatever your PC plays, so the Zoom and Teams apps work too, with shortcuts that work while the
                meeting has focus: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to answer and <kbd>Ctrl</kbd>+
                <kbd>Shift</kbd>+<kbd>S</kbd> to solve the screen.
              </p>
            </div>
            <span className={styles.comingSoon}>The installer comes with the first public release.</span>
          </div>
        </section>

        <section id="pricing" className={styles.pricing} aria-labelledby="pricing-title">
          <h2 id="pricing-title" className={styles.sectionTitle}>
            Pricing
          </h2>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <h3 className={styles.planName}>Free</h3>
              <p className={styles.planPrice}>$0</p>
              <ul className={styles.planList}>
                <li>10 minutes of live help a month</li>
                <li>Sessions up to 10 minutes</li>
                <li>Résumé builder and job tracker</li>
              </ul>
              <Link className="button" href="/auth?mode=signup">
                Start free
              </Link>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <h3 className={styles.planName}>Pro</h3>
              <p className={styles.planPrice}>
                $29 <span className={styles.planPer}>a month, or €29</span>
              </p>
              <ul className={styles.planList}>
                <li>400 minutes of live help a month</li>
                <li>Sessions up to 30 minutes, 45 minutes a day</li>
                <li>Cancel anytime from Settings</li>
              </ul>
              <Link className="button buttonPrimary" href={signedIn ? '/settings' : '/auth?mode=signup'}>
                Go Pro
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>Apex Round</span>
        <span>Check your interview&apos;s rules on outside help before you use it.</span>
      </footer>
    </div>
  );
}
