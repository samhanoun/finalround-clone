/**
 * The machinery behind e2e/app/crawl.spec.ts: a click-through of every page
 * and every control, against the local fakes (e2e/fakes).
 *
 * - Sweeps: load a page in a fresh browser context and record what goes wrong
 *   (page errors, console errors, missing translations, bad HTTP statuses,
 *   horizontal scroll at 360px).
 * - Controls: enumerate the visible controls of a page, then activate each one
 *   from a fresh load and record what it did, or that it did nothing. Then the
 *   same for the controls a click opened (a sheet, a menu, a form), each from a
 *   fresh load after re-opening it.
 *
 * Nothing here stops at the first problem: every test collects a report,
 * attaches it, and writes it under the project's output folder, so the last
 * test of the spec can print one summary of the whole run.
 *
 * The fake database is shared with every other spec (one fake user), so the
 * crawler:
 * - never clicks destructive or session-ending controls (SKIP_NAME);
 * - never clicks controls on data it didn't create: it reads the fake's
 *   /__state before every click to know what other specs' data looks like, and
 *   only checks the links on it over HTTP (a click handler can write, as
 *   opening a notification marks it read);
 * - only follows what a click opened, not new items that appear in a list;
 * - puts every toggle, radio and select it changed back the way it was;
 * - deletes the rows its own clicks created (only rows whose ids came back in
 *   responses to its own writes, created while those were in flight);
 * - seeds its own items, named with MARKER, so item-level controls get clicked.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  test as base,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';
import { KEYS, PORTS, RESUME, USER } from '../../fakes/config.cjs';

// ---------------------------------------------------------------------------
// What to crawl

export const LOCALES = ['en', 'es', 'fr', 'de', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

/** Every row the crawler creates has this in its name. */
export const MARKER = 'crawl-';

export type RouteSpec = {
  /** Path without the locale, e.g. "/goals?tab=memory". */
  path: string;
  /** Document status the page is meant to answer with (default 200). */
  status?: number;
  /** Where the page is meant to end up, when it redirects by design. */
  finalPath?: string;
  /** Uses the app frame (sidebar on desktop, tab bar on phones). */
  shell?: boolean;
};

const NO_SUCH_PAGE = '/crawl-no-such-page';
/** An interview id that doesn't exist: the page calls notFound() ([locale]/not-found.tsx). */
const NO_SUCH_INTERVIEW = '/interview/00000000-0000-4000-8000-00000000c0de';

export const SIGNED_IN_ROUTES: RouteSpec[] = [
  { path: '/' },
  { path: '/dashboard', shell: true },
  { path: '/copilot/live', shell: true },
  { path: '/goals', shell: true },
  { path: '/goals?tab=materials', shell: true },
  { path: '/goals?tab=playbooks', shell: true },
  { path: '/goals?tab=memory', shell: true },
  { path: '/interview', shell: true },
  { path: '/interview/bank', shell: true },
  { path: '/resume', shell: true },
  { path: '/cover-letters', shell: true },
  { path: '/jobs', shell: true },
  { path: '/analytics', shell: true },
  { path: '/analytics/funnel', shell: true },
  { path: '/analytics/weekly', shell: true },
  { path: '/analytics/reports', shell: true },
  { path: '/settings', shell: true },
  { path: '/support', shell: true },
  { path: '/teams', shell: true },
  // The fake user finished onboarding, so the flow sends them home.
  { path: '/onboarding', finalPath: '/dashboard', shell: true },
  // Admin is a 404 for anyone who isn't staff, by design.
  { path: '/admin', status: 404 },
  { path: NO_SUCH_PAGE, status: 404 },
  { path: NO_SUCH_INTERVIEW, status: 404 },
];

export const SIGNED_OUT_ROUTES: RouteSpec[] = [
  { path: '/' },
  { path: '/auth' },
  { path: NO_SUCH_PAGE, status: 404 },
  { path: '/admin', status: 404 },
];

/** Pages whose controls get clicked (English, signed in). */
export const CONTROL_ROUTES = SIGNED_IN_ROUTES.filter((route) => !route.status && !route.finalPath);

/** At most this many controls are activated per page, in document order. */
export const CONTROL_CAP = 80;
/** And at most this many of the controls those clicks reveal (sheets, menus, forms), per page and per opener. */
export const CHILD_CAP = 60;
export const CHILD_CAP_PER_PARENT = 25;

/**
 * Controls the crawler never activates, by accessible name: destructive or
 * session-ending ones, and ones that end or take over the shared user's live
 * session (starting a session ends any session left open, which would break
 * a live-copilot spec running at the same time).
 */
export const SKIP_NAME: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\b(delete|remove|archive|erase|purge|wipe|discard)\b/i, why: 'destructive' },
  { pattern: /\b(forget|revoke|reset|unsubscribe|deactivate|disconnect)\b/i, why: 'destructive' },
  { pattern: /\bcancel\b.*\b(invitation|subscription)\b/i, why: 'destructive' },
  { pattern: /\bclear (all|history|everything|notifications)\b/i, why: 'destructive' },
  { pattern: /\bmark (all )?(as )?(read|unread|done)\b/i, why: "changes the shared user's notifications" },
  { pattern: /\b(sign|log) ?out\b/i, why: 'ends the session' },
  { pattern: /\bleave\b/i, why: 'leaves a team' },
  { pattern: /\bturn off\b/i, why: 'turns a feature off for the shared user' },
  { pattern: /\bstop (session|listening|sharing)\b|\bend (now|interview|session|call)\b/i, why: 'ends a live session' },
  { pattern: /^start session$/i, why: 'starts a live session, which ends any open session of the shared fake user' },
];

// ---------------------------------------------------------------------------
// Problems and the allowlist

export type ProblemKind =
  | 'page-error'
  | 'console-error'
  | 'i18n'
  | 'document-status'
  | 'redirect'
  | 'navigation'
  | 'http-5xx'
  | 'http-4xx'
  | 'request-failed'
  | 'h-scroll'
  | 'link-404'
  | 'external-link'
  | 'anchor'
  | 'dead'
  | 'unclickable'
  | 'reverts'
  | 'escape'
  | 'no-name'
  | 'restore'
  | 'tab-bar'
  | 'more-sheet'
  | 'main-action';

export type Problem = {
  /** "<locale> <path>", plus the viewport when it matters. */
  where: string;
  /** Accessible name of the control, when a control caused it. */
  control?: string;
  kind: ProblemKind;
  detail: string;
};

type AllowEntry = {
  kind: ProblemKind;
  where?: RegExp;
  control?: RegExp;
  detail?: RegExp;
  /** Why this is tolerated: by design, a gap in the fakes, or a known bug (with its cause). */
  why: string;
};

/**
 * Problems that are expected. Each entry says why; known bugs say where the
 * cause is, so the entry can go once it's fixed. The summary lists every hit,
 * and entries that matched nothing in a full run.
 * CRAWL_STRICT=1 ignores the allowlist.
 */
export const ALLOWLIST: AllowEntry[] = [
  {
    // By design: POST /api/billing/portal answers 503 billing_unavailable without
    // Stripe keys (src/app/api/billing/portal/route.ts:36), and the fakes have no Stripe.
    kind: 'http-5xx',
    detail: /^POST \/api\/billing\/portal → 503$/,
    why: 'Stripe is not configured in the fakes (the route answers 503 billing_unavailable by design)',
  },
  {
    // Fake gap: the seeded résumé (e2e/fakes/config.cjs RESUME) has no storage_path, so
    // GET /api/resume/[id]/download answers 404 (src/app/api/resume/[id]/download/route.ts:29-31);
    // the fake Supabase has no storage API to sign a URL either. Uploaded résumés always have a path.
    kind: 'http-4xx',
    control: /^Download e2e-resume\.pdf$/,
    detail: /^GET \/api\/resume\/0e2e0000-0000-4000-8000-0000000000aa\/download → 404$/,
    why: 'the seeded résumé has no stored file and the fake has no storage API',
  },
];

const STRICT = process.env.CRAWL_STRICT === '1';

export function allowedBy(problem: Problem): AllowEntry | undefined {
  if (STRICT) return undefined;
  return ALLOWLIST.find(
    (entry) =>
      entry.kind === problem.kind &&
      (!entry.where || entry.where.test(problem.where)) &&
      (!entry.control || entry.control.test(problem.control ?? '')) &&
      (!entry.detail || entry.detail.test(problem.detail)),
  );
}

