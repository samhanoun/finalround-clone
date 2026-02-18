import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: 'FinalRound (MVP)',
  description: 'Interview Copilot + Resume Builder (Next.js + Supabase)',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0b0f19" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {/* Skip to main content link for keyboard users */}
        <a href="#main-content" className="skipLink">
          Skip to main content
        </a>
        
        {/* Live region for announcements - screen reader only */}
        <div 
          id="live-announcer" 
          className="liveRegion" 
          aria-live="polite" 
          aria-atomic="true"
        />
        
        {children}
      </body>
    </html>
  );
}
