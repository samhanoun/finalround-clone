import { expect, test, type Page } from '@playwright/test';
import { FIRST_LOAD, escapeRegExp, fakeState, field, fill, hideNextDevBadge, marker, msg, signIn, watchPage, USER } from './helpers/flowsA';
import { THROWAWAY_PASSWORD, canSignIn, createThrowawayUser, deleteThrowawayUser, fakeAuthUser, signInAs } from './helpers/accounts';

/**
 * Sign-in and accounts, end to end against the fake Supabase: email and
 * password, sign out, the ?next= return to a protected page, forgot password
 * and the reset page, Google, single sign-on, onboarding and the language.
 *
 * Most tests sign in as the shared fake user (e2e/fakes/config.cjs). The ones
 * that change an account (sign-up and onboarding, a new password) use a
 * throwaway account of their own (helpers/accounts.ts) and delete it after.
 */

const loginForm = (page: Page, locale: 'en' | 'es' | 'fr' | 'de' | 'pt' = 'en') =>
  page.getByRole('form', { name: msg('Auth.title.login', locale) });

/** Picks a radio styled through its label (the input itself is visually hidden and takes no clicks). */
async function chooseRadio(page: Page, name: string) {
  const radio = page.getByRole('radio', { name });
  const id = await radio.getAttribute('id');
  expect(id, `the "${name}" radio has a label`).toBeTruthy();
  await page.locator(`label[for="${id}"]`).click();
  await expect(radio).toBeChecked();
}

