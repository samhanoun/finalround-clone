import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';

/**
 * 404 in the page's language for pages that call notFound(), such as Admin for
 * anyone who isn't staff. Unknown addresses use app/global-not-found.tsx.
 */
export default async function NotFound() {
  const t = await getTranslations('NotFound');
  return (
    <main id="main-content" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: '48px 16px' }}>
      <div className="stack" style={{ maxWidth: 440, textAlign: 'center', gap: 12 }}>
        <p className="help" style={{ margin: 0 }}>404</p>
        <h1 className="pageTitle" style={{ margin: 0 }}>
          {t('title')}
        </h1>
        <p style={{ margin: 0 }}>{t('body')}</p>
        <div>
          <Link className="button buttonPrimary" href="/dashboard">
            {t('home')}
          </Link>
        </div>
      </div>
    </main>
  );
}
