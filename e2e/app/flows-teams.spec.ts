import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  THROWAWAY_PASSWORD,
  canSignIn,
  createThrowawayUser,
  deleteThrowawayUser,
  fakeAuthAdminCalls,
  fakeAuthUser,
  throwawayEmail,
} from './helpers/accounts';
import {
  USER,
  escapeRegExp,
  expect,
  go,
  m,
  marker,
  restDelete,
  restGet,
  restInsert,
  restRow,
  signIn,
  test,
  warmUp,
} from './helpers/flowsB';

/**
 * Teams (create, invite, cancel, rename, single sign-on, delete), joining a
 * team from an invitation link, and the Admin pages, end to end against the
 * fakes. Teams made here carry a unique marker and are removed with their
 * members and invitations (removeTeam deletes them explicitly, though the fake
 * now cascades as the database does). Flows that need someone other than the
 * shared fake user sign up a throwaway account (helpers/accounts.ts).
 */

async function removeTeam(request: APIRequestContext, organizationId: string) {
  await restDelete(request, 'organization_members', `organization_id=eq.${organizationId}`);
  await restDelete(request, 'organization_invitations', `organization_id=eq.${organizationId}`);
  await restDelete(request, 'organizations', `id=eq.${organizationId}`);
}

/** The fake user's active team, if it has one that still exists. */
async function currentTeam(request: APIRequestContext) {
  for (const membership of await restGet(request, 'organization_members', `user_id=eq.${USER.id}&status=eq.active`)) {
    const org = await restRow(request, 'organizations', String(membership.organization_id));
    if (org) return org;
  }
  return null;
}

/** A section by its heading; some headings end with a count ("Members 2"). */
const region = (page: Page, name: string) => page.getByRole('region', { name: new RegExp('^' + escapeRegExp(name) + '( \\d+)?$') });