test.describe('sign-in and accounts', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    // Compile the pages these tests visit once, up front.
    for (const path of ['/en/auth', '/en/auth/reset', '/en/dashboard', '/en/goals', '/en/onboarding', '/fr/auth', '/es/dashboard']) {
      await request.get(path, { timeout: 120_000, maxRedirects: 0 }).catch(() => undefined);
    }
  });

  test('a protected page asks you to sign in and comes back to it afterwards (?next=)', async ({ page }) => {
    const watch = watchPage(page);
    await page.goto('/en/goals', FIRST_LOAD);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: msg('RequireAuth.title') })).toBeVisible();
    await main.getByRole('link', { name: msg('RequireAuth.signIn') }).click();
    await expect(page).toHaveURL(/\/en\/auth\?next=%2Fgoals$/);

    const form = loginForm(page);
    await form.getByLabel(msg('Auth.email')).fill(USER.email);
    await form.getByLabel(msg('Auth.password'), { exact: true }).fill(USER.password);
    await form.getByRole('button', { name: msg('Auth.submit.login') }).click();

    await page.waitForURL(/\/en\/goals$/, FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Goals.title') })).toBeVisible();
    await expect(main.getByRole('heading', { name: msg('RequireAuth.title') })).toHaveCount(0);
    watch.expectClean();
  });

  test('a wrong password is refused with a plain message', async ({ page }) => {
    const watch = watchPage(page);
    await page.goto('/en/auth', FIRST_LOAD);
    const form = loginForm(page);
    await form.getByLabel(msg('Auth.email')).fill(USER.email);
    await form.getByLabel(msg('Auth.password'), { exact: true }).fill('not-the-password');
    await form.getByRole('button', { name: msg('Auth.submit.login') }).click();
    await expect(form.getByRole('alert')).toHaveText(msg('Auth.errors.invalidCredentials'));
    await expect(page).toHaveURL(/\/en\/auth$/);
    watch.expectClean();
  });

  test('signs in, then signs out from the sidebar', async ({ page }) => {
    const watch = watchPage(page);
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1, name: msg('Home.title') })).toBeVisible();
    await expect(page.getByText(fill(msg('AppShell.signedInAs'), { email: USER.email }))).toBeAttached();

    await page.getByRole('button', { name: msg('SignOutButton.label') }).click();
    await page.waitForURL(/\/en$/, FIRST_LOAD);

    // Signed out for real: Home now asks to sign in.
    await page.goto('/en/dashboard', FIRST_LOAD);
    await expect(page.getByRole('main').getByRole('heading', { name: msg('RequireAuth.title') })).toBeVisible();
    watch.expectClean();
  });

  test('forgot password: asks for the link, which leads back to the reset page', async ({ page, request }) => {
    const watch = watchPage(page);
    const email = `${marker('reset')}@example.test`;
    await page.goto('/en/auth', FIRST_LOAD);
    await page.getByRole('button', { name: msg('Auth.forgot') }).click();
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.forgot') })).toBeVisible();

    const form = page.getByRole('form', { name: msg('Auth.title.forgot') });
    await expect(form.getByLabel(msg('Auth.password'), { exact: true })).toHaveCount(0);
    await form.getByLabel(msg('Auth.email')).fill(email);
    await form.getByRole('button', { name: msg('Auth.submit.forgot') }).click();
    await expect(form.getByRole('status')).toHaveText(fill(msg('Auth.resetSent'), { email }));

    // Supabase was asked to email a link back through the callback to the reset page, in this language.
    const { recoverRequests } = await fakeState(request);
    const sent = recoverRequests.find((item) => item.email === email);
    expect(sent, 'recover request').toBeDefined();
    const back = new URL(sent!.redirectTo ?? '');
    expect(back.origin + back.pathname).toBe('http://localhost:3100/api/auth/callback');
    expect(back.searchParams.get('next')).toBe('/en/auth/reset');

    await page.getByRole('button', { name: msg('Auth.backToSignIn') }).click();
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.login') })).toBeVisible();
    watch.expectClean();
  });

  test('reset links that are broken or used up explain themselves', async ({ page }) => {
    const watch = watchPage(page);
    // No code at all.
    await page.goto('/api/auth/callback?next=%2Fen%2Fauth%2Freset', FIRST_LOAD);
    await expect(page).toHaveURL(/\/en\/auth\?error=missing_code$/);
    await expect(loginForm(page).getByRole('alert')).toHaveText(msg('Auth.errors.missing_code'));

    // Supabase sent the user back with an error (link expired or used).
    await page.goto('/api/auth/callback?error=access_denied&next=%2Fen%2Fauth%2Freset', FIRST_LOAD);
    await expect(page).toHaveURL(/\/en\/auth\?error=link_failed$/);
    await expect(loginForm(page).getByRole('alert')).toHaveText(msg('Auth.errors.link_failed'));

    // A code that can't be exchanged.
    await page.goto('/api/auth/callback?code=not-a-real-code&next=%2Fen%2Fauth%2Freset', FIRST_LOAD);
    await expect(page).toHaveURL(/\/en\/auth\?error=link_failed$/);

    // The reset page without a signed-in session: ask for a new link.
    await page.goto('/en/auth/reset', FIRST_LOAD);
    await expect(page.getByText(msg('ResetPassword.expired'))).toBeVisible();
    await page.getByRole('link', { name: msg('ResetPassword.requestNew') }).click();
    await expect(page).toHaveURL(/\/en\/auth\?mode=forgot$/);
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.forgot') })).toBeVisible();
    watch.expectClean();
  });

  test('the reset page, once signed in by the link, checks the two passwords match', async ({ page }) => {
    const watch = watchPage(page);
    // The emailed link signs the user in through the callback; signing in stands in for it here.
    await signIn(page);
    await page.goto('/en/auth/reset', FIRST_LOAD);
    const form = page.getByRole('form', { name: msg('ResetPassword.title') });
    await expect(page.getByText(msg('ResetPassword.subtitle'))).toBeVisible();

    await form.getByLabel(msg('ResetPassword.newPassword'), { exact: true }).fill('new-password-1');
    await form.getByLabel(msg('ResetPassword.confirm'), { exact: true }).fill('new-password-2');
    await form.getByRole('button', { name: msg('ResetPassword.save') }).click();
    await expect(form.getByRole('alert')).toHaveText(msg('ResetPassword.mismatch'));
    await expect(page).toHaveURL(/\/en\/auth\/reset$/);
    watch.expectClean();
  });

  test('the reset page saves the new password', async ({ page, request }) => {
    const watch = watchPage(page);
    // A throwaway account: the shared fake user's password has to stay as it is.
    const user = await createThrowawayUser(request, 'reset', { onboarded: true, fullName: 'Reset Candidate' });
    const newPassword = `${THROWAWAY_PASSWORD}-changed`;
    try {
      // The emailed link signs the user in through the callback; signing in stands in for it here.
      await signInAs(page, user);
      await page.goto('/en/auth/reset', FIRST_LOAD);
      const form = page.getByRole('form', { name: msg('ResetPassword.title') });
      await expect(page.getByText(msg('ResetPassword.subtitle'))).toBeVisible();
      await form.getByLabel(msg('ResetPassword.newPassword'), { exact: true }).fill(newPassword);
      await form.getByLabel(msg('ResetPassword.confirm'), { exact: true }).fill(newPassword);

      // supabase-js sends PUT /auth/v1/user from the browser (a CORS preflight first).
      const saved = page.waitForResponse((res) => res.url().endsWith('/auth/v1/user') && res.request().method() === 'PUT');
      await form.getByRole('button', { name: msg('ResetPassword.save') }).click();
      expect((await saved).status()).toBe(200);
      await page.waitForURL(/\/en\/dashboard$/, FIRST_LOAD);
      await expect(page.getByRole('heading', { level: 1, name: msg('Home.title') })).toBeVisible();
      await expect(page.getByText(msg('ResetPassword.failed'))).toHaveCount(0);

      // The new password signs in; the old one doesn't any more.
      expect(await canSignIn(request, user.email, newPassword)).toBe(true);
      expect(await canSignIn(request, user.email, user.password)).toBe(false);
      watch.expectClean();
    } finally {
      await deleteThrowawayUser(request, user.id);
    }
  });

  test('Continue with Google comes back signed in, to the page that asked (?next=)', async ({ page, request }) => {
    const watch = watchPage(page);
    await page.goto('/en/auth?next=%2Fgoals', FIRST_LOAD);
    const authorize = page.waitForRequest((req) => req.url().includes('/auth/v1/authorize'));
    await page.getByRole('button', { name: msg('Auth.google') }).click();

    const asked = new URL((await authorize).url());
    expect(asked.searchParams.get('provider')).toBe('google');
    expect(asked.searchParams.get('code_challenge')).toBeTruthy();
    await page.waitForURL(/\/en\/goals$/, FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Goals.title') })).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { name: msg('RequireAuth.title') })).toHaveCount(0);

    const { oauthRequests } = await fakeState(request);
    const mine = oauthRequests.filter((item) => item.redirectTo?.includes(encodeURIComponent('/en/goals')));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.at(-1)).toMatchObject({ provider: 'google', pkce: true });
    watch.expectClean();
  });

  test('single sign-on fails gracefully when the company has none', async ({ page }) => {
    const watch = watchPage(page);
    const domain = `${marker('sso').toLowerCase()}.test`;
    await page.goto('/en/auth', FIRST_LOAD);
    await page.getByRole('button', { name: msg('Auth.useSso') }).click();
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.sso') })).toBeVisible();

    const form = page.getByRole('form', { name: msg('Auth.title.sso') });
    await expect(form.getByLabel(msg('Auth.password'), { exact: true })).toHaveCount(0);
    await form.getByLabel(msg('Auth.workEmail')).fill(`someone@${domain}`);
    const sso = page.waitForResponse((res) => res.url().includes('/auth/v1/sso'));
    await form.getByRole('button', { name: msg('Auth.submit.sso') }).click();
    expect((await sso).ok()).toBe(false);
    await expect(form.getByRole('alert')).toHaveText(fill(msg('Auth.errors.noSso'), { domain }));
    await expect(page).toHaveURL(/\/en\/auth$/);

    await page.getByRole('button', { name: msg('Auth.backToSignIn') }).click();
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.login') })).toBeVisible();
    watch.expectClean();
  });

  test('sign up a new throwaway account, then go through onboarding: every step, back and next, the plan, finishing', async ({ page, request }) => {
    test.setTimeout(240_000);
    const watch = watchPage(page);
    const email = `${marker('newuser')}@example.test`.toLowerCase();
    const name = `New Candidate ${email.slice(6, 22)}`;
    let userId: string | undefined;
    try {
      await page.goto('/en/auth?mode=signup', FIRST_LOAD);
      const form = page.getByRole('form', { name: msg('Auth.title.signup') });
      await form.getByLabel(msg('Auth.email')).fill(email);
      await form.getByLabel(msg('Auth.password'), { exact: true }).fill(THROWAWAY_PASSWORD);
      await form.getByRole('button', { name: msg('Auth.submit.signup') }).click();
      // With email confirmation off, a new account is signed in at once and goes to onboarding.
      await page.waitForURL(/\/en\/onboarding$/, FIRST_LOAD);
      userId = (await fakeAuthUser(request, email))?.id;
      expect(userId, 'the new account').toBeTruthy();
      const { tables: before } = await fakeState(request);
      // The sign-up trigger made its profile (0024), not yet onboarded.
      expect((before.profiles ?? []).find((row) => row.id === userId)).toMatchObject({ email, onboarding_completed: false });

      // 1 of 4: welcome.
      await expect(page.getByText(fill(msg('Onboarding.stepOf'), { current: 1, total: 4 }))).toBeVisible();
      await page.getByRole('button', { name: msg('Onboarding.welcome.start') }).click();

      // 2 of 4: the plan, a radio choice; Continue waits for one.
      await expect(page.getByRole('heading', { level: 1, name: msg('Onboarding.plan.title') })).toBeVisible();
      const proceed = page.getByRole('button', { name: msg('Onboarding.continue') });
      await expect(proceed).toBeDisabled();
      await chooseRadio(page, msg('Onboarding.plan.pro.name'));
      await chooseRadio(page, msg('Onboarding.plan.free.name'));
      await expect(page.getByRole('radio', { name: msg('Onboarding.plan.pro.name') })).not.toBeChecked();
      await proceed.click();

      // 3 of 4: about you; Back keeps the plan, Continue waits for a name, a role and a level.
      await expect(page.getByRole('heading', { level: 1, name: msg('Onboarding.profile.title') })).toBeVisible();
      await page.getByRole('button', { name: msg('Onboarding.back'), exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: msg('Onboarding.plan.title') })).toBeVisible();
      await expect(page.getByRole('radio', { name: msg('Onboarding.plan.free.name') })).toBeChecked();
      await proceed.click();
      await expect(page.getByRole('heading', { level: 1, name: msg('Onboarding.profile.title') })).toBeVisible();
      await expect(proceed).toBeDisabled();
      await page.getByRole('textbox', { name: field(msg('Onboarding.profile.name')) }).fill(name);
      await page.getByRole('button', { name: msg('Onboarding.roles.backend') }).click();
      await expect(page.getByRole('button', { name: msg('Onboarding.roles.backend') })).toHaveAttribute('aria-pressed', 'true');
      await expect(proceed).toBeDisabled();
      await page.getByRole('combobox', { name: field(msg('Onboarding.profile.experience')) }).selectOption('3-5');
      await page.getByRole('textbox', { name: field(msg('Onboarding.profile.industry')) }).fill('Payments');
      await proceed.click();

      // 4 of 4: how it works, then finish on Home.
      await expect(page.getByText(fill(msg('Onboarding.stepOf'), { current: 4, total: 4 }))).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(4);
      await page.getByRole('button', { name: msg('Onboarding.finish') }).click();
      await page.waitForURL(/\/en\/dashboard$/, FIRST_LOAD);
      await expect(page.getByRole('heading', { level: 1, name: msg('Home.title') })).toBeVisible();
      // Every step saved without an error.
      await expect(page.getByText(msg('Onboarding.saveFailed'))).toHaveCount(0);

      const { tables } = await fakeState(request);
      expect((tables.profiles ?? []).find((row) => row.id === userId)).toMatchObject({
        full_name: name,
        onboarding_completed: true,
        target_roles: [msg('Onboarding.roles.backend')],
        years_experience: 3,
        industry: 'Payments',
      });
      // One onboarding row for the account (user_id is unique), at the last step reached.
      const progress = (tables.onboarding_state ?? []).filter((row) => row.user_id === userId);
      expect(progress).toHaveLength(1);
      expect(progress[0]).toMatchObject({ current_step: 'tutorial', plan: 'free' });

      // Finished: onboarding doesn't come back.
      await page.goto('/en/onboarding', FIRST_LOAD);
      await expect(page).toHaveURL(/\/en\/dashboard$/);
      watch.expectClean();
    } finally {
      if (userId) await deleteThrowawayUser(request, userId);
    }
  });

  test('the sign-up form asks for a confirmed email and sends new accounts to onboarding (sign-up response stubbed)', async ({ page }) => {
    const watch = watchPage(page);
    const email = `${marker('signup')}@example.test`;
    // The fake signs new accounts in at once (confirmation off); answer as Supabase does when it's on.
    let signup: { url: string; body: Record<string, unknown> } | null = null;
    await page.route('**/auth/v1/signup**', async (route) => {
      signup = { url: route.request().url(), body: route.request().postDataJSON() as Record<string, unknown> };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: '0e2e0000-0000-4000-8000-0000000000ff', aud: 'authenticated', role: '', email, identities: [{}], created_at: new Date().toISOString() }),
      });
    });

    await page.goto('/en/auth', FIRST_LOAD);
    await page.getByRole('button', { name: msg('Auth.newHere') }).click();
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.signup') })).toBeVisible();
    const form = page.getByRole('form', { name: msg('Auth.title.signup') });
    await expect(form.getByText(msg('Auth.passwordHelp'))).toBeVisible();
    await expect(form.getByRole('button', { name: msg('Auth.forgot') })).toHaveCount(0);

    await form.getByLabel(msg('Auth.email')).fill(email);
    await form.getByLabel(msg('Auth.password'), { exact: true }).fill('long-enough-password');
    await form.getByRole('button', { name: msg('Auth.submit.signup') }).click();
    await expect(form.getByRole('status')).toHaveText(fill(msg('Auth.confirmSent'), { email }));

    expect(signup).not.toBeNull();
    const sent = signup as unknown as { url: string; body: Record<string, unknown> };
    expect(sent.body).toMatchObject({ email, password: 'long-enough-password' });
    // The confirmation link signs them in through the callback and opens onboarding, in this language.
    const back = new URL(new URL(sent.url).searchParams.get('redirect_to') ?? '');
    expect(back.pathname).toBe('/api/auth/callback');
    expect(back.searchParams.get('next')).toBe('/en/onboarding');
    watch.expectClean();
  });

  test('onboarding is skipped for an account that finished it, and needs sign-in otherwise', async ({ page }) => {
    const watch = watchPage(page);
    await page.goto('/en/onboarding', FIRST_LOAD);
    await expect(page).toHaveURL(/\/en\/auth\?next=(%2F|\/)onboarding$/);

    await loginForm(page).getByLabel(msg('Auth.email')).fill(USER.email);
    await loginForm(page).getByLabel(msg('Auth.password'), { exact: true }).fill(USER.password);
    await loginForm(page).getByRole('button', { name: msg('Auth.submit.login') }).click();
    // Onboarding is done for this account, so it goes on to Home.
    await page.waitForURL(/\/en\/dashboard$/, FIRST_LOAD);
    await page.goto('/en/onboarding', FIRST_LOAD);
    await expect(page).toHaveURL(/\/en\/dashboard$/);
    watch.expectClean();
  });

  test('the language switcher on sign-in changes the page language and keeps ?next=', async ({ page }) => {
    const watch = watchPage(page);
    await page.goto('/en/auth?next=%2Fgoals', FIRST_LOAD);
    const picker = page.getByRole('combobox', { name: msg('Auth.language') });
    await expect(picker).toHaveValue('en');
    await picker.selectOption('fr');

    await page.waitForURL(/\/fr\/auth\?next=%2Fgoals$/, FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.login', 'fr') })).toBeVisible();
    await expect(page.getByRole('combobox', { name: msg('Auth.language', 'fr') })).toHaveValue('fr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    // Signing in keeps French and returns to the page that asked.
    const form = loginForm(page, 'fr');
    await form.getByLabel(msg('Auth.email', 'fr')).fill(USER.email);
    await form.getByLabel(msg('Auth.password', 'fr'), { exact: true }).fill(USER.password);
    await form.getByRole('button', { name: msg('Auth.submit.login', 'fr') }).click();
    await page.waitForURL(/\/fr\/goals$/, FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Goals.title', 'fr') })).toBeVisible();

    // And the app's own links stay in French.
    await page
      .getByRole('navigation', { name: msg('AppShell.primaryNavigation', 'fr') })
      .first()
      .getByRole('link', { name: new RegExp(`^${escapeRegExp(msg('AppShell.nav.home', 'fr'))}$`) })
      .click();
    await page.waitForURL(/\/fr\/dashboard$/, FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Home.title', 'fr') })).toBeVisible();
    watch.expectClean();
  });

  test('signing in from a language keeps it (Spanish, Google)', async ({ page }) => {
    const watch = watchPage(page);
    await page.goto('/es/auth', FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Auth.title.login', 'es') })).toBeVisible();
    await page.getByRole('button', { name: msg('Auth.google', 'es') }).click();
    await page.waitForURL(/\/es\/dashboard$/, FIRST_LOAD);
    await expect(page.getByRole('heading', { level: 1, name: msg('Home.title', 'es') })).toBeVisible();
    watch.expectClean();
  });

  test('@mobile signs in, and signs out from the More sheet', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout (tab bar and More sheet)');
    const watch = watchPage(page);
    await hideNextDevBadge(page);
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1, name: msg('Home.title') })).toBeVisible();

    const tabs = page.getByRole('navigation', { name: msg('AppShell.primaryNavigation') }).last();
    await expect(tabs.getByRole('link', { name: msg('AppShell.nav.live') })).toBeVisible();
    await tabs.getByRole('button', { name: msg('AppShell.nav.more') }).click();
    const sheet = page.getByRole('dialog', { name: msg('AppShell.nav.more') });
    await expect(sheet.getByText(USER.email)).toBeVisible();
    await sheet.getByRole('button', { name: msg('SignOutButton.label') }).click();
    await page.waitForURL(/\/en$/, FIRST_LOAD);

    await page.goto('/en/dashboard', FIRST_LOAD);
    await expect(page.getByRole('main').getByRole('heading', { name: msg('RequireAuth.title') })).toBeVisible();
    watch.expectClean();
  });
});