export const describeProblem = (p: Problem) =>
  `[${p.kind}] ${p.where}${p.control !== undefined ? ` › "${p.control}"` : ''}: ${p.detail}`;

type Skip = { where: string; control: string; why: string };

type ReportFile = {
  title: string;
  project: string;
  problems: Problem[];
  skipped: Skip[];
  notes: string[];
  stats: Record<string, number>;
};

/** What one test found. `finish()` attaches it and saves it for the summary. */
export class CrawlReport {
  readonly problems: Problem[] = [];
  readonly skipped: Skip[] = [];
  readonly notes: string[] = [];
  readonly stats: Record<string, number> = {};
  private readonly seen = new Set<string>();

  add(problem: Problem) {
    const key = describeProblem(problem);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.problems.push(problem);
  }

  skip(where: string, control: string, why: string) {
    this.skipped.push({ where, control, why });
  }

  note(text: string) {
    if (!this.notes.includes(text)) this.notes.push(text);
  }

  count(stat: string, by = 1) {
    this.stats[stat] = (this.stats[stat] ?? 0) + by;
  }

  failures() {
    return this.problems.filter((p) => !allowedBy(p));
  }

  format(): string {
    return formatSummary([{ title: '', project: '', problems: this.problems, skipped: this.skipped, notes: this.notes, stats: this.stats }]);
  }

  /**
   * Attaches the report and saves it for the final summary. The test itself
   * passes: the summary test at the end of the spec fails with every problem
   * of the run in one list (so one broken page doesn't hide the others, and
   * CI doesn't retry a 10-minute crawl for one bad button).
   */
  async finish(testInfo: TestInfo) {
    const file: ReportFile = {
      title: testInfo.titlePath.slice(1).join(' › '),
      project: testInfo.project.name,
      problems: this.problems,
      skipped: this.skipped,
      notes: this.notes,
      stats: this.stats,
    };
    const dir = resultsDir(testInfo);
    fs.mkdirSync(dir, { recursive: true });
    const slug = file.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 120);
    fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(file, null, 2));
    await testInfo.attach('crawl-report.txt', { body: this.format(), contentType: 'text/plain' });
    const failures = this.failures();
    if (failures.length) {
      testInfo.annotations.push({ type: 'crawl problems', description: `${failures.length}: ${failures.slice(0, 5).map(describeProblem).join(' | ')}` });
    }
  }
}

const resultsDir = (testInfo: TestInfo) => path.join(testInfo.project.outputDir, 'crawl-results', testInfo.project.name);

/** Every report saved by this run in this project (the output folder is emptied at the start of a run). */
export function readReports(testInfo: TestInfo): ReportFile[] {
  const dir = resultsDir(testInfo);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ReportFile);
}

export function formatSummary(reports: ReportFile[], { full = false } = {}): string {
  const problems = reports.flatMap((r) => r.problems);
  const failures = problems.filter((p) => !allowedBy(p));
  const allowed = problems.filter((p) => allowedBy(p));
  const skipped = reports.flatMap((r) => r.skipped);
  const notes = [...new Set(reports.flatMap((r) => r.notes))];
  const stats: Record<string, number> = {};
  for (const report of reports) for (const [k, v] of Object.entries(report.stats)) stats[k] = (stats[k] ?? 0) + v;

  const lines: string[] = [];
  if (Object.keys(stats).length) lines.push(Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(' · '));
  lines.push(failures.length ? `FAILURES (${failures.length}):` : 'No failures.');
  const byKind = [...failures].sort((a, b) => a.kind.localeCompare(b.kind) || a.where.localeCompare(b.where));
  for (const p of byKind) lines.push(`  ${describeProblem(p)}`);
  if (allowed.length) {
    lines.push(`ALLOWLISTED (${allowed.length}):`);
    for (const p of allowed) lines.push(`  ${describeProblem(p)} (${allowedBy(p)?.why})`);
  }
  if (full) {
    const stale = ALLOWLIST.filter((entry) => !problems.some((p) => entryMatches(entry, p)));
    if (stale.length) {
      lines.push(`ALLOWLIST ENTRIES THAT MATCHED NOTHING (${stale.length}; remove them once fixed):`);
      for (const entry of stale) lines.push(`  [${entry.kind}] ${entry.why}`);
    }
  }
  if (skipped.length) {
    lines.push(`SKIPPED CONTROLS (${skipped.length}):`);
    const grouped = new Map<string, string[]>();
    for (const s of skipped) {
      const key = `${s.why}`;
      grouped.set(key, [...(grouped.get(key) ?? []), `${s.where} › "${s.control}"`]);
    }
    for (const [why, items] of grouped) {
      lines.push(`  ${why} (${items.length}):`);
      for (const item of [...new Set(items)]) lines.push(`    ${item}`);
    }
  }
  if (notes.length) {
    lines.push(`NOTES (${notes.length}):`);
    for (const n of notes) lines.push(`  ${n}`);
  }
  return lines.join('\n');
}

function entryMatches(entry: AllowEntry, p: Problem) {
  return (
    entry.kind === p.kind &&
    (!entry.where || entry.where.test(p.where)) &&
    (!entry.control || entry.control.test(p.control ?? '')) &&
    (!entry.detail || entry.detail.test(p.detail))
  );
}

// ---------------------------------------------------------------------------
// Messages (to recognise raw message keys and check each page's language)

type Messages = Record<string, unknown>;
const MESSAGES_DIR = path.resolve(__dirname, '../../../src/messages');
const messagesCache = new Map<string, Messages>();
export function messages(locale: string): Messages {
  if (!messagesCache.has(locale)) {
    messagesCache.set(locale, JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Messages);
  }
  return messagesCache.get(locale) as Messages;
}

export function message(locale: string, key: string): string {
  let node: unknown = messages(locale);
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== 'string') throw new Error(`No message ${key} in ${locale}`);
  return node;
}

const NAMESPACES = Object.keys(messages('en'));

/** Every English UI string: data named like one of these isn't treated as someone else's data. */
const UI_STRINGS = new Set<string>();
(function collect(node: unknown) {
  if (typeof node === 'string') UI_STRINGS.add(node.trim());
  else if (node && typeof node === 'object') Object.values(node).forEach(collect);
})(messages('en'));

// ---------------------------------------------------------------------------
// The fake services

const FAKE_SUPABASE = `http://127.0.0.1:${PORTS.supabase}`;
const SERVICE_HEADERS = { apikey: KEYS.service, authorization: `Bearer ${KEYS.service}` };

type Row = Record<string, unknown> & { id?: string };
type FakeState = { tables: Record<string, Row[]> };

export async function fakeState(request: APIRequestContext): Promise<FakeState> {
  const response = await request.get(`${FAKE_SUPABASE}/__state`);
  expect(response.ok(), 'the fake Supabase answers /__state').toBe(true);
  return (await response.json()) as FakeState;
}

/** Tables that hold settings, not items shown in lists. */
const SETTINGS_TABLES = new Set(['profiles', 'user_settings', 'llm_settings', 'notification_preferences', 'video_conferencing_settings', 'referral_codes']);
const NAME_FIELDS = ['name', 'title', 'company', 'filename', 'source_filename', 'subject', 'email', 'question_text', 'content', 'instructions'];

/**
 * Strings that identify rows the crawler didn't create (other specs' data and
 * the seeded résumé). A list item containing one of them is someone else's.
 */
export function foreignStrings(state: FakeState): string[] {
  const out = new Set<string>();
  for (const [table, rows] of Object.entries(state.tables)) {
    if (SETTINGS_TABLES.has(table)) continue;
    for (const row of rows) {
      const values = NAME_FIELDS.map((field) => row[field]).filter((v): v is string => typeof v === 'string');
      if (values.some((v) => v.includes(MARKER))) continue;
      for (const value of values) {
        const text = value.replace(/\s+/g, ' ').trim();
        if (text.length >= 6 && !UI_STRINGS.has(text)) out.add(text.slice(0, 80));
      }
    }
  }
  return [...out];
}

