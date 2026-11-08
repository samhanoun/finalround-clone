import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { ANSWER_PIECES, QUESTION, RESUME, WAV_PATH } from '../fakes/config.cjs';
import {
  FIRST_LOAD,
  deleteCopilotSessions,
  deleteRows,
  escapeRegExp,
  field,
  fill,
  format,
  hideNextDevBadge,
  insertRow,
  marker,
  modelRequestsMentioning,
  msg,
  rows,
  signIn,
  watchPage,
} from './helpers/flowsA';

/**
 * The live copilot, end to end against the fakes: the setup (by hand and from
 * a goal), a session with typed and spoken questions, the answer card's
 * controls, Solve screen, the floating window, the tools, stopping, and Past
 * sessions. The fake OpenAI answers "linked list" questions with code and
 * "design a url shortener" with a diagram.
 *
 * Starting a session ends the user's other open sessions, so these tests run
 * one at a time and only ever stop or delete sessions they started.
 */

// The fake microphone plays the scripted interviewer (e2e/fakes/serve.mjs writes the file), and the
// fake Deepgram "hears" the question after a second of it. Everything else is as in the config.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV_PATH}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

const setupRegion = (page: Page) => page.getByRole('region', { name: msg('SessionSetup.label') });
const answerCard = (page: Page) => page.getByRole('region', { name: msg('Answer.label') });
const suggested = (page: Page) => answerCard(page).getByRole('group', { name: msg('Answer.suggested') });
const answeredStatus = (page: Page) =>
  answerCard(page).getByText(new RegExp(`^${escapeRegExp(msg('Answer.status.answered'))} · first words in \\d+ ms$`));

const isStart = (req: Request) => req.url().endsWith('/api/copilot/sessions/start') && req.method() === 'POST';
const isAnswer = (req: Request) => /\/api\/copilot\/sessions\/[^/]+\/answer$/.test(req.url()) && req.method() === 'POST';

/** Opens the live page and waits for the setup's lists (goals, résumés) to load. */
async function openSetup(page: Page, path = '/en/copilot/live') {
  await page.goto(path, FIRST_LOAD);
  const setup = setupRegion(page);
  await expect(setup).toBeVisible(FIRST_LOAD);
  await expect(setup.getByRole('combobox', { name: field(msg('SessionSetup.goal')) }).locator('option').first()).not.toHaveText(msg('SessionSetup.loading'));
  return setup;
}

/** Starts a session from the setup as it is; returns the new session's id. */
async function start(page: Page): Promise<{ id: string; body: Record<string, unknown> }> {
  const request = page.waitForRequest(isStart);
  const response = page.waitForResponse((res) => isStart(res.request()));
  await setupRegion(page).getByRole('button', { name: msg('SessionSetup.start') }).click();
  const res = await response;
  expect(res.status(), 'start session').toBe(201);
  const { session } = (await res.json()) as { session: { id: string } };
  await expect(page.getByRole('button', { name: msg('SessionBar.stop') })).toBeVisible();
  return { id: session.id, body: (await request).postDataJSON() as Record<string, unknown> };
}

/** A quick session by hand: company and role only. */
async function quickSession(page: Page, company: string, role = 'Staff Engineer') {
  const setup = await openSetup(page);
  await setup.getByRole('textbox', { name: field(msg('SessionSetup.company')) }).fill(company);
  await setup.getByRole('textbox', { name: field(msg('SessionSetup.role')) }).fill(role);
  return start(page);
}

async function stop(page: Page) {
  await page.getByRole('button', { name: msg('SessionBar.stop') }).click();
  await expect(setupRegion(page)).toBeVisible();
}

/** More tools → Type a line: sends a line as the interviewer or as you. */
async function sendLine(page: Page, text: string, speaker: 'interviewer' | 'candidate' = 'interviewer') {
  const composer = page.getByRole('textbox', { name: msg('Copilot.composer.title') });
  if (!(await composer.isVisible())) await page.getByRole('button', { name: msg('Copilot.composer.title') }).click();
  await composer.fill(text);
  await page.getByRole('combobox', { name: msg('Copilot.composer.speaker') }).selectOption(speaker);
  const saved = page.waitForResponse((res) => /\/transcript$/.test(res.url()) && res.request().method() === 'POST');
  await page.getByRole('button', { name: msg('Copilot.composer.send') }).click();
  expect((await saved).ok(), 'transcript line saved').toBe(true);
  await expect(composer).toHaveValue('');
}

async function sessionRow(request: APIRequestContext, id: string) {
  const [row] = await rows(request, 'copilot_sessions', (item) => item.id === id);
  return row as (Record<string, unknown> & { id: string; status: string; title: string; metadata: Record<string, unknown> }) | undefined;
}

