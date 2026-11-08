import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeNextPath } from '@/lib/safeRedirect';
import { joinSsoOrganization } from '@/lib/sso';
import { LOCALES } from '@/i18n/locales';
import { savedLocaleToRestore, withLocale } from '@/app/[locale]/auth/savedLocale';

/**
 * Where Supabase Auth sends the browser back after single sign-on (and other
 * code-based sign-ins): swaps the code for a session cookie, adds SSO users to
 * their team, then continues to `next`. Add this URL to the project's allowed
 * redirect URLs (Supabase → Authentication → URL configuration).
 *
 * `restoreLocale=1` (sent by the sign-in page when its link named no
 * language) opens `next` in the account's saved app language instead.
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

  const saved = url.searchParams.get('restoreLocale') === '1' ? await savedLanguage(data.user.id) : null;
  const switchTo = savedLocaleToRestore(saved, locale ?? '');
  return NextResponse.redirect(new URL(switchTo ? withLocale(next, switchTo) : next, url.origin));
}

/** The user's saved app language; null when there is none or it can't be read (the sign-in still goes on). */
async function savedLanguage(userId: string): Promise<unknown> {
  try {
    const { data } = await createAdminClient().from('user_settings').select('language').eq('user_id', userId).maybeSingle();
    return (data as { language?: unknown } | null)?.language ?? null;
  } catch (e) {
    console.error('[auth] could not read the saved language', e instanceof Error ? e.message : e);
    return null;
  }
}
