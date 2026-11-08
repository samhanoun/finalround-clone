import { Link } from '@/i18n/routing';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { ApexMark } from '@/components/ApexMark';
import { AnswerMoment } from './_landing/AnswerMoment';
import { DesktopScene } from './_landing/DesktopScene';
import { LandingMenu } from './_landing/LandingMenu';
import styles from './landing.module.css';

const STEPS = ['context', 'share', 'pickUp', 'say'] as const;
const SECTIONS = [
  ['how', 'nav.how'],
  ['pricing', 'nav.pricing'],
  ['desktop', 'nav.desktop'],
] as const;
/** The Windows app's global shortcuts (desktop/src/policy.ts): Ctrl+Shift and a letter. */
const SHORTCUTS = [
  ['answer', 'A'],
  ['solve', 'S'],
  ['toggle', 'H'],
] as const;

export default async function Home() {
  const t = await getTranslations('Landing');
  const tBrand = await getTranslations('Brand');
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const signedIn = Boolean(data.user);
  const kbd = (chunks: React.ReactNode) => <kbd>{chunks}</kbd>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={`${styles.inner} ${styles.headerInner}`}>
          <Link href="/" className={styles.brandLink} aria-label={t('homeLabel')}>
            <ApexMark size={28} />
            <span className={styles.brandName}>{tBrand('name')}</span>
          </Link>
          <nav aria-label={t('primaryNav')} className={styles.nav}>
            {SECTIONS.map(([id, label]) => (
              <a key={id} className={styles.navLink} href={`#${id}`}>
                {t(label)}
              </a>
            ))}
          </nav>
          <div className={styles.headerActions}>
            {signedIn ? (
              <Link className={`button ${styles.navButton}`} href="/dashboard">
                {t('open')}
              </Link>
            ) : (
              <>
                <Link className={styles.signInLink} href="/auth">
                  {t('signIn')}
                </Link>
                <Link className={`button ${styles.navButton}`} href="/auth?mode=signup">
                  {t('startFree')}
                </Link>
              </>
            )}
            <LandingMenu
              label={t('menu')}
              closeLabel={t('closeMenu')}
              sections={SECTIONS.map(([id, label]) => ({ href: `#${id}`, label: t(label) }))}
              account={
                signedIn
                  ? [{ href: '/dashboard', label: t('open') }]
                  : [
                      { href: '/auth', label: t('signIn') },
                      { href: '/auth?mode=signup', label: t('startFree') },
                    ]
              }
            />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.inner} ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <h1 id="hero-title" className={styles.heroTitle}>
                {t('heroTitle')}
              </h1>
              <p className={styles.heroLead}>{t('heroLead')}</p>
              <div className={styles.heroActions}>
                <Link className="button buttonPrimary buttonLarge" href={signedIn ? '/copilot/live' : '/auth?mode=signup'}>
                  {signedIn ? t('startLive') : t('startFree')}
                </Link>
                <a className="button buttonLarge" href="#desktop">
                  {t('getApp')}
                </a>
              </div>
              <p className={styles.heroNote}>{t('heroNote')}</p>
            </div>
            <AnswerMoment variant="hero" />
          </div>
        </section>

        <section id="how" className={`${styles.section} ${styles.band}`} aria-labelledby="how-title">
          <div className={styles.inner}>
            <h2 id="how-title" className={styles.sectionTitle}>
              {t('howTitle')}
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li key={step} className={styles.step}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <h3 className={styles.stepTitle}>{t(`steps.${step}.title`)}</h3>
                  <p className={styles.stepBody}>{t.rich(`steps.${step}.body`, { kbd })}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="screen-title">
          <div className={`${styles.inner} ${styles.split} ${styles.splitFlip}`}>
            <div className={styles.splitCopy}>
              <h2 id="screen-title" className={styles.sectionTitle}>
                {t('screenTitle')}
              </h2>
              <p className={styles.sectionLead}>{t.rich('screenLead', { kbd })}</p>
            </div>
            <figure className={styles.codeCard} aria-label={t('screenDemo.label')}>
              <div className={styles.codeHead}>
                <span className={styles.codeProblem}>{t('screenDemo.problem')}</span>
                <span className={styles.codeLanguage}>{t('screenDemo.language')}</span>
              </div>
              <p className={styles.codeApproach}>{t('screenDemo.approach')}</p>
              <pre className={styles.code}>
                <code>{t('demoCode')}</code>
              </pre>
              <p className={styles.codeComplexity}>{t('screenDemo.complexity')}</p>
            </figure>
          </div>
        </section>

        <section id="desktop" className={`${styles.section} ${styles.band}`} aria-labelledby="desktop-title">
          <div className={`${styles.inner} ${styles.split}`}>
            <div className={styles.splitCopy}>
              <h2 id="desktop-title" className={styles.sectionTitle}>
                {t('desktopTitle')}
              </h2>
              <p className={styles.sectionLead}>{t('desktopLead')}</p>
              <dl className={styles.shortcuts}>
                {SHORTCUTS.map(([action, letter]) => (
                  <div key={action} className={styles.shortcut}>
                    <dt className={styles.keys}>
                      <kbd>{t('keys.ctrl')}</kbd>
                      <kbd>{t('keys.shift')}</kbd>
                      <kbd>{letter}</kbd>
                    </dt>
                    <dd className={styles.shortcutAction}>{t(`shortcuts.${action}`)}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.note}>{t('desktopSoon')}</p>
            </div>
            <DesktopScene />
          </div>
        </section>

        <section id="pricing" className={styles.section} aria-labelledby="pricing-title">
          <div className={`${styles.inner} ${styles.pricing}`}>
            <div className={styles.pricingCopy}>
              <h2 id="pricing-title" className={styles.sectionTitle}>
                {t('pricing')}
              </h2>
              <p className={styles.sectionLead}>{t('pricingLead')}</p>
            </div>
            <div className={styles.plans}>
              <div className={styles.plan}>
                <h3 className={styles.planName}>{t('free.name')}</h3>
                <p className={styles.planPrice}>
                  <span className={styles.planAmount}>{t('free.price')}</span>
                </p>
                <ul className={styles.planList}>
                  <li>{t('free.minutes')}</li>
                  <li>{t('free.sessions')}</li>
                  <li>{t('free.tools')}</li>
                </ul>
                <Link className="button buttonLarge" href={signedIn ? '/dashboard' : '/auth?mode=signup'}>
                  {signedIn ? t('open') : t('startFree')}
                </Link>
              </div>
              <div className={`${styles.plan} ${styles.planPro}`}>
                <h3 className={styles.planName}>{t('pro.name')}</h3>
                <p className={styles.planPrice}>
                  <span className={styles.planAmount}>{t('pro.price')}</span>
                  <span className={styles.planPer}>{t('pro.per')}</span>
                </p>
                <ul className={styles.planList}>
                  <li>{t('pro.minutes')}</li>
                  <li>{t('pro.sessions')}</li>
                  <li>{t('pro.cancel')}</li>
                </ul>
                <Link className="button buttonPrimary buttonLarge" href={signedIn ? '/settings' : '/auth?mode=signup'}>
                  {t('pro.cta')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.inner} ${styles.footerInner}`}>
          <span className={styles.footerBrand}>
            <ApexMark size={20} />
            {tBrand('name')}
          </span>
          <span>{t('footer')}</span>
        </div>
      </footer>
    </div>
  );
}
