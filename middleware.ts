import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { requireEnv } from '@/lib/env';

// Handle internationalization
const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  // Run intl middleware first for locale routing
  const intlResponse = intlMiddleware(request);
  
  if (intlResponse) {
    // Initialize Supabase client
    const supabase = createServerClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              intlResponse.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    // Refresh session if needed
    await supabase.auth.getUser();

    // Add cache control headers for API routes
    if (request.nextUrl.pathname.startsWith('/api/')) {
      if (request.method === 'GET') {
        intlResponse.headers.set(
          'Cache-Control',
          'public, s-maxage=60, stale-while-revalidate=300'
        );
      } else {
        intlResponse.headers.set(
          'Cache-Control',
          'no-cache, no-store, must-revalidate'
        );
      }
    }

    return intlResponse;
  }

  return NextResponse.next({ request: { headers: request.headers } });
}

export const config = {
  // Match all pathnames except for
  // - api routes
  // - _next/static (static files)
  // - _next/image (image optimization files)
  // - favicon.ico
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)']
};
