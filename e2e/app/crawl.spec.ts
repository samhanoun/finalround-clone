import { request, type Browser, type Page, type TestInfo } from '@playwright/test';
import {
  CHILD_CAP,
  CHILD_CAP_PER_PARENT,
  CONTROL_CAP,
  CONTROL_ROUTES,
  CrawlReport,
  CreatedRows,
  FOREIGN_LINK,
  LOCALES,
  SIGNED_IN_ROUTES,
  SIGNED_OUT_ROUTES,
  activateControl,
  allowedBy,
  checkExternalLink,
  checkLinkTarget,
  checkLoadedPage,
  describeProblem,
  enumerateControls,
  ensureSeeds,
  expect,
  fakeState,
  foreignStrings,
  formatSummary,
  horizontalOverflow,
  load,
  message,
  newContext,
  openPage,
  rawMessageKeys,
  readReports,
  revealWith,
  shortUrl,
  skipReason,
  test,
  type Control,
  type RouteSpec,
  type StorageState,
} from './helpers/crawl';

/**
 * A click-through of every screen and every control, against the local fakes.
 *
 * 1. Every page in every language (signed in, and signed out for the public
 *    pages and the 404s): page errors, console errors, missing translations,
 *    unexpected document statuses, and horizontal scroll at 360px wide.
 * 2. Every control on every signed-in page (desktop, English), each from a
 *    fresh load: what it did, or that it did nothing, plus errors and bad
 *    responses it caused, internal links that 404 and external links that
 *    don't open in a new tab. Destructive and session-ending controls are
 *    skipped and listed.
 * 3. Phone layout (@mobile, Pixel 7): the same pages, the bottom tab bar, the
 *    More sheet, no horizontal scroll, and the main action within the screen.
 *
 * Each test records what it found and attaches it; the last test of each
 * project ("crawl summary") fails with every problem of the run in one list.
 * Known, explained problems are allowlisted in helpers/crawl.ts (ALLOWLIST);
 * run with CRAWL_STRICT=1 to see them fail too.
 *
 * Locally, against the shared app: E2E_BASE_URL=http://localhost:3100 (see
 * playwright.app.config.ts).
 */

const NARROW = { width: 360, height: 800 };
const DESKTOP = { width: 1440, height: 900 };

/** The dev server compiles each page on its first visit (20–60 s): visit them all once first. */
test.beforeAll(async ({ browser, authState }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const context = await newContext(browser, testInfo, { signedIn: authState });
  const page = await context.newPage();
  for (const route of SIGNED_IN_ROUTES) {
    await page.goto(`/en${route.path === '/' ? '' : route.path}`, { waitUntil: 'load', timeout: 240_000 }).catch(() => undefined);
  }
  await context.close();
});

const pagePath = (locale: string, route: RouteSpec) => `/${locale}${route.path === '/' ? '' : route.path}`;

// ---------------------------------------------------------------------------
// 0. The crawler notices problems: a page made of them, served in place of a real one

const SELF_CHECK_PAGE = `<!doctype html><html lang="en"><head><title>Crawler self-check</title></head><body>
<main id="main-content">
  <p>Goals.title</p>
  <button type="button">Does nothing</button>
  <button type="button" onclick="setTimeout(() => { throw new Error('thrown by the self-check'); })">Throws</button>
  <button type="button" onclick="console.error('logged by the self-check')">Logs an error</button>
  <button type="button" onclick="fetch('/api/crawl-self-check', { method: 'POST' })">Fails on the server</button>
  <button type="button" onclick="this.textContent = 'Clicked'">Works</button>
  <a href="/en/crawl-no-such-page">Broken link</a>
  <a href="https://example.com/terms">External link in the same tab</a>
  <div style="width: 2000px">Too wide</div>
</main>
<script>
  // Stands in for React's hydration marker, which the crawler waits for before it clicks.
  for (const el of document.querySelectorAll('*')) el['__reactFiber$selfcheck'] = {};
</script>
</body></html>`;

