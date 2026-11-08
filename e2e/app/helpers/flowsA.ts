import { expect, type APIRequestContext, type Page } from '@playwright/test';
import en from '../../../src/messages/en.json';
import es from '../../../src/messages/es.json';
import fr from '../../../src/messages/fr.json';
import de from '../../../src/messages/de.json';
import pt from '../../../src/messages/pt.json';
import { KEYS, PORTS, USER } from '../../fakes/config.cjs';

/**
 * Shared helpers for the feature-flow specs (flows-signin, flows-live,
 * flows-prep). They drive the app as the fake user, read the expected copy
 * from the message files, and look at what reached the fakes.
 *
 * The fake database is shared with other specs: everything these tests make
 * carries a unique marker (see `marker`) and only those rows are cleaned up.
 */

export const FAKE = {
  supabase: `http://127.0.0.1:${PORTS.supabase}`,
  deepgram: `http://127.0.0.1:${PORTS.deepgram}`,
  openai: `http://127.0.0.1:${PORTS.openai}`,
};

const MESSAGES = { en, es, fr, de, pt } as const;
export type Locale = keyof typeof MESSAGES;

/** A message by its dotted key, e.g. msg('Auth.title.login'). Fails loudly when the key is missing. */
export function msg(key: string, locale: Locale = 'en'): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], MESSAGES[locale]);
  if (typeof value !== 'string') throw new Error(`No message ${locale}:${key}`);
  return value;
}

/** A message with simple {placeholders} filled in (no plural or select forms). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** Where the `{…}` block that opens at `start` closes. */
function blockEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return text.length - 1;
}

/** Formats an ICU message as English-language next-intl does: {values}, plural (=n, one, other, #) and select. */
function formatIcu(text: string, values: Record<string, string | number>): string {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] !== '{') {
      out += text[i++];
      continue;
    }
    const end = blockEnd(text, i);
    const match = /^\s*(\w+)\s*(?:,\s*(plural|select)\s*,([\s\S]*))?$/.exec(text.slice(i + 1, end));
    if (!match) out += text.slice(i, end + 1);
    else if (!match[2]) out += match[1] in values ? String(values[match[1]]) : `{${match[1]}}`;
    else {
      const options = new Map<string, string>();
      const body = match[3];
      for (let j = 0; j < body.length; ) {
        const key = /\s*(=?\w+)\s*\{/y;
        key.lastIndex = j;
        const found = key.exec(body);
        if (!found) break;
        const close = blockEnd(body, key.lastIndex - 1);
        options.set(found[1], body.slice(key.lastIndex, close));
        j = close + 1;
      }
      const value = values[match[1]];
      const chosen =
        match[2] === 'plural'
          ? (options.get(`=${Number(value)}`) ?? (Number(value) === 1 ? options.get('one') : undefined) ?? options.get('other') ?? '').replace(/#/g, String(value))
          : (options.get(String(value)) ?? options.get('other') ?? '');
      out += formatIcu(chosen, values);
    }
    i = end + 1;
  }
  return out;
}

/** A message formatted with its values, plurals and selects included, e.g. format('LiveFeeds.lines', { count: 3 }) → "3 lines". */
export function format(key: string, values: Record<string, string | number> = {}, locale: Locale = 'en'): string {
  return formatIcu(msg(key, locale), values);
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The accessible name of a form field with this visible label, for
 * getByRole('textbox' | 'combobox', { name: field(label) }). Role-based,
 * because a <label> that wraps its control also holds the control's text (a
 * select's options, a textarea's first value), which getByLabel's exact match
 * trips over. A label that also holds a line of help matches from its start.
 */
export function field(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label)}(?:$|\\s)`);
}

/** A name nobody else's data has: flowA-<what>-<time>-<random>. */
export function marker(what: string): string {
  return `flowA-${what}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Collects uncaught page errors and next-intl's MISSING_MESSAGE /
 * FORMATTING_ERROR console messages; `expectClean()` fails the test if any.
 */
export function watchPage(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (/MISSING_MESSAGE|FORMATTING_ERROR/.test(text)) problems.push(`console.${message.type()}: ${text.slice(0, 300)}`);
  });
  return {
    problems,
    expectClean() {
      expect(problems, 'page errors and message errors').toEqual([]);
    },
  };
}

