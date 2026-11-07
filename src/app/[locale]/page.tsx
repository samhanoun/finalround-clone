import { Link } from '@/i18n/routing';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { ApexMark } from '@/components/ApexMark';
import styles from './landing.module.css';

const STEPS = ['context', 'share', 'pickUp', 'say'] as const;

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
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brandLink} aria-label={t('homeLabel')}>
            <ApexMark size={34} />
            <span className={styles.brandName}>{tBrand('name')}</span>
          </Link>
          <nav aria-label={t('primaryNav')} className={styles.headerNav}>
            <a className={styles.navLink} href="#how">
              {t('nav.how')}
            </a>
            <a className={styles.navLink} href="#pricing">
              {t('nav.pricing')}
            </a>
            <a className={styles.navLink} href="#desktop">
              {t('nav.desktop')}
            </a>
          </nav>
          <div className={styles.headerActions}>
            {signedIn ? (
              <Link className="button buttonPrimary" href="/dashboard">
                {t('open')}
              </Link>
            ) : (
              <>
                <Link className="button buttonGhost" href="/auth">
                  {t('signIn')}
                </Link>
                <Link className="button buttonPrimary" href="/auth?mode=signup">
                  {t('startFree')}
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
              {t('heroTitle')}
            </h1>
            <p className={styles.heroLead}>{t('heroLead')}</p>
            <div className={styles.heroActions}>
              <Link className={`button buttonPrimary ${styles.bigButton}`} href={signedIn ? '/copilot/live' : '/auth?mode=signup'}>
                {signedIn ? t('startLive') : t('startFree')}
              </Link>
              <a className={`button ${styles.bigButton}`} href="#desktop">
                {t('getApp')}
              </a>
            </div>
            <p className={styles.heroNote}>{t('heroNote')}</p>
          </div>

          <div className={styles.demo} aria-label={t('demo.label')}>
            <div className={styles.caption}>
              <span className={styles.captionWho}>{t('demo.interviewer')}</span>
              <span>{t('demo.question')}</span>
            </div>
            <div className={styles.answerCard}>
              <div className={styles.answerMeta}>
                <span className="badge badgeIce">{t('demo.category')}</span>
                <span className={styles.answerTiming}>{t('demo.timing')}</span>
              </div>
              <p className={styles.answerLead}>{t('demo.lead')}</p>
              <ul className={styles.answerPoints}>
                <li>{t('demo.point1')}</li>
                <li>{t('demo.point2')}</li>
                <li>
                  {t('demo.point3')}
                  <span className={styles.caret} aria-hidden="true" />
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section id="how" className={styles.band} aria-labelledby="how-title">
          <div className={styles.bandInner}>
            <h2 id="how-title" className={styles.sectionTitle}>
              {t('howTitle')}
            </h2>
            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li key={step} className={styles.step}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <strong className={styles.stepTitle}>{t(`steps.${step}.title`)}</strong>
                  <span className={styles.stepBody}>{t(`steps.${step}.body`)}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.split} aria-labelledby="screen-title">
          <div className={styles.splitCopy}>
            <h2 id="screen-title" className={styles.sectionTitle}>
              {t('screenTitle')}
            </h2>
            <p className={styles.sectionLead}>{t('screenLead')}</p>
          </div>
          <pre className={styles.code}>
            <code>{t('demoCode')}</code>
          </pre>
        </section>

        <section id="desktop" className={styles.band} aria-labelledby="desktop-title">
          <div className={`${styles.bandInner} ${styles.desktopRow}`}>
            <div className={styles.splitCopy}>
              <h2 id="desktop-title" className={styles.sectionTitle}>
                {t('desktopTitle')}
              </h2>
              <p className={styles.sectionLead}>{t.rich('desktopLead', { kbd })}</p>
            </div>
            <span className={styles.comingSoon}>{t('desktopSoon')}</span>
          </div>
        </section>

        <section id="pricing" className={styles.pricing} aria-labelledby="pricing-title">
          <h2 id="pricing-title" className={styles.sectionTitle}>
            {t('pricing')}
          </h2>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <h3 className={styles.planName}>{t('free.name')}</h3>
              <p className={styles.planPrice}>$0</p>
              <ul className={styles.planList}>
                <li>{t('free.minutes')}</li>
                <li>{t('free.sessions')}</li>
                <li>{t('free.tools')}</li>
              </ul>
              <Link className="button" href="/auth?mode=signup">
                {t('startFree')}
              </Link>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <h3 className={styles.planName}>{t('pro.name')}</h3>
              <p className={styles.planPrice}>
                $29 <span className={styles.planPer}>{t('pro.per')}</span>
              </p>
              <ul className={styles.planList}>
                <li>{t('pro.minutes')}</li>
                <li>{t('pro.sessions')}</li>
                <li>{t('pro.cancel')}</li>
              </ul>
              <Link className="button buttonPrimary" href={signedIn ? '/settings' : '/auth?mode=signup'}>
                {t('pro.cta')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>{tBrand('name')}</span>
        <span>{t('footer')}</span>
      </footer>
    </div>
  );
}
