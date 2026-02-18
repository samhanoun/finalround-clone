import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ],
  },
  
  // Headers for performance
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
            key: 'Cache-Control',
            // Default caching: public, max-age, must-revalidate for dynamic content
            // API routes should set their own caching headers
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        // Static assets can be cached aggressively
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
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
    ];
  },
};

export default nextConfig;