/**
 * The dev server's Next.js badge sits in the bottom-left corner, on top of
 * the phone layouts' bottom bars (it isn't there in production): hide it so
 * taps reach the app.
 */
export async function hideNextDevBadge(page: Page) {
  await page.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener('DOMContentLoaded', hide, { once: true });
  });
}

/** The first visit to a page compiles it, which can take a while on the dev server. */
export const FIRST_LOAD = { timeout: 90_000 };

/** Signs in on the sign-in page with the form, as a user would, and waits to land on `expectPath`. */
export async function signIn(page: Page, options: { locale?: Locale; next?: string; expectPath?: RegExp } = {}) {
  const locale = options.locale ?? 'en';
  const query = options.next ? `?next=${encodeURIComponent(options.next)}` : '';
  await page.goto(`/${locale}/auth${query}`, FIRST_LOAD);
  const form = page.getByRole('form', { name: msg('Auth.title.login', locale) });
  await form.getByLabel(msg('Auth.email', locale)).fill(USER.email);
  await form.getByLabel(msg('Auth.password', locale), { exact: true }).fill(USER.password);
  await form.getByRole('button', { name: msg('Auth.submit.login', locale) }).click();
  await page.waitForURL(options.expectPath ?? new RegExp(`/${locale}/dashboard$`), FIRST_LOAD);
}

type Row = Record<string, unknown> & { id: string };
export type FakeTables = Record<string, Row[]>;
export type FakeState = {
  tables: FakeTables;
  rpcCalls: Array<{ fn: string; body: unknown }>;
  recoverRequests: Array<{ email: string; redirectTo: string | null }>;
  oauthRequests: Array<{ provider: string | null; redirectTo: string | null; pkce: boolean }>;
};

/** Everything in the fake database (only read it: other specs share it). */
export async function fakeState(request: APIRequestContext): Promise<FakeState> {
  const res = await request.get(`${FAKE.supabase}/__state`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as FakeState;
}

/** Rows of one table that match a test, e.g. rows(request, 'goals', (g) => g.name === name). */
export async function rows(request: APIRequestContext, table: string, match: (row: Row) => boolean = () => true): Promise<Row[]> {
  const { tables } = await fakeState(request);
  return (tables[table] ?? []).filter(match);
}

const SERVICE = { apikey: KEYS.service, authorization: `Bearer ${KEYS.service}` };

/** Adds a row as the fake user (test set-up the app has no screen for). */
export async function insertRow(request: APIRequestContext, table: string, row: Record<string, unknown>): Promise<Row> {
  const res = await request.post(`${FAKE.supabase}/rest/v1/${table}`, {
    headers: { ...SERVICE, 'content-type': 'application/json', prefer: 'return=representation' },
    data: { user_id: USER.id, ...row },
  });
  expect(res.status(), `insert into ${table}`).toBe(201);
  const body = (await res.json()) as Row[];
  return body[0];
}

/** Deletes rows this test made, by id (never anything else). */
export async function deleteRows(request: APIRequestContext, table: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  await request.delete(`${FAKE.supabase}/rest/v1/${table}?id=in.(${unique.join(',')})`, { headers: SERVICE });
}

/** Deletes the rows of `table` whose `column` is one of `values` (ids of things this test made). */
export async function deleteWhere(request: APIRequestContext, table: string, column: string, values: string[]): Promise<void> {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return;
  await request.delete(`${FAKE.supabase}/rest/v1/${table}?${column}=in.(${unique.join(',')})`, { headers: SERVICE });
}

/** A live session this test made, with its events and summaries. */
export async function deleteCopilotSessions(request: APIRequestContext, ids: string[]): Promise<void> {
  await deleteWhere(request, 'copilot_events', 'session_id', ids);
  await deleteWhere(request, 'copilot_summaries', 'session_id', ids);
  await deleteRows(request, 'copilot_sessions', ids);
}

type OpenAIRequest = { model: string; stream: boolean; messages: Array<{ role: string; content: unknown }> };

/** The fake model's requests whose messages mention `text` (other specs' requests are in there too). */
export async function modelRequestsMentioning(request: APIRequestContext, text: string): Promise<OpenAIRequest[]> {
  const res = await request.get(`${FAKE.openai}/__state`);
  const { requests } = (await res.json()) as { requests: OpenAIRequest[] };
  return requests.filter((call) => JSON.stringify(call.messages).includes(text));
}

export { USER };