/** The crawler's own items, so item-level controls (edit, menus, stage pickers) get clicked. */
const SEEDS: Array<{ table: string; match: Record<string, string>; row: Row }> = [
  {
    table: 'goals',
    match: { name: `${MARKER}goal` },
    row: { name: `${MARKER}goal`, company: `${MARKER}company`, role: 'Staff Engineer', round: 'behavioral', resume_document_id: RESUME.id, job_description: null, job_application_id: null, playbook_id: null, notes: null, archived: false },
  },
  {
    table: 'materials',
    match: { title: `${MARKER}material` },
    row: { title: `${MARKER}material`, kind: 'project', content: `${MARKER}material: led the payments migration.`, source_filename: null },
  },
  {
    table: 'playbooks',
    match: { name: `${MARKER}playbook` },
    row: { name: `${MARKER}playbook`, instructions: `${MARKER}playbook: answer in two sentences.` },
  },
  {
    table: 'memories',
    match: { content: `${MARKER}memory: prefers short answers` },
    row: { content: `${MARKER}memory: prefers short answers`, source: 'manual', goal_id: null },
  },
  {
    table: 'job_applications',
    match: { title: `${MARKER}job` },
    row: { company: `${MARKER}company`, title: `${MARKER}job`, stage: 'saved', status: 'active', notes: null, job_url: null, applied_at: null, interview_at: null, next_followup_at: null },
  },
];

/**
 * Creates the crawler's items, or puts them back to how they started (a click
 * may have moved the job to another stage), so every run sees the same page.
 */
export async function ensureSeeds(request: APIRequestContext) {
  for (const seed of SEEDS) {
    const query = Object.entries({ ...seed.match, user_id: USER.id })
      .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
      .join('&');
    const existing = await request.get(`${FAKE_SUPABASE}/rest/v1/${seed.table}?${query}`, { headers: SERVICE_HEADERS });
    const rows = (await existing.json()) as Row[];
    if (rows.length) {
      for (const row of rows) {
        await request.patch(`${FAKE_SUPABASE}/rest/v1/${seed.table}?id=eq.${row.id}&user_id=eq.${USER.id}`, { headers: SERVICE_HEADERS, data: seed.row });
      }
      continue;
    }
    const created = await request.post(`${FAKE_SUPABASE}/rest/v1/${seed.table}`, {
      headers: { ...SERVICE_HEADERS, prefer: 'return=representation' },
      data: { ...seed.row, user_id: USER.id },
    });
    expect(created.ok(), `seeding ${seed.table}`).toBe(true);
  }
}

/**
 * Rows created by the crawler's own clicks, deleted at the end of the test.
 * A row qualifies only if it didn't exist when the test started, its id came
 * back in the response to one of the crawler's own writes, and it was created
 * while that request was in flight. So rows other specs create at the same
 * time are never touched.
 */
export class CreatedRows {
  private readonly writes: Array<{ ids: Set<string>; from: number; to: number }> = [];
  /** The crawler's own inserts straight to the fake (supabase-js .insert() without .select() returns no ids). */
  private readonly inserts: Array<{ table: string; rows: Row[]; from: number; to: number }> = [];
  private readonly pending: Promise<unknown>[] = [];
  private before = new Set<string>();

  async start(request: APIRequestContext) {
    const state = await fakeState(request);
    this.before = new Set(Object.entries(state.tables).flatMap(([table, rows]) => rows.map((row) => `${table}:${row.id}`)));
  }

  watch(page: Page, appOrigin: string) {
    const started = new Map<Request, number>();
    page.on('request', (request) => started.set(request, Date.now()));
    page.on('response', (response) => {
      const request = response.request();
      const method = request.method();
      if (method === 'GET' || method === 'HEAD' || response.status() >= 400) return;
      const url = response.url();
      if (!(url.startsWith(`${appOrigin}/api/`) || url.startsWith(`${FAKE_SUPABASE}/rest/`))) return;
      const from = started.get(request) ?? Date.now();
      const rest = url.startsWith(`${FAKE_SUPABASE}/rest/v1/`) && method === 'POST' ? new URL(url).pathname.split('/')[3] : null;
      if (rest && rest !== 'rpc') {
        try {
          const body = JSON.parse(request.postData() ?? 'null') as Row | Row[] | null;
          const rows = (Array.isArray(body) ? body : body ? [body] : []).filter((row) => row && typeof row === 'object');
          if (rows.length) this.inserts.push({ table: rest, rows, from, to: Date.now() });
        } catch {
          // Not JSON: nothing to match.
        }
      }
      this.pending.push(
        response
          .text()
          .then((body) => {
            const ids = new Set((body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map((id) => id.toLowerCase()));
            if (ids.size) this.writes.push({ ids, from, to: Date.now() });
          })
          .catch(() => undefined),
      );
    });
  }

  /** Waits (up to 5 s) for response bodies still being read: call before closing a page. */
  async flush() {
    const pending = this.pending.splice(0);
    await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }

  async cleanUp(request: APIRequestContext): Promise<string[]> {
    await this.flush();
    const state = await fakeState(request);
    const deleted: string[] = [];
    for (const [table, rows] of Object.entries(state.tables)) {
      for (const row of rows) {
        const id = String(row.id ?? '').toLowerCase();
        if (!id || this.before.has(`${table}:${row.id}`)) continue;
        if ('user_id' in row && row.user_id !== USER.id) continue;
        const created = Date.parse(String(row.created_at ?? ''));
        // 1 s of slack: the fake and the test runner read the same clock, but not at the same instant.
        const inWindow = (w: { from: number; to: number }) => created >= w.from - 1_000 && created <= w.to + 1_000;
        // Every field the crawler's insert sent, with the same value.
        const sameRow = (sent: Row) => Object.entries(sent).every(([key, value]) => JSON.stringify(row[key]) === JSON.stringify(value));
        const mine =
          this.writes.some((w) => w.ids.has(id) && inWindow(w)) ||
          this.inserts.some((w) => w.table === table && inWindow(w) && w.rows.some(sameRow));
        if (!mine) continue;
        const response = await request.delete(`${FAKE_SUPABASE}/rest/v1/${table}?id=eq.${row.id}`, { headers: SERVICE_HEADERS });
        if (response.ok()) deleted.push(table);
      }
    }
    return deleted;
  }
}

// ---------------------------------------------------------------------------
// Fixtures: sign in once per worker; contexts built from the project's options

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- no test-scoped fixtures
export const test = base.extend<{}, { authState: StorageState }>({
  authState: [
    async ({ browser }, use, workerInfo) => {
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL, serviceWorkers: 'block' });
      const page = await context.newPage();
      await signIn(page);
      const state = await context.storageState();
      await context.close();
      await use(state);
    },
    { scope: 'worker', timeout: 300_000 },
  ],
});
export { expect };

/** Signs in through the form, like a person (waits for hydration so Enter doesn't submit a plain HTML form). */
export async function signIn(page: Page) {
  await page.goto('/en/auth', { timeout: 240_000 });
  const email = page.locator('input[type=email]');
  await waitForHydrated(page, 'input[type=email]');
  await email.fill(USER.email);
  await page.locator('input[type=password]').fill(USER.password);
  await page.locator('input[type=password]').press('Enter');
  await page.waitForURL('**/en/dashboard', { timeout: 120_000 });
}

/**
 * A fresh context with the project's device settings. Service workers are
 * blocked: public/sw.js would otherwise serve the second load of a page in a
 * context, which makes fresh loads depend on what ran before (its behaviour
 * isn't what this crawl checks).
 */
export async function newContext(
  browser: Browser,
  testInfo: TestInfo,
  options: { signedIn: StorageState | null; viewport?: { width: number; height: number } },
): Promise<BrowserContext> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: options.viewport ?? use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    permissions: use.permissions,
    storageState: options.signedIn ?? undefined,
    serviceWorkers: 'block',
  });
  // Contexts made by hand don't get the runner's timeouts: without these, waiting on a control that
  // a click removed (a menu that closes) would wait forever.
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(90_000);
  return context;
}