test.describe('Teams', () => {
  const mark = marker('teams');
  const slug = mark.toLowerCase();
  const name = `Team ${mark}`;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/teams', '/en/teams/join?token=warm-up-token-0000']);
  });

  test.afterAll(async ({ request }) => {
    for (const org of await restGet(request, 'organizations', `slug=like.*${slug}*`)) await removeTeam(request, String(org.id));
  });

  test('create a team, invite and cancel, rename, single sign-on needs a proven domain, delete it', async ({ page, request }) => {
    test.setTimeout(180_000);
    const existing = await currentTeam(request);
    test.skip(
      Boolean(existing),
      `The shared fake user is already in a team (${existing?.name}); the fake has no sign-up for a throwaway user, so this test leaves that team alone.`,
    );
    await signIn(page, '/en/teams');
    await page.getByRole('button', { name: m('Teams.create'), exact: true }).click();
    const form = page.getByRole('form', { name: m('Teams.create') });
    await form.getByRole('textbox', { name: m('Teams.name'), exact: true }).fill(name);
    // The address follows the name until it's edited.
    const address = form.getByRole('textbox', { name: new RegExp(`^${escapeRegExp(m('Teams.address'))}`) });
    await expect(address).toHaveValue(`team-${slug}`);
    await form.getByRole('button', { name: m('Teams.createTeam'), exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText(m('Teams.youAre', { role: m('Teams.roles.owner') }))).toBeVisible();
    const [org] = await restGet(request, 'organizations', `slug=eq.team-${slug}`);
    expect(org).toMatchObject({ name, plan: 'free' });
    const orgId = String(org.id);
    expect(await restGet(request, 'organization_members', `organization_id=eq.${orgId}&user_id=eq.${USER.id}`)).toEqual([
      expect.objectContaining({ role: 'owner', status: 'active' }),
    ]);
    // The owner is listed (by name: the fake's profiles have no email column).
    await expect(region(page, m('Teams.tabs.members')).getByText('E2E Candidate', { exact: true })).toBeVisible();

    // Invite an address: email isn't set up on the fake server, so the link is shown to share by hand.
    const invitee = `invitee-${slug}@example.test`;
    const invite = page.getByRole('form', { name: m('Teams.invite') });
    await invite.getByRole('textbox', { name: m('Teams.email'), exact: true }).fill(invitee);
    await invite.getByRole('combobox', { name: m('Teams.role'), exact: true }).selectOption('viewer');
    await invite.getByRole('button', { name: m('Teams.sendInvitation'), exact: true }).click();
    await expect(page.getByText(m('Teams.inviteCreated', { email: invitee }))).toBeVisible();
    const [invitation] = await restGet(request, 'organization_invitations', `organization_id=eq.${orgId}&email=eq.${encodeURIComponent(invitee)}`);
    expect(invitation).toMatchObject({ role: 'viewer', status: 'pending', invited_by: USER.id });
    await expect(page.getByRole('status').filter({ hasText: `/teams/join?token=${invitation.token}` })).toBeVisible();
    const pending = region(page, m('Teams.tabs.invitations')).getByRole('listitem').filter({ hasText: invitee });
    await expect(pending).toContainText(m('Teams.roles.viewer'));

    // Cancel it.
    await pending.getByRole('button', { name: m('Teams.cancelInvitation', { email: invitee }) }).click();
    await expect(pending).toHaveCount(0);
    await expect.poll(async () => (await restRow(request, 'organization_invitations', String(invitation.id)))?.status).toBe('cancelled');

    // Rename.
    const details = region(page, m('Teams.details'));
    const renamed = `${name} renamed`;
    await details.getByLabel(m('Teams.name'), { exact: true }).fill(renamed);
    await details.getByRole('button', { name: m('Teams.saveName'), exact: true }).click();
    await expect(details.getByRole('status')).toHaveText(m('Teams.saved'));
    await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
    expect((await restRow(request, 'organizations', orgId))?.name).toBe(renamed);

    // Single sign-on: an unverified domain gets the DNS TXT record to add, a public domain is refused,
    // and it stays off. Saves are limited to 10 an hour per user: when repeated local runs on one dev
    // server have used them up, the page says so and these checks are noted rather than failed.
    const sso = region(page, m('Teams.tabs.sso'));
    await expect(sso.getByText(m('Teams.sso.badgeOff'), { exact: true })).toBeVisible();
    const domain = `${slug}.example.test`;
    const metadataUrl = 'https://idp.example.test/saml/metadata';
    const limited = () => test.info().annotations.push({ type: 'note', description: 'SSO saves hit the hourly limit on this server; checks skipped' });
    const manageable = Boolean((await (await page.request.get(`/api/teams/${orgId}/sso`)).json()).manageable);
    if (manageable) {
      // Through the form (this server has a management token, real or placeholder; saving stops at the DNS check).
      const domains = sso.getByRole('textbox', { name: new RegExp(`^${escapeRegExp(m('Teams.sso.domains'))}`) });
      const turnOn = sso.getByRole('button', { name: m('Teams.sso.turnOn'), exact: true });
      const save = async () => {
        const saved = page.waitForResponse((res) => res.url().endsWith(`/api/teams/${orgId}/sso`) && res.request().method() === 'PUT', { timeout: 60_000 });
        await turnOn.click();
        return (await saved).status();
      };
      await domains.fill(domain);
      await sso.getByRole('textbox', { name: m('Teams.sso.metadataUrlLabel'), exact: true }).fill(metadataUrl);
      if ((await save()) === 429) {
        await expect(sso.getByRole('alert')).toHaveText(m('Teams.sso.errors.rate_limited'));
        limited();
      } else {
        await expect(sso.getByRole('alert')).toHaveText(m('Teams.sso.errors.domain_unverified'));
        await expect(sso.getByText(m('Teams.sso.verifyTitle'), { exact: true })).toBeVisible();
        await expect(sso.getByText(`_apex-round-sso.${domain}`, { exact: true })).toBeVisible();
        await expect(sso.getByText(/^apex-round-sso=[0-9a-f]{40}$/)).toBeVisible();
        await domains.fill('gmail.com');
        if ((await save()) === 429) limited();
        else await expect(sso.getByRole('alert')).toHaveText(m('Teams.sso.errors.public_domain'));
      }
    } else {
      // Without SUPABASE_MANAGEMENT_TOKEN (as in CI) the form can't be sent, so the API is checked directly.
      await expect(sso.getByRole('button', { name: m('Teams.sso.turnOn'), exact: true })).toBeDisabled();
      const put = await page.request.put(`/api/teams/${orgId}/sso`, { data: { domains: [domain], metadataUrl }, timeout: 60_000 });
      if (put.status() === 429) limited();
      else {
        expect(put.status()).toBe(422);
        const refused = await put.json();
        expect(refused.error).toBe('domain_unverified');
        expect(refused.records).toEqual([
          { domain, type: 'TXT', name: `_apex-round-sso.${domain}`, value: expect.stringMatching(/^apex-round-sso=[0-9a-f]{40}$/) },
        ]);
        const gmail = await page.request.put(`/api/teams/${orgId}/sso`, { data: { domains: ['gmail.com'], metadataUrl } });
        if (gmail.status() === 429) limited();
        else expect((await gmail.json()).error).toBe('public_domain');
      }
    }
    await expect(sso.getByText(m('Teams.sso.badgeOff'), { exact: true })).toBeVisible();
    expect((await (await page.request.get(`/api/teams/${orgId}/sso`)).json()).enabled).toBe(false);
    // (The fake has no column defaults, so a team that never turned it on has no sso_enabled at all.)
    expect((await restRow(request, 'organizations', orgId))?.sso_enabled ?? false).toBe(false);

    // Delete the team: it asks first.
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe(m('Teams.confirmDeleteTeam', { team: renamed }));
      void dialog.accept();
    });
    await region(page, m('Teams.dangerZone')).getByRole('button', { name: m('Teams.deleteTeam'), exact: true }).click();
    await expect(page.getByRole('button', { name: m('Teams.create'), exact: true })).toBeVisible();
    expect(await restRow(request, 'organizations', orgId)).toBeNull();
    await removeTeam(request, orgId);
  });

});

