import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
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
 * Jobs and Analytics, end to end against the fakes. Each test adds jobs of
 * its own (a unique company name) and removes them; counts are compared on
 * the page itself, never as global totals, since other specs add jobs too.
 */

type Stage = 'saved' | 'applied' | 'oa' | 'interview' | 'offer' | 'rejected';
const STAGES: Stage[] = ['saved', 'applied', 'oa', 'interview', 'offer', 'rejected'];

const pad = (n: number) => String(n).padStart(2, '0');
/** A local date, `days` from today, as a date input wants it. */
function dateInput(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const column = (page: Page, stage: Stage) =>
  page.getByRole('region', { name: m('Jobs.boardLabel') }).getByRole('group', { name: new RegExp(`^${escapeRegExp(m(`Jobs.stages.${stage}`))}:`) });
const names = (title: string, company: string) => ({ title, company });

async function openMenu(page: Page, title: string, company: string): Promise<Locator> {
  const menu = page.getByRole('group', { name: m('Jobs.actionsLabel', names(title, company)) });
  if (!(await menu.isVisible())) await page.getByRole('button', { name: m('Jobs.actionsLabel', names(title, company)) }).click();
  await expect(menu).toBeVisible();
  return menu;
}

async function addJob(page: Page, job: { company: string; title: string; stage?: Stage; link?: string; notes?: string; interview?: string; followUp?: string }) {
  await page.getByRole('button', { name: m('Jobs.add'), exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: m('Jobs.add') });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(m('Jobs.company'), { exact: true }).fill(job.company);
  await dialog.getByLabel(m('Jobs.title'), { exact: true }).fill(job.title);
  if (job.link) await dialog.getByLabel(m('Jobs.link'), { exact: true }).fill(job.link);
  if (job.stage) await dialog.getByLabel(m('Jobs.stage'), { exact: true }).selectOption(job.stage);
  if (job.interview) await dialog.getByLabel(m('Jobs.interviewAt'), { exact: true }).fill(job.interview);
  if (job.followUp) await dialog.getByLabel(m('Jobs.followUp'), { exact: true }).fill(job.followUp);
  if (job.notes) await dialog.getByLabel(m('Jobs.notes'), { exact: true }).fill(job.notes);
  await dialog.getByRole('button', { name: m('Jobs.addJob'), exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function jobRow(page: Page, company: string) {
  const [row] = await restGet(page.request, 'job_applications', `user_id=eq.${USER.id}&company=eq.${encodeURIComponent(company)}`);
  return row ?? null;
}

test.describe('Jobs board', () => {
  const mark = marker('jobs');

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/jobs', '/en/goals']);
  });

  test.afterAll(async ({ request }) => {
    for (const job of await restGet(request, 'job_applications', `user_id=eq.${USER.id}&company=like.*${mark}*`)) {
      await restDelete(request, 'job_applications', `id=eq.${job.id}`);
    }
  });

  test('adds a job with every field, edits it and moves it through every stage', async ({ page }) => {
    test.setTimeout(180_000);
    const company = `Acme ${mark}`;
    const title = 'Platform engineer';
    await signIn(page, '/en/jobs');
    await addJob(page, {
      company,
      title,
      stage: 'applied',
      link: 'https://jobs.example.test/acme/platform',
      notes: 'Recruiter: Sam',
      interview: `${dateInput(5)}T14:30`,
      followUp: dateInput(3),
    });
    await expect(page.getByText(m('Jobs.jobAt', names(title, company)))).toBeVisible();
    const card = column(page, 'applied').getByRole('listitem').filter({ hasText: company });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Recruiter: Sam');
    await expect(card.getByText(new RegExp(`^${escapeRegExp(m('Jobs.interviewOn', { when: '' }))}`))).toBeVisible();
    await expect(card.getByText(new RegExp(`^${escapeRegExp(m('Jobs.followUpOn', { when: '' }))}`))).toBeVisible();

    const saved = await jobRow(page, company);
    expect(saved).toMatchObject({ title, stage: 'applied', status: 'active', job_url: 'https://jobs.example.test/acme/platform', notes: 'Recruiter: Sam' });
    expect(saved?.applied_at).toBeTruthy();
    expect(new Date(String(saved?.interview_at)).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(String(saved?.next_followup_at)).getTime()).toBeGreaterThan(Date.now());

    // Edit: the dialog opens with what was saved.
    const menu = await openMenu(page, title, company);
    await menu.getByRole('button', { name: m('Jobs.editLabel', names(title, company)) }).click();
    const dialog = page.getByRole('dialog', { name: m('Jobs.editTitle') });
    await expect(dialog.getByLabel(m('Jobs.company'), { exact: true })).toHaveValue(company);
    await expect(dialog.getByLabel(m('Jobs.link'), { exact: true })).toHaveValue('https://jobs.example.test/acme/platform');
    await expect(dialog.getByLabel(m('Jobs.followUp'), { exact: true })).toHaveValue(dateInput(3));
    const newTitle = 'Staff platform engineer';
    await dialog.getByLabel(m('Jobs.title'), { exact: true }).fill(newTitle);
    await dialog.getByLabel(m('Jobs.notes'), { exact: true }).fill('Recruiter: Sam. Second round booked.');
    await dialog.getByRole('button', { name: m('Jobs.save'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toContainText(newTitle);
    await expect(card).toContainText('Second round booked.');
    expect(await jobRow(page, company)).toMatchObject({ title: newTitle, notes: 'Recruiter: Sam. Second round booked.' });

    // Every stage, with the card's "Move to" menu.
    for (const stage of ['saved', 'oa', 'interview', 'offer', 'rejected', 'applied'] as Stage[]) {
      const actions = await openMenu(page, newTitle, company);
      await actions.getByLabel(m('Jobs.moveTo'), { exact: true }).selectOption(stage);
      await expect(column(page, stage).getByRole('listitem').filter({ hasText: company })).toBeVisible();
      await expect(page.getByText(m('Jobs.movedBody', { title: newTitle, stage: m(`Jobs.stages.${stage}`) })).first()).toBeVisible();
      await expect.poll(async () => (await jobRow(page, company))?.stage).toBe(stage);
    }

    // Still there after a reload, in the stage it was left in.
    await page.reload();
    await expect(column(page, 'applied').getByRole('listitem').filter({ hasText: company })).toBeVisible();
  });

  test('moves a job by drag and drop', async ({ page }) => {
    const company = `Dragco ${mark}`;
    const title = 'Engineer';
    await signIn(page, '/en/jobs');
    await addJob(page, { company, title });
    const card = column(page, 'saved').getByRole('listitem').filter({ hasText: company });
    await expect(card).toBeVisible();
    await card.locator('[draggable="true"]').dragTo(column(page, 'interview').getByRole('list'));
    await expect(column(page, 'interview').getByRole('listitem').filter({ hasText: company })).toBeVisible();
    await expect.poll(async () => (await jobRow(page, company))?.stage).toBe('interview');
  });

  test('searches, filters by stage with matching counts, and shows follow-ups and overdue ones', async ({ page }) => {
    const due = `Duesoon ${mark}`;
    const late = `Overdue ${mark}`;
    await signIn(page, '/en/jobs');
    await addJob(page, { company: due, title: 'Designer', stage: 'interview', followUp: dateInput(2) });
    await addJob(page, { company: late, title: 'Designer', stage: 'interview', followUp: dateInput(-1) });

    const dueCard = column(page, 'interview').getByRole('listitem').filter({ hasText: due });
    const lateCard = column(page, 'interview').getByRole('listitem').filter({ hasText: late });
    await expect(dueCard.getByText(new RegExp(`^${escapeRegExp(m('Jobs.followUpOn', { when: '' }))}`))).toBeVisible();
    await expect(lateCard.getByText(new RegExp(`^${escapeRegExp(m('Jobs.followUpOverdue', { when: '' }))}`))).toBeVisible();

    // Search narrows to the matches; a query with none says so.
    const search = page.getByRole('searchbox', { name: m('Jobs.search') });
    await search.fill(mark);
    await expect(page.getByRole('listitem').filter({ hasText: due })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: late })).toBeVisible();
    await expect(page.locator('[data-menu]').filter({ hasNotText: mark })).toHaveCount(0);
    await search.fill(`${mark}-nothing-matches`);
    await expect(page.getByText(m('Jobs.noMatches'), { exact: true })).toBeVisible();
    await search.fill('');

    // Each stage tab: pressed, and its count is the number of jobs shown in that stage.
    const tabs = page.getByRole('group', { name: m('Jobs.filterLabel') });
    for (const stage of STAGES) {
      const tab = tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m(`Jobs.stages.${stage}`))} \\d+$`) });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-pressed', 'true');
      const shown = await column(page, stage).locator('[data-menu]').count();
      await expect(tab).toHaveText(new RegExp(`${shown}$`));
      for (const other of STAGES.filter((s) => s !== stage)) {
        await expect(column(page, other).locator('[data-menu]')).toHaveCount(0);
      }
    }
    const all = tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m('Jobs.all'))} \\d+$`) });
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    const total = await page.locator('[data-menu]').count();
    await expect(all).toHaveText(new RegExp(`${total}$`));
  });

  test('"Make a goal" opens the goal form filled in from the job', async ({ page }) => {
    const company = `Goalco ${mark}`;
    const title = 'Product manager';
    await signIn(page, '/en/jobs');
    await addJob(page, { company, title, notes: 'Panel on Thursday' });
    const row = await jobRow(page, company);
    const menu = await openMenu(page, title, company);
    await menu.getByRole('link', { name: m('Jobs.makeGoal') }).click();
    await page.waitForURL(`**/en/goals?fromJob=${row?.id}`, { timeout: 120_000 });
    const sheet = page.getByRole('dialog', { name: m('Goals.newGoal') });
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByLabel(m('Goals.role'), { exact: true })).toHaveValue(title);
    await expect(sheet.getByLabel(m('Goals.company'), { exact: true })).toHaveValue(company);
    await expect(sheet.getByLabel(m('Goals.name'), { exact: true })).toHaveValue(m('Jobs.jobAt', names(title, company)));
    // Nothing is saved until the form is.
    expect(await restGet(page.request, 'goals', `user_id=eq.${USER.id}&job_application_id=eq.${row?.id}`)).toHaveLength(0);
  });

  test('deletes a job only once confirmed', async ({ page }) => {
    const company = `Deleteco ${mark}`;
    const title = 'Analyst';
    await signIn(page, '/en/jobs');
    await addJob(page, { company, title });
    const card = page.locator('[data-menu]').filter({ hasText: company });
    await expect(card).toBeVisible();

    // Dismissed: it stays.
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe(m('Jobs.confirmDelete', names(title, company)));
      void dialog.dismiss();
    });
    await (await openMenu(page, title, company)).getByRole('button', { name: m('Jobs.deleteLabel', names(title, company)) }).click();
    await expect(card).toBeVisible();
    expect(await jobRow(page, company)).not.toBeNull();

    page.once('dialog', (dialog) => void dialog.accept());
    await (await openMenu(page, title, company)).getByRole('button', { name: m('Jobs.deleteLabel', names(title, company)) }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText(m('Jobs.deletedBody', { title }))).toBeVisible();
    expect(await jobRow(page, company)).toBeNull();
  });

  test('on a phone: the add sheet, the stage selector and the list @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'The phone layout (one filtered list) shows below 768px; the mobile project runs it.');
    const company = `Phoneco ${mark}`;
    const title = 'iOS engineer';
    await signIn(page, '/en/jobs');
    await addJob(page, { company, title, stage: 'oa' });
    // Phones get one list grouped by stage instead of the board.
    await expect(page.getByRole('region', { name: m('Jobs.boardLabel') })).toHaveCount(0);
    const group = page.getByRole('group', { name: new RegExp(`^${escapeRegExp(m('Jobs.stages.oa'))}:`) });
    await expect(group.getByRole('listitem').filter({ hasText: company })).toBeVisible();

    // The stage selector filters the list to one stage.
    const tabs = page.getByRole('group', { name: m('Jobs.filterLabel') });
    await tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m('Jobs.stages.offer'))} \\d+$`) }).click();
    await expect(page.locator('[data-menu]').filter({ hasText: company })).toHaveCount(0);
    await tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m('Jobs.stages.oa'))} \\d+$`) }).click();
    await expect(page.locator('[data-menu]').filter({ hasText: company })).toBeVisible();

    // Its menu works by touch too.
    const menu = await openMenu(page, title, company);
    await menu.getByLabel(m('Jobs.moveTo'), { exact: true }).selectOption('interview');
    await expect.poll(async () => (await jobRow(page, company))?.stage).toBe('interview');
    page.once('dialog', (dialog) => void dialog.accept());
    await tabs.getByRole('button', { name: new RegExp(`^${escapeRegExp(m('Jobs.all'))} \\d+$`) }).click();
    await (await openMenu(page, title, company)).getByRole('button', { name: m('Jobs.deleteLabel', names(title, company)) }).click();
    await expect(page.locator('[data-menu]').filter({ hasText: company })).toHaveCount(0);
  });
});

