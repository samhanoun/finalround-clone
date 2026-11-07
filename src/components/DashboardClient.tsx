'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { HomeSetup, NextUp } from '@/app/[locale]/dashboard/homeData';
import { LocalDateTime } from '@/app/[locale]/dashboard/LocalDateTime';
import { NewPracticeButton } from './NewPracticeButton';
import { CheckIcon } from './icons';
import styles from './DashboardClient.module.css';

/**
 * The top of Home: the next interview is what the app is for. With one to go
 * on (a dated interview, a job in the Interview stage, or the latest goal) it
 * leads with that and two actions; before there is one, it lists the three
 * steps that get you there.
 */
export function DashboardClient({ next, setup, now }: { next: NextUp | null; setup: HomeSetup; now: string }) {
  return next ? <Upcoming next={next} now={now} /> : <FirstRun setup={setup} />;
}

function Upcoming({ next, now }: { next: NextUp; now: string }) {
  const t = useTranslations('Home.nextUp');
  const tGoals = useTranslations('Goals');
  const format = useFormatter();

  const title =
    next.role && next.company ? t('roleAt', { role: next.role, company: next.company }) : next.name || next.role || next.company || t('label');
  const liveHref = next.goal ? `/copilot/live?goal=${next.goal.id}` : '/copilot/live';
  // Practice fills its setup from the goal, or at least the company.
  const practiceQuery = next.goal ? `goal=${next.goal.id}` : next.company ? `company=${encodeURIComponent(next.company)}` : undefined;

  // When: the date in the viewer's own time zone (filled in by the browser), then how far off it is.
  const meta: React.ReactNode[] = next.at
    ? [<LocalDateTime key="at" iso={next.at} />, format.relativeTime(new Date(next.at), new Date(now))]
    : [next.source === 'stage' ? t('inStage') : t('noDate')];

  return (
    <section className={styles.panel} aria-labelledby="next-up-title">
      <div className={styles.main}>
        <p className={styles.eyebrow}>
          <span>{t('label')}</span>
          {next.round ? <span className={styles.round}>{tGoals(`rounds.${next.round}`)}</span> : null}
        </p>
        <h2 id="next-up-title" className={styles.title}>
          {title}
        </h2>
        <p className={styles.meta}>
          {meta.map((part, index) => (
            <span key={index} className={styles.metaPart}>
              {part}
            </span>
          ))}
        </p>
        <div className={styles.actions}>
          <Link className="button buttonPrimary" href={liveHref}>
            {t('startLive')}
          </Link>
          <NewPracticeButton label={t('practice')} query={practiceQuery} />
        </div>
      </div>

      <div className={styles.side}>
        {next.goal ? (
          <>
            <h3 className={styles.sideTitle}>{t('readyTitle')}</h3>
            <ul className={styles.facts}>
              <Fact done={next.goal.hasResume}>
                {next.goal.hasResume ? t('resumeOn', { name: next.goal.resumeName || t('resume') }) : t('resumeOff')}
              </Fact>
              <Fact done={next.goal.hasJobDescription}>{next.goal.hasJobDescription ? t('jobOn') : t('jobOff')}</Fact>
            </ul>
            <Link className={styles.sideLink} href="/goals">
              {t('editGoal')}
            </Link>
          </>
        ) : (
          <>
            <h3 className={styles.sideTitle}>{t('noGoal')}</h3>
            <p className={styles.sideText}>{t('noGoalHelp')}</p>
            <Link className={styles.sideLink} href={next.jobId ? `/goals?fromJob=${next.jobId}` : '/goals'}>
              {t('makeGoal')}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

function Fact({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className={styles.fact} data-done={done}>
      <span className={styles.factMark} aria-hidden="true">
        {done ? <CheckIcon size={16} /> : <span className={styles.ring} />}
      </span>
      <span>{children}</span>
    </li>
  );
}

function FirstRun({ setup }: { setup: HomeSetup }) {
  const t = useTranslations('Home.nextUp');
  const steps = [
    {
      key: 'resume',
      done: setup.resumeName !== null,
      note: setup.resumeName !== null ? setup.resumeName || t('resume') : t('steps.resume.desc'),
      href: '/resume',
    },
    // A goal always starts this list unsaved: with one, Home shows it instead.
    { key: 'goal', done: false, note: t('steps.goal.desc'), href: '/goals' },
    {
      key: 'live',
      done: setup.liveSessions > 0,
      note: setup.liveSessions > 0 ? t('steps.live.done', { count: setup.liveSessions }) : t('steps.live.desc'),
      href: '/copilot/live',
      // Live sessions are worth repeating, so this one keeps its button.
      always: true,
    },
  ] as const;
  const firstTodo = steps.findIndex((step) => !step.done);

  return (
    <section className={`${styles.panel} ${styles.setup}`} aria-labelledby="next-up-title">
      <div className={styles.main}>
        <p className={styles.eyebrow}>{t('label')}</p>
        <h2 id="next-up-title" className={styles.title}>
          {t('setupTitle')}
        </h2>
        <p className={styles.lead}>{t('setupLead')}</p>
      </div>

      <ol className={styles.steps} aria-label={t('stepsLabel')}>
        {steps.map((step, index) => (
          <li key={step.key} className={styles.step} data-done={step.done}>
            <span className={styles.marker} aria-hidden="true">
              {step.done ? <CheckIcon size={14} /> : index + 1}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>
                {t(`steps.${step.key}.title`)}
                {step.done ? <span className="srOnly">{` (${t('stepDone')})`}</span> : null}
              </span>
              <span className={styles.stepNote}>{step.note}</span>
            </span>
            {!step.done || ('always' in step && step.always) ? (
              <Link className={`button ${styles.stepAction} ${index === firstTodo ? 'buttonPrimary' : ''}`} href={step.href}>
                {t(`steps.${step.key}.action`)}
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