test('the crawler notices problems (self-check)', async ({ browser, isMobile }, testInfo) => {
  test.skip(isMobile, 'Runs in the desktop project');
  const report = new CrawlReport();
  const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  const url = `${appOrigin}/crawl-self-check`;
  const context = await newContext(browser, testInfo, { signedIn: null, viewport: NARROW });
  try {
    await context.route(url, (route) => route.fulfill({ contentType: 'text/html', body: SELF_CHECK_PAGE }));
    await context.route(`${appOrigin}/api/crawl-self-check`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    const where = 'self-check';
    const first = await openPage(context, { report, where, appOrigin, signedIn: false });
    expect(await load(first.page, first.watch, url)).toBe(true);
    for (const key of await rawMessageKeys(first.page)) report.add({ where, kind: 'i18n', detail: `raw message key on screen: ${key}` });
    const overflow = await horizontalOverflow(first.page);
    if (overflow) report.add({ where, kind: 'h-scroll', detail: overflow });
    const controls = await enumerateControls(first.page, []);
    await first.page.close();
    for (const control of controls) {
      if (control.kind === 'external-link') {
        const problem = checkExternalLink(control);
        if (problem) report.add({ where, control: control.name, kind: 'external-link', detail: problem });
        continue;
      }
      if (control.kind === 'link' && control.href) {
        const status = await checkLinkTarget(context, control.href);
        if (status >= 400) report.add({ where, control: control.name, kind: 'link-404', detail: `answered ${status}` });
        continue;
      }
      const { page, watch } = await openPage(context, { report, where, appOrigin, signedIn: false });
      await load(page, watch, url);
      const now = await enumerateControls(page, []);
      const fresh = now.find((c) => c.key === control.key);
      if (fresh) await activateControl(page, watch, fresh, now, { appOrigin });
      await page.close();
    }
  } finally {
    await context.close();
  }
  await testInfo.attach('self-check.txt', { body: report.format(), contentType: 'text/plain' });
  const found = (kind: string, control?: string) => report.problems.some((p) => p.kind === kind && (control === undefined || p.control === control));
  expect.soft(found('i18n'), 'a raw message key').toBe(true);
  expect.soft(found('h-scroll'), 'horizontal scroll at 360px').toBe(true);
  expect.soft(found('dead', 'Does nothing'), 'a dead button').toBe(true);
  expect.soft(found('page-error', 'Throws'), 'a page error').toBe(true);
  expect.soft(found('console-error', 'Logs an error'), 'a console error').toBe(true);
  expect.soft(found('http-5xx', 'Fails on the server'), 'a 500 from the API').toBe(true);
  expect.soft(found('link-404', 'Broken link'), 'a link to a 404').toBe(true);
  expect.soft(found('external-link'), 'an external link without target=_blank').toBe(true);
  expect.soft(report.problems.filter((p) => p.control === 'Works'), 'a working button is not reported').toEqual([]);
});

// ---------------------------------------------------------------------------
// 1. Every page in every language

/**
 * Loads the page fresh at 360px wide (checks, horizontal scroll), then widens
 * it to desktop size (the sidebar and desktop-only layouts render) and checks
 * again.
 */
async function sweep(browser: Browser, testInfo: TestInfo, report: CrawlReport, locale: string, route: RouteSpec, signedIn: boolean, authState: StorageState) {
  const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  const who = signedIn ? 'signed in' : 'signed out';
  const context = await newContext(browser, testInfo, { signedIn: signedIn ? authState : null, viewport: NARROW });
  try {
    const where = `${locale} ${route.path} (${who}) @${NARROW.width}px`;
    const { page, watch } = await openPage(context, { report, where, appOrigin, signedIn, expectStatus: route.status });
    if (!(await load(page, watch, pagePath(locale, route)))) return;
    await checkLoadedPage(page, watch, report, { locale, route, where, appOrigin });
    const overflow = await horizontalOverflow(page);
    if (overflow) report.add({ where, kind: 'h-scroll', detail: overflow });

    watch.options.where = `${locale} ${route.path} (${who}) @${DESKTOP.width}px`;
    await page.setViewportSize(DESKTOP);
    await watch.settle({ timeout: 6_000 });
    await checkLoadedPage(page, watch, report, { locale, route, where: watch.options.where, appOrigin });
    report.count('pages loaded');
  } finally {
    await context.close();
  }
}

test.describe('every page in every language', () => {
  for (const locale of LOCALES) {
    test(`pages in ${locale}`, async ({ browser, authState }, testInfo) => {
      test.setTimeout(20 * 60_000);
      const report = new CrawlReport();
      for (const route of SIGNED_IN_ROUTES) await sweep(browser, testInfo, report, locale, route, true, authState);
      for (const route of SIGNED_OUT_ROUTES) await sweep(browser, testInfo, report, locale, route, false, authState);
      await report.finish(testInfo);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Every control (desktop, English)

/** A control's accessible name, or what it is when it has none. */
const nameOf = (control: Control) => control.name || `(unnamed ${control.role})`;

/** Links already clicked on an earlier page (same name, same target): checked over HTTP only. */
const clickedLinks = new Set<string>();

async function crawlControls(
  browser: Browser,
  testInfo: TestInfo,
  authState: StorageState,
  route: RouteSpec,
  region: 'main' | 'shell' | 'all',
) {
  const report = new CrawlReport();
  const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
  const url = pagePath('en', route);
  const where = region === 'shell' ? `en app frame (on ${route.path})` : `en ${route.path}`;
  const api = await request.newContext();
  const created = new CreatedRows();
  await created.start(api);
  const foreign = foreignStrings(await fakeState(api));
  const context = await newContext(browser, testInfo, { signedIn: authState });
  try {
    // What's on the page.
    const first = await openPage(context, { report, where, appOrigin, signedIn: true });
    if (!(await load(first.page, first.watch, url))) return report.finish(testInfo);
    const all = (await enumerateControls(first.page, foreign)).filter((c) => region === 'all' || c.region === region);

    /** An internal link's target over HTTP (signed in, as the page), once per address. */
    const linkStatus = new Map<string, number>();
    const checkHref = async (href: string, label: string) => {
      if (new URL(href).hash && new URL(href).pathname === new URL(url, appOrigin).pathname) return;
      if (!linkStatus.has(href)) linkStatus.set(href, await checkLinkTarget(context, href).catch(() => 0));
      const status = linkStatus.get(href) ?? 0;
      if (status === 0 || status >= 400) report.add({ where, control: label, kind: 'link-404', detail: `${shortUrl(href, appOrigin)} answered ${status || 'nothing'}` });
    };
    const linksToCheck: Array<{ href: string; label: string }> = [];

    const queue: Control[] = [];
    for (const control of all) {
      const label = control.name || `(unnamed ${control.role})`;
      if (!control.name) {
        report.add({ where, control: label, kind: 'no-name', detail: `a visible ${control.role} (<${control.tag}>) has no accessible name` });
      }
      const why = skipReason(control);
      if (why === FOREIGN_LINK) {
        if (control.href) await checkHref(control.href, label);
        report.count("links on other specs' data (checked over HTTP, not clicked)");
        continue;
      }
      if (why) {
        if (why === 'disabled') report.count('disabled controls (not clicked)');
        else if (why === 'already the current choice') report.count('current tab or option (not clicked)');
        else report.skip(where, label, why);
        continue;
      }
      if (control.kind === 'external-link') {
        const problem = checkExternalLink(control);
        if (problem) report.add({ where, control: label, kind: 'external-link', detail: problem });
        report.count('external links checked');
        continue;
      }
      if (control.kind === 'link' && control.href) {
        await checkHref(control.href, label);
        const linkKey = `${control.name}|${control.href}`;
        if (clickedLinks.has(linkKey)) {
          report.count('links checked over HTTP only (clicked on an earlier page)');
          continue;
        }
        clickedLinks.add(linkKey);
      }
      queue.push(control);
    }
    await first.page.close();
    if (queue.length > CONTROL_CAP) report.note(`${where}: ${queue.length} controls, only the first ${CONTROL_CAP} were clicked`);

    // Controls that a click brings on screen (a sheet, a menu, a form): clicked
    // next, each from a fresh load after re-opening what holds them.
    const children: Array<{ target: Control; parent: Control }> = [];
    const childKeys = new Set<string>();
    const queueChildren = (parent: Control, revealed: Control[]) => {
      let taken = 0;
      for (const child of revealed) {
        const label = `${nameOf(parent)} › ${nameOf(child)}`;
        if (!child.name) report.add({ where, control: label, kind: 'no-name', detail: `a visible ${child.role} (<${child.tag}>) has no accessible name` });
        const why = skipReason(child);
        if (why === FOREIGN_LINK) {
          if (child.href) linksToCheck.push({ href: child.href, label });
          continue;
        }
        if (why) {
          if (why !== 'disabled' && why !== 'already the current choice') report.skip(where, label, why);
          continue;
        }
        if (child.kind === 'external-link') {
          const problem = checkExternalLink(child);
          if (problem) report.add({ where, control: label, kind: 'external-link', detail: problem });
          continue;
        }
        if (childKeys.has(child.key) || taken >= CHILD_CAP_PER_PARENT) continue;
        childKeys.add(child.key);
        taken += 1;
        children.push({ target: child, parent });
      }
    };

    /** One control from a fresh load (after re-opening its parent, for revealed ones). */
    const runOne = async (target: Control, parent?: Control) => {
      const label = parent ? `${nameOf(parent)} › ${nameOf(target)}` : nameOf(target);
      const { page, watch } = await openPage(context, { report, where, appOrigin, signedIn: true });
      created.watch(page, appOrigin);
      try {
        if (!(await load(page, watch, url))) return;
        // Other specs add data while the crawl runs: whose item is whose is decided again for every click.
        const foreignNow = foreignStrings(await fakeState(api));
        let now = await enumerateControls(page, foreignNow);
        if (parent) {
          const holder = now.find((c) => c.key === parent.key);
          if (!holder || skipReason(holder) || !(await revealWith(page, watch, { ...holder, name: nameOf(parent) }))) {
            report.note(`${where} › "${label}": could not re-open "${nameOf(parent)}" to reach it`);
            return;
          }
          now = await enumerateControls(page, foreignNow);
        }
        const control = now.find((c) => c.key === target.key);
        if (!control) {
          report.note(`${where} › "${label}": not on the page after a reload (the page changed between loads)`);
          return;
        }
        const nowWhy = skipReason(control);
        if (nowWhy) {
          report.note(`${where} › "${label}": left alone this time (${nowWhy})`);
          return;
        }
        const labelled = { ...control, name: label };
        if (control.kind === 'hash-link') {
          const hash = decodeURIComponent(new URL(control.href ?? '', appOrigin).hash.slice(1));
          const exists = await page.evaluate((id) => !!document.getElementById(id), hash);
          if (!exists) report.add({ where, control: label, kind: 'anchor', detail: `#${hash} isn't on the page` });
        }
        if (control.kind === 'link' && control.href && parent) await checkHref(control.href, label);
        const documentsBefore = watch.documents.length;
        const rscBefore = watch.rsc.length;
        // Only buttons get their revealed controls crawled: re-opening a toggle or a select would change a setting again.
        // (Nor do tabs and nav buttons: the views they switch to are crawled as pages of their own.)
        const opens = !parent && control.owner !== 'foreign' && !control.inNav && (control.kind === 'button' || control.kind === 'tab');
        const result = await activateControl(page, watch, labelled, now, { appOrigin, reveal: opens ? { foreign: foreignNow } : undefined });
        report.count(parent ? 'revealed controls activated' : 'controls activated');
        if (control.kind === 'link') {
          const landed = [...watch.documents.slice(documentsBefore), ...watch.rsc.slice(rscBefore)].find((r) => r.status >= 400);
          if (landed) report.add({ where, control: label, kind: 'link-404', detail: `${shortUrl(landed.url, appOrigin)} answered ${landed.status}` });
          const moved = result.effects.some((e) => e.startsWith('url') || e === 'document' || e === 'navigation' || e === 'navigate' || e.startsWith('popup'));
          if (!moved) report.add({ where, control: label, kind: 'dead', detail: `possibly dead: the link to ${shortUrl(control.href ?? '', appOrigin)} did not navigate` });
        }
        if (result.revealed.length) queueChildren(control, result.revealed);
        if (process.env.CRAWL_DEBUG) {
          const more = result.revealed.length ? ` (revealed ${result.revealed.length})` : '';
          console.log(`${where} › ${label} [${control.kind}] → ${result.effects.join(', ') || 'nothing'}${more}`);
        }
      } finally {
        await created.flush();
        for (const other of context.pages()) await other.close().catch(() => undefined);
      }
    };

    for (const target of queue.slice(0, CONTROL_CAP)) await runOne(target);
    if (children.length > CHILD_CAP) report.note(`${where}: ${children.length} revealed controls, only the first ${CHILD_CAP} were clicked`);
    for (const { target, parent } of children.slice(0, CHILD_CAP)) await runOne(target, parent);
    for (const { href, label } of linksToCheck) await checkHref(href, label);
    if (linksToCheck.length) report.count("links on other specs' data (checked over HTTP, not clicked)", linksToCheck.length);
  } finally {
    await context.close();
    const deleted = await created.cleanUp(api);
    if (deleted.length) report.note(`${where}: deleted ${deleted.length} row(s) the clicks created (${[...new Set(deleted)].join(', ')})`);
    await api.dispose();
  }
  await report.finish(testInfo);
}

test.describe('every control (desktop, English)', () => {
  test.beforeAll(async () => {
    const api = await request.newContext();
    await ensureSeeds(api);
    await api.dispose();
  });

  test('controls: app frame', async ({ browser, authState }, testInfo) => {
    test.setTimeout(10 * 60_000);
    await crawlControls(browser, testInfo, authState, { path: '/dashboard', shell: true }, 'shell');
  });

  for (const route of CONTROL_ROUTES) {
    test(`controls: ${route.path}`, async ({ browser, authState }, testInfo) => {
      test.setTimeout(15 * 60_000);
      await crawlControls(browser, testInfo, authState, route, route.shell ? 'main' : 'all');
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Phone layout

const PHONE_ROUTES = SIGNED_IN_ROUTES.filter((route) => !route.status && !route.finalPath);

test.describe('phone layout @mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone checks run in the mobile project (Pixel 7)');

  for (const locale of LOCALES) {
    test(`phone pages in ${locale} @mobile`, async ({ browser, authState }, testInfo) => {
      test.setTimeout(15 * 60_000);
      const report = new CrawlReport();
      const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
      for (const route of PHONE_ROUTES) {
        const context = await newContext(browser, testInfo, { signedIn: authState });
        try {
          const where = `${locale} ${route.path} (phone)`;
          const { page, watch } = await openPage(context, { report, where, appOrigin, signedIn: true });
          if (!(await load(page, watch, pagePath(locale, route)))) continue;
          await checkLoadedPage(page, watch, report, { locale, route, where, appOrigin });
          const overflow = await horizontalOverflow(page);
          if (overflow) report.add({ where, kind: 'h-scroll', detail: overflow });
          if (route.shell) await checkTabBar(page, report, where, locale);
          await checkMainAction(page, report, where, route.path);
          report.count('phone pages loaded');
        } finally {
          await context.close();
        }
      }
      await report.finish(testInfo);
    });
  }

  test('tab bar and More sheet @mobile', async ({ browser, authState }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const report = new CrawlReport();
    const appOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
    const context = await newContext(browser, testInfo, { signedIn: authState });
    const navName = message('en', 'AppShell.primaryNavigation');
    const moreName = message('en', 'AppShell.nav.more');
    const tabBar = (page: Page) => page.getByRole('navigation', { name: navName }).filter({ visible: true });
    try {
      // Every tab opens its page, and shows as the current one there. The tabs are read from the
      // bar itself, starting from a page none of them points at (Help, or Settings).
      const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const probe = await openPage(context, { report, where: 'en tab bar', appOrigin, signedIn: true });
      let start = '/en/support';
      let tabs: Array<{ name: string; href: string }> = [];
      if (await load(probe.page, probe.watch, start)) {
        tabs = await tabBar(probe.page).getByRole('link').evaluateAll((els) => els.map((el) => ({ name: (el.textContent ?? '').trim(), href: el.getAttribute('href') ?? '' })));
        if (tabs.some((tab) => tab.href === start)) start = '/en/settings';
      }
      await probe.page.close();
      expect(tabs.length, 'links in the tab bar').toBeGreaterThan(0);
      for (const tab of tabs) {
        const where = `en tab bar › ${tab.name}`;
        const { page, watch } = await openPage(context, { report, where, appOrigin, signedIn: true });
        if (!(await load(page, watch, start))) continue;
        const link = tabBar(page).getByRole('link', { name: tab.name, exact: true });
        try {
          watch.phase = { name: 'control', control: tab.name, isSubmit: false };
          await link.click({ timeout: 10_000 });
          await expect(page).toHaveURL(new RegExp(`${escape(tab.href)}$`), { timeout: 30_000 });
          await watch.settle();
          await expect(link).toHaveAttribute('aria-current', 'page', { timeout: 10_000 });
        } catch (error) {
          report.add({ where, control: tab.name, kind: 'tab-bar', detail: String(error).split('\n')[0] });
        }
        report.count('tab bar links opened');
        await page.close();
      }

      // The More sheet: opens as a dialog, closes with Escape and its close button, and each link opens its page.
      const where = 'en More sheet';
      const open = async () => {
        const { page, watch } = await openPage(context, { report, where, appOrigin, signedIn: true });
        if (!(await load(page, watch, '/en/dashboard'))) return null;
        await tabBar(page).getByRole('button', { name: moreName, exact: true }).click({ timeout: 10_000 });
        const sheet = page.getByRole('dialog', { name: moreName });
        await expect(sheet).toBeVisible({ timeout: 10_000 });
        return { page, watch, sheet };
      };
      const first = await open();
      if (!first) throw new Error('the dashboard did not load');
      const links = await first.sheet.getByRole('link').evaluateAll((els) => els.map((el) => ({ name: (el.textContent ?? '').trim(), href: el.getAttribute('href') ?? '' })));
      expect(links.length, 'links in the More sheet').toBeGreaterThan(0);
      await first.page.keyboard.press('Escape');
      await expect(first.sheet)
        .toBeHidden({ timeout: 5_000 })
        .catch(() => report.add({ where, kind: 'more-sheet', detail: 'Escape does not close the More sheet' }));
      await first.page.close();

      const second = await open();
      if (second) {
        await second.sheet.getByRole('button', { name: message('en', 'AppShell.close'), exact: true }).click({ timeout: 10_000 });
        await expect(second.sheet)
          .toBeHidden({ timeout: 5_000 })
          .catch(() => report.add({ where, kind: 'more-sheet', detail: 'the close button does not close the More sheet' }));
        await second.page.close();
      }

      for (const link of links) {
        const opened = await open();
        if (!opened) continue;
        const { page, watch, sheet } = opened;
        watch.phase = { name: 'control', control: link.name, isSubmit: false };
        try {
          await sheet.getByRole('link', { name: link.name, exact: true }).click({ timeout: 10_000 });
          await expect(page).toHaveURL(new RegExp(`${link.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), { timeout: 30_000 });
          await watch.settle();
          await expect(sheet).toBeHidden({ timeout: 10_000 });
          const status = await page.request.get(link.href).then((r) => r.status());
          if (status >= 400) report.add({ where, control: link.name, kind: 'link-404', detail: `${link.href} answered ${status}` });
        } catch (error) {
          report.add({ where, control: link.name, kind: 'more-sheet', detail: String(error).split('\n')[0] });
        }
        report.count('More sheet links opened');
        await page.close();
      }
    } finally {
      await context.close();
    }
    await report.finish(testInfo);
  });
});

/** The bottom tab bar is there, inside the screen, with its tabs and More. */
async function checkTabBar(page: Page, report: CrawlReport, where: string, locale: string) {
  const bar = page.getByRole('navigation', { name: message(locale, 'AppShell.primaryNavigation') }).filter({ visible: true });
  if ((await bar.count()) !== 1) {
    report.add({ where, kind: 'tab-bar', detail: `expected one visible tab bar, found ${await bar.count()}` });
    return;
  }
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const box = await bar.boundingBox();
  if (!box || box.x < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1 || box.y < viewport.height / 2) {
    report.add({ where, kind: 'tab-bar', detail: `the tab bar isn't fixed at the bottom of the screen (${JSON.stringify(box)})` });
  }
  const links = await bar.getByRole('link').count();
  const more = await bar.getByRole('button', { name: message(locale, 'AppShell.nav.more') }).count();
  if (links < 3 || more !== 1) report.add({ where, kind: 'tab-bar', detail: `expected tabs and a More button, found ${links} links and ${more} More button` });
}

/** The page's primary action (the one Ember button) is within the screen, uncovered, and big enough to tap. */
async function checkMainAction(page: Page, report: CrawlReport, where: string, path: string) {
  const primaries = page.locator('#main-content .buttonPrimary').filter({ visible: true });
  const count = await primaries.count();
  if (count === 0) {
    report.count('phone pages without a primary action');
    report.note(`no primary (Ember) action to check on ${path} (phone)`);
    return;
  }
  const action = primaries.first();
  const name = ((await action.getAttribute('aria-label')) ?? (await action.innerText())).trim();
  // Scrolled to the middle of the screen, as far as the page lets it: the best a person can do.
  // (Just "into view" can leave it at the bottom edge, under the fixed tab bar, while scrolling on
  // would free it.)
  await action.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const box = await action.boundingBox();
  if (!box) return;
  if (box.x < -1 || box.x + box.width > viewport.width + 1) {
    report.add({ where, control: name, kind: 'main-action', detail: `sticks out of the ${viewport.width}px screen (x ${Math.round(box.x)}, width ${Math.round(box.width)})` });
  }
  if (box.height < 40) report.add({ where, control: name, kind: 'main-action', detail: `only ${Math.round(box.height)}px tall to tap (44px expected on touch screens)` });
  const covered = await action.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    // The middle of the part of the button that is on screen.
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, (top + bottom) / 2);
    if (!hit || el === hit || el.contains(hit)) return null;
    const cls = typeof hit.className === 'string' ? hit.className.split(/\s+/)[0] : '';
    const holder = hit.closest('nav, header, footer, [role=dialog], dialog');
    const where = holder ? ` in <${holder.tagName.toLowerCase()}${holder.getAttribute('aria-label') ? ` "${holder.getAttribute('aria-label')}"` : ''}>` : '';
    return `<${hit.tagName.toLowerCase()}${cls ? ` .${cls}` : ''}>${where}`;
  });
  if (covered) {
    const scroll = await page.evaluate(() => ({ y: Math.round(window.scrollY), max: Math.round(document.documentElement.scrollHeight - window.innerHeight) }));
    report.add({ where, control: name, kind: 'main-action', detail: `covered by ${covered} with the page scrolled to bring it to the middle (scrollY ${scroll.y} of ${scroll.max}, button at y ${Math.round(box.y)}–${Math.round(box.y + box.height)} of ${viewport.height})` });
  }
}

// ---------------------------------------------------------------------------
// The summary: every problem of the run in one list

function summarize(testInfo: TestInfo) {
  const reports = readReports(testInfo);
  // Unused allowlist entries only mean something where every control gets clicked (desktop).
  const summary = formatSummary(reports, { full: !testInfo.project.use.isMobile });
  console.log(`\nCrawl summary (${testInfo.project.name}):\n${summary}\n`);
  return { reports, summary };
}

test('crawl summary', async ({ isMobile }, testInfo) => {
  test.skip(isMobile, 'The mobile project has its own summary');
  const { reports, summary } = summarize(testInfo);
  await testInfo.attach('crawl-summary.txt', { body: summary, contentType: 'text/plain' });
  const failures = reports.flatMap((r) => r.problems).filter((p) => !allowedBy(p));
  expect(failures.map(describeProblem), `The crawl found problems:\n${summary}`).toEqual([]);
});

test('crawl summary @mobile', async ({ isMobile }, testInfo) => {
  test.skip(!isMobile, 'Runs in the mobile project');
  const { reports, summary } = summarize(testInfo);
  await testInfo.attach('crawl-summary.txt', { body: summary, contentType: 'text/plain' });
  const failures = reports.flatMap((r) => r.problems).filter((p) => !allowedBy(p));
  expect(failures.map(describeProblem), `The crawl found problems:\n${summary}`).toEqual([]);
});
