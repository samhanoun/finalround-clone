import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import en from '../../src/messages/en.json';
import { canSignIn, createThrowawayUser, deleteThrowawayUser, fakeAuthUser, signInAs } from './helpers/accounts';
import {
  USER,
  clipboardText,
  escapeRegExp,
  expect,
  go,
  m,
  marker,
  restDelete,
  restGet,
  restInsert,
  restPatch,
  restRow,
  signIn,
  test,
  warmUp,
  type Row,
} from './helpers/flowsB';

/**
 * Settings (every section), Help & support, the notification bell and the
 * referral panel, end to end against the fakes.
 *
 * The fake user is shared with every other spec, so each settings test
 * snapshots the user's settings rows first and puts them back afterwards,
 * whatever happens in the test. That account is never deleted: the deletion
 * test signs up a throwaway account of its own (helpers/accounts.ts).
 */

const SETTINGS_TABLES = ['user_settings', 'llm_settings', 'video_conferencing_settings', 'notification_preferences'] as const;
type Snapshot = { profile: Row | null; tables: Record<string, Row[]> };

async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  const [profile] = await restGet(request, 'profiles', `id=eq.${USER.id}`);
  const tables: Record<string, Row[]> = {};
  for (const table of SETTINGS_TABLES) tables[table] = await restGet(request, table, `user_id=eq.${USER.id}`);
  return { profile: profile ?? null, tables };
}

/** Puts every settings row back as it was: changed rows get their old values, new rows go. */
async function restore(request: APIRequestContext, before: Snapshot): Promise<void> {
  if (before.profile) {
    await restPatch(request, 'profiles', `id=eq.${USER.id}`, {
      full_name: before.profile.full_name ?? null,
      avatar_url: before.profile.avatar_url ?? null,
      target_roles: before.profile.target_roles ?? null,
    });
  }
  for (const table of SETTINGS_TABLES) {
    for (const row of await restGet(request, table, `user_id=eq.${USER.id}`)) {
      const original = before.tables[table].find((old) => old.id === row.id);
      if (!original) {
        await restDelete(request, table, `id=eq.${row.id}`);
        continue;
      }
      const fields = { ...original };
      delete fields.id;
      delete fields.created_at;
      delete fields.updated_at;
      // Columns the test added that the row didn't have go back to null.
      for (const key of Object.keys(row)) if (!(key in original) && !['id', 'created_at', 'updated_at'].includes(key)) fields[key] = null;
      await restPatch(request, table, `id=eq.${row.id}`, fields);
    }
  }
}

const section = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const savedIn = (scope: Locator, text = m('ProfileSettings.saved')) => scope.getByRole('status').filter({ hasText: text });

async function openSettings(page: Page) {
  await signIn(page, '/en/settings');
  // The profile loads after the first paint.
  await expect(section(page, m('settings.sections.profile')).getByLabel(m('ProfileSettings.fullName'), { exact: true })).toBeVisible({ timeout: 60_000 });
}

