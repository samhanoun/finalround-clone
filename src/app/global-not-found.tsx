import type { Metadata } from 'next';
import { Geist, Unbounded } from 'next/font/google';
import { getLocale, getTranslations } from 'next-intl/server';
import '@/app/globals.css';

/**
 * 404 for addresses that match no page (/es/no-such-page), in the address's
 * language: the next-intl middleware has already picked it. Pages that call
 * notFound() use [locale]/not-found.tsx instead.
 *
 * Deliberately not a [locale]/[...rest] catch-all: [locale] matches any first
 * segment, so a catch-all would also claim /api/stt/stream and, in
 * development, Next would answer the live-transcription WebSocket with a page.
 */

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const unbounded = Unbounded({ variable: '--font-display', subsets: ['latin'] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('NotFound');
  return { title: `${t('title')} · Apex Round` };
}

export default async function GlobalNotFound() {
  const locale = await getLocale();
  const t = await getTranslations('NotFound');
  return (
    <html lang={locale}>
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0b1324" />
      </head>
      <body className={`${geistSans.variable} ${unbounded.variable}`}>
        <main id="main-content" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 16px' }}>
          <div className="stack" style={{ maxWidth: 440, textAlign: 'center', gap: 12 }}>
            <p className="help" style={{ margin: 0 }}>404</p>
            <h1 className="pageTitle" style={{ margin: 0 }}>
              {t('title')}
            </h1>
            <p style={{ margin: 0 }}>{t('body')}</p>
            <div>
              <a className="button buttonPrimary" href={`/${locale}/dashboard`}>
                {t('home')}
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
