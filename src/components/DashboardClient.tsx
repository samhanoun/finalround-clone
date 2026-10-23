'use client';

import { Link } from '@/i18n/routing';
import { NewPracticeButton } from './NewPracticeButton';
import styles from './DashboardClient.module.css';

/** The top of Home: the next interview is what the app is for. */
export function DashboardClient() {
  return (
    <section className={styles.panel} aria-labelledby="next-interview-heading">
      <div className={styles.copy}>
        <h2 id="next-interview-heading" className={styles.title}>
          Interview coming up?
        </h2>
        <p className={styles.lead}>
          Add your résumé and the job, share your meeting, and answers appear as the questions are asked. Setup takes about two
          minutes.
        </p>
        <div className={styles.actions}>
          <Link className="button buttonPrimary" href="/copilot/live">
            Set up the live copilot
          </Link>
          <NewPracticeButton />
        </div>
      </div>
      <svg className={styles.signal} viewBox="0 0 360 120" aria-hidden="true">
        <path
          d="M0 44 h40 l4 -14 l5 28 l5 -36 l5 40 l5 -24 l5 14 l5 -8 h18 l4 -16 l5 30 l5 -18 l5 10 h30 l4 -8 l5 16 l5 -22 l5 26 l5 -12 h170"
          stroke="var(--ice)"
        />
        <path d="M0 88 h190 l4 -8 l5 16 l5 -12 l5 8 l5 -4 h146" stroke="var(--ember)" />
      </svg>
    </section>
  );
}