test.describe('Joining a team', () => {
  const mark = marker('join');
  const created: string[] = [];
  const inviter = randomUUID();

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/teams', '/en/teams/join?token=warm-up-token-0000']);
  });

  test.afterAll(async ({ request }) => {
    for (const id of created) await removeTeam(request, id);
    await restDelete(request, 'notifications', `user_id=eq.${inviter}`);
  });

  /** A team the fake user isn't in, made through the fake (no second user exists to create it). */
  async function invitedTeam(request: APIRequestContext, email: string) {
    const [org] = await restInsert(request, 'organizations', {
      name: `Joinco ${mark} ${created.length}`,
      slug: `${mark}-${created.length}`.toLowerCase(),
      plan: 'free',
      sso_enabled: false,
      sso_config: {},
      settings: {},
    });
    created.push(String(org.id));
    const token = randomUUID();
    await restInsert(request, 'organization_invitations', {
      organization_id: org.id,
      email,
      role: 'member',
      invited_by: inviter,
      token,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    return { org, token };
  }

  test('an invitation link to your own address, accepted while signed in', async ({ page, request }) => {
    const existing = await currentTeam(request);
    test.skip(Boolean(existing), `The shared fake user is already in a team (${existing?.name}); joining another would change what other specs see.`);
    const { org, token } = await invitedTeam(request, USER.email);
    await signIn(page, '/en/teams');
    // It is listed on Teams too.
    const forYou = page.getByRole('region', { name: m('Teams.forYou') });
    await expect(forYou.getByRole('link', { name: m('Teams.viewInvitation') })).toHaveAttribute('href', `/en/teams/join?token=${token}`);

    await go(page, `/en/teams/join?token=${token}`);
    const team = String(org.name);
    await expect(page.getByRole('heading', { name: m('JoinTeam.join', { team }) })).toBeVisible({ timeout: 60_000 });
    const invited = `${m('JoinTeam.teammate')} invited ${USER.email} to join as ${m('JoinTeam.roles.member')}`;
    await expect(page.getByText(new RegExp(`^${escapeRegExp(invited)}`))).toBeVisible();
    await page.getByRole('button', { name: m('JoinTeam.join', { team }), exact: true }).click();
    await page.waitForURL('**/en/teams', { timeout: 120_000 });
    await expect(page.getByRole('heading', { name: team, exact: true })).toBeVisible();
    await expect(page.getByText(m('Teams.youAre', { role: m('Teams.roles.member') }))).toBeVisible();
    expect(await restGet(request, 'organization_members', `organization_id=eq.${org.id}&user_id=eq.${USER.id}`)).toEqual([
      expect.objectContaining({ role: 'member', status: 'active' }),
    ]);
    expect((await restGet(request, 'organization_invitations', `token=eq.${token}`))[0]?.status).toBe('accepted');

    // The link can't be used twice.
    await go(page, `/en/teams/join?token=${token}`);
    await expect(page.getByText(m('JoinTeam.errors.not_pending'))).toBeVisible();
    await removeTeam(request, String(org.id));
  });

  test("an invitation for someone else's address can't be accepted from this account", async ({ page, request }) => {
    const email = `${mark}@example.test`;
    const { token } = await invitedTeam(request, email);
    await signIn(page, `/en/teams/join?token=${encodeURIComponent(token)}`);
    const alert = page.getByRole('alert').filter({ hasText: m('JoinTeam.errors.wrong_account') });
    await expect(alert).toContainText(m('JoinTeam.signedInAs', { email: USER.email }));
    await expect(page.getByRole('button', { name: new RegExp(`^${escapeRegExp(m('JoinTeam.join', { team: '' }))}`) })).toHaveCount(0);
    const res = await page.request.post(`/api/teams/invitations/${token}`, { data: { action: 'accept' } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toBe('wrong_account');
  });

  test('a throwaway user signs up from the invitation link and joins the team', async ({ page, request }) => {
    test.setTimeout(240_000);
    const email = throwawayEmail('join');
    const { org, token } = await invitedTeam(request, email);
    const team = String(org.name);
    let userId: string | undefined;
    try {
      // Signed out, the link says what it's for and offers to sign in or make an account.
      await go(page, `/en/teams/join?token=${token}`);
      await expect(page.getByRole('heading', { name: m('JoinTeam.join', { team }) })).toBeVisible({ timeout: 60_000 });
      await page.getByRole('link', { name: m('JoinTeam.signUp') }).click();
      await page.waitForURL((url) => url.pathname === '/en/auth' && url.searchParams.get('mode') === 'signup', { timeout: 120_000 });

      // A new account with the invited address; the sign-up keeps ?next=, so it comes back to the invitation.
      const form = page.getByRole('form', { name: m('Auth.title.signup') });
      await form.getByRole('textbox', { name: m('Auth.email') }).fill(email);
      await form.locator('input[type=password]').fill(THROWAWAY_PASSWORD);
      await form.getByRole('button', { name: m('Auth.submit.signup'), exact: true }).click();
      await page.waitForURL((url) => url.pathname === '/en/teams/join' && url.searchParams.get('token') === token, { timeout: 120_000 });
      userId = (await fakeAuthUser(request, email))?.id;
      expect(userId, 'the new account').toBeTruthy();

      await page.getByRole('button', { name: m('JoinTeam.join', { team }), exact: true }).click();
      await page.waitForURL('**/en/teams', { timeout: 120_000 });
      await expect(page.getByRole('heading', { name: team, exact: true })).toBeVisible();
      await expect(page.getByText(m('Teams.youAre', { role: m('Teams.roles.member') }))).toBeVisible();
      expect(await restGet(request, 'organization_members', `organization_id=eq.${org.id}&user_id=eq.${userId}`)).toEqual([
        expect.objectContaining({ role: 'member', status: 'active', invited_by: inviter }),
      ]);
      expect((await restGet(request, 'organization_invitations', `token=eq.${token}`))[0]?.status).toBe('accepted');
      // Whoever invited them hears about it (about this team: the other tests here invite from the same person).
      const notices = await restGet(request, 'notifications', `user_id=eq.${inviter}`);
      expect(notices.filter((notice) => String(notice.title ?? '').includes(team))).toHaveLength(1);

      // The link can't be used twice.
      await go(page, `/en/teams/join?token=${token}`);
      await expect(page.getByText(m('JoinTeam.errors.not_pending'))).toBeVisible({ timeout: 60_000 });
    } finally {
      // The account goes, and its membership with it (on delete cascade); the team goes in afterAll.
      if (userId) await deleteThrowawayUser(request, userId);
    }
    expect(await restGet(request, 'organization_members', `organization_id=eq.${org.id}&user_id=eq.${userId}`)).toEqual([]);
  });

  test('an unknown link says so', async ({ page }) => {
    await signIn(page, `/en/teams/join?token=${randomUUID()}`);
    await expect(page.getByRole('heading', { name: m('JoinTeam.invalidTitle') })).toBeVisible();
    await expect(page.getByRole('link', { name: m('JoinTeam.openTeams') })).toBeVisible();
  });
});

test.describe('Admin', () => {
  const mark = marker('admin');
  let staffRowAdded = false;
  let ticketId = '';

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/admin']);
  });

  test.afterAll(async ({ request }) => {
    if (ticketId) {
      await restDelete(request, 'support_messages', `ticket_id=eq.${ticketId}`);
      await restDelete(request, 'support_tickets', `id=eq.${ticketId}`);
    }
    await restDelete(request, 'notifications', `user_id=eq.${USER.id}&title=like.*${mark}*`);
    // Exactly the staff row this spec added, and only if it added one.
    if (staffRowAdded) await restDelete(request, 'admin_users', `user_id=eq.${USER.id}`);
  });

  test('without a staff row the page is a plain 404', async ({ page, request }) => {
    test.skip((await restGet(request, 'admin_users', `user_id=eq.${USER.id}`)).length > 0, 'The fake user is staff already.');
    await signIn(page, '/en/dashboard');
    const res = await page.goto('/en/admin', { timeout: 120_000 });
    expect(res?.status()).toBe(404);
  });

  test('overview, users and tickets render, and support replies to a ticket', async ({ page, request }) => {
    test.setTimeout(180_000);
    if (!(await restGet(request, 'admin_users', `user_id=eq.${USER.id}`)).length) {
      await restInsert(request, 'admin_users', { user_id: USER.id, role: 'admin', permissions: ['read'] });
      staffRowAdded = true;
    }
    const subject = `Billing question ${mark}`;
    const [ticket] = await restInsert(request, 'support_tickets', {
      user_id: USER.id,
      email: USER.email,
      full_name: 'E2E Candidate',
      subject,
      description: 'I was charged twice this month.',
      category: 'billing',
      priority: 'medium',
      status: 'open',
    });
    ticketId = String(ticket.id);

    await signIn(page, '/en/admin');
    const tabs = page.getByRole('navigation', { name: m('Admin.sections') });
    const stats = page.locator('dl');
    // Users, sign-ups in the period (30 days), active or trialing subscriptions, open tickets, unresolved fraud flags.
    for (const label of [
      m('Admin.stats.users'),
      m('Admin.stats.newUsers', { days: 30 }),
      m('Admin.stats.subscriptions'),
      m('Admin.stats.tickets'),
      m('Admin.stats.fraud'),
    ]) {
      await expect(stats.getByText(label, { exact: true })).toBeVisible({ timeout: 60_000 });
    }

    await tabs.getByRole('button', { name: m('Admin.tabs.users') }).click();
    await expect(tabs.getByRole('button', { name: m('Admin.tabs.users') })).toHaveAttribute('aria-current', 'page');
    const users = page.getByRole('table');
    await expect(users.getByRole('columnheader', { name: m('Admin.cols.user') })).toBeVisible();
    await expect(users.getByRole('row').filter({ hasText: 'E2E Candidate' })).toBeVisible();
    await page.getByRole('searchbox', { name: m('Admin.searchLabel') }).fill('E2E');
    await expect(users.getByRole('row').filter({ hasText: 'E2E Candidate' })).toBeVisible();

    for (const [tab, empty] of [
      ['subscriptions', 'subscriptions'],
      ['fraud', 'fraud'],
    ] as const) {
      await tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m(`Admin.tabs.${tab}`))}`) }).click();
      await expect(page.getByRole('table').or(page.getByText(m(`Admin.empty.${empty}`)))).toBeVisible();
    }

    await tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m('Admin.tabs.tickets'))}`) }).click();
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toBeVisible();
    await expect(row).toContainText(m('Admin.values.open'));
    // The topic is shown in the reader's language, as the user picked it.
    await expect(row).toContainText(m('Support.categories.billing'));
    await row.getByRole('button', { name: m('Admin.open'), exact: true }).click();
    const thread = page.getByRole('region', { name: m('Admin.ticketLabel', { subject }) });
    await expect(thread.getByText('I was charged twice this month.')).toBeVisible();
    const reply = `Refunded the second charge ${mark}`;
    await thread.getByRole('textbox', { name: m('Admin.reply') }).fill(reply);
    await thread.getByRole('button', { name: m('Admin.sendReply'), exact: true }).click();
    await expect(thread.getByRole('status')).toHaveText(m('Admin.replySent'));
    // Once: the conversation is shown as saved.
    await expect(thread.getByText(reply)).toHaveCount(1);
    await expect(thread.getByText(reply)).toBeVisible();

    const [message] = await restGet(request, 'support_messages', `ticket_id=eq.${ticketId}`);
    expect(message).toMatchObject({ is_from_admin: true, content: reply, user_id: USER.id });
    expect((await restRow(request, 'support_tickets', ticketId))?.status).toBe('waiting_user');
    // The user hears about it in the app.
    const [notice] = await restGet(request, 'notifications', `user_id=eq.${USER.id}&title=like.*${mark}*`);
    expect(notice).toMatchObject({ type: 'system' });
    expect(notice.read ?? false).toBe(false);
    expect(notice.data).toMatchObject({ url: '/support' });
  });

  test('Users: suspends and reinstates an account (a throwaway one), through Supabase Auth bans', async ({ page, request }) => {
    test.setTimeout(180_000);
    if (!(await restGet(request, 'admin_users', `user_id=eq.${USER.id}`)).length) {
      await restInsert(request, 'admin_users', { user_id: USER.id, role: 'admin', permissions: ['read'] });
      staffRowAdded = true;
    }
    // Never the shared fake user: every other spec signs in with it.
    const user = await createThrowawayUser(request, 'suspend', { onboarded: true, fullName: `Suspended ${mark}` });
    try {
      await signIn(page, '/en/admin');
      const tabs = page.getByRole('navigation', { name: m('Admin.sections') });
      await tabs.getByRole('button', { name: m('Admin.tabs.users') }).click();
      await page.getByRole('searchbox', { name: m('Admin.searchLabel') }).fill(user.email);
      const row = page.getByRole('table').getByRole('row').filter({ hasText: user.email });
      await expect(row).toBeVisible({ timeout: 60_000 });
      const suspendedBadge = row.getByText(m('Admin.values.suspended'), { exact: true });
      await expect(suspendedBadge).toHaveCount(0);

      // Suspend: it asks first, then Supabase Auth bans the account (ban_duration), which the list reads back.
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(m('Admin.confirmSuspend', { email: user.email }));
        void dialog.accept();
      });
      const suspended = page.waitForResponse((res) => res.url().endsWith('/api/admin/users') && res.request().method() === 'PATCH');
      await row.getByRole('button', { name: m('Admin.suspend'), exact: true }).click();
      expect((await suspended).status()).toBe(200);
      await expect(suspendedBadge).toBeVisible();
      await expect(row.getByRole('button', { name: m('Admin.unsuspend'), exact: true })).toBeVisible();
      expect((await fakeAuthAdminCalls(request, user.id)).map((call) => call.ban_duration)).toEqual(['876000h']);
      expect(Date.parse(String((await fakeAuthUser(request, user.email))?.banned_until))).toBeGreaterThan(Date.now() + 365 * 86_400_000);
      expect(await canSignIn(request, user.email, user.password)).toBe(false);
      // The record of it, in the fraud flags.
      expect(await restGet(request, 'fraud_flags', `user_id=eq.${user.id}`)).toHaveLength(1);

      // Unsuspend: the ban is lifted and they can sign in again.
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(m('Admin.confirmUnsuspend', { email: user.email }));
        void dialog.accept();
      });
      await row.getByRole('button', { name: m('Admin.unsuspend'), exact: true }).click();
      await expect(row.getByRole('button', { name: m('Admin.suspend'), exact: true })).toBeVisible();
      await expect(suspendedBadge).toHaveCount(0);
      expect((await fakeAuthAdminCalls(request, user.id)).map((call) => call.ban_duration)).toEqual(['876000h', 'none']);
      expect((await fakeAuthUser(request, user.email))?.banned_until).toBeUndefined();
      expect(await canSignIn(request, user.email, user.password)).toBe(true);
    } finally {
      // Deleting the account takes its fraud flag with it (on delete cascade).
      await deleteThrowawayUser(request, user.id);
    }
  });
});