/** Page setup that every crawled page gets before any of its scripts run. */
const INSTRUMENT = () => {
  type CrawlState = { mutations: number; lastMutation: number; clipboard: number; opened: string[]; navigations: string[]; prints: number; shares: number };
  const w = window as unknown as { __crawl?: CrawlState };
  if (w.__crawl) return;
  const state: CrawlState = { mutations: 0, lastMutation: 0, clipboard: 0, opened: [], navigations: [], prints: 0, shares: 0 };
  Object.defineProperty(window, '__crawl', { value: state, enumerable: false });
  new MutationObserver((list) => {
    let counted = 0;
    for (const record of list) {
      if (record.type === 'attributes' && record.attributeName?.startsWith('data-crawl')) continue;
      counted += 1;
    }
    if (counted) {
      state.mutations += counted;
      state.lastMutation = performance.now();
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const clipboard = navigator.clipboard as (Clipboard & Record<string, unknown>) | undefined;
  if (clipboard) {
    for (const method of ['writeText', 'write'] as const) {
      const original = clipboard[method]?.bind(clipboard) as ((...args: unknown[]) => Promise<void>) | undefined;
      if (original) (clipboard as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        state.clipboard += 1;
        return original(...args);
      };
    }
  }
  const open = window.open.bind(window);
  window.open = (...args: Parameters<typeof window.open>) => {
    state.opened.push(String(args[0] ?? ''));
    return open(...args);
  };
  // Next's dev indicator and error overlay (<nextjs-portal>) sit over the bottom-left corner, where
  // the phone tab bar's first tab is, and take its clicks. They're dev tooling, not the app (errors
  // are still caught from the console and page events), so the crawler hides them.
  const hideDevOverlay = () => {
    if (!document.head) return false;
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal { display: none !important; }';
    document.head.appendChild(style);
    return true;
  };
  if (!hideDevOverlay()) document.addEventListener('DOMContentLoaded', hideDevOverlay, { once: true });
  // Printing would block a headless page; sharing has no sheet to show.
  window.print = () => {
    state.prints += 1;
  };
  if ('share' in navigator) {
    (navigator as unknown as Record<string, unknown>).share = async () => {
      state.shares += 1;
    };
  }
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener('navigate', (event) => {
    const url = (event as unknown as { destination?: { url?: string } }).destination?.url;
    if (url) state.navigations.push(url);
  });
};

// ---------------------------------------------------------------------------
// Watching a page

/**
 * Console errors that are noise, not app problems:
 * - the favicon request (the browser asks for it on its own);
 * - service-worker registration: the crawler blocks service workers on purpose
 *   (see newContext), so registering /sw.js fails;
 * - "Failed to load resource" lines: the browser logs one for every 4xx/5xx
 *   response; the HTTP checks below report those once, with the URL, and judge
 *   whether the status is wrong.
 */
function ignoredConsole(message: ConsoleMessage): boolean {
  const text = message.text();
  const url = message.location()?.url ?? '';
  if (/favicon/i.test(url) || /favicon/i.test(text)) return true;
  if (/service ?worker|\bsw\.js\b|\[sw\]/i.test(text)) return true;
  if (text.startsWith('Failed to load resource')) return true;
  return false;
}

export type WatchOptions = {
  report: CrawlReport;
  where: string;
  appOrigin: string;
  signedIn: boolean;
  /** Status the page's own document is meant to have (default 200). */
  expectStatus?: number;
};

type Phase = { name: 'load' } | { name: 'control'; control: string; isSubmit: boolean };

/** Listens to one page and turns what goes wrong into problems for the report. */
export class PageWatch {
  phase: Phase = { name: 'load' };
  readonly inflight = new Set<Request>();
  lastNetwork = Date.now();
  requests = 0;
  documents: Array<{ url: string; status: number }> = [];
  rsc: Array<{ url: string; status: number }> = [];
  popups: string[] = [];
  downloads: string[] = [];
  dialogs: string[] = [];
  externalHosts = new Set<string>();

  constructor(
    readonly page: Page,
    readonly options: WatchOptions,
  ) {
    page.on('pageerror', (error) => this.add('page-error', `${error.name}: ${error.message.split('\n')[0]}`));
    page.on('console', (message) => {
      const text = message.text();
      if (/MISSING_MESSAGE|FORMATTING_ERROR|INVALID_MESSAGE|INVALID_KEY/.test(text)) {
        this.add('i18n', text.split('\n')[0].slice(0, 300));
        return;
      }
      if (message.type() !== 'error' || ignoredConsole(message)) return;
      this.add('console-error', text.split('\n')[0].slice(0, 300));
    });
    page.on('request', (request) => {
      this.lastNetwork = Date.now();
      if (!tracked(request)) return;
      this.requests += 1;
      this.inflight.add(request);
      const url = request.url();
      if (/^https?:/.test(url)) {
        const host = new URL(url).host;
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) this.externalHosts.add(host);
      }
    });
    const done = (request: Request) => {
      this.inflight.delete(request);
      this.lastNetwork = Date.now();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', (request) => {
      done(request);
      const error = request.failure()?.errorText ?? '';
      const url = request.url();
      // Aborted requests are navigations away and cancelled fetches, not failures.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancel/i.test(error)) return;
      if (!url.startsWith(this.options.appOrigin) && !url.startsWith(FAKE_SUPABASE)) return;
      this.add('request-failed', `${request.method()} ${shortUrl(url, this.options.appOrigin)}: ${error}`);
    });
    page.on('response', (response) => this.onResponse(response));
    page.on('dialog', (dialog) => {
      this.dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      // Leaving a page is fine; every confirm/alert/prompt is dismissed.
      void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => undefined);
    });
    page.on('download', (download) => {
      this.downloads.push(download.suggestedFilename());
      void download.cancel().catch(() => undefined);
    });
    page.on('popup', (popup) => {
      this.popups.push(popup.url());
      void popup.close().catch(() => undefined);
    });
  }

  add(kind: ProblemKind, detail: string) {
    const control = this.phase.name === 'control' ? this.phase.control : undefined;
    this.options.report.add({ where: this.options.where, control, kind, detail });
  }

  private onResponse(response: Response) {
    const request = response.request();
    const status = response.status();
    const url = response.url();
    const short = shortUrl(url, this.options.appOrigin);
    let isMainFrame = false;
    try {
      isMainFrame = request.isNavigationRequest() && request.frame() === this.page.mainFrame();
    } catch {
      isMainFrame = false; // service-worker requests have no frame
    }
    if (isMainFrame) {
      if (status >= 300 && status < 400) return;
      this.documents.push({ url, status });
      const expected = this.phase.name === 'load' ? (this.options.expectStatus ?? 200) : undefined;
      if (expected !== undefined) {
        if (status !== expected) this.add('document-status', `${short} answered ${status}, expected ${expected}`);
      } else if (status >= 400) {
        this.add('document-status', `navigated to ${short}, which answered ${status}`);
      }
      return;
    }
    const isApp = url.startsWith(`${this.options.appOrigin}/`);
    const isRsc = isApp && (/[?&]_rsc=/.test(url) || request.headers()['rsc'] === '1');
    if (isRsc) {
      this.rsc.push({ url, status });
      if (status >= 500) this.add('http-5xx', `${request.method()} ${short} → ${status}`);
      return;
    }
    const isApi = isApp && new URL(url).pathname.startsWith('/api/');
    const isFake = url.startsWith(`${FAKE_SUPABASE}/`);
    if (!isApi && !isFake) {
      if (isApp && status >= 400 && !/favicon/.test(url)) this.add('http-4xx', `${request.method()} ${short} → ${status}`);
      return;
    }
    if (status >= 500) {
      this.add('http-5xx', `${request.method()} ${short} → ${status}`);
      return;
    }
    if (status < 400) return;
    // Judging 4xx: signed in, 401/403 are always wrong, and so are 404/405 (a
    // missing or miswired endpoint). 400/409/422/429 are fine as the answer to
    // a control (an empty form, a conflict), but not when a page just loads.
    // 406 from the fake is PostgREST's "no single row", which the app handles.
    if (status === 406 && isFake) return;
    const wrongAlways = (status === 401 || status === 403) ? this.options.signedIn : status === 404 || status === 405;
    const wrongOnLoad = this.phase.name === 'load';
    if (wrongAlways || wrongOnLoad) this.add('http-4xx', `${request.method()} ${short} → ${status}`);
  }

  /** Waits until no tracked request is in flight for `quietMs` and the DOM stops changing. */
  async settle({ quietMs = 500, domQuietMs = 300, timeout = 12_000 } = {}): Promise<boolean> {
    try {
      await expect
        .poll(
          async () => {
            if (this.inflight.size > 0 || Date.now() - this.lastNetwork < quietMs) return false;
            const sinceMutation = await this.page
              .evaluate(() => performance.now() - ((window as unknown as { __crawl?: { lastMutation: number } }).__crawl?.lastMutation ?? 0))
              .catch(() => 0);
            return sinceMutation >= domQuietMs;
          },
          { timeout, intervals: [100] },
        )
        .toBe(true);
      return true;
    } catch {
      return false;
    }
  }
}

