import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // End-to-end runs build into their own folder so they can run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Enable compression (enabled by default in Next.js, but explicit is clearer)
  compress: true,
  
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
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            // The live copilot captures the mic and the meeting tab's audio (getDisplayMedia).
            value: 'camera=(), microphone=(self), display-capture=(self), geolocation=()',
          },
          {
            key: 'Cache-Control',
            // Default caching: public, max-age, must-revalidate for dynamic content
            // API routes should set their own caching headers
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
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