test.describe('Analytics', () => {
  const mark = marker('analytics');
  const ids: { session?: string; report?: string; job?: string } = {};

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await warmUp(request, ['/en/auth', '/en/analytics', '/en/analytics/funnel', '/en/analytics/weekly', '/en/analytics/reports']);
    // Activity of our own, three days ago (so it isn't the newest row anywhere else).
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const [session] = await restInsert(request, 'interview_sessions', {
      user_id: USER.id,
      title: mark,
      status: 'completed',
      meta: {},
      created_at: at,
      updated_at: at,
    });
    ids.session = String(session.id);
    const [report] = await restInsert(request, 'interview_reports', {
      session_id: ids.session,
      user_id: USER.id,
      mode: 'general',
      overall_score: 77,
      summary: mark,
      strengths: [],
      weaknesses: [],
      next_steps: [],
      rubric: {},
      generated_at: at,
      created_at: at,
    });
    ids.report = String(report.id);
    const [job] = await restInsert(request, 'job_applications', {
      user_id: USER.id,
      company: `Funnelco ${mark}`,
      title: 'Engineer',
      stage: 'interview',
      status: 'active',
      applied_at: at,
      created_at: at,
      updated_at: at,
    });
    ids.job = String(job.id);
  });

  test.afterAll(async ({ request }) => {
    if (ids.report) await restDelete(request, 'interview_reports', `id=eq.${ids.report}`);
    if (ids.session) await restDelete(request, 'interview_sessions', `id=eq.${ids.session}`);
    if (ids.job) await restDelete(request, 'job_applications', `id=eq.${ids.job}`);
    for (const report of await restGet(request, 'analytics_report_schedules', `user_id=eq.${USER.id}&id=in.(${(reportIds.length ? reportIds : ['00000000-0000-0000-0000-000000000000']).join(',')})`)) {
      await restDelete(request, 'analytics_report_schedules', `id=eq.${report.id}`);
    }
  });

  const reportIds: string[] = [];

  async function download(page: Page, button: Locator) {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button.click()]);
    return { name: file.suggestedFilename(), body: await readFile(await file.path()) };
  }

  test('every tab opens its view', async ({ page }) => {
    await signIn(page, '/en/analytics');
    const nav = page.getByRole('navigation', { name: m('AnalyticsNav.label') });
    const views = [
      { link: 'overview', path: '/en/analytics', heading: 'Overview.title' },
      { link: 'funnel', path: '/en/analytics/funnel', heading: 'Funnel.title' },
      { link: 'weekly', path: '/en/analytics/weekly', heading: 'Weekly.title' },
      { link: 'reports', path: '/en/analytics/reports', heading: 'Reports.title' },
      { link: 'overview', path: '/en/analytics', heading: 'Overview.title' },
    ];
    for (const view of views) {
      await nav.getByRole('link', { name: m(`AnalyticsNav.${view.link}`), exact: true }).click();
      await page.waitForURL((url) => url.pathname === view.path, { timeout: 120_000 });
      await expect(page.getByRole('heading', { name: m(view.heading), exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(nav.getByRole('link', { name: m(`AnalyticsNav.${view.link}`), exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('overview: date ranges, and CSV and PDF exports', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, '/en/analytics');
    const range = page.getByRole('group', { name: m('Overview.range') });
    await expect(range).toBeVisible({ timeout: 60_000 });
    const practiceTile = page.locator('.tile').filter({ hasText: m('Overview.practiceInterviews') }).first();
    for (const days of [7, 30, 90]) {
      const button = range.getByRole('button', { name: m('Overview.days', { days }), exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('heading', { name: m(days === 90 ? 'Overview.weekly' : 'Overview.daily'), exact: true })).toBeVisible();
      // Our practice interview from three days ago is in every range.
      await expect.poll(async () => Number((await practiceTile.locator('.tile-value').textContent())?.replace(/\D/g, '') || 0)).toBeGreaterThanOrEqual(1);
    }
    await expect(page.getByText(m('Overview.scores'), { exact: true })).toBeVisible();

    await range.getByRole('button', { name: m('Overview.days', { days: 30 }), exact: true }).click();
    const csv = await download(page, page.getByRole('button', { name: m('Export.csvShort'), exact: true }));
    expect(csv.name).toBe('activity-last-30-days.csv');
    expect(csv.body.toString('utf8').split('\n')[0]).toContain(m('Overview.csvPeriod'));

    const pdf = await download(page, page.getByRole('button', { name: m('Export.pdfShort'), exact: true }));
    expect(pdf.name).toBe('activity-last-30-days.pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('job search funnel: stages and exports', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, '/en/analytics/funnel');
    await expect(page.getByRole('heading', { name: m('Funnel.title'), exact: true })).toBeVisible();
    const funnel = page.locator('#funnel-detail');
    await expect(funnel).toBeVisible({ timeout: 60_000 });
    for (const stage of ['tracked', 'applied', 'interviewing', 'offer']) {
      await expect(funnel.getByText(m(`Funnel.stages.${stage}`), { exact: true })).toBeVisible();
    }
    const csv = await download(page, page.getByRole('button', { name: m('Export.csvShort'), exact: true }));
    expect(csv.name).toBe('job-search-funnel.csv');
    expect(csv.body.toString('utf8').split('\n')[0]).toContain(m('Funnel.csv.stage'));
    const pdf = await download(page, page.getByRole('button', { name: m('Export.pdfShort'), exact: true }));
    expect(pdf.name).toBe('job-search-funnel.pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('week by week: the metric switch and the exports', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, '/en/analytics/weekly');
    const metrics = page.getByRole('group', { name: m('Weekly.metricLabel') });
    await expect(metrics).toBeVisible({ timeout: 60_000 });
    for (const row of ['averageScore', 'liveSessions', 'liveMinutes', 'applied', 'practice']) {
      const button = metrics.getByRole('button', { name: m(`Weekly.rows.${row}`), exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(metrics.getByRole('button', { pressed: true })).toHaveCount(1);
    }
    await expect(page.getByText(m('Weekly.thisWeek'), { exact: true })).toBeVisible();

    const csv = await download(page, page.getByRole('button', { name: m('Export.csvShort'), exact: true }));
    expect(csv.name).toBe('weekly-activity.csv');
    expect(csv.body.toString('utf8').split('\n')[0]).toContain(m('Weekly.csv.week'));
    const pdf = await download(page, page.getByRole('button', { name: m('Export.pdfShort'), exact: true }));
    expect(pdf.name).toBe('weekly-activity.pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('email reports: schedule one, pause and resume it, send now, delete it', async ({ page, request }) => {
    await signIn(page, '/en/analytics/reports');
    await expect(page.getByRole('heading', { name: m('Reports.title'), exact: true })).toBeVisible();
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: m('Reports.schedule') }) });
    await form.getByLabel(m('Reports.report'), { exact: true }).selectOption('job_search');
    await expect(form.getByText(m('Reports.types.job_search.help'))).toBeVisible();
    await form.getByLabel(m('Reports.howOften'), { exact: true }).selectOption('monthly');

    const created = page.waitForResponse((res) => res.url().endsWith('/api/analytics/reports') && res.request().method() === 'POST');
    await form.getByRole('button', { name: m('Reports.schedule'), exact: true }).click();
    const res = await created;
    expect(res.status()).toBe(201);
    const { report } = await res.json();
    reportIds.push(report.id);
    await expect(page.getByRole('status').filter({ hasText: m('Reports.scheduled') })).toBeVisible();
    expect(await restRow(request, 'analytics_report_schedules', report.id)).toMatchObject({
      user_id: USER.id,
      report_type: 'job_search',
      frequency: 'monthly',
      enabled: true,
    });

    // The new one is last in the list.
    const item = page.locator('li').filter({ hasText: m('Reports.types.job_search.label') }).filter({ hasText: m('Reports.frequencies.monthly') }).last();
    await expect(item).toBeVisible();

    await item.getByRole('button', { name: m('Reports.pause'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: m('Reports.paused') })).toBeVisible();
    await expect(item).toContainText(m('Reports.pausedState'));
    expect((await restRow(request, 'analytics_report_schedules', report.id))?.enabled).toBe(false);

    await item.getByRole('button', { name: m('Reports.resume'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: m('Reports.resumed') })).toBeVisible();
    expect((await restRow(request, 'analytics_report_schedules', report.id))?.enabled).toBe(true);

    // Email isn't set up on the fake server: "Send now" is off, and the page says why.
    await expect(page.getByText(m('Reports.emailUnconfigured'))).toBeVisible();
    await expect(item.getByRole('button', { name: m('Reports.sendNow'), exact: true })).toBeDisabled();

    await item.getByRole('button', { name: m('Reports.delete'), exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: m('Reports.deleted') })).toBeVisible();
    await expect.poll(() => restRow(request, 'analytics_report_schedules', report.id)).toBeNull();
  });

  test('on a phone: the views, the overview and its table as a list, with no sideways scroll @mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'The phone layout; the mobile project runs it.');
    await signIn(page, '/en/analytics');
    const nav = page.getByRole('navigation', { name: m('AnalyticsNav.label') });
    await expect(page.getByRole('group', { name: m('Overview.range') })).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // The table view becomes a list on a phone.
    await page.getByText(m('Overview.table'), { exact: true }).click();
    await expect(page.getByRole('list', { name: m('Overview.tableCaption', { days: 30 }) })).toBeVisible();
    for (const [link, path, heading] of [
      ['reports', '/en/analytics/reports', 'Reports.title'],
      ['weekly', '/en/analytics/weekly', 'Weekly.title'],
      ['funnel', '/en/analytics/funnel', 'Funnel.title'],
    ] as const) {
      await nav.getByRole('link', { name: m(`AnalyticsNav.${link}`), exact: true }).click();
      await page.waitForURL((url) => url.pathname === path, { timeout: 120_000 });
      await expect(page.getByRole('heading', { name: m(heading), exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(nav.getByRole('link', { name: m(`AnalyticsNav.${link}`), exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });

  test('?debug=1 shows the data checks, and only then', async ({ page }) => {
    await signIn(page, '/en/analytics');
    await expect(page.getByRole('heading', { name: m('Overview.title'), exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: m('PageTitles.dataChecks') })).toHaveCount(0);
    await go(page, '/en/analytics?debug=1');
    const checks = page.getByRole('region', { name: m('PageTitles.dataChecks') });
    await expect(checks).toBeVisible({ timeout: 60_000 });
    await expect(checks.getByText(m('DataChecks.title'), { exact: true }).first()).toBeVisible();
  });
});
