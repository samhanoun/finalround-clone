import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { ApexMark } from '@/components/ApexMark';
import styles from '../notFound.module.css';

/**
 * 404 in the page's language for pages that call notFound(), such as Admin for
 * anyone who isn't staff. Unknown addresses use app/global-not-found.tsx.
 */
export default async function NotFound() {
  const t = await getTranslations('NotFound');
  return (
    <main id="main-content" className={styles.page} tabIndex={-1}>
      <div className={styles.box}>
        <ApexMark size={32} />
        <p className={styles.code}>404</p>
        <h1 className="pageTitle">{t('title')}</h1>
        <p className={styles.body}>{t('body')}</p>
        <Link className={`button buttonPrimary ${styles.action}`} href="/dashboard">
          {t('home')}
        </Link>
      </div>
    </main>
  );
}
