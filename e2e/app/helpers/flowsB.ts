import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { KEYS, PORTS, USER } from '../../fakes/config.cjs';
import en from '../../../src/messages/en.json';

/**
 * Shared helpers for the part-2 flow specs (docs, jobs, account, teams).
 *
 * The fake database is shared by every worker and every spec, and so is the
 * fake user. These helpers create rows with a unique marker, read and write
 * the fake through its REST API with the service key (to set up data the UI
 * can't, and to clean up exactly what a test made), and fail a test on page
 * errors or missing/broken translations.
 */

export { expect };
export { USER };

export const FAKE = `http://127.0.0.1:${PORTS.supabase}`;

/** A unique marker for the rows a test creates, e.g. "flowsB-jobs-1730000000000-ab12". */
export function marker(area: string): string {
  return `flowsB-${area}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Messages: the expected text comes from src/messages/en.json, so copy edits
// don't break the specs. A small ICU subset: {name}, plural, select, and rich
// text tags (<n>…</n>), which are dropped.

type Values = Record<string, string | number>;

function lookup(path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], en);
  if (typeof value !== 'string') throw new Error(`No English message at ${path}`);
  return value;
}

/** The text between `open` (the index of a "{") and its matching "}". */
function block(text: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
  }
  throw new Error(`Unbalanced braces in "${text}"`);
}

/** "one {# job} other {# jobs}" → { one: "# job", other: "# jobs" } */
function branches(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf('{', i);
    if (brace === -1) break;
    const key = text.slice(i, brace).trim();
    const { body, end } = block(text, brace);
    out[key] = body;
    i = end + 1;
  }
  return out;
}

function formatIcu(message: string, values: Values, pound?: number): string {
  let out = '';
  for (let i = 0; i < message.length; i += 1) {
    const char = message[i];
    if (char === '#' && pound !== undefined) {
      out += String(pound);
      continue;
    }
    if (char !== '{') {
      out += char;
      continue;
    }
    const { body, end } = block(message, i);
    i = end;
    const [name, kind, ...rest] = body.split(',');
    const key = name.trim();
    if (kind === undefined) {
      out += String(values[key] ?? `{${key}}`);
      continue;
    }
    const options = branches(rest.join(','));
    const value = values[key];
    if (kind.trim() === 'plural') {
      const n = Number(value);
      const chosen = options[`=${n}`] ?? options[new Intl.PluralRules('en').select(n)] ?? options.other;
      out += formatIcu(chosen, values, n);
    } else {
      out += formatIcu(options[String(value)] ?? options.other, values, pound);
    }
  }
  return out;
}

/** An English message, formatted: m('Jobs.movedBody', { title, stage }). */
export function m(path: string, values: Values = {}): string {
  return formatIcu(lookup(path), values).replace(/<\/?[a-zA-Z]+>/g, '');
}

/** A RegExp that matches a message exactly (anchored), for getByRole names. */
export function exact(path: string, values: Values = {}): RegExp {
  return new RegExp(`^${escapeRegExp(m(path, values))}$`);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// The fake's REST API, with the service key (bypasses the per-user filter).

const SERVICE_HEADERS = {
  apikey: KEYS.service,
  authorization: `Bearer ${KEYS.service}`,
  'content-type': 'application/json',
  prefer: 'return=representation',
};

export type Row = Record<string, unknown> & { id?: string };

export async function restGet(request: APIRequestContext, table: string, query = ''): Promise<Row[]> {
  const res = await request.get(`${FAKE}/rest/v1/${table}${query ? `?${query}` : ''}`, { headers: SERVICE_HEADERS });
  expect(res.ok(), `GET ${table}?${query}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Row[];
}

export async function restInsert(request: APIRequestContext, table: string, rows: Row | Row[]): Promise<Row[]> {
  const res = await request.post(`${FAKE}/rest/v1/${table}`, { headers: SERVICE_HEADERS, data: rows });
  expect(res.ok(), `POST ${table}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Row[];
}

export async function restPatch(request: APIRequestContext, table: string, query: string, patch: Row): Promise<Row[]> {
  const res = await request.patch(`${FAKE}/rest/v1/${table}?${query}`, { headers: SERVICE_HEADERS, data: patch });
  expect(res.ok(), `PATCH ${table}?${query}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Row[];
}

/** Deletes rows matching `query`. Always pass a precise filter (an id, or a marker). */
export async function restDelete(request: APIRequestContext, table: string, query: string): Promise<Row[]> {
  if (!query.trim()) throw new Error(`Refusing to delete every row of ${table}`);
  const res = await request.delete(`${FAKE}/rest/v1/${table}?${query}`, { headers: SERVICE_HEADERS });
  expect(res.ok(), `DELETE ${table}?${query}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Row[];
}

/** One row by id, or null. */
export async function restRow(request: APIRequestContext, table: string, id: string): Promise<Row | null> {
  const [row] = await restGet(request, table, `id=eq.${id}`);
  return row ?? null;
}

/** Waits until `check` returns a truthy value (polling the fake), and returns it. */
export async function eventually<T>(check: () => Promise<T | null | undefined | false>, message: string, timeout = 30_000): Promise<T> {
  let last: T | null | undefined | false = null;
  await expect
    .poll(
      async () => {
        last = await check();
        return Boolean(last);
      },
      { message, timeout },
    )
    .toBe(true);
  return last as T;
}

// ---------------------------------------------------------------------------
// The browser: sign in, navigate with first-compile time, watch for errors.

/** The dev server compiles a page on its first visit, which can take a minute. */
export const FIRST_LOAD = 120_000;

/** Signs in as the fake user and lands on `next` (a localized path such as "/en/jobs"). */
export async function signIn(page: Page, next = '/en/dashboard'): Promise<void> {
  await page.goto(`/en/auth?next=${encodeURIComponent(next)}`, { timeout: FIRST_LOAD });
  await page.locator('input[type=email]').fill(USER.email);
  await page.locator('input[type=password]').fill(USER.password);
  await page.locator('input[type=password]').press('Enter');
  const target = new URL(next, 'http://app.invalid');
  await page.waitForURL((url) => url.pathname === target.pathname, { timeout: FIRST_LOAD });
}

/** What the page copied (Windows hands it back with CRLF line ends). */
export async function clipboardText(page: Page): Promise<string> {
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
}

export async function go(page: Page, path: string): Promise<void> {
  await page.goto(path, { timeout: FIRST_LOAD });
}

/** Loads pages once so the dev server has compiled them before the timed steps. */
export async function warmUp(request: APIRequestContext, paths: string[]): Promise<void> {
  for (const path of paths) {
    await request.get(path, { timeout: FIRST_LOAD, maxRedirects: 0 }).catch(() => undefined);
  }
}

/**
 * Every test fails on an uncaught page error or a next-intl MISSING_MESSAGE /
 * FORMATTING_ERROR in the console.
 */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        const text = message.text();
        if (/MISSING_MESSAGE|FORMATTING_ERROR/.test(text)) problems.push(`console ${message.type()}: ${text}`);
      });
      await use();
      expect(problems, 'page errors or broken translations').toEqual([]);
    },
    { auto: true },
  ],
});
