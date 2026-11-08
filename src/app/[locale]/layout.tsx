import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Unbounded } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { ClientProviders } from '@/components/ClientProviders';
import { DesktopFrame } from '@/components/DesktopFrame';
import '@/app/globals.css';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face: page titles, headlines and the brand only.
const unbounded = Unbounded({
  variable: "--font-display",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the tab bar sit above the home indicator on phones (env(safe-area-inset-*)).
  viewportFit: 'cover',
  themeColor: '#141415',
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Meta' });
  return { ...METADATA, description: t('description') };
}

const METADATA: Metadata = {
  title: 'Apex Round',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Apex Round',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

// Generate static params for all supported locales
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  
  // Validate that the incoming `locale` parameter is valid
  if (!routing.locales.includes(locale as typeof routing.locales[number])) {
    notFound();
  }

  const messages = await getMessages();
  const t = await getTranslations('Meta');
  const tBrand = await getTranslations('Brand');

  // Determine if we should apply RTL layout (for future Arabic/Hebrew support)
  const isRTL = ['ar', 'he', 'fa'].includes(locale);

  return (
    <html lang={locale} dir={isRTL ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#141415" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${unbounded.variable}`}>
        {/* Skip to main content link for keyboard users */}
        <a href="#main-content" className="skipLink">
          {t('skip')}
        </a>
        
        {/* Live region for announcements - screen reader only */}
        <div 
          id="live-announcer" 
          className="liveRegion" 
          aria-live="polite" 
          aria-atomic="true"
        />
        
        <DesktopFrame title={tBrand('name')} />

        <NextIntlClientProvider messages={messages}>
          {/* Toasts: components across the app call useToast. */}
          <ClientProviders>{children}</ClientProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
