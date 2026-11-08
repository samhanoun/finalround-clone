import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { KEYS, PORTS, THROWAWAY_PASSWORD } from '../../fakes/config.cjs';

/**
 * Throwaway accounts for the flows that change or delete an account (sign-up,
 * onboarding, a new password, account deletion, joining a team as someone
 * new). Every other spec signs in as the shared USER, which must never change;
 * these make their own account through the fake's sign-up, as the app's form
 * would, and delete it afterwards with the admin API (its rows go with it).
 */

const FAKE = `http://127.0.0.1:${PORTS.supabase}`;
const SERVICE = { apikey: KEYS.service, authorization: `Bearer ${KEYS.service}` };
const ANON = { apikey: KEYS.anon, 'content-type': 'application/json' };

export type Throwaway = { id: string; email: string; password: string };

/** A unique address for an account a test makes: throwaway-<label>-<time>-<random>@example.test. */
export function throwawayEmail(label: string): string {
  return `throwaway-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.test`.toLowerCase();
}

/**
 * Signs up a new account through the fake (email confirmation is off there, so
 * it can sign in at once). `onboarded` marks onboarding as done, so the app
 * opens Home rather than the onboarding steps.
 */
export async function createThrowawayUser(
  request: APIRequestContext,
  label: string,
  options: { onboarded?: boolean; fullName?: string } = {},
): Promise<Throwaway> {
  const email = throwawayEmail(label);
  const res = await request.post(`${FAKE}/auth/v1/signup`, {
    headers: ANON,
    data: { email, password: THROWAWAY_PASSWORD, data: options.fullName ? { full_name: options.fullName } : {} },
  });
  expect(res.status(), `sign-up of ${email}`).toBe(200);
  const { user } = (await res.json()) as { user: { id: string } };
  if (options.onboarded) {
    const done = await request.patch(`${FAKE}/rest/v1/profiles?id=eq.${user.id}`, {
      headers: { ...SERVICE, 'content-type': 'application/json' },
      data: { onboarding_completed: true, ...(options.fullName ? { full_name: options.fullName } : {}) },
    });
    expect(done.ok(), 'onboarding marked done').toBe(true);
  }
  return { id: user.id, email, password: THROWAWAY_PASSWORD };
}

/** Deletes a throwaway account (and, by the foreign keys, its rows). Already gone is fine. */
export async function deleteThrowawayUser(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`${FAKE}/auth/v1/admin/users/${id}`, { headers: SERVICE });
  expect([200, 404], `delete account ${id}`).toContain(res.status());
}

export type FakeAuthUser = { id: string; email: string; email_confirmed_at: string | null; banned_until?: string };

/** The fake's auth users (without passwords). */
export async function fakeAuthUsers(request: APIRequestContext): Promise<FakeAuthUser[]> {
  const res = await request.get(`${FAKE}/__state`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { users: FakeAuthUser[] }).users;
}

/** The auth user with this address, if there is one. */
export async function fakeAuthUser(request: APIRequestContext, email: string): Promise<FakeAuthUser | undefined> {
  return (await fakeAuthUsers(request)).find((user) => user.email === email.toLowerCase());
}

export type AuthAdminCall = { method: 'POST' | 'PUT' | 'DELETE'; userId: string; ban_duration?: string; banned_until?: string | null };

/** What the app asked of the auth admin API (bans and other changes to a user), oldest first. */
export async function fakeAuthAdminCalls(request: APIRequestContext, userId: string): Promise<AuthAdminCall[]> {
  const res = await request.get(`${FAKE}/__state`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { authAdminCalls: AuthAdminCall[] }).authAdminCalls.filter((call) => call.userId === userId);
}

/** Whether these credentials sign in, asked of the fake's token endpoint directly. */
export async function canSignIn(request: APIRequestContext, email: string, password: string): Promise<boolean> {
  const res = await request.post(`${FAKE}/auth/v1/token?grant_type=password`, { headers: ANON, data: { email, password } });
  return res.ok();
}

export type StoredObject = { bucket: string; name: string; size: number; contentType: string; sha256: string };

/** What the fake's Storage holds (names and checksums, not the bytes). */
export async function fakeStorage(request: APIRequestContext): Promise<StoredObject[]> {
  const res = await request.get(`${FAKE}/__state`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { storage: StoredObject[] }).storage;
}

/**
 * Signs in through the sign-in form as `user` and waits for `next`'s page (a
 * localized path such as "/en/settings"; Home by default).
 */
export async function signInAs(page: Page, user: Pick<Throwaway, 'email' | 'password'>, next = '/en/dashboard'): Promise<void> {
  await page.goto(`/en/auth?next=${encodeURIComponent(next)}`, { timeout: 120_000 });
  await page.locator('input[type=email]').fill(user.email);
  await page.locator('input[type=password]').fill(user.password);
  await page.locator('input[type=password]').press('Enter');
  const target = new URL(next, 'http://app.invalid');
  await page.waitForURL((url) => url.pathname === target.pathname, { timeout: 120_000 });
}

export { THROWAWAY_PASSWORD };
