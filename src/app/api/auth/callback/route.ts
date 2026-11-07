import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safeRedirect';
import { joinSsoOrganization } from '@/lib/sso';
import { LOCALES } from '@/i18n/locales';

/**
 * Where Supabase Auth sends the browser back after single sign-on (and other
 * code-based sign-ins): swaps the code for a session cookie, adds SSO users to
 * their team, then continues to `next`. Add this URL to the project's allowed
 * redirect URLs (Supabase → Authentication → URL configuration).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));
  // The sign-in page sends `next` with its language prefix ("/es/onboarding"); errors go back in that language too.
  const locale = LOCALES.find((code) => next === `/${code}` || next.startsWith(`/${code}/`) || next.startsWith(`/${code}?`));
  const prefix = locale ? `/${locale}` : '';
  const fail = (reason: string) => NextResponse.redirect(new URL(`${prefix}/auth?error=${reason}`, url.origin));
  const failure = next.slice(prefix.length).startsWith('/auth/reset') ? 'link_failed' : 'signin_failed';

  if (!code) return fail(url.searchParams.get('error') ? failure : 'missing_code');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail(failure);

  try {
    await joinSsoOrganization(data.user);
  } catch (e) {
    // Signed in either way; the team owner can still invite them.
    console.error('[auth] could not add the SSO user to their team', e instanceof Error ? e.message : e);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
