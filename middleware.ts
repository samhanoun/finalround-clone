import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { requireEnv } from '@/lib/env';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });

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
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Refresh session if needed
  await supabase.auth.getUser();

  return response;
}

export function middlewareWithCache(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });
  
  // Add cache control headers for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // GET requests can be cached, others cannot
    if (request.method === 'GET') {
      response.headers.set(
        'Cache-Control',
        'public, s-maxage=60, stale-while-revalidate=300'
      );
    } else {
      response.headers.set(
        'Cache-Control',
        'no-cache, no-store, must-revalidate'
      );
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