/** Requests that count as "network activity" (long-lived streams and dev tooling don't). */
function tracked(request: Request) {
  const type = request.resourceType();
  if (type === 'websocket' || type === 'eventsource' || type === 'media' || type === 'manifest') return false;
  const url = request.url();
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  if (/\/_next\/webpack-hmr|\/__nextjs|turbopack-hmr|favicon/.test(url)) return false;
  return true;
}

export function shortUrl(url: string, appOrigin: string) {
  if (url.startsWith(appOrigin)) return url.slice(appOrigin.length) || '/';
  if (url.startsWith(FAKE_SUPABASE)) return `[fake supabase]${url.slice(FAKE_SUPABASE.length).split('?')[0]}`;
  return url;
}

// ---------------------------------------------------------------------------
// Loading pages

/** A new page in `context`, instrumented and watched. */
export async function openPage(context: BrowserContext, options: WatchOptions) {
  const page = await context.newPage();
  await page.addInitScript(INSTRUMENT);
  const watch = new PageWatch(page, options);
  return { page, watch };
}

/**
 * Loads `url` and waits until it's usable: loaded, network idle, hydrated by
 * React, and the DOM quiet. Returns false if the page never got there.
 */
export async function load(page: Page, watch: PageWatch, url: string, { timeout = 90_000 } = {}): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
  } catch (error) {
    watch.add('navigation', `could not load ${url}: ${String(error).split('\n')[0]}`);
    return false;
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const hydrated = await waitForHydrated(page, MAIN).then(
    () => true,
    () => false,
  );
  if (!hydrated) watch.options.report.note(`${watch.options.where}: the page never hydrated (no React fiber on #main-content)`);
  await watch.settle({ timeout: 8_000 });
  return true;
}

/** The page's main content, or its body when it has none. */
const MAIN = ':main:';

/** Waits until React has hydrated the first element matching `selector` (MAIN: the main content). */
export async function waitForHydrated(page: Page, selector: string, timeout = 30_000) {
  await expect
    .poll(
      () =>
        page
          .evaluate((sel) => {
            const el = sel === ':main:' ? (document.getElementById('main-content') ?? document.body) : document.querySelector(sel);
            return !!el && Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
          }, selector)
          .catch(() => false),
      { timeout, intervals: [100, 250, 500] },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Page checks

/**
 * Raw message keys on screen: a message missing on the server renders as its
 * key ("Goals.title"). Keys under the old lowercase namespaces ("resume.…")
 * only count when the key exists in English, so a file called "resume.pdf"
 * isn't mistaken for one.
 */
export async function rawMessageKeys(page: Page): Promise<string[]> {
  const candidates = await page.evaluate((namespaces) => {
    const pattern = new RegExp(`^(${namespaces.join('|')})\\.[A-Za-z0-9_.]+$`);
    const found: Array<{ key: string; label: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      if (pattern.test(text)) found.push({ key: text, label: text });
    }
    for (const el of document.querySelectorAll('[aria-label], [placeholder], [title], [alt]')) {
      for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = el.getAttribute(attr)?.trim();
        if (value && pattern.test(value)) found.push({ key: value, label: `${attr}="${value}"` });
      }
    }
    const title = document.title.trim();
    if (pattern.test(title)) found.push({ key: title, label: `<title>${title}` });
    return found;
  }, NAMESPACES);
  const keys = candidates.filter(({ key }) => {
    if (/^[A-Z]/.test(key)) return true;
    try {
      message('en', key);
      return true;
    } catch {
      return false;
    }
  });
  return [...new Set(keys.map((k) => k.label))].slice(0, 10);
}

/** The page is wider than the screen: what sticks out (up to 3 elements). */
export async function horizontalOverflow(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return null;
    const limit = root.clientWidth + 1;
    const culprits: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= limit || rect.width === 0) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent.getBoundingClientRect().right > limit) continue;
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '';
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      culprits.push(`<${el.tagName.toLowerCase()}${cls ? ` .${cls}` : ''}> right=${Math.round(rect.right)}${text ? ` "${text}"` : ''}`);
      if (culprits.length === 3) break;
    }
    return `scrollWidth ${root.scrollWidth} > clientWidth ${root.clientWidth}${culprits.length ? `; sticking out: ${culprits.join(', ')}` : ''}`;
  });
}

/** Checks for a loaded page: where it ended up, its language, and raw message keys. */
export async function checkLoadedPage(
  page: Page,
  watch: PageWatch,
  report: CrawlReport,
  options: { locale: string; route: RouteSpec; where: string; appOrigin: string },
) {
  const { locale, route, where } = options;
  const expectedPath = `/${locale}${(route.finalPath ?? route.path) === '/' ? '' : (route.finalPath ?? route.path)}`;
  const finalUrl = new URL(page.url());
  const finalPath = finalUrl.pathname + finalUrl.search;
  if (finalPath !== expectedPath && finalPath.replace(/\/$/, '') !== expectedPath) {
    report.add({ where, kind: 'redirect', detail: `ended up at ${finalPath}, expected ${expectedPath}` });
  }
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (lang !== locale) report.add({ where, kind: 'i18n', detail: `<html lang="${lang}">, expected "${locale}"` });
  for (const key of await rawMessageKeys(page)) report.add({ where, kind: 'i18n', detail: `raw message key on screen: ${key}` });
  // The page speaks its language: the frame's nav (sidebar or tab bar), or the 404 page's title.
  const expectedText = route.status === 404 ? message(locale, 'NotFound.title') : route.shell ? message(locale, 'AppShell.nav.home') : null;
  if (expectedText) {
    const text = await page.evaluate(() => document.body.textContent ?? '');
    if (!text.includes(expectedText)) report.add({ where, kind: 'i18n', detail: `"${expectedText}" (${locale}) isn't on the page` });
  }
  if (watch.externalHosts.size) report.note(`${where}: requests to ${[...watch.externalHosts].join(', ')}`);
}

// ---------------------------------------------------------------------------
// Controls

export type ControlKind = 'link' | 'hash-link' | 'external-link' | 'select' | 'checkbox' | 'radio' | 'aria-toggle' | 'aria-radio' | 'tab' | 'button';

export type Control = {
  /** Index of this control's data-crawl-id on the current load. */
  id: number;
  /** Stable identity across loads: region, role, name, item, occurrence. */
  key: string;
  name: string;
  role: string;
  tag: string;
  kind: ControlKind;
  region: 'main' | 'shell';
  owner: 'page' | 'mine' | 'foreign';
  disabled: boolean;
  /** aria-current / aria-selected / aria-checked / checked: it's the current choice. */
  current: boolean;
  checked: boolean | null;
  value: string | null;
  options: Array<{ value: string; label: string; disabled: boolean }>;
  group: string | null;
  href: string | null;
  rawHref: string | null;
  target: string | null;
  domId: string | null;
  isSubmit: boolean;
  hasLabelTarget: boolean;
  /** Has aria-expanded / aria-haspopup (a menu or disclosure). */
  discloses: boolean;
  /** Inside a nav or tab list: switches views that are crawled as pages of their own. */
  inNav: boolean;
};

type RawControl = Omit<Control, 'key'> & { baseKey: string };

/**
 * Tags every visible control on the page with data-crawl-id and describes it.
 * Runs in the page.
 */