async function events(request: APIRequestContext, sessionId: string) {
  return (await rows(request, 'copilot_events', (item) => item.session_id === sessionId)) as Array<{
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
  }>;
}

test.describe('live copilot', () => {
  const sessions: string[] = [];
  const cleanup: Array<{ table: string; id: string }> = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    // Compile the page and its routes once, up front (the dev server builds each on first use).
    await request.get('/en/copilot/live', { timeout: 120_000 }).catch(() => undefined);
    const none = '00000000-0000-4000-8000-000000000000';
    for (const route of ['answer', 'screen', 'gate', 'transcript', 'latency', 'heartbeat', 'summarize']) {
      await request.post(`/api/copilot/sessions/${none}/${route}`, { data: {}, timeout: 120_000 }).catch(() => undefined);
    }
    for (const route of ['history', 'export', `${none}`, `${none}/report`, `${none}/stream`]) {
      await request.get(`/api/copilot/sessions/${route}`, { timeout: 120_000, maxRedirects: 0 }).catch(() => undefined);
    }
    await request.post('/api/copilot/sessions/start', { data: {}, timeout: 120_000 }).catch(() => undefined);
    await request.post('/api/copilot/sessions/stop', { data: {}, timeout: 120_000 }).catch(() => undefined);
  });

  test.afterAll(async ({ request }) => {
    await deleteCopilotSessions(request, sessions);
    for (const { table, id } of cleanup) await deleteRows(request, table, [id]);
  });

  test('setup by hand: every field and this session’s choices go into the session', async ({ page, request }) => {
    const watch = watchPage(page);
    const company = marker('live-setup');
    const title = `${company} session`;
    const playbook = await insertRow(request, 'playbooks', { name: `${company} playbook`, instructions: 'Lead with the result.' });
    cleanup.push({ table: 'playbooks', id: playbook.id });

    await signIn(page);
    const setup = await openSetup(page);
    await expect(setup.getByRole('combobox', { name: field(msg('SessionSetup.goal')) })).toHaveValue('');

    // The interview: type, company, role, title; coding interviews can be hints only.
    await setup.getByRole('combobox', { name: field(msg('SessionSetup.mode')) }).selectOption('coding');
    await setup.getByRole('checkbox', { name: msg('SessionSetup.hintsOnly') }).check();
    await setup.getByRole('textbox', { name: field(msg('SessionSetup.company')) }).fill(company);
    await setup.getByRole('textbox', { name: field(msg('SessionSetup.role')) }).fill('Staff Engineer');
    await expect(setup.getByRole('textbox', { name: field(msg('SessionSetup.sessionTitle')) })).toHaveAttribute('placeholder', `Staff Engineer ${fill(msg('SessionSetup.at'), { company })}`);
    await setup.getByRole('textbox', { name: field(msg('SessionSetup.sessionTitle')) }).fill(title);
    await setup.getByRole('combobox', { name: field(msg('SessionSetup.resume')) }).selectOption(RESUME.id);
    await setup.getByRole('textbox', { name: field(msg('SessionSetup.jobDescription')) }).fill('Requirements:\n- Lead large migrations\n- 5+ years in payments');

    // This session's choices.
    await setup.getByRole('combobox', { name: field(msg('SessionSetup.answerModel')) }).selectOption('gpt-4o');
    await setup.getByRole('combobox', { name: field(msg('SessionSetup.spokenLanguage')) }).selectOption('fr');
    await setup.getByRole('combobox', { name: field(msg('SessionSetup.codingLanguage')) }).selectOption('python');
    await setup.getByRole('combobox', { name: field(msg('SessionSetup.playbook')) }).selectOption(playbook.id);

    // The meeting link (Settings → Meeting apps → ask for the link, on by default).
    const link = setup.getByRole('textbox', { name: field(msg('SessionSetup.meetingLink')) });
    if (await link.count()) {
      await expect(setup.getByText(msg('SessionSetup.meetingLinkHelp'))).toBeVisible();
      // Not a web link. (Plain words such as "not a link" pass as "another app": see the report on meetingUrl.)
      await link.fill('ftp://files.example.test/interview');
      await expect(setup.getByText(msg('SessionSetup.meetingLinkInvalid'))).toBeVisible();
      await link.fill('https://whereby.com/acme-interview');
      await expect(setup.getByText(msg('SessionSetup.meetingLinkOther'))).toBeVisible();
      await link.fill('https://meet.google.com/abc-defg-hij');
      await expect(setup.getByText(fill(msg('SessionSetup.meetingLinkFound'), { app: 'Google Meet' }))).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'note', description: 'Meeting link field off in Settings → Meeting apps for the shared user' });
    }

    // Phone or in person is a switch for this session (its own test covers the session).
    const phone = setup.getByRole('checkbox', { name: msg('SessionSetup.singleMic') });
    await phone.check();
    await phone.uncheck();

    const { id, body } = await start(page);
    sessions.push(id);
    expect(body).toMatchObject({
      title,
      company,
      role: 'Staff Engineer',
      resumeDocumentId: RESUME.id,
      jobDescription: 'Requirements:\n- Lead large migrations\n- 5+ years in payments',
      answerModel: 'gpt-4o',
      language: 'fr',
      codingLanguage: 'python',
      playbookId: playbook.id,
      metadata: { mode: 'coding', noFullCodeMode: true },
    });
    expect(body.singleMic).toBeUndefined();

    // The session bar: the title, the type, and that it uses the résumé and job.
    const bar = page.getByRole('region', { name: msg('SessionBar.label') });
    await expect(bar.getByRole('heading', { name: title })).toBeVisible();
    await expect(bar.getByText(msg('SessionBar.modes.coding'))).toBeVisible();
    await expect(bar.getByText(msg('SessionBar.withContext'))).toBeVisible();

    // What the server saved: the choices and the context pack, built from the fields and the playbook.
    const saved = await sessionRow(request, id);
    expect(saved).toMatchObject({ status: 'active', title });
    expect(saved!.metadata).toMatchObject({
      mode: 'coding',
      noFullCodeMode: true,
      codingLanguage: 'python',
      models: { answer: 'gpt-4o' },
      stt: { language: 'fr', singleMic: false },
      context_pack: { company, role: 'Staff Engineer', resume_filename: RESUME.filename, playbook: 'Lead with the result.' },
    });

    await stop(page);
    await expect.poll(async () => (await sessionRow(request, id))?.status).toBe('stopped');
    expect((await sessionRow(request, id))!.metadata).toMatchObject({ stop_reason: 'user' });
    // The setup is remembered for the next interview.
    await expect(setupRegion(page).getByRole('textbox', { name: field(msg('SessionSetup.company')) })).toHaveValue(company);
    watch.expectClean();
  });

  test('setup from a goal: its summary, edits for this session only, and the goal goes along', async ({ page, request }) => {
    const watch = watchPage(page);
    const name = marker('live-goal');
    const playbook = await insertRow(request, 'playbooks', { name: `${name} playbook`, instructions: 'Keep answers under a minute.' });
    cleanup.push({ table: 'playbooks', id: playbook.id });
    const goal = await insertRow(request, 'goals', {
      name,
      company: `${name} Co`,
      role: 'Platform Engineer',
      round: 'behavioral',
      resume_document_id: RESUME.id,
      job_description: 'Own the platform roadmap.',
      playbook_id: playbook.id,
    });
    cleanup.push({ table: 'goals', id: goal.id });

    await signIn(page);
    // Opened from the goal (Goals → Start live session).
    const setup = await openSetup(page, `/en/copilot/live?goal=${goal.id}`);
    await expect(setup.getByRole('combobox', { name: field(msg('SessionSetup.goal')) })).toHaveValue(goal.id);
    const details = setup.locator(`dl[aria-label="${msg('SessionSetup.summaryLabel')}"]`);
    const detail = (term: string) => details.locator('div').filter({ has: page.locator('dt', { hasText: term }) }).locator('dd');
    await expect(detail(msg('SessionSetup.company'))).toHaveText(`${name} Co`);
    await expect(detail(msg('SessionSetup.role'))).toHaveText('Platform Engineer');
    await expect(detail(msg('SessionSetup.round'))).toHaveText(msg('SessionSetup.rounds.behavioral'));
    await expect(detail(msg('SessionSetup.resume'))).toHaveText(RESUME.filename);
    await expect(detail(msg('SessionSetup.playbook'))).toHaveText(`${name} playbook`);
    // The fields stay hidden until asked for.
    await expect(setup.getByRole('textbox', { name: field(msg('SessionSetup.company')) })).toHaveCount(0);
    const edit = setup.getByRole('button', { name: msg('SessionSetup.editForSession') });
    await expect(edit).toHaveAttribute('aria-expanded', 'false');
    await edit.click();
    await expect(edit).toHaveAttribute('aria-expanded', 'true');
    await expect(setup.getByRole('textbox', { name: field(msg('SessionSetup.company')) })).toHaveValue(`${name} Co`);
    await expect(setup.getByRole('textbox', { name: field(msg('SessionSetup.jobDescription')) })).toHaveValue('Own the platform roadmap.');
    await setup.getByRole('textbox', { name: field(msg('SessionSetup.role')) }).fill('Senior Platform Engineer');
    await expect(detail(msg('SessionSetup.role'))).toHaveText('Senior Platform Engineer');
    // The playbook comes from the goal unless this session picks another.
    await expect(setup.getByRole('combobox', { name: field(msg('SessionSetup.playbook')) }).locator('option').first()).toHaveText(
      fill(msg('SessionSetup.fromGoal'), { name: `${name} playbook` }),
    );

    const { id, body } = await start(page);
    sessions.push(id);
    expect(body).toMatchObject({ goalId: goal.id, company: `${name} Co`, role: 'Senior Platform Engineer', resumeDocumentId: RESUME.id });
    const saved = await sessionRow(request, id);
    expect(saved!.metadata).toMatchObject({
      goal_id: goal.id,
      context_pack: { company: `${name} Co`, role: 'Senior Platform Engineer', round: 'behavioral', playbook: 'Keep answers under a minute.' },
    });
    // The goal itself is unchanged: the edit was for this session only.
    expect((await rows(request, 'goals', (row) => row.id === goal.id))[0]).toMatchObject({ role: 'Platform Engineer' });
    await stop(page);
    watch.expectClean();
  });

  test('typed questions stream answers: code panel, diagram, Answer now, Auto, text size, a line to buy time, the summary and the feeds', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const watch = watchPage(page);
    const company = marker('live-typed');
    await signIn(page);
    const { id } = await quickSession(page, company);
    sessions.push(id);
    const card = answerCard(page);
    await expect(card.getByText(msg('Answer.emptyNotListening'))).toBeVisible();

    // A coding question typed as the interviewer: the answer streams in, with its code in the code panel.
    const coding = 'How would you reverse a linked list?';
    const firstAnswer = page.waitForRequest(isAnswer);
    await sendLine(page, coding);
    expect((await firstAnswer).postDataJSON()).toMatchObject({ question: coding, trigger: 'manual' });
    await expect(card.getByText(coding)).toBeVisible();
    await expect(suggested(page)).toContainText('Reverse it in place with two pointers.');
    await expect(answeredStatus(page)).toBeVisible();
    const codeTab = card.getByRole('tab', { name: format('Answer.codeTab', { count: 1 }) });
    await codeTab.click();
    await expect(card.locator('pre code').first()).toContainText('def reverse(head):');
    await card.getByRole('tab', { name: msg('Answer.answerTab') }).click();
    await expect(suggested(page)).toBeVisible();

    // A system-design question: the answer draws the diagram.
    await sendLine(page, 'How would you design a URL shortener?');
    await expect(card.getByRole('img', { name: format('Answer.diagramLabel', { count: 5 }) })).toBeVisible();
    await expect(suggested(page)).toContainText('Rate limit at the gateway.');

    // What reached the database: both lines and both answers, for this session.
    await expect
      .poll(async () => {
        const saved = await events(request, id);
        return {
          lines: saved.filter((e) => e.event_type === 'transcript' && e.payload.speaker === 'interviewer').map((e) => e.payload.text),
          answers: saved.filter((e) => e.event_type === 'suggestion').map((e) => e.payload.question),
        };
      })
      .toEqual({
        lines: [coding, 'How would you design a URL shortener?'],
        answers: [coding, 'How would you design a URL shortener?'],
      });
    // The model got the question with the session's context.
    const asked = await modelRequestsMentioning(request, company);
    expect(asked.some((call) => call.stream && JSON.stringify(call.messages).includes('design a URL shortener'))).toBe(true);

    // Answer now answers the latest interviewer question again.
    const again = page.waitForRequest(isAnswer);
    await card.getByRole('button', { name: msg('Answer.answerNow') }).click();
    expect((await again).postDataJSON()).toMatchObject({ question: 'How would you design a URL shortener?', trigger: 'manual' });
    await expect(answeredStatus(page)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: msg('Copilot.errors.noQuestion') })).toHaveCount(0);

    // Auto (solve the shared screen when it changes): off by default outside coding interviews.
    const auto = card.getByRole('checkbox', { name: msg('Answer.autoScreen') });
    await expect(auto).not.toBeChecked();
    await auto.check();
    await expect(auto).toBeChecked();
    await auto.uncheck();
    await expect(auto).not.toBeChecked();

    // A− / A+: the answer's text size, remembered in this browser.
    const fontPx = () => card.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--answer-font'));
    const before = Number.parseInt(await fontPx(), 10);
    await card.getByRole('button', { name: msg('Answer.larger') }).click();
    await expect.poll(fontPx).toBe(`${before + 1}px`);
    await card.getByRole('button', { name: msg('Answer.smaller') }).click();
    await card.getByRole('button', { name: msg('Answer.smaller') }).click();
    await expect.poll(fontPx).toBe(`${before - 1}px`);
    expect(await page.evaluate(() => window.localStorage.getItem('apex.answerFontPx'))).toBe(String(before - 1));

    // Insert a line to buy time: fills Type a line as you; sending it adds context, not a question.
    const answersBefore = (await events(request, id)).filter((e) => e.event_type === 'suggestion').length;
    await page.getByRole('button', { name: msg('Copilot.composer.filler') }).click();
    const composer = page.getByRole('textbox', { name: msg('Copilot.composer.title') });
    await expect(composer).toHaveValue(msg('Copilot.fillerLine'));
    await expect(page.getByRole('combobox', { name: msg('Copilot.composer.speaker') })).toHaveValue('candidate');
    await page.getByRole('button', { name: msg('Copilot.composer.send') }).click();
    await expect(composer).toHaveValue('');
    await expect
      .poll(async () => (await events(request, id)).some((e) => e.event_type === 'transcript' && e.payload.speaker === 'candidate' && e.payload.text === msg('Copilot.fillerLine')))
      .toBe(true);
    expect((await events(request, id)).filter((e) => e.event_type === 'suggestion').length).toBe(answersBefore);

    // Transcript and answers: side by side, or one at a time.
    const feeds = page.getByRole('region', { name: msg('Copilot.layout.title') });
    const layout = feeds.getByRole('toolbar', { name: msg('Copilot.layout.options') });
    const transcriptPanel = feeds.getByRole('region', { name: msg('LiveFeeds.transcriptLabel') });
    const answersPanel = feeds.getByRole('region', { name: msg('LiveFeeds.answersLabel') });
    await expect(layout.getByRole('button', { name: msg('Copilot.layout.split') })).toHaveAttribute('aria-pressed', 'true');
    await expect(transcriptPanel).toBeVisible();
    await expect(answersPanel).toBeVisible();
    await expect(transcriptPanel.getByText(format('LiveFeeds.lines', { count: 3 }), { exact: true })).toBeVisible();
    await expect(transcriptPanel).toContainText(msg('Copilot.fillerLine'));
    await expect(answersPanel.getByText(/^\d+ saved$/)).toBeVisible();
    await layout.getByRole('button', { name: msg('Copilot.layout.transcript') }).click();
    await expect(answersPanel).toHaveCount(0);
    await expect(transcriptPanel).toBeVisible();
    await layout.getByRole('button', { name: msg('Copilot.layout.answers') }).click();
    await expect(transcriptPanel).toHaveCount(0);
    await expect(answersPanel).toContainText('Rate limit at the gateway.');
    await layout.getByRole('button', { name: msg('Copilot.layout.split') }).click();
    await expect(transcriptPanel).toBeVisible();

    // Session summary: the model's report on the transcript so far (TASK: live_report in the fake model):
    // its summary, strengths, weaknesses and next steps in priority order.
    await page.getByRole('button', { name: msg('Copilot.summary.title') }).click();
    const summarize = page.waitForResponse((res) => res.url().endsWith(`/api/copilot/sessions/${id}/summarize`));
    await page.getByRole('button', { name: msg('Copilot.composer.summarize') }).click();
    expect((await summarize).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: msg('Copilot.report.strengths') }).first()).toBeVisible();
    await expect(page.getByText('Clear, well-ordered answers with a measured result', { exact: false })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: /^Led with the outcome: checkout latency down 40%$/ })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: /^Named trade-offs without explaining them$/ })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: /^P1: Explain one trade-off in each design answer$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: msg('Copilot.summary.again') })).toBeVisible();
    await expect
      .poll(async () => (await rows(request, 'copilot_summaries', (row) => row.session_id === id)).map((row) => row.summary_type).sort())
      .toEqual(['final', 'mock_interview_report']);
    // What's saved is what the model wrote: an area it didn't score stays unscored, with no stock text.
    const [saved] = await rows(request, 'copilot_summaries', (row) => row.session_id === id && row.summary_type === 'mock_interview_report');
    expect(saved.payload).toMatchObject({
      report: { overall_score: 74, hiring_signal: 'lean_hire', rubric: { communication: { score: 4 }, role_fit: { score: null, evidence: '', recommendation: '' } } },
    });

    await stop(page);
    // After the session, its lines stay on the page.
    await expect(page.getByRole('region', { name: fill(msg('Copilot.lastSession'), { title: fill(msg('SessionSetup.titleAt'), { role: 'Staff Engineer', company }) }) })).toBeVisible();
    watch.expectClean();
  });

  test.describe('listening (the fake microphone plays the interviewer)', () => {
    test('a spoken question is answered, Answer now repeats it, Solve screen reads the shared screen, and the answers pop out', async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      const watch = watchPage(page);
      const company = marker('live-listen');
      await signIn(page);
      const { id } = await quickSession(page, company);
      sessions.push(id);
      const card = answerCard(page);
      const audio = page.getByRole('region', { name: msg('AudioSources.title') });

      // Solve screen needs something shared first.
      await expect(card.getByRole('button', { name: msg('Answer.solveScreen') })).toBeDisabled();
      await audio.getByRole('button', { name: msg('AudioSources.start') }).click();
      await expect(audio.getByText(msg('AudioSources.capture.live'), { exact: true })).toBeVisible();
      await expect(audio.getByRole('button', { name: msg('AudioSources.stop') })).toBeVisible();

      // The interviewer's question, heard and answered without a click.
      await expect(card).toContainText(QUESTION, { timeout: 60_000 });
      await expect(suggested(page)).toContainText(ANSWER_PIECES[0].trim(), { timeout: 60_000 });
      await expect(answeredStatus(page)).toBeVisible();
      await expect
        .poll(async () => (await events(request, id)).some((e) => e.event_type === 'transcript' && e.payload.text === QUESTION && e.payload.speaker === 'interviewer'))
        .toBe(true);

      // Answer now: the same question again, on demand.
      const again = page.waitForRequest(isAnswer);
      await card.getByRole('button', { name: msg('Answer.answerNow') }).click();
      expect((await again).postDataJSON()).toMatchObject({ question: QUESTION, trigger: 'manual' });
      await expect(answeredStatus(page)).toBeVisible();

      // Solve screen: a frame of what's shared (the fake camera) goes to the model, and its answer shows.
      const screen = page.waitForRequest((req) => req.url().endsWith(`/api/copilot/sessions/${id}/screen`) && req.method() === 'POST');
      await card.getByRole('button', { name: msg('Answer.solveScreen') }).click();
      const frame = (await screen).postDataJSON() as { image: string };
      expect(frame.image.startsWith('/9j/'), 'a JPEG frame').toBe(true);
      await expect(card.getByText(msg('Answer.screen'), { exact: true })).toBeVisible();
      await expect(card.getByText(msg('Answer.screenQuestion'))).toBeVisible();
      await expect(answeredStatus(page)).toBeVisible({ timeout: 60_000 });
      await expect(suggested(page)).not.toBeEmpty();
      await expect
        .poll(async () => {
          const saved = (await events(request, id)).find((e) => e.event_type === 'suggestion' && e.payload.source === 'screen');
          return typeof saved?.payload.screen_sha256 === 'string' && /^[0-9a-f]{64}$/.test(saved.payload.screen_sha256);
        })
        .toBe(true);
      const vision = (await modelRequestsMentioning(request, company)).find((call) => Array.isArray(call.messages.at(-1)?.content));
      const parts = vision!.messages.at(-1)!.content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(parts[1].image_url!.url).toMatch(/^data:image\/jpeg;base64,\/9j\//);

      // Pop out: the answers move to an always-on-top window, and come back.
      const popOut = card.getByRole('button', { name: msg('AnswerPanel.popOut') });
      await expect(popOut).toBeVisible();
      await popOut.click();
      const popped = page.getByRole('region', { name: msg('AnswerPanel.statusLabel') });
      await expect(popped.getByText(msg('AnswerPanel.inWindow'))).toBeVisible();
      await expect(answerCard(page)).toHaveCount(0);
      // The floating window holds the answer card, with the latest lines of the conversation.
      expect(
        await page.evaluate(() => {
          const pip = (window as unknown as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window;
          return pip?.document.body.innerText ?? '';
        }),
      ).toContain(QUESTION);
      await popped.getByRole('button', { name: msg('AnswerPanel.bringBack') }).click();
      await expect(answerCard(page)).toBeVisible();

      // Stop listening, then stop the session.
      await audio.getByRole('button', { name: msg('AudioSources.stop') }).click();
      await expect(audio.getByRole('button', { name: msg('AudioSources.start') })).toBeVisible();
      await stop(page);
      watch.expectClean();
    });

    test('phone or in person: one microphone, a voice sample, no Solve screen', async ({ page, request }) => {
      const watch = watchPage(page);
      const company = marker('live-phone');
      await signIn(page);
      const setup = await openSetup(page);
      await setup.getByRole('textbox', { name: field(msg('SessionSetup.company')) }).fill(company);
      await setup.getByRole('checkbox', { name: msg('SessionSetup.singleMic') }).check();
      const { id, body } = await start(page);
      sessions.push(id);
      expect(body).toMatchObject({ singleMic: true });
      expect((await sessionRow(request, id))!.metadata).toMatchObject({ stt: { singleMic: true } });

      // Nothing is shared in this mode, so there is no screen to solve.
      const card = answerCard(page);
      await expect(card.getByRole('button', { name: msg('Answer.answerNow') })).toBeVisible();
      await expect(card.getByRole('button', { name: msg('Answer.solveScreen') })).toHaveCount(0);

      // The voice sample tells the two voices apart; it needs the microphone on.
      const audio = page.getByRole('region', { name: msg('AudioSources.title') });
      await expect(audio.getByText(msg('AudioSources.voice.title'))).toBeVisible();
      await expect(audio.getByText(msg('AudioSources.voice.missing'))).toBeVisible();
      await expect(audio.getByRole('button', { name: msg('AudioSources.voice.record') })).toBeDisabled();
      await audio.getByRole('button', { name: msg('AudioSources.start') }).click();
      await expect(audio.getByText(msg('AudioSources.capture.live'), { exact: true })).toBeVisible();
      await expect(audio.getByRole('button', { name: msg('AudioSources.voice.record') })).toBeEnabled();
      await audio.getByRole('button', { name: msg('AudioSources.voice.record') }).click();
      await expect(audio.getByRole('progressbar', { name: msg('AudioSources.voice.progress') })).toBeVisible();
      await audio.getByRole('button', { name: msg('AudioSources.voice.cancel') }).click();
      await expect(audio.getByRole('button', { name: msg('AudioSources.voice.record') })).toBeVisible();

      await stop(page);
      watch.expectClean();
    });
  });

  test('Past sessions: the list, one session with its report, search, export, and deleting your own', async ({ page, request }) => {
    test.setTimeout(240_000);
    const watch = watchPage(page);
    const company = marker('live-past');
    const title = fill(msg('SessionSetup.titleAt'), { role: 'Staff Engineer', company });
    await signIn(page);
    const { id } = await quickSession(page, company);
    sessions.push(id);
    await sendLine(page, 'How would you reverse a linked list?');
    await expect(answeredStatus(page)).toBeVisible();
    await page.getByRole('button', { name: msg('Copilot.summary.title') }).click();
    await page.getByRole('button', { name: msg('Copilot.composer.summarize') }).click();
    await expect(page.getByRole('button', { name: msg('Copilot.summary.again') })).toBeVisible();
    await stop(page);

    // Open Past sessions; find this one by its title.
    await page.getByRole('button', { name: msg('Copilot.history.sectionTitle') }).click();
    const list = page.getByRole('group', { name: msg('Copilot.history.listLabel') });
    await list.getByRole('textbox', { name: field(msg('Copilot.history.search')) }).fill(company);
    const item = list.getByRole('button', { name: new RegExp(escapeRegExp(title)) });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(msg('Copilot.statuses.stopped'));
    await item.click();
    await expect(item).toHaveAttribute('aria-pressed', 'true');

    // The session: its figures, recent lines and answers, and the interview report.
    const detail = page.getByRole('region', { name: msg('Copilot.history.detailLabel') });
    await expect(detail.getByRole('heading', { name: title })).toBeVisible();
    // Loaded once, not over and over while it's open.
    const detailLoads: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && new URL(req.url()).pathname.startsWith(`/api/copilot/sessions/${id}`)) detailLoads.push(req.url());
    });
    await page.waitForTimeout(3_000);
    expect(detailLoads, 'detail and report requests while the session sat open').toEqual([]);
    const figure = (term: string) => detail.locator('dl div').filter({ has: page.locator('dt', { hasText: term }) }).locator('dd');
    await expect(figure(msg('Copilot.history.lines'))).toHaveText('1');
    await expect(figure(msg('Copilot.history.suggestions'))).toHaveText('1');
    await expect(detail.getByText('How would you reverse a linked list?')).toBeVisible();
    await expect(detail.getByRole('heading', { name: msg('Copilot.report.title') })).toBeVisible();
    await expect(detail.getByText(msg('Copilot.report.overall'))).toBeVisible();
    // The report as the model wrote it: its score and signal, the six areas, and the one it couldn't judge
    // shown as "Not captured", with no score, bar or stock advice.
    await expect(figure(msg('Copilot.report.overall'))).toHaveText('74');
    await expect(figure(msg('Copilot.report.signal'))).toHaveText(msg('Copilot.signals.lean_hire'));
    const area = (key: string) => detail.getByRole('listitem').filter({ has: page.getByText(msg(`Copilot.rubric.${key}`), { exact: true }) });
    for (const key of ['communication', 'technical_accuracy', 'problem_solving', 'structure', 'ownership', 'role_fit']) {
      await expect(area(key), key).toHaveCount(1);
    }
    await expect(area('communication')).toContainText('4/5');
    await expect(area('communication')).toContainText('Short answers in a clear order');
    await expect(area('role_fit')).toContainText(msg('Copilot.report.notCaptured'));
    await expect(area('role_fit')).not.toContainText('/5');
    await expect(area('role_fit')).not.toContainText(msg('Copilot.report.recommendation'));
    await detail.getByRole('button', { name: msg('Copilot.report.copy') }).click();
    await expect(detail.getByRole('button', { name: msg('Copilot.report.copied') })).toBeVisible();
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as { overallScore: unknown; rubric: unknown };
    expect(copied.overallScore).toBe(74);
    expect(copied.rubric).toBeTruthy();

    // Filters: a search that matches nothing, and the interview type.
    await list.getByRole('textbox', { name: field(msg('Copilot.history.search')) }).fill(`${company}-nothing`);
    await expect(list.getByText(msg('Copilot.history.noMatches'))).toBeVisible();
    await list.getByRole('textbox', { name: field(msg('Copilot.history.search')) }).fill(company);
    await list.getByRole('combobox', { name: field(msg('Copilot.history.mode')) }).selectOption('coding');
    await expect(item).toHaveCount(0);
    await list.getByRole('combobox', { name: field(msg('Copilot.history.mode')) }).selectOption('general');
    await expect(item).toHaveCount(1);
    // Filtering it out let go of the selection; pick it again.
    await expect(detail.getByText(msg('Copilot.history.selectOne'))).toBeVisible();
    await item.click();
    await expect(detail.getByRole('heading', { name: title })).toBeVisible();

    // Export everything: a JSON file that includes this session.
    const data = page.getByRole('region', { name: msg('Copilot.data.label') });
    const download = page.waitForEvent('download');
    await data.getByRole('button', { name: msg('Copilot.data.export') }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.json$/);
    const exported = await (await file.createReadStream()).toArray();
    expect(Buffer.concat(exported).toString('utf8')).toContain(id);
    await expect(data.getByText(msg('Copilot.data.exported'))).toBeVisible();

    // Delete all would remove every session of the shared test user, so only its guard is checked here.
    const purge = data.getByRole('button', { name: msg('Copilot.data.purge') });
    await expect(purge).toBeDisabled();
    await data.getByRole('textbox').fill('DELETE ALL COPILOT DATA');
    await expect(purge).toBeEnabled();
    await data.getByRole('textbox').fill('');
    await expect(purge).toBeDisabled();

    // Delete this one session (the confirmation asks to type DELETE).
    page.once('dialog', (dialog) => void dialog.accept('DELETE'));
    await detail.getByRole('button', { name: msg('Copilot.history.delete') }).click();
    await expect(detail.getByText(fill(msg('Copilot.history.deleted'), { name: title }))).toBeVisible();
    await expect(item).toHaveCount(0);
    await expect.poll(async () => (await sessionRow(request, id)) ?? null).toBeNull();
    watch.expectClean();
  });

  test('delete all copilot data', async () => {
    test.skip(true, 'Deletes every copilot session of the shared fake user, including other specs’ data; only its guard is checked (Past sessions test)');
  });

  test('@mobile the control bar stays at the thumb and the tab bar steps aside during a session', async ({ page, request, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    const watch = watchPage(page);
    await hideNextDevBadge(page);
    const company = marker('live-mobile');
    await signIn(page);
    const tabs = page.getByRole('navigation', { name: msg('AppShell.primaryNavigation') });
    await openSetup(page);
    await expect(tabs.getByRole('link', { name: msg('AppShell.nav.live') })).toBeVisible();

    await setupRegion(page).getByRole('textbox', { name: field(msg('SessionSetup.company')) }).fill(company);
    const { id } = await start(page);
    sessions.push(id);

    // During the session: no tab bar, and the controls in a bar at the bottom of the screen.
    await expect(tabs.getByRole('link', { name: msg('AppShell.nav.live') })).toHaveCount(0);
    const controls = page.getByRole('group', { name: msg('Copilot.controlsLabel') });
    await expect(controls).toBeVisible();
    const box = await controls.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 4);
    await page.mouse.wheel(0, 1500);
    await expect(controls).toBeInViewport();

    // Answer now from the bar with nothing asked yet: a plain message, just above the bar.
    await controls.getByRole('button', { name: msg('Answer.answerNow') }).click();
    await expect(page.getByText(msg('Copilot.errors.noQuestion'))).toBeVisible();

    // Start listening from the bar; Solve screen wakes up once something is shared.
    await expect(controls.getByRole('button', { name: msg('Answer.solveScreen') })).toBeDisabled();
    await controls.getByRole('button', { name: msg('AudioSources.start') }).click();
    await expect(controls.getByRole('button', { name: msg('AudioSources.stop') })).toBeVisible();
    await expect(controls.getByRole('button', { name: msg('Answer.solveScreen') })).toBeEnabled();
    await controls.getByRole('button', { name: msg('AudioSources.stop') }).click();
    await expect(controls.getByRole('button', { name: msg('AudioSources.start') })).toBeVisible();

    // Type a line works on a phone too.
    await sendLine(page, 'How would you design a URL shortener?');
    await expect(answerCard(page).getByRole('img', { name: format('Answer.diagramLabel', { count: 5 }) })).toBeVisible();

    await page.getByRole('button', { name: msg('SessionBar.stop') }).click();
    await expect(setupRegion(page)).toBeVisible();
    await expect(controls).toHaveCount(0);
    await expect(tabs.getByRole('link', { name: msg('AppShell.nav.live') })).toBeVisible();
    expect((await sessionRow(request, id))?.status).toBe('stopped');
    watch.expectClean();
  });
});