test.describe('Settings', () => {
  let before: Snapshot;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/settings', '/es/settings', '/en/teams', '/en']);
  });

  test.beforeEach(async ({ request }) => {
    before = await snapshot(request);
  });

  test.afterEach(async ({ request }) => {
    await restore(request, before);
  });

  test('profile: name, avatar URL (an invalid one is refused) and roles, kept after a reload', async ({ page, request }) => {
    const mark = marker('profile');
    const originalRoles = (before.profile?.target_roles as string[] | null) ?? [];
    const role = Object.values(en.ProfileSettings.roles).find((r) => !originalRoles.includes(r))!;
    const custom = `Role ${mark}`;
    const name = `E2E Candidate ${mark.slice(-4)}`;
    // The avatar preview loads from this address; answer it here instead of going out to the internet.
    await page.route('https://avatars.example.test/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }),
    );
    await openSettings(page);
    const profile = section(page, m('settings.sections.profile'));
    await expect(profile.getByText(USER.email, { exact: true })).toBeVisible();

    // An address that isn't a web address is refused: the form won't send it, and the API says no.
    const avatar = profile.getByLabel(m('ProfileSettings.avatar'), { exact: true });
    await avatar.fill('not a web address');
    let sent = 0;
    const count = (req: { method(): string; url(): string }) => {
      if (req.method() === 'PATCH' && req.url().endsWith('/api/settings/profile')) sent += 1;
    };
    page.on('request', count);
    await profile.getByRole('button', { name: m('ProfileSettings.save'), exact: true }).click();
    expect(await avatar.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    page.off('request', count);
    expect(sent).toBe(0);
    expect((await page.request.patch('/api/settings/profile', { data: { avatar_url: 'not a web address' } })).status()).toBe(400);

    await profile.getByLabel(m('ProfileSettings.fullName'), { exact: true }).fill(name);
    await avatar.fill('https://avatars.example.test/flowsB.png');
    await expect(profile.getByRole('img', { name: m('ProfileSettings.avatarPreview') })).toBeVisible();
    const roles = profile.getByRole('group', { name: m('ProfileSettings.targetRoles') });
    await roles.getByRole('button', { name: role, exact: true }).click();
    await expect(roles.getByRole('button', { name: role, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await profile.getByRole('textbox', { name: m('ProfileSettings.customRole') }).fill(custom);
    await profile.getByRole('button', { name: m('ProfileSettings.add'), exact: true }).click();
    await expect(roles.getByRole('button', { name: m('ProfileSettings.removeRole', { role: custom }) })).toBeVisible();
    await profile.getByRole('button', { name: m('ProfileSettings.save'), exact: true }).click();
    await expect(savedIn(profile)).toBeVisible();
    await expect.poll(async () => (await restRow(request, 'profiles', USER.id))?.full_name).toBe(name);
    const saved = await restRow(request, 'profiles', USER.id);
    expect(saved?.avatar_url).toBe('https://avatars.example.test/flowsB.png');
    expect(saved?.target_roles).toEqual([...originalRoles, role, custom]);

    await page.reload();
    await expect(profile.getByLabel(m('ProfileSettings.fullName'), { exact: true })).toHaveValue(name, { timeout: 60_000 });
    await expect(avatar).toHaveValue('https://avatars.example.test/flowsB.png');
    await expect(roles.getByRole('button', { name: role, exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Roles come off again.
    await roles.getByRole('button', { name: m('ProfileSettings.removeRole', { role: custom }) }).click();
    await roles.getByRole('button', { name: role, exact: true }).click();
    await profile.getByRole('button', { name: m('ProfileSettings.save'), exact: true }).click();
    await expect(savedIn(profile)).toBeVisible();
    await expect.poll(async () => (await restRow(request, 'profiles', USER.id))?.target_roles).toEqual(originalRoles);
  });

  test('app language: switches the URL and the cookie, is saved, and switches back', async ({ page, request }) => {
    await openSettings(page);
    await page.locator('#language-select').selectOption('es');
    await page.waitForURL('**/es/settings#language', { timeout: 120_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('es');
    await expect.poll(async () => (await restGet(request, 'user_settings', `user_id=eq.${USER.id}`))[0]?.language).toBe('es');

    await page.locator('#language-select').selectOption('en');
    await page.waitForURL('**/en/settings#language', { timeout: 120_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(section(page, m('settings.sections.language'))).toBeVisible();
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('en');
    await expect.poll(async () => (await restGet(request, 'user_settings', `user_id=eq.${USER.id}`))[0]?.language).toBe('en');
  });

  test('time zone: saved at once and kept after a reload', async ({ page, request }) => {
    await openSettings(page);
    const region = section(page, m('settings.sections.language'));
    const zone = region.getByLabel(m('ProfileSettings.timezone'), { exact: true });
    await expect(zone).toBeVisible();
    const next = (await zone.inputValue()) === 'Asia/Tokyo' ? 'Europe/Berlin' : 'Asia/Tokyo';
    await zone.selectOption(next);
    await expect(savedIn(region)).toBeVisible();
    await expect.poll(async () => (await restGet(request, 'user_settings', `user_id=eq.${USER.id}`))[0]?.timezone).toBe(next);
    await page.reload();
    await expect(region.getByLabel(m('ProfileSettings.timezone'), { exact: true })).toHaveValue(next, { timeout: 60_000 });
  });

  test('answers: model, writing style and length, kept after a reload', async ({ page, request }) => {
    await openSettings(page);
    const form = page.getByRole('form', { name: m('AnswerModel.label') });
    const model = form.getByLabel(m('AnswerModel.answers'), { exact: true });
    const options = await model.locator('option').evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value).filter(Boolean));
    expect(options.length, 'the fake server offers at least one model').toBeGreaterThan(0);
    const current = await model.inputValue();
    const choice = options.find((value) => value !== current)!;
    await model.selectOption(choice);
    const style = form.getByRole('radiogroup', { name: m('AnswerModel.styleLabel') });
    const length = form.getByRole('radiogroup', { name: m('AnswerModel.lengthLabel') });
    const styleChoice = (await style.getByRole('radio', { name: m('AnswerModel.styles.creative.label') }).isChecked()) ? 'precise' : 'creative';
    const lengthChoice = (await length.getByRole('radio', { name: m('AnswerModel.lengths.detailed') }).isChecked()) ? 'short' : 'detailed';
    await style.getByRole('radio', { name: m(`AnswerModel.styles.${styleChoice}.label`) }).check();
    await length.getByRole('radio', { name: m(`AnswerModel.lengths.${lengthChoice}`) }).check();
    await expect(form.getByText(m(`AnswerModel.styles.${styleChoice}.note`))).toBeVisible();
    await form.getByRole('button', { name: m('AnswerModel.save'), exact: true }).click();
    await expect(savedIn(form, m('AnswerModel.saved'))).toBeVisible();
    await expect.poll(async () => (await restGet(request, 'llm_settings', `user_id=eq.${USER.id}`))[0]?.model).toBe(choice);
    expect((await restGet(request, 'llm_settings', `user_id=eq.${USER.id}`))[0]?.answer_length).toBe(lengthChoice);

    await page.reload();
    await expect(model).toHaveValue(choice, { timeout: 60_000 });
    await expect(style.getByRole('radio', { name: m(`AnswerModel.styles.${styleChoice}.label`) })).toBeChecked();
    await expect(length.getByRole('radio', { name: m(`AnswerModel.lengths.${lengthChoice}`) })).toBeChecked();
    await expect(form.getByRole('button', { name: m('AnswerModel.save'), exact: true })).toBeDisabled();
  });

  test('meeting apps: the platform and every toggle are saved and kept after a reload', async ({ page, request }) => {
    test.setTimeout(180_000);
    await openSettings(page);
    const region = section(page, m('settings.sections.meetings'));
    const where = region.getByLabel(m('MeetingApps.where'), { exact: true });
    const original = await where.inputValue();
    const next = original === 'zoom-app' ? 'ms_teams-browser' : 'zoom-app';
    await where.selectOption(next);
    await expect(savedIn(region, m('MeetingApps.saved'))).toBeVisible();
    await page.reload();
    await expect(where).toHaveValue(next, { timeout: 60_000 });
    const row = (await restGet(request, 'video_conferencing_settings', `user_id=eq.${USER.id}`))[0];
    expect(row?.preferred_platform).toBe(next.split('-')[0]);

    const columns = {
      askForLink: 'auto_detect_platform',
      autoStartListening: 'auto_start_listening',
      endWhenSharingStops: 'screen_share_detection_enabled',
      useMicrophone: 'audio_capture_enabled',
    } as const;
    // One at a time, and each goes straight back, so the shared user's live sessions aren't left changed.
    for (const [key, column] of Object.entries(columns)) {
      const toggle = region.getByRole('switch', { name: m(`MeetingApps.toggles.${key}.label`) });
      const was = await toggle.isChecked();
      await toggle.click();
      await expect(savedIn(region, m('MeetingApps.saved'))).toBeVisible();
      await expect.poll(async () => (await restGet(request, 'video_conferencing_settings', `user_id=eq.${USER.id}`))[0]?.[column]).toBe(!was);
      await page.reload();
      await expect(region.getByRole('switch', { name: m(`MeetingApps.toggles.${key}.label`) })).toBeChecked({ checked: !was, timeout: 60_000 });
      await region.getByRole('switch', { name: m(`MeetingApps.toggles.${key}.label`) }).click();
      await expect.poll(async () => (await restGet(request, 'video_conferencing_settings', `user_id=eq.${USER.id}`))[0]?.[column]).toBe(was);
    }
  });

  test('notifications: the matrix and the weekly digest are saved and kept; this device explains push is off here', async ({ page, request }) => {
    await openSettings(page);
    const region = section(page, m('settings.sections.notifications'));
    const kinds = ['interview_reminders', 'application_updates', 'ai_suggestions'];
    const boxes = [
      ...kinds.flatMap((kind) => [
        { name: `${m(`NotificationPreferences.kinds.${kind}.label`)} ${m('NotificationPreferences.inApp')}`, column: `in_app_${kind}` },
        { name: `${m(`NotificationPreferences.kinds.${kind}.label`)} ${m('NotificationPreferences.byEmail')}`, column: `email_${kind}` },
      ]),
      { name: `${m('NotificationPreferences.digest')} ${m('NotificationPreferences.byEmail')}`, column: 'email_weekly_digest' },
    ];
    const checkbox = (name: string) => region.getByRole('checkbox', { name, exact: true });
    await expect(checkbox(boxes[0].name)).toBeEnabled({ timeout: 60_000 });
    const was = await Promise.all(boxes.map((box) => checkbox(box.name).isChecked()));
    for (const box of boxes) await checkbox(box.name).click();
    await region.getByRole('button', { name: m('NotificationPreferences.save'), exact: true }).click();
    await expect(savedIn(region, m('NotificationPreferences.saved'))).toBeVisible();
    const saved = (await restGet(request, 'notification_preferences', `user_id=eq.${USER.id}`))[0];
    boxes.forEach((box, i) => expect(saved?.[box.column], box.column).toBe(!was[i]));

    await page.reload();
    for (const [i, box] of boxes.entries()) await expect(checkbox(box.name)).toBeChecked({ checked: !was[i], timeout: 60_000 });

    // And back, through the page again.
    for (const box of boxes) await checkbox(box.name).click();
    await region.getByRole('button', { name: m('NotificationPreferences.save'), exact: true }).click();
    await expect(savedIn(region, m('NotificationPreferences.saved'))).toBeVisible();
    const restored = (await restGet(request, 'notification_preferences', `user_id=eq.${USER.id}`))[0];
    boxes.forEach((box, i) => expect(restored?.[box.column], box.column).toBe(was[i]));

    // Push isn't set up on the fake server (no VAPID keys): the row says so, with nothing to press.
    const device = region.getByText(new RegExp(`^(${escapeRegExp(m('NotificationPreferences.push.unconfigured'))}|${escapeRegExp(m('NotificationPreferences.push.unsupported'))})$`));
    await expect(device).toBeVisible();
    await expect(region.getByRole('button', { name: m('NotificationPreferences.pushOn') })).toHaveCount(0);
  });

  test('billing & usage: the plan and its meters; "Manage billing" explains billing is off', async ({ page }) => {
    await openSettings(page);
    const region = section(page, m('settings.sections.billing'));
    await expect(region.getByText(m('Billing.planName', { plan: m('Billing.plans.pro') }), { exact: true })).toBeVisible({ timeout: 60_000 });
    const meters = region.getByRole('list', { name: m('Billing.usageLabel') });
    for (const key of ['copilotMonth', 'copilotToday', 'perSession', 'reviewsMonth']) {
      await expect(meters.getByRole('meter', { name: m(`Billing.usage.${key}`) })).toBeVisible();
    }
    const response = page.waitForResponse((res) => res.url().endsWith('/api/billing/portal'));
    await region.getByRole('button', { name: m('Billing.manage'), exact: true }).click();
    expect((await response).status()).toBe(503);
    await expect(region.getByRole('alert')).toHaveText(m('Billing.errors.billing_unavailable'));
    await expect(region.getByRole('button', { name: m('Billing.manage'), exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/en\/settings/);
  });

  test('section links, the hidden desktop section, and the Manage team link', async ({ page }) => {
    await openSettings(page);
    const nav = page.getByRole('navigation', { name: m('settings.sections.label') });
    for (const [id, key] of [
      ['notifications', 'notifications'],
      ['billing', 'billing'],
      ['account', 'account'],
      ['profile', 'profile'],
    ] as const) {
      const link = nav.getByRole('link', { name: m(`settings.sections.${key}`), exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(link).toHaveAttribute('aria-current', 'true');
      await expect(section(page, m(`settings.sections.${key}`))).toBeInViewport();
      await expect(page.locator(`#${id}`)).toBeFocused();
    }
    // The desktop app's section and its link only show inside the desktop app.
    await expect(page.locator('#desktop')).toBeHidden();
    await expect(nav.getByRole('link', { name: m('settings.sections.desktop'), exact: true })).toBeHidden();

    await section(page, m('settings.sections.account')).getByRole('link', { name: m('settings.manageTeam'), exact: true }).click();
    await page.waitForURL('**/en/teams', { timeout: 120_000 });
  });

  test('signs out from settings', async ({ page }) => {
    await openSettings(page);
    await section(page, m('settings.sections.account')).getByRole('button', { name: m('SignOutButton.label') }).click();
    await page.waitForURL((url) => url.pathname === '/en' || url.pathname === '/en/', { timeout: 120_000 });
    await go(page, '/en/settings');
    await expect(page.getByRole('heading', { name: m('RequireAuth.title') })).toBeVisible({ timeout: 60_000 });
    await expect(section(page, m('settings.sections.profile'))).toHaveCount(0);
  });

  test('account deletion asks for the email and the word, and refuses a wrong email', async ({ page }) => {
    await openSettings(page);
    const region = section(page, m('settings.sections.account'));
    await region.getByRole('button', { name: m('AccountDeletion.start'), exact: true }).click();
    const form = region.getByRole('form', { name: m('AccountDeletion.confirmTitle') });
    const confirm = form.getByRole('button', { name: m('AccountDeletion.confirm'), exact: true });
    await expect(confirm).toBeDisabled();
    // Never the real address: this account is shared by every spec.
    await form.getByRole('textbox', { name: m('AccountDeletion.email'), exact: true }).fill(`someone-else-${Date.now()}@example.test`);
    await expect(confirm).toBeDisabled();
    await form.getByRole('textbox', { name: m('AccountDeletion.typeWord', { word: 'DELETE' }) }).fill('DELETE');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(form.getByRole('alert')).toHaveText(m('AccountDeletion.errors.email_mismatch'));
    await form.getByRole('button', { name: m('AccountDeletion.cancel'), exact: true }).click();
    await expect(region.getByRole('button', { name: m('AccountDeletion.start'), exact: true })).toBeVisible();
    // Still signed in.
    await page.reload();
    await expect(section(page, m('settings.sections.profile'))).toBeVisible({ timeout: 60_000 });
  });

  test('on a phone: the section strip moves between sections, with no sideways scroll @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'The strip under the top bar is the phone layout; the mobile project runs it.');
    await openSettings(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const nav = page.getByRole('navigation', { name: m('settings.sections.label') });
    for (const [id, key] of [
      ['billing', 'billing'],
      ['meeting-apps', 'meetings'],
      ['account', 'account'],
    ] as const) {
      await nav.getByRole('link', { name: m(`settings.sections.${key}`), exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(section(page, m(`settings.sections.${key}`))).toBeInViewport();
    }
    await expect(page.locator('#desktop')).toBeHidden();
  });

  test('account deletion with a throwaway user deletes that account', async ({ page, request }) => {
    test.setTimeout(180_000);
    const mark = marker('delete');
    // Never the shared fake user: a throwaway account, with a little data of its own.
    const user = await createThrowawayUser(request, 'delete', { onboarded: true, fullName: `Leaving ${mark.slice(-4)}` });
    const [goal] = await restInsert(request, 'goals', { user_id: user.id, name: `Goal ${mark}` });
    const [ticket] = await restInsert(request, 'support_tickets', {
      user_id: user.id,
      email: user.email,
      subject: `Closing my account ${mark}`,
      description: 'Please close my account.',
      category: 'account',
      priority: 'medium',
      status: 'open',
    });
    try {
      await signInAs(page, user, '/en/settings');
      await expect(section(page, m('settings.sections.profile')).getByLabel(m('ProfileSettings.fullName'), { exact: true })).toBeVisible({ timeout: 60_000 });
      const region = section(page, m('settings.sections.account'));
      await region.getByRole('button', { name: m('AccountDeletion.start'), exact: true }).click();
      const form = region.getByRole('form', { name: m('AccountDeletion.confirmTitle') });
      // The address is compared without regard to case.
      await form.getByRole('textbox', { name: m('AccountDeletion.email'), exact: true }).fill(user.email.toUpperCase());
      await form.getByRole('textbox', { name: m('AccountDeletion.typeWord', { word: 'DELETE' }) }).fill('DELETE');
      const deleted = page.waitForResponse((res) => res.url().endsWith('/api/settings/account') && res.request().method() === 'DELETE');
      await form.getByRole('button', { name: m('AccountDeletion.confirm'), exact: true }).click();
      expect((await deleted).status()).toBe(200);
      await expect(region.getByRole('status')).toContainText(m('AccountDeletion.deletedTitle'));
      // Then it signs out and goes home.
      await page.waitForURL((url) => url.pathname === '/en' || url.pathname === '/en/', { timeout: 120_000 });

      // The account is gone from Supabase Auth, and can't sign in.
      expect(await fakeAuthUser(request, user.email)).toBeUndefined();
      expect(await canSignIn(request, user.email, user.password)).toBe(false);
      // What it owned went with it (on delete cascade); its support ticket stays, without it (set null).
      expect(await restRow(request, 'profiles', user.id)).toBeNull();
      expect(await restRow(request, 'goals', String(goal.id))).toBeNull();
      const kept = await restRow(request, 'support_tickets', String(ticket.id));
      expect(kept, 'the support ticket stays').not.toBeNull();
      expect(kept?.user_id).toBeNull();
      // Signed out for real: settings asks to sign in.
      await go(page, '/en/settings');
      await expect(page.getByRole('heading', { name: m('RequireAuth.title') })).toBeVisible({ timeout: 60_000 });
    } finally {
      await deleteThrowawayUser(request, user.id);
      await restDelete(request, 'support_tickets', `id=eq.${ticket.id}`);
      await restDelete(request, 'goals', `id=eq.${goal.id}`);
    }
  });
});

test.describe('Help & support', () => {
  const mark = marker('support');

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/support']);
  });

  test.afterAll(async ({ request }) => {
    for (const ticket of await restGet(request, 'support_tickets', `user_id=eq.${USER.id}&subject=like.*${mark}*`)) {
      await restDelete(request, 'support_messages', `ticket_id=eq.${ticket.id}`);
      await restDelete(request, 'support_tickets', `id=eq.${ticket.id}`);
    }
    await restDelete(request, 'notifications', `user_id=eq.${USER.id}&title=like.*${mark}*`);
  });

  test('a new request, a reply, its status in the list, and a closed request', async ({ page, request }) => {
    const subject = `Can't export my report ${mark}`;
    await signIn(page, '/en/support');
    await page.getByRole('button', { name: m('Support.newRequest') }).click();
    const form = page.getByRole('form', { name: m('Support.newTitle') });
    await form.getByRole('textbox', { name: m('Support.subject'), exact: true }).fill(subject);
    await form.getByRole('combobox', { name: m('Support.category'), exact: true }).selectOption('technical');
    await form.getByRole('textbox', { name: m('Support.description'), exact: true }).fill('The PDF button does nothing on the Analytics page.');
    await form.getByRole('button', { name: m('Support.send'), exact: true }).click();
    await expect(page.getByText(m('Support.sent', { email: USER.email }))).toBeVisible();

    // It opens as a conversation, and the list shows it as open.
    const thread = page.getByRole('article', { name: subject });
    await expect(thread).toBeVisible();
    await expect(thread.getByText(m('Support.status.open'), { exact: true })).toBeVisible();
    const listItem = page.getByRole('button').filter({ hasText: subject });
    await expect(listItem).toContainText(m('Support.status.open'));
    const [ticket] = await restGet(request, 'support_tickets', `user_id=eq.${USER.id}&subject=eq.${encodeURIComponent(subject)}`);
    expect(ticket).toMatchObject({ category: 'technical', status: 'open', priority: 'medium', email: USER.email });

    // A reply in its thread.
    await thread.getByRole('textbox', { name: m('Support.reply') }).fill(`More detail ${mark}: it happens every time.`);
    const replied = page.waitForResponse((res) => res.url().endsWith(`/api/support/${ticket.id}/messages`));
    await thread.getByRole('button', { name: m('Support.sendReply'), exact: true }).click();
    expect((await replied).status()).toBe(201);
    const [message] = await restGet(request, 'support_messages', `ticket_id=eq.${ticket.id}`);
    expect(message).toMatchObject({ is_from_admin: false, content: `More detail ${mark}: it happens every time.` });
    await expect(thread.getByRole('textbox', { name: m('Support.reply') })).toHaveValue('');

    // Support answered: the request waits for you, and opens first on your next visit.
    await restPatch(request, 'support_tickets', `id=eq.${ticket.id}`, { status: 'waiting_user' });
    await page.reload();
    await expect(page.getByRole('article', { name: subject })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button').filter({ hasText: subject })).toContainText(m('Support.status.waiting_user'));

    // Closed: it says so, and there is no reply box.
    await restPatch(request, 'support_tickets', `id=eq.${ticket.id}`, { status: 'closed' });
    await page.reload();
    await page.getByRole('button').filter({ hasText: subject }).click();
    const closed = page.getByRole('article', { name: subject });
    await expect(closed.getByText(m('Support.closedNote'))).toBeVisible();
    await expect(closed.getByRole('textbox', { name: m('Support.reply') })).toHaveCount(0);
    await expect(page.getByRole('button').filter({ hasText: subject })).toContainText(m('Support.status.closed'));
  });

  test('on a phone: the list, then the request full width, and back @mobile', async ({ page, request, isMobile }) => {
    test.skip(!isMobile, 'Phones show the list and the request one at a time; the mobile project runs it.');
    const subject = `Phone question ${mark}`;
    // Made through the fake: opening requests through the page is limited to 5 an hour per user.
    await restInsert(request, 'support_tickets', {
      user_id: USER.id,
      email: USER.email,
      subject,
      description: 'Where do I change my time zone?',
      category: 'account',
      priority: 'medium',
      status: 'open',
    });
    await signIn(page, '/en/support');
    const item = page.getByRole('button').filter({ hasText: subject });
    await expect(item).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await item.click();
    const thread = page.getByRole('article', { name: subject });
    await expect(thread).toBeVisible();
    await expect(thread.getByText('Where do I change my time zone?')).toBeVisible();
    await expect(item).toBeHidden();
    await page.getByRole('button', { name: m('Support.mineTitle'), exact: true }).click();
    await expect(item).toBeVisible();
    await expect(thread).toBeHidden();
  });

  test('your reply and support’s answer show in the thread, in order', async ({ page, request }) => {
    const subject = `Export question ${mark}`;
    // Made through the fake: opening requests through the page is limited to 5 an hour per user.
    const [ticket] = await restInsert(request, 'support_tickets', {
      user_id: USER.id,
      email: USER.email,
      subject,
      description: 'The CSV export is empty.',
      category: 'technical',
      priority: 'medium',
      status: 'open',
    });
    await signIn(page, '/en/support');
    await page.getByRole('button').filter({ hasText: subject }).click();
    const thread = page.getByRole('article', { name: subject });
    await expect(thread.getByText(m('Support.noReplies'))).toBeVisible();

    // Your reply: GET /api/support reads the ticket with its messages (an embedded select), so it shows.
    const mine = `It is empty for last month too ${mark}`;
    await thread.getByRole('textbox', { name: m('Support.reply') }).fill(mine);
    const replied = page.waitForResponse((res) => res.url().endsWith(`/api/support/${ticket.id}/messages`));
    await thread.getByRole('button', { name: m('Support.sendReply'), exact: true }).click();
    expect((await replied).status()).toBe(201);
    const entries = thread.getByRole('listitem');
    await expect(entries.filter({ hasText: mine })).toContainText(m('Support.fromYou'));
    await expect(thread.getByText(m('Support.noReplies'))).toHaveCount(0);

    // Support answers (as Admin → Support tickets does, by another person): it shows after yours, from Support.
    const answer = `Fixed in the next release ${mark}`;
    await restInsert(request, 'support_messages', { ticket_id: ticket.id, user_id: randomUUID(), is_from_admin: true, content: answer });
    await page.reload();
    await page.getByRole('button').filter({ hasText: subject }).click();
    const reloaded = page.getByRole('article', { name: subject });
    const items = reloaded.getByRole('listitem');
    await expect(items).toHaveCount(3, { timeout: 60_000 });
    await expect(items.nth(0)).toContainText('The CSV export is empty.');
    await expect(items.nth(1)).toContainText(mine);
    await expect(items.nth(1)).toContainText(m('Support.fromYou'));
    await expect(items.nth(2)).toContainText(answer);
    await expect(items.nth(2)).toContainText(m('Support.fromSupport'));
  });
});

test.describe('Notification bell', () => {
  const mark = marker('bell');

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/jobs', '/en/settings']);
  });

  test.afterAll(async ({ request }) => {
    await restDelete(request, 'notifications', `user_id=eq.${USER.id}&title=like.*${mark}*`);
  });

  async function notify(request: APIRequestContext, title: string, url = '/jobs') {
    const [row] = await restInsert(request, 'notifications', {
      user_id: USER.id,
      type: 'system',
      title,
      message: `Open it to see the jobs board (${mark})`,
      data: { url },
      read: false,
      read_at: null,
    });
    return String(row.id);
  }

  const bell = (page: Page) => page.getByRole('button', { name: /^Notifications( \(\d+ unread\))?$/ });

  test('shows unread notifications, and opening one goes where it points', async ({ page, request }) => {
    const title = `Your interview is tomorrow ${mark}`;
    const id = await notify(request, title);
    await signIn(page, '/en/settings');
    await expect(bell(page)).toHaveAccessibleName(/^Notifications \(\d+ unread\)$/, { timeout: 60_000 });
    await bell(page).click();
    const item = page.getByRole('link').filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.click();
    await page.waitForURL('**/en/jobs', { timeout: 120_000 });
    await expect.poll(async () => (await restRow(request, 'notifications', id))?.read).toBe(true);
  });

  test('"Mark all read" marks them read', async ({ page, request }) => {
    const mine = [await notify(request, `First ${mark}`), await notify(request, `Second ${mark}`)];
    // The shared user may have other workers' unread notifications: the update the page sends (all of
    // the user's unread ones) is narrowed to this test's own, so theirs stay as they are.
    const sent: string[] = [];
    await page.route('**/rest/v1/notifications?*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const url = new URL(route.request().url());
      sent.push(url.search);
      url.searchParams.set('id', `in.(${mine.join(',')})`);
      return route.continue({ url: url.toString() });
    });
    await signIn(page, '/en/settings');
    await expect(bell(page)).toHaveAccessibleName(/^Notifications \(\d+ unread\)$/, { timeout: 60_000 });
    await bell(page).click();
    await expect(page.getByText(`First ${mark}`)).toBeVisible();
    await page.getByRole('button', { name: m('NotificationBell.markAllRead'), exact: true }).click();
    await expect(page.getByRole('button', { name: m('NotificationBell.markAllRead'), exact: true })).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName(m('NotificationBell.label'));
    for (const id of mine) await expect.poll(async () => (await restRow(request, 'notifications', id))?.read).toBe(true);
    // The page asked for every unread notification of the user, not only the ones it listed.
    expect(sent).toEqual([expect.stringMatching(new RegExp(`user_id=eq.${USER.id}.*read=eq.false|read=eq.false.*user_id=eq.${USER.id}`))]);
  });

  test('the settings link goes to the Notifications section', async ({ page }) => {
    await signIn(page, '/en/jobs');
    await bell(page).click();
    await page.getByRole('link', { name: m('NotificationBell.settings'), exact: true }).click();
    await page.waitForURL('**/en/settings#notifications', { timeout: 120_000 });
    await expect(section(page, m('settings.sections.notifications'))).toBeInViewport({ timeout: 30_000 });
  });
});

test.describe('Referrals', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/dashboard']);
  });

  test('copy link, copy code, and the share links', async ({ page, context, request }) => {
    const shares: string[] = [];
    await signIn(page, '/en/dashboard');
    const panel = page.getByRole('region', { name: m('Referrals.title') });
    const field = panel.getByRole('textbox', { name: m('Referrals.link') });
    await expect(field).toHaveValue(/ref=/, { timeout: 60_000 });
    const [code] = await restGet(request, 'referral_codes', `user_id=eq.${USER.id}`);
    const link = `${new URL(page.url()).origin}/auth?mode=signup&ref=${encodeURIComponent(String(code.code))}`;
    await expect(field).toHaveValue(link);
    await expect(panel.getByText(String(code.code), { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: m('Referrals.copyLink') }).click();
    await expect(panel.getByRole('button', { name: m('Referrals.copied') })).toBeVisible();
    expect(await clipboardText(page)).toBe(link);
    await panel.getByRole('button', { name: m('Referrals.copyCodeLabel') }).click();
    expect(await clipboardText(page)).toBe(code.code);

    const text = encodeURIComponent(m('Referrals.shareText', { code: String(code.code) }));
    const url = encodeURIComponent(link);
    const linkedin = panel.getByRole('link', { name: m('Referrals.linkedin'), exact: true });
    await expect(linkedin).toHaveAttribute('href', `https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${text}`);
    await expect(linkedin).toHaveAttribute('target', '_blank');
    await expect(panel.getByRole('link', { name: m('Referrals.shareOnX') })).toHaveAttribute('href', `https://twitter.com/intent/tweet?text=${text}&url=${url}`);
    await expect(panel.getByRole('link', { name: m('Referrals.shareByEmail') })).toHaveAttribute(
      'href',
      `mailto:?subject=${encodeURIComponent(m('Referrals.emailSubject'))}&body=${text}%0A%0A${url}`,
    );

    // Sharing on LinkedIn opens it in a new tab and records the share (the site itself isn't loaded).
    await context.route(/^https:\/\/(www\.)?(linkedin|twitter|x)\.com\//, (route) => route.fulfill({ contentType: 'text/html', body: '<title>share</title>' }));
    const recorded = page.waitForResponse((res) => res.url().endsWith('/api/social/shares') && res.request().method() === 'POST');
    const [popup] = await Promise.all([page.waitForEvent('popup'), linkedin.click()]);
    await popup.waitForURL((address) => address.href.startsWith('https://www.linkedin.com/shareArticle?mini=true&url='));
    await popup.close();
    const response = await recorded;
    const body = await response.json().catch(() => ({}));
    if (body?.share?.id) shares.push(String(body.share.id));
    expect(response.ok()).toBeTruthy();
    for (const id of shares) await restDelete(request, 'social_shares', `id=eq.${id}`);
  });
});