function enumerateInPage(args: { marker: string; foreign: string[] }): RawControl[] {
  const SELECTOR = [
    'a[href]',
    'button',
    'input[type=button]',
    'input[type=submit]',
    'input[type=reset]',
    'input[type=checkbox]',
    'input[type=radio]',
    'select',
    'summary',
    '[role=button]',
    '[role=tab]',
    '[role=switch]',
    '[role=radio]',
    '[role=checkbox]',
    '[role=menuitem]',
    '[role=link]',
  ].join(',');
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const shown = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textOf = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';
    if (node instanceof HTMLElement && node.hidden) return '';
    if (node instanceof HTMLImageElement) return node.alt;
    // A field inside a label (<label>Goal <select>…</select></label>) doesn't add its options to the name.
    if (node instanceof HTMLSelectElement || node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return '';
    if (node instanceof SVGElement) {
      const title = node.querySelector('title');
      return node.getAttribute('aria-label') ?? title?.textContent ?? '';
    }
    if (getComputedStyle(node).display === 'none') return '';
    return [...node.childNodes].map(textOf).join(' ');
  };
  const nameOf = (el: Element): string => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = norm(labelledBy.split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement('span'))).join(' '));
      if (text) return text;
    }
    const label = norm(el.getAttribute('aria-label'));
    if (label) return label;
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const text = norm([...labels].map((l) => textOf(l)).join(' '));
      if (text) return text;
    }
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) return norm(el.value);
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
      const text = norm(textOf(el));
      if (text) return text;
    }
    return norm(el.getAttribute('title') ?? (el as HTMLInputElement).placeholder ?? '');
  };
  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role')?.split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'summary') return 'summary';
    if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'button';
    }
    return tag;
  };
  /** An item's own text: not the options of the selects inside it. */
  const itemText = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest('select, option, textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '');
    return norm(parts.join(' '));
  };
  // Counts change while the crawl runs ("Materials 2", "Notifications (1 unread)"): keys leave them out.
  const keyName = (name: string) => norm(name.replace(/\([^)]*\)/g, ' ').replace(/\d+/g, '#'));
  const main = document.getElementById('main-content');
  const groups = new Map<Element, number>();
  const out: RawControl[] = [];
  const elements = [...document.querySelectorAll(SELECTOR)];
  // Ids stay the same for the life of the page, so a second look (after a click) doesn't move them.
  const counter = window as unknown as { __crawlNextId?: number };
  const idOf = (el: Element) => {
    const existing = el.getAttribute('data-crawl-id');
    if (existing) return Number(existing);
    counter.__crawlNextId = (counter.__crawlNextId ?? 0) + 1;
    el.setAttribute('data-crawl-id', String(counter.__crawlNextId));
    return counter.__crawlNextId;
  };
  elements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const input = el instanceof HTMLInputElement ? el : null;
    let isShown = shown(el);
    let hasLabelTarget = false;
    // A visually hidden checkbox/radio styled through its label is clicked through the label.
    let label: Element | undefined;
    if (!isShown && input && (input.type === 'checkbox' || input.type === 'radio')) {
      label = [...(input.labels ?? [])].find(shown);
      if (label) {
        isShown = true;
        hasLabelTarget = true;
      }
    }
    if (!isShown) return;
    // A control nested in another (a button inside a link) is reached through the outer one.
    if (el.parentElement?.closest(SELECTOR) && !el.parentElement.closest('label')) {
      const outer = el.parentElement.closest(SELECTOR);
      if (outer && outer.tagName.toLowerCase() !== 'summary') return;
    }
    const index = idOf(el);
    if (label) label.setAttribute('data-crawl-label', String(index));
    const role = roleOf(el);
    const name = nameOf(el);
    const region: 'main' | 'shell' = main && main.contains(el) ? 'main' : 'shell';
    // Whose item is it? Walk up through list items, rows and articles.
    let owner: 'page' | 'mine' | 'foreign' = 'page';
    let itemKey = '';
    for (let node = el.parentElement; node && node !== main && node !== document.body; node = node.parentElement) {
      if (!node.matches('li, tr, [role=listitem], [role=row]')) continue;
      const text = itemText(node);
      const mine = text.match(new RegExp(`${args.marker}[\\w-]+`));
      if (mine) {
        owner = 'mine';
        itemKey = mine[0];
        break;
      }
      if (args.foreign.some((f) => text.includes(f))) {
        owner = 'foreign';
        break;
      }
    }
    // Not every list is a <ul>: a control whose own text carries someone else's data (a notification, a session) is theirs too.
    if (owner === 'page') {
      const own = itemText(el);
      if (!own.includes(args.marker) && args.foreign.some((f) => own.includes(f))) owner = 'foreign';
    }
    const ariaChecked = el.getAttribute('aria-checked');
    const ariaSelected = el.getAttribute('aria-selected');
    const ariaCurrent = el.getAttribute('aria-current');
    // The pressed button of a pick-one group (filters, ranges): pressing it again changes nothing.
    const pressedSiblings = el.getAttribute('aria-pressed') === 'true' && el.parentElement
      ? [...el.parentElement.children].filter((sibling) => sibling.hasAttribute('aria-pressed'))
      : [];
    const pickOneCurrent = pressedSiblings.length >= 2 && pressedSiblings.filter((s) => s.getAttribute('aria-pressed') === 'true').length === 1;
    const checked = input && (input.type === 'checkbox' || input.type === 'radio') ? input.checked : ariaChecked === null ? null : ariaChecked === 'true';
    let kind: RawControl['kind'] = 'button';
    let href: string | null = null;
    let rawHref: string | null = null;
    if (tag === 'a') {
      rawHref = el.getAttribute('href');
      href = (el as HTMLAnchorElement).href;
      const target = new URL(href, location.href);
      if (!/^https?:$/.test(target.protocol)) kind = /^javascript:/i.test(rawHref ?? '') ? 'button' : 'external-link';
      else if (target.origin !== location.origin) kind = 'external-link';
      else if (target.pathname === location.pathname && target.search === location.search && target.hash) kind = 'hash-link';
      else if ((rawHref ?? '').startsWith('#')) kind = 'hash-link';
      else kind = 'link';
    } else if (tag === 'select') kind = 'select';
    else if (input?.type === 'checkbox') kind = 'checkbox';
    else if (input?.type === 'radio') kind = 'radio';
    else if (role === 'switch' || role === 'checkbox') kind = 'aria-toggle';
    else if (role === 'radio') kind = 'aria-radio';
    else if (role === 'tab') kind = 'tab';
    let group: string | null = null;
    if (kind === 'radio') group = `radio:${input?.name}`;
    if (kind === 'aria-radio') {
      const container = el.closest('[role=radiogroup]') ?? el.parentElement;
      if (container) {
        if (!groups.has(container)) groups.set(container, groups.size);
        group = `rg${groups.get(container)}`;
      }
    }
    const select = el instanceof HTMLSelectElement ? el : null;
    const domId = el.id && !/[:«»]|^_?r_|^radix-/.test(el.id) ? el.id : null;
    const isSubmit = (el instanceof HTMLButtonElement && el.type === 'submit' && !!el.form) || (!!input && input.type === 'submit');
    out.push({
      id: index,
      baseKey: `${region}|${role}|${keyName(name)}|${itemKey}`,
      name,
      role,
      tag,
      kind,
      region,
      owner,
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset:disabled'),
      current:
        (ariaCurrent !== null && ariaCurrent !== 'false') ||
        ariaSelected === 'true' ||
        pickOneCurrent ||
        ((kind === 'radio' || kind === 'aria-radio' || kind === 'tab') && checked === true),
      checked,
      value: select ? select.value : null,
      options: select ? [...select.options].map((o) => ({ value: o.value, label: norm(o.label), disabled: o.disabled })) : [],
      group,
      href,
      rawHref,
      target: el.getAttribute('target'),
      domId,
      isSubmit,
      hasLabelTarget,
      discloses: el.hasAttribute('aria-expanded') || el.hasAttribute('aria-haspopup'),
      inNav: !!el.closest('nav, [role=tablist], [role=menubar]'),
    });
  });
  return out;
}

/** Every visible control on the page, tagged for this load. Keys stay the same across loads. */
export async function enumerateControls(page: Page, foreign: string[]): Promise<Control[]> {
  const raw = await page.evaluate(enumerateInPage, { marker: MARKER, foreign });
  const seen = new Map<string, number>();
  return raw.map(({ baseKey, ...control }) => {
    const n = seen.get(baseKey) ?? 0;
    seen.set(baseKey, n + 1);
    return { ...control, key: `${baseKey}#${n}` };
  });
}

export const controlLocator = (page: Page, control: Control) => page.locator(`[data-crawl-id="${control.id}"]`);

