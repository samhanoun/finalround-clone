import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ApexMark } from '@/components/ApexMark';
import { AnswerMoment } from '../_landing/AnswerMoment';
import { AuthLanguage } from './AuthLanguage';
import styles from './auth.module.css';

/**
 * Sign-in, sign-up, password reset: the form on calm space, and beside it on
 * wide screens a quiet look at the product (the answer card, still). The foot
 * line holds the way home and the page's language.
 */
export function AuthShell({ children }: { children?: React.ReactNode }) {
  const t = useTranslations('Auth');
  const tBrand = useTranslations('Brand');
  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.formSide} tabIndex={-1}>
        <Link href="/" className={styles.brandLink} aria-label={t('home')}>
          <ApexMark size={28} />
          <span className={styles.brandName}>{tBrand('name')}</span>
        </Link>
        <div className={styles.formBox}>{children}</div>
        <div className={styles.footLine}>
          <Link className={styles.homeLink} href="/">
            {t('home')}
          </Link>
          <AuthLanguage />
        </div>
      </main>
      <aside className={styles.aside}>
        <div className={styles.asideInner}>
          <AnswerMoment variant="compact" />
          <p className={styles.tagline}>{t('tagline')}</p>
        </div>
      </aside>
    </div>
  );
}
