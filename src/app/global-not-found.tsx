import type { Metadata } from 'next';
import { Geist, Geist_Mono, Unbounded } from 'next/font/google';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApexMark } from '@/components/ApexMark';
import '@/app/globals.css';
import styles from './notFound.module.css';

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
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
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
        <meta name="theme-color" content="#141415" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${unbounded.variable}`}>
        <main id="main-content" className={styles.page}>
          <div className={styles.box}>
            <ApexMark size={32} />
            <p className={styles.code}>404</p>
            <h1 className="pageTitle">{t('title')}</h1>
            <p className={styles.body}>{t('body')}</p>
            <a className={`button buttonPrimary ${styles.action}`} href={`/${locale}/dashboard`}>
              {t('home')}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