/** skipReason() for a link on someone else's item: checked over HTTP, not clicked. */
export const FOREIGN_LINK = "link on data the crawler didn't create (checked over HTTP, not clicked)";

/** Why a control is left alone, or null to activate it. */
export function skipReason(control: Control): string | null {
  if (control.disabled) return 'disabled';
  // Form fields (toggles, radios, selects) are put back after the change, so only actions are skipped by name.
  const action = control.kind === 'button' || control.kind === 'tab' || control.kind === 'link' || control.kind === 'hash-link';
  if (action) for (const rule of SKIP_NAME) if (rule.pattern.test(control.name)) return rule.why;
  if (control.current) return 'already the current choice';
  if (control.owner === 'foreign' && control.kind !== 'external-link') {
    // Someone else's item. Its links are checked over HTTP without clicking (a click handler can
    // write: opening a notification marks it read). Of the rest, only what opens a menu or an
    // editor is clicked, and what those reveal isn't (see the spec).
    if (control.kind === 'link' || control.kind === 'hash-link') return FOREIGN_LINK;
    if (!(control.discloses || /^(edit|view|show|details|download|copy|preview)\b/i.test(control.name))) {
      return 'belongs to data the crawler didn\'t create';
    }
  }
  if (control.kind === 'select' && !control.options.some((o) => !o.disabled && o.value !== control.value)) return 'select with no other option';
  return null;
}

type Snapshot = { url: string; mutations: number; clipboard: number; opened: number; navigations: number; prints: number; shares: number; active: string; invalidForm: boolean };

async function snapshot(page: Page, id: number): Promise<Snapshot> {
  return page.evaluate((crawlId) => {
    const state = (window as unknown as { __crawl: { mutations: number; clipboard: number; opened: string[]; navigations: string[]; prints: number; shares: number } }).__crawl;
    const active = document.activeElement;
    const target = document.querySelector(`[data-crawl-id="${crawlId}"]`);
    const label = document.querySelector(`[data-crawl-label="${crawlId}"]`);
    let activeKey = 'body';
    if (active && active !== document.body) {
      activeKey = target && (active === target || target.contains(active)) ? 'control' : label && label.contains(active) ? 'control' : `${active.tagName}#${active.id}.${active.getAttribute('name') ?? ''}.${(active.textContent ?? '').slice(0, 20)}`;
    }
    return {
      url: location.href,
      mutations: state.mutations,
      clipboard: state.clipboard,
      opened: state.opened.length,
      navigations: state.navigations.length,
      prints: state.prints,
      shares: state.shares,
      active: activeKey,
      // A submit button of a form with invalid fields: the browser shows its own validation message.
      invalidForm: !!(target as HTMLButtonElement | null)?.form?.matches(':invalid') && (target as HTMLButtonElement).type === 'submit',
    };
  }, id);
}

/**
 * Of the controls that appeared after a click, the ones the click opened (runs
 * in the page): inside the element it controls (aria-controls), inside its
 * <details>, inside a new dialog, menu, group, form or region, or, for a
 * button that says it expanded something, right next to it.
 */
function openedBy(args: { ids: number[]; parentId: number }): number[] {
  const parent = document.querySelector(`[data-crawl-id="${args.parentId}"]`);
  const controlsId = parent?.getAttribute('aria-controls');
  const controlled = controlsId ? document.getElementById(controlsId) : null;
  const details = parent?.closest('details');
  const expanded = parent?.getAttribute('aria-expanded') === 'true';
  const near = expanded && parent ? (parent.parentElement?.parentElement?.parentElement ?? null) : null;
  const CONTAINER = 'dialog, [role=dialog], [role=alertdialog], [role=menu], [role=listbox], [role=group], [role=region], form, [popover], [aria-modal=true]';
  const isOld = (el: Element) => (el as unknown as { __crawlOld?: boolean }).__crawlOld === true;
  return args.ids.filter((id) => {
    const el = document.querySelector(`[data-crawl-id="${id}"]`);
    if (!el) return false;
    if (controlled?.contains(el) || details?.contains(el)) return true;
    // The new part of the page this control sits in, if any.
    for (let node: Element | null = el; node && node !== document.body && !isOld(node); node = node.parentElement) {
      if (node.matches(CONTAINER)) return true;
      if (near && node.parentElement && isOld(node.parentElement) && near.contains(node.parentElement)) return true;
    }
    // Shown but not new: a dialog or menu that was in the page, closed, or a hidden menu next to an expanded button.
    if (!isOld(el)) return false;
    return !!el.closest('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true], [role=menu]') || !!near?.contains(el);
  });
}

export type ControlResult = {
  effects: string[];
  navigatedTo?: string;
  /** Controls the click revealed (a sheet, a menu, a form), when asked for. */
  revealed: Control[];
};

/**
 * Activates one control on a freshly loaded page and records what it did.
 * The page is left as it was: toggles are toggled back, selects reset.
 * With `reveal`, also lists the controls the click brought on screen.
 */
export async function activateControl(
  page: Page,
  watch: PageWatch,
  control: Control,
  all: Control[],
  options: { appOrigin: string; reveal?: { foreign: string[] } },
): Promise<ControlResult> {
  const revealed: Control[] = [];
  const report = watch.options.report;
  const where = watch.options.where;
  const locator = controlLocator(page, control);
  const effects: string[] = [];
  watch.phase = { name: 'control', control: control.name, isSubmit: control.isSubmit };
  await waitForHydrated(page, `[data-crawl-id="${control.id}"]`, 15_000).catch(() => report.note(`${where} › "${control.name}": not hydrated before the click`));
  // Remember what's already in the page, to tell what the click opens (an expando, so no DOM mutation).
  if (options.reveal) {
    await page.evaluate(() => document.querySelectorAll('*').forEach((el) => ((el as unknown as { __crawlOld?: boolean }).__crawlOld = true)));
  }
  const before = await snapshot(page, control.id);
  const requestsBefore = watch.requests;
  const popupsBefore = watch.popups.length;
  const downloadsBefore = watch.downloads.length;
  const dialogsBefore = watch.dialogs.length;
  const documentsBefore = watch.documents.length;

  let chosen: string | null = null;
  try {
    if (control.kind === 'select') {
      chosen = control.options.find((o) => !o.disabled && o.value !== control.value)?.value ?? null;
      if (chosen === null) return { effects, revealed };
      await locator.selectOption(chosen, { timeout: 5_000 });
    } else if (control.kind === 'hash-link') {
      // Skip links and in-page anchors can be visually hidden until focused: use the keyboard.
      await locator.focus({ timeout: 5_000 });
      await page.keyboard.press('Enter');
    } else {
      await clickControl(page, control);
    }
  } catch (error) {
    report.add({ where, control: control.name, kind: 'unclickable', detail: shortError(error) });
    return { effects, revealed };
  }

  const settled = await watch.settle();
  if (!settled) report.note(`${where} › "${control.name}": the page was still busy 12 s after the click`);
  const after = await snapshot(page, control.id).catch(() => null);

  if (watch.requests > requestsBefore) effects.push('request');
  if (watch.popups.length > popupsBefore) effects.push(`popup ${watch.popups.slice(popupsBefore).join(', ')}`);
  if (watch.downloads.length > downloadsBefore) effects.push(`download ${watch.downloads.slice(downloadsBefore).join(', ')}`);
  if (watch.dialogs.length > dialogsBefore) effects.push(`dialog ${watch.dialogs.slice(dialogsBefore).join(' | ')}`);
  if (watch.documents.length > documentsBefore) effects.push('document');
  if (!after) effects.push('navigation');
  else {
    if (after.url !== before.url) effects.push(`url ${shortUrl(after.url, options.appOrigin)}`);
    if (after.mutations > before.mutations) effects.push('dom');
    if (after.clipboard > before.clipboard) effects.push('clipboard');
    if (after.opened > before.opened) effects.push('window.open');
    if (after.navigations > before.navigations) effects.push('navigate');
    if (after.prints > before.prints) effects.push('print');
    if (after.shares > before.shares) effects.push('share');
    if (after.active !== before.active && after.active !== 'control' && after.active !== 'body') effects.push('focus');
    if (before.invalidForm) effects.push('validation');
  }

  // Form fields: the new value has to stick.
  const samePage = !!after && sameDocument(after.url, before.url);
  if (samePage && (control.kind === 'select' || control.kind === 'checkbox' || control.kind === 'radio')) {
    // A field can be gone after the change (a menu that closes): then there's nothing to check.
    const state = (await locator.count())
      ? await locator
          .evaluate((el) => (el instanceof HTMLSelectElement ? el.value : (el as HTMLInputElement).checked), undefined, { timeout: 2_000 })
          .catch(() => undefined)
      : undefined;
    if (state !== undefined) {
      const expected = control.kind === 'select' ? chosen : control.kind === 'radio' ? true : !control.checked;
      if (state !== expected) report.add({ where, control: control.name, kind: 'reverts', detail: `set to ${String(expected)}, it went back to ${String(state)}` });
    }
  }

  const buttonLike = control.kind === 'button' || control.kind === 'tab' || control.kind === 'aria-toggle' || control.kind === 'aria-radio';
  if (buttonLike && effects.length === 0) {
    report.add({ where, control: control.name, kind: 'dead', detail: 'possibly dead: no DOM change, navigation, request or focus change after the click' });
  }

  if (samePage && options.reveal) {
    const before = new Set(all.map((c) => c.key));
    const now = await enumerateControls(page, options.reveal.foreign).catch(() => [] as Control[]);
    const appeared = now.filter((c) => !before.has(c.key) && c.id !== control.id);
    const opened = new Set(await page.evaluate(openedBy, { ids: appeared.map((c) => c.id), parentId: control.id }).catch(() => [] as number[]));
    revealed.push(...appeared.filter((c) => opened.has(c.id)));
    const elsewhere = appeared.length - revealed.length;
    // Only what the click opened counts: a list that reloaded can show other specs' new items.
    if (elsewhere) report.count('controls that appeared outside what a click opened (not clicked)', elsewhere);
  }

  if (samePage) {
    // Put it back first: closing a sheet takes its fields with it.
    await restore(page, watch, control, all);
    await closeModals(page, watch, control);
  } else if (control.kind === 'select' && control.domId) {
    // A select that navigated (the language picker): put it back on the new page.
    await restoreSelectAfterNavigation(page, watch, control);
  }
  return { effects, navigatedTo: after && !samePage ? after.url : undefined, revealed };
}

