import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The e2e test mode stands in for the shared screen with Chromium's fake
// camera (see DualAudioCapture). Never in a production build.
const e2eFakeCamera = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_E2E_FAKE_AUDIO === '1';
const isProd = process.env.NODE_ENV === 'production';
/**
 * Served over https (every real deployment). A production build tried on plain
 * http (the Docker image on localhost) mustn't tell browsers to switch its own
 * requests to https, or pin https for the host.
 */
const httpsOnly = isProd && (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://');

/** Supabase's origin (REST, auth, storage) and its realtime WebSocket origin. */
function supabaseOrigins(): string[] {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    const ws = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
    return [url.origin, ws];
  } catch {
    return [];
  }
}

/**
 * Content Security Policy. Scripts and connections are limited to this app and
 * Supabase, so injected markup can't load code from elsewhere or send data
 * away. Next.js hydration needs inline scripts ('unsafe-inline'); development
 * also needs eval and the HMR socket. Images allow any https source (profile
 * photos are links the user pastes).
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(isProd ? [] : ["'unsafe-eval'"])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...supabaseOrigins(), ...(isProd ? [] : ['ws:', 'wss:'])],
    'media-src': ["'self'", 'blob:', 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'self'", 'blob:'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (httpsOnly) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

const nextConfig: NextConfig = {
  // End-to-end runs build into their own folder so they can run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Enable compression (enabled by default in Next.js, but explicit is clearer)
  compress: true,

  // The dev-only Next.js badge sits over the phone tab bar.
  devIndicators: false,

  // Loaded from node_modules at run time, not bundled. pdf.js (under pdf-parse) runs its worker
  // in-process and imports pdf.worker.mjs from beside its own file; inside a bundled server chunk
  // that file isn't there, and every PDF upload came back unreadable.
  serverExternalPackages: ['pdf-parse'],

  // Performance optimizations
  poweredByHeader: false, // Remove X-Powered-By header for security
  
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  
  // Enable experimental features for better performance
  experimental: {
    // app/global-not-found.tsx: a translated 404 for unknown addresses, without a
    // [locale]/[...rest] catch-all (which would also match /api/stt/stream).
    globalNotFound: true,
    // Optimize package loading
    optimizePackageImports: [
      '@supabase/ssr', 
      '@supabase/supabase-js',
      'react',
      'react-dom',
      'next-intl',
    ],
  },
  
  // Headers for performance and PWA
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // The legacy XSS auditor is gone from browsers and could be abused; the CSP replaces it.
            key: 'X-XSS-Protection',
            value: '0',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(),
          },
          ...(httpsOnly
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
            : []),
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            // The live copilot captures the mic and the meeting tab's audio (getDisplayMedia).
            value: `camera=${e2eFakeCamera ? '(self)' : '()'}, microphone=(self), display-capture=(self), geolocation=()`,
          },
        ],
      },
      // Page caching is left to Next.js: it marks dynamic (signed-in) pages private and
      // no-store itself. A blanket "public" here would let shared caches keep them.
      // /_next/static is left to Next.js: it already serves hashed production
      // assets as immutable, and forcing that in dev pins stale chunks.
      {
        // Images can be cached for a long time
        source: '/:path*.(:glob).(:ext)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
      // PWA Manifest
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
          {
            key: 'Content-Type',
            value: 'application/manifest+json',
          },
        ],
      },
      // Service Worker
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Content-Type',
            value: 'application/javascript',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      // Offline page
      {
        source: '/offline.html',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
      // PWA Icons
      {
        source: '/icon-:size.png',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