/** Does what a control does (to reveal what it opens), without judging it. */
export async function revealWith(page: Page, watch: PageWatch, parent: Control): Promise<boolean> {
  watch.phase = { name: 'control', control: parent.name, isSubmit: parent.isSubmit };
  try {
    await waitForHydrated(page, `[data-crawl-id="${parent.id}"]`, 15_000);
    if (parent.kind === 'select') {
      const chosen = parent.options.find((o) => !o.disabled && o.value !== parent.value)?.value;
      if (chosen === undefined) return false;
      await controlLocator(page, parent).selectOption(chosen, { timeout: 5_000 });
    } else {
      await clickControl(page, parent);
    }
  } catch {
    return false;
  }
  await watch.settle();
  return true;
}

async function clickControl(page: Page, control: Control) {
  const locator = controlLocator(page, control);
  try {
    await locator.click({ timeout: 5_000 });
  } catch (error) {
    // A styled checkbox or switch whose input sits under its label.
    if ((control.kind === 'checkbox' || control.kind === 'radio') && /intercepts pointer events|not visible|outside of the viewport/.test(String(error))) {
      const label = control.hasLabelTarget
        ? page.locator(`[data-crawl-label="${control.id}"]`)
        : page.locator(`label:has([data-crawl-id="${control.id}"]), label[for="${control.domId ?? '__none__'}"]`).first();
      await label.click({ timeout: 5_000 });
      return;
    }
    throw error;
  }
}

const sameDocument = (a: string, b: string) => {
  const x = new URL(a);
  const y = new URL(b);
  return x.origin === y.origin && x.pathname === y.pathname;
};

/** Modals and sheets opened by the click are closed with Escape, and have to close. */
async function closeModals(page: Page, watch: PageWatch, control: Control) {
  const openModals = () =>
    page
      .evaluate(() => {
        const visible = (el: Element) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        return [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')].filter(visible).length;
      })
      .catch(() => 0);
  const count = await openModals();
  if (!count) return;
  const modal = await page.evaluate(() => [...document.querySelectorAll('dialog:modal, [aria-modal=true]')].length).catch(() => 0);
  await page.keyboard.press('Escape');
  await watch.settle({ timeout: 4_000 });
  if (modal && (await openModals()) >= count) {
    watch.options.report.add({ where: watch.options.where, control: control.name, kind: 'escape', detail: 'the modal it opened did not close with Escape' });
  }
}

/** Puts a toggle, radio or select back the way it was (the fake user is shared). */
async function restore(page: Page, watch: PageWatch, control: Control, all: Control[]) {
  const report = watch.options.report;
  const where = watch.options.where;
  const locator = controlLocator(page, control);
  const stateful = ['select', 'checkbox', 'aria-toggle', 'radio', 'aria-radio'].includes(control.kind);
  if (stateful && (await locator.count()) === 0) {
    // Its menu or sheet closed after the change. The crawler's own items are reset on the next run (ensureSeeds).
    if (control.owner === 'mine') report.note(`${where} › "${control.name}": closed after the change, left for ensureSeeds to reset`);
    else report.add({ where, control: control.name, kind: 'restore', detail: 'could not put it back: it was gone after the change' });
    return;
  }
  try {
    if (control.kind === 'select' && control.value !== null) {
      const now = await locator.inputValue({ timeout: 2_000 });
      if (now !== control.value) await locator.selectOption(control.value, { timeout: 5_000 });
    } else if (control.kind === 'checkbox') {
      const now = await locator.evaluate((el) => (el as HTMLInputElement).checked, undefined, { timeout: 2_000 });
      if (now !== control.checked) await clickControl(page, control);
    } else if (control.kind === 'aria-toggle') {
      const now = await locator.getAttribute('aria-checked', { timeout: 2_000 });
      if (now !== null && String(control.checked) !== now) await clickControl(page, control);
    } else if ((control.kind === 'radio' || control.kind === 'aria-radio') && control.group) {
      const original = all.find((c) => c.group === control.group && c.checked === true);
      if (original) {
        const state = await controlLocator(page, original).evaluate(
          (el) => (el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'),
          undefined,
          { timeout: 2_000 },
        );
        if (!state) await clickControl(page, original);
      }
    } else {
      return;
    }
    await watch.settle({ timeout: 6_000 });
  } catch (error) {
    report.add({ where, control: control.name, kind: 'restore', detail: `could not put it back: ${shortError(error)}` });
  }
}

async function restoreSelectAfterNavigation(page: Page, watch: PageWatch, control: Control) {
  if (control.value === null || !control.domId) return;
  try {
    const selector = `[id="${control.domId}"]`;
    await waitForHydrated(page, selector, 20_000);
    await page.locator(selector).selectOption(control.value, { timeout: 5_000 });
    await page.waitForLoadState('load');
    await watch.settle({ timeout: 10_000 });
  } catch (error) {
    watch.options.report.add({ where: watch.options.where, control: control.name, kind: 'restore', detail: `could not put it back after it navigated: ${shortError(error)}` });
  }
}

export function shortError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const intercept = lines.find((l) => /intercepts pointer events/.test(l));
  return (intercept ? `${lines[0]} (${intercept})` : lines[0] ?? text).replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300);
}

/** External links: a real address that opens in a new tab (mail links stay put). */
export function checkExternalLink(control: Control): string | null {
  const raw = control.rawHref ?? '';
  let url: URL;
  try {
    url = new URL(control.href ?? raw);
  } catch {
    return `invalid href "${raw}"`;
  }
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
    return url.pathname || url.search ? null : `empty ${url.protocol} link`;
  }
  if (!/^https?:$/.test(url.protocol)) return `unexpected protocol in "${raw}"`;
  if (!url.hostname.includes('.')) return `href "${raw}" has no real host`;
  if (control.target !== '_blank') return `${url.href} opens in the same tab (no target="_blank")`;
  return null;
}

/** An internal link's target answers without an error (checked over HTTP, signed in as the page is). */
export async function checkLinkTarget(context: BrowserContext, href: string): Promise<number> {
  const response = await context.request.get(href, { maxRedirects: 5, timeout: 60_000 });
  return response.status();
}
