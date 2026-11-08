import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { RESUME, USER } from '../fakes/config.cjs';
import {
  FIRST_LOAD,
  deleteRows,
  deleteWhere,
  escapeRegExp,
  field,
  fill,
  format,
  hideNextDevBadge,
  insertRow,
  marker,
  msg,
  rows,
  signIn,
  watchPage,
} from './helpers/flowsA';

/**
 * Getting ready for an interview, end to end against the fakes: Home's next
 * interview and links, Goals (goals, materials, playbooks, memory, a goal from
 * a job), Practice (setup, answers, follow-ups, the interviewer's voice, the
 * report, the list) and the company question bank.
 *
 * Every row these tests make carries a unique marker and is removed at the
 * end; nothing else in the shared fake database is changed.
 */

type Made = { table: string; id: string };

/** Rows to remove after the test, and the practice interviews (with their questions and reports). */
function tracker() {
  const made: Made[] = [];
  const interviews: string[] = [];
  return {
    add(table: string, id: string) {
      made.push({ table, id });
    },
    interview(id: string) {
      interviews.push(id);
    },
    async clean(request: APIRequestContext, company?: string) {
      await deleteWhere(request, 'interview_questions', 'session_id', interviews);
      await deleteWhere(request, 'interview_reports', 'session_id', interviews);
      await deleteRows(request, 'interview_sessions', interviews);
      if (company) {
        // Practice interviews for a company add their questions to that company's bank.
        const bank = await rows(request, 'company_questions', (row) => row.company === company);
        await deleteRows(request, 'company_questions', bank.map((row) => row.id));
      }
      for (const table of ['goal_materials', 'memories', 'goals', 'materials', 'playbooks', 'job_applications', 'company_questions']) {
        await deleteRows(request, table, made.filter((item) => item.table === table).map((item) => item.id));
      }
    },
  };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const isPost = (path: RegExp) => (req: Request) => path.test(new URL(req.url()).pathname) && req.method() === 'POST';

/** The interviewer reads questions aloud with speechSynthesis; record what it says instead (headless Chromium has no voices). */
async function recordInterviewerVoice(page: Page) {
  await page.addInitScript(() => {
    const spoken: Array<{ text: string; lang: string }> = [];
    (window as unknown as { __spoken: typeof spoken }).__spoken = spoken;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      onvoiceschanged: null,
      speak(utterance: SpeechSynthesisUtterance) {
        spoken.push({ text: utterance.text, lang: utterance.lang });
        setTimeout(() => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent), 0);
        setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 30);
      },
      cancel() {},
      pause() {},
      resume() {},
      getVoices() {
        return [];
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    if (typeof window.SpeechSynthesisUtterance !== 'function') {
      (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
        text: string;
        lang = '';
        constructor(text: string) {
          this.text = text;
        }
      };
    }
  });
}

const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: Array<{ text: string; lang: string }> }).__spoken);

async function openGoals(page: Page, query = '') {
  await page.goto(`/en/goals${query}`, FIRST_LOAD);
  await expect(page.getByRole('navigation', { name: msg('Goals.sections') }).getByRole('button', { name: new RegExp(`^${msg('Goals.tabs.goals')} \\d+$`) })).toBeVisible(FIRST_LOAD);
}

const goalCard = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });

test.describe('getting ready: Home, Goals, Practice and the question bank', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    for (const path of ['/en/dashboard', '/en/goals', '/en/interview', '/en/interview/bank', '/en/copilot/live']) {
      await request.get(path, { timeout: 120_000 }).catch(() => undefined);
    }
  });

  test('Goals: create, edit, archive, restore and delete your own goal', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const name = marker('goal');
    const material = await insertRow(request, 'materials', { title: `${name} notes`, kind: 'project', content: 'Led the ledger migration.' });
    made.add('materials', material.id);
    try {
      await signIn(page);
      await openGoals(page);

      await page.getByRole('button', { name: msg('Goals.newGoal') }).first().click();
      const sheet = page.getByRole('dialog', { name: msg('Goals.newGoal') });
      await sheet.getByRole('textbox', { name: field(msg('Goals.role')) }).fill('Staff Engineer');
      await sheet.getByRole('textbox', { name: field(msg('Goals.company')) }).fill(`${name} Co`);
      await sheet.getByRole('combobox', { name: field(msg('Goals.round')) }).selectOption('technical');
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.name')) })).toHaveAttribute('placeholder', `Staff Engineer · ${name} Co`);
      await sheet.getByRole('textbox', { name: field(msg('Goals.name')) }).fill(name);
      await sheet.getByRole('combobox', { name: field(msg('Goals.resume')) }).selectOption(RESUME.id);
      await sheet.getByRole('textbox', { name: field(msg('Goals.jobDescription')) }).fill('Run the payments platform.');
      await sheet.getByRole('checkbox', { name: `${name} notes` }).check();
      await sheet.getByRole('textbox', { name: field(msg('Goals.notes')) }).fill('Ask about on-call.');
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: msg('Goals.saved') })).toBeVisible();

      const card = goalCard(page, name);
      await expect(card).toContainText(fill(msg('Goals.roleAt'), { role: 'Staff Engineer', company: `${name} Co` }));
      await expect(card).toContainText(msg('Goals.rounds.technical'));
      await expect(card).toContainText(fill(msg('Goals.usesResume'), { name: RESUME.filename }));
      await expect(card).toContainText(msg('Goals.hasJob'));
      await expect(card).toContainText(format('Goals.materialCount', { count: 1 }));
      const [goal] = await rows(request, 'goals', (row) => row.name === name);
      expect(goal).toMatchObject({
        company: `${name} Co`,
        role: 'Staff Engineer',
        round: 'technical',
        resume_document_id: RESUME.id,
        job_description: 'Run the payments platform.',
        notes: 'Ask about on-call.',
        archived: false,
      });
      made.add('goals', goal.id);
      const links = await rows(request, 'goal_materials', (row) => row.goal_id === goal.id);
      expect(links.map((link) => link.material_id)).toEqual([material.id]);
      links.forEach((link) => made.add('goal_materials', link.id));
      // The goal's way into a live session.
      await expect(card.getByRole('link', { name: msg('Goals.startLive') })).toHaveAttribute('href', `/en/copilot/live?goal=${goal.id}`);

      // Edit: the sheet opens filled in.
      await card.getByRole('button', { name: msg('Goals.edit') }).click();
      const editor = page.getByRole('dialog', { name: msg('Goals.editGoal') });
      await expect(editor.getByRole('textbox', { name: field(msg('Goals.company')) })).toHaveValue(`${name} Co`);
      await expect(editor.getByRole('checkbox', { name: `${name} notes` })).toBeChecked();
      await editor.getByRole('textbox', { name: field(msg('Goals.role')) }).fill('Principal Engineer');
      await editor.getByRole('checkbox', { name: `${name} notes` }).uncheck();
      await editor.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(editor).toHaveCount(0);
      await expect(card).toContainText(fill(msg('Goals.roleAt'), { role: 'Principal Engineer', company: `${name} Co` }));
      await expect(card).toContainText(format('Goals.materialCount', { count: 0 }));
      expect((await rows(request, 'goals', (row) => row.id === goal.id))[0]).toMatchObject({ role: 'Principal Engineer' });
      expect(await rows(request, 'goal_materials', (row) => row.goal_id === goal.id)).toEqual([]);

      // Cancel leaves it as it was.
      await card.getByRole('button', { name: msg('Goals.edit') }).click();
      await page.getByRole('dialog', { name: msg('Goals.editGoal') }).getByRole('textbox', { name: field(msg('Goals.role')) }).fill('Changed my mind');
      await page.getByRole('dialog', { name: msg('Goals.editGoal') }).getByRole('button', { name: msg('Goals.cancel') }).click();
      await expect(card).toContainText(fill(msg('Goals.roleAt'), { role: 'Principal Engineer', company: `${name} Co` }));

      // Archive, then find it under Show archived and restore it.
      await card.getByRole('button', { name: msg('Goals.archive') }).click();
      await expect(card).toHaveCount(0);
      await expect.poll(async () => (await rows(request, 'goals', (row) => row.id === goal.id))[0]?.archived).toBe(true);
      const archivedToggle = page.getByRole('button', { name: msg('Goals.showArchived') });
      await archivedToggle.click();
      await expect(page.getByRole('button', { name: msg('Goals.showActive') })).toHaveAttribute('aria-pressed', 'true');
      await expect(card.getByRole('button', { name: msg('Goals.delete') })).toBeVisible();
      await card.getByRole('button', { name: msg('Goals.restore') }).click();
      await expect(card).toHaveCount(0);
      await expect.poll(async () => (await rows(request, 'goals', (row) => row.id === goal.id))[0]?.archived).toBe(false);
      await page.getByRole('button', { name: msg('Goals.showActive') }).click();
      await expect(card).toBeVisible();

      // Delete is offered for archived goals, after a confirmation.
      await card.getByRole('button', { name: msg('Goals.archive') }).click();
      await page.getByRole('button', { name: msg('Goals.showArchived') }).click();
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(fill(msg('Goals.confirmDelete'), { name }));
        void dialog.accept();
      });
      await card.getByRole('button', { name: msg('Goals.delete') }).click();
      await expect(card).toHaveCount(0);
      await expect.poll(async () => (await rows(request, 'goals', (row) => row.id === goal.id)).length).toBe(0);
      watch.expectClean();
    } finally {
      await made.clean(request);
    }
  });

  test('Goals → Materials: paste one, upload a file, read it, and delete yours', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const title = marker('material');
    try {
      await signIn(page);
      await openGoals(page, '?tab=materials');
      const form = page.getByRole('form', { name: msg('Goals.addMaterial') });
      const list = page.getByRole('region', { name: new RegExp(`^${escapeRegExp(msg('Goals.yourMaterials'))}`) });

      // Paste text.
      await form.getByRole('radio', { name: msg('Goals.pasteText') }).click();
      await form.getByRole('textbox', { name: field(msg('Goals.materialTitle')) }).fill(`${title} pasted`);
      await form.getByRole('combobox', { name: field(msg('Goals.materialKind')) }).selectOption('company');
      await form.getByRole('textbox', { name: field(msg('Goals.content')) }).fill('Acme ships weekly and runs its own payments ledger.');
      await form.getByRole('button', { name: msg('Goals.addMaterial') }).click();
      await expect(form.getByRole('status')).toHaveText(msg('Goals.materialAdded'));
      await expect(list.getByRole('button', { name: new RegExp(`^${escapeRegExp(`${title} pasted`)}`) })).toBeVisible();
      const [pasted] = await rows(request, 'materials', (row) => row.title === `${title} pasted`);
      expect(pasted).toMatchObject({ kind: 'company', content: 'Acme ships weekly and runs its own payments ledger.' });
      made.add('materials', pasted.id);

      // Upload a Markdown file: only its text is kept.
      await form.getByRole('radio', { name: msg('Goals.uploadFile') }).click();
      await expect(form.getByRole('button', { name: msg('Goals.addMaterial') })).toBeDisabled();
      await form.getByRole('textbox', { name: field(msg('Goals.materialTitle')) }).fill(`${title} uploaded`);
      await form.locator('input[type="file"]').setInputFiles({
        name: 'project-notes.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Ledger migration\n\nMoved two million merchants without downtime.\n'),
      });
      const upload = page.waitForResponse((res) => res.url().endsWith('/api/materials/upload'));
      await form.getByRole('button', { name: msg('Goals.addMaterial') }).click();
      expect((await upload).status()).toBe(201);
      await expect(form.getByRole('status')).toHaveText(msg('Goals.materialAdded'));
      const [uploaded] = await rows(request, 'materials', (row) => row.title === `${title} uploaded`);
      expect(uploaded).toMatchObject({ source_filename: 'project-notes.md' });
      expect(String(uploaded.content)).toContain('Moved two million merchants without downtime.');
      made.add('materials', uploaded.id);

      // Read one: the row opens to its text.
      const row = list.getByRole('listitem').filter({ hasText: `${title} uploaded` });
      await row.getByRole('button', { name: new RegExp(`^${escapeRegExp(`${title} uploaded`)}`) }).click();
      await expect(row.getByText('Moved two million merchants without downtime.')).toBeVisible();
      // The type stays as last picked (Company research), and the row says how long it is and where it's used.
      await expect(row).toContainText(msg('Goals.kinds.company'));
      await expect(row).toContainText(format('Goals.usedBy', { count: 0 }));
      expect(uploaded).toMatchObject({ kind: 'company' });

      // Delete both, each after a confirmation.
      for (const item of [`${title} uploaded`, `${title} pasted`]) {
        page.once('dialog', (dialog) => void dialog.accept());
        await list.getByRole('listitem').filter({ hasText: item }).getByRole('button', { name: msg('Goals.delete') }).click();
        await expect(list.getByRole('listitem').filter({ hasText: item })).toHaveCount(0);
      }
      expect(await rows(request, 'materials', (r) => String(r.title).startsWith(title))).toEqual([]);
      watch.expectClean();
    } finally {
      await made.clean(request);
    }
  });

  test('Goals → Playbooks: start from the example, write one, edit and delete', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const name = marker('playbook');
    try {
      await signIn(page);
      await openGoals(page, '?tab=playbooks');
      const list = page.getByRole('region', { name: new RegExp(`^${escapeRegExp(msg('Goals.yourPlaybooks'))}`) });

      // From the example: the sheet opens filled in.
      await page.getByRole('button', { name: msg('Goals.startFromExample') }).click();
      let sheet = page.getByRole('dialog', { name: msg('Goals.newPlaybook') });
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.playbookName')) })).toHaveValue(msg('Goals.examplePlaybookName'));
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.playbookInstructions')) })).toHaveValue(msg('Goals.examplePlaybook'));
      await sheet.getByRole('textbox', { name: field(msg('Goals.playbookName')) }).fill(`${name} example`);
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(sheet).toHaveCount(0);
      await expect(list.getByText(`${name} example`, { exact: true })).toBeVisible();

      // A new one: Save waits for a name and instructions.
      await page.getByRole('button', { name: msg('Goals.newPlaybook') }).click();
      sheet = page.getByRole('dialog', { name: msg('Goals.newPlaybook') });
      await expect(sheet.getByRole('button', { name: msg('Goals.save') })).toBeDisabled();
      await sheet.getByRole('textbox', { name: field(msg('Goals.playbookName')) }).fill(name);
      await sheet.getByRole('textbox', { name: field(msg('Goals.playbookInstructions')) }).fill('Short answers. Numbers first.');
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(sheet).toHaveCount(0);
      const row = list.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
      await expect(row).toContainText('Short answers. Numbers first.');
      const saved = await rows(request, 'playbooks', (r) => String(r.name).startsWith(name));
      expect(saved.map((r) => r.name).sort()).toEqual([name, `${name} example`]);
      saved.forEach((r) => made.add('playbooks', r.id));

      // Edit.
      await row.getByRole('button', { name: msg('Goals.edit') }).click();
      sheet = page.getByRole('dialog', { name: msg('Goals.editPlaybook') });
      await sheet.getByRole('textbox', { name: field(msg('Goals.playbookInstructions')) }).fill('Short answers. Numbers first. Say "I".');
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(row).toContainText('Say "I".');
      expect((await rows(request, 'playbooks', (r) => r.name === name))[0]).toMatchObject({ instructions: 'Short answers. Numbers first. Say "I".' });

      // Delete both, after confirming.
      for (const item of [name, `${name} example`]) {
        page.once('dialog', (dialog) => void dialog.accept());
        await list.getByRole('listitem').filter({ has: page.getByText(item, { exact: true }) }).getByRole('button', { name: msg('Goals.delete') }).click();
        await expect(list.getByText(item, { exact: true })).toHaveCount(0);
      }
      expect(await rows(request, 'playbooks', (r) => String(r.name).startsWith(name))).toEqual([]);
      watch.expectClean();
    } finally {
      await made.clean(request);
    }
  });

  test('Goals → Memory: remember a fact for one goal, then forget it', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const name = marker('memory');
    const goal = await insertRow(request, 'goals', { name: `${name} goal`, company: 'Acme', role: 'Staff Engineer', round: 'behavioral' });
    made.add('goals', goal.id);
    try {
      await signIn(page);
      await openGoals(page, '?tab=memory');
      const fact = `${name}: I managed a team of six.`;
      await page.getByRole('textbox', { name: field(msg('Goals.addMemory')) }).fill(fact);
      await page.getByRole('combobox', { name: field(msg('Goals.memoryGoal')) }).selectOption(goal.id);
      await page.getByRole('button', { name: msg('Goals.remember') }).click();

      const list = page.getByRole('region', { name: new RegExp(`^${escapeRegExp(msg('Goals.whatIKnow'))}`) });
      const row = list.getByRole('listitem').filter({ hasText: fact });
      await expect(row).toContainText(msg('Goals.addedByYou'));
      await expect(row).toContainText(`${name} goal`);
      const [memory] = await rows(request, 'memories', (r) => r.content === fact);
      expect(memory).toMatchObject({ goal_id: goal.id, source: 'manual' });
      made.add('memories', memory.id);

      // "Forget everything" asks first; saying no keeps everything.
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(msg('Goals.confirmForgetAll'));
        void dialog.dismiss();
      });
      await list.getByRole('button', { name: msg('Goals.forgetAll') }).click();
      await expect(row).toBeVisible();
      expect(await rows(request, 'memories', (r) => r.id === memory.id)).toHaveLength(1);

      await row.getByRole('button', { name: msg('Goals.forget') }).click();
      await expect(row).toHaveCount(0);
      expect(await rows(request, 'memories', (r) => r.id === memory.id)).toEqual([]);
      watch.expectClean();
    } finally {
      await made.clean(request);
    }
  });

  test('Goals from the Jobs board (?fromJob=): a new goal filled in from the job, then the same goal again', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const company = marker('fromjob');
    const job = await insertRow(request, 'job_applications', { company, title: 'Platform Engineer', notes: 'Recruiter: Sam', stage: 'saved', status: 'active' });
    made.add('job_applications', job.id);
    try {
      await signIn(page);
      await openGoals(page, `?fromJob=${job.id}`);
      const sheet = page.getByRole('dialog', { name: msg('Goals.newGoal') });
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.name')) })).toHaveValue(fill(msg('Jobs.jobAt'), { title: 'Platform Engineer', company }));
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.role')) })).toHaveValue('Platform Engineer');
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.company')) })).toHaveValue(company);
      await expect(sheet.getByRole('combobox', { name: field(msg('Goals.jobBoard')) })).toHaveValue(job.id);
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.notes')) })).toHaveValue('Recruiter: Sam');
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(sheet).toHaveCount(0);
      const [goal] = await rows(request, 'goals', (row) => row.job_application_id === job.id);
      expect(goal).toMatchObject({ company, role: 'Platform Engineer' });
      made.add('goals', goal.id);

      // The same link again opens that goal instead of a second one.
      await openGoals(page, `?fromJob=${job.id}`);
      await expect(page.getByRole('dialog', { name: msg('Goals.editGoal') }).getByRole('textbox', { name: field(msg('Goals.role')) })).toHaveValue('Platform Engineer');
      watch.expectClean();
    } finally {
      await made.clean(request);
    }
  });

  test('Practice: setup, typed answers, follow-ups, the interviewer’s voice, the report, and the list with the score', async ({ page, request }) => {
    test.setTimeout(240_000);
    const watch = watchPage(page);
    const made = tracker();
    const company = marker('practice');
    try {
      await recordInterviewerVoice(page);
      await signIn(page);
      await page.goto('/en/interview', FIRST_LOAD);
      const created = page.waitForResponse((res) => res.url().endsWith('/api/interviews') && res.request().method() === 'POST');
      await page.getByRole('button', { name: msg('PracticePages.new') }).first().click();
      const { session } = (await (await created).json()) as { session: { id: string } };
      made.interview(session.id);
      await page.waitForURL(new RegExp(`/en/interview/${session.id}$`), FIRST_LOAD);

      // The setup: role, company, type, difficulty, length, follow-ups, résumé, job.
      const setup = page.locator('form').filter({ has: page.getByRole('heading', { name: msg('Practice.setup.title') }) });
      const startButton = setup.getByRole('button', { name: msg('Practice.setup.start') });
      await expect(startButton).toBeDisabled();
      await setup.getByRole('textbox', { name: field(msg('Practice.setup.role')) }).fill('Staff Engineer');
      await setup.getByRole('textbox', { name: field(msg('Practice.setup.company')) }).fill(company);
      await setup.getByRole('radiogroup', { name: msg('Practice.setup.type') }).getByRole('radio', { name: msg('Practice.types.situational') }).click();
      await setup.getByRole('radiogroup', { name: msg('Practice.setup.difficulty') }).getByRole('radio', { name: msg('Practice.difficulties.hard') }).click();
      await setup.getByRole('radiogroup', { name: msg('Practice.setup.length') }).getByRole('radio', { name: format('Practice.setup.lengthOption', { count: 3 }) }).click();
      const followUps = setup.getByRole('switch', { name: msg('Practice.setup.followUps') });
      await expect(followUps).toHaveAttribute('aria-checked', 'true');
      await followUps.click();
      await expect(followUps).toHaveAttribute('aria-checked', 'false');
      await followUps.click();
      await setup.getByRole('combobox', { name: field(msg('Practice.setup.resume')) }).selectOption(RESUME.id);
      await setup.getByRole('textbox', { name: field(msg('Practice.setup.job')) }).fill('Lead the payments platform.');
      await expect(
        setup.getByText(format('Practice.setup.summary', { count: 3, type: msg('Practice.types.situational'), difficulty: msg('Practice.difficulties.hard') })),
      ).toBeVisible();

      const startRequest = page.waitForRequest(isPost(/\/practice\/start$/));
      await startButton.click();
      expect((await startRequest).postDataJSON()).toMatchObject({
        role: 'Staff Engineer',
        company,
        type: 'situational',
        difficulty: 'hard',
        count: 3,
        followUps: true,
        resumeDocumentId: RESUME.id,
        jobDescription: 'Lead the payments platform.',
        locale: 'en',
      });

      // Question 1, read aloud by the interviewer.
      const progress = page.getByRole('navigation', { name: msg('Practice.interview.questions') });
      await expect(progress.getByText(fill(msg('Practice.interview.progress'), { current: 1, total: 3 }))).toBeVisible(FIRST_LOAD);
      const question = page.getByRole('region', { name: msg('Practice.interview.question') });
      const q1 = 'Tell me about a time you led a project through a hard deadline.';
      await expect(question).toContainText(q1);
      await expect.poll(async () => (await spoken(page)).map((item) => item.text)).toContain(q1);
      expect((await spoken(page)).at(-1)?.lang).toBe('en');

      // Mute the interviewer, then unmute and ask again.
      const mute = question.getByRole('button', { name: msg('Practice.interview.mute') });
      await mute.click();
      const unmute = question.getByRole('button', { name: msg('Practice.interview.unmute') });
      await expect(unmute).toHaveAttribute('aria-pressed', 'true');
      await expect(question.getByRole('button', { name: msg('Practice.interview.repeat') })).toBeDisabled();
      expect(await page.evaluate(() => window.localStorage.getItem('practice.interviewerMuted'))).toBe('1');
      await unmute.click();
      const before = (await spoken(page)).length;
      await question.getByRole('button', { name: msg('Practice.interview.repeat') }).click();
      await expect.poll(async () => (await spoken(page)).length).toBe(before + 1);
      expect((await spoken(page)).at(-1)?.text).toBe(q1);

      // Answer by typing; the coach scores it, and the interviewer has a follow-up.
      const answerBox = page.getByRole('textbox', { name: msg('Practice.interview.yourAnswer') });
      const submit = page.getByRole('button', { name: msg('Practice.interview.submit') });
      await answerBox.fill('I led the payments migration at Stripe and cut checkout latency by 40 percent.');
      await expect(page.getByText(format('Practice.interview.words', { count: 14 }), { exact: true })).toBeVisible();
      await submit.click();
      const feedback = page.getByRole('region', { name: msg('Practice.feedback.label') });
      await expect(feedback).toContainText('7');
      await expect(feedback).toContainText('A clear story with a real result; make your own role sharper.');
      await expect(feedback.getByRole('heading', { name: msg('Practice.feedback.worked') })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: msg('Practice.interview.followUpComing') })).toBeVisible();
      await expect(progress.getByRole('button', { name: format('Practice.interview.step', { n: 1, answered: 'yes' }) })).toContainText(format('Practice.interview.stepScore', { score: 7 }));

      // The follow-up: skip it.
      await page.getByRole('button', { name: msg('Practice.interview.answerFollowUp') }).click();
      await expect(question).toContainText('What would you do differently if you ran that project again?');
      await expect(question.getByText(msg('Practice.interview.followUp'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: msg('Practice.interview.skipFollowUp') }).click();

      // Question 2: answer it and its follow-up.
      await expect(progress.getByText(fill(msg('Practice.interview.progress'), { current: 2, total: 3 }))).toBeVisible();
      await expect(question).toContainText('Describe a disagreement with a teammate and how you resolved it.');
      await answerBox.fill('We disagreed on the rollout; I ran a small test and we went with the data.');
      await submit.click();
      await expect(feedback).toBeVisible();
      await page.getByRole('button', { name: msg('Practice.interview.answerFollowUp') }).click();
      await answerBox.fill('I would have involved the on-call team earlier.');
      await submit.click();
      await expect(feedback).toBeVisible();
      // Follow-ups don't get follow-ups of their own.
      await expect(page.getByText(msg('Practice.interview.followUpComing'))).toHaveCount(0);
      await page.getByRole('button', { name: msg('Practice.interview.next') }).click();

      // Question 3, then finish (its follow-up is optional).
      await expect(progress.getByText(fill(msg('Practice.interview.progress'), { current: 3, total: 3 }))).toBeVisible();
      await answerBox.fill('I shipped with partial data and set a review date; it worked out.');
      await submit.click();
      await expect(feedback).toBeVisible();
      await expect(page.getByRole('button', { name: msg('Practice.interview.answerFollowUp') })).toBeVisible();
      const report = page.waitForResponse((res) => res.url().endsWith(`/api/interviews/${session.id}/report`) && res.request().method() === 'POST');
      await page.getByRole('button', { name: msg('Practice.interview.finish') }).click();
      expect((await report).ok()).toBe(true);

      // The report: overall score, signal, areas, lists, each answer.
      const overall = page.getByRole('region', { name: msg('Practice.report.overall') });
      await expect(overall).toContainText('72');
      await expect(overall).toContainText(msg('Practice.report.outOf'));
      await expect(overall).toContainText(msg('Practice.signals.lean_hire'));
      await expect(page.getByRole('region', { name: msg('Practice.report.byAreaLabel') }).getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('region', { name: msg('Practice.report.strengths') })).toContainText('Uses numbers to show impact');
      await expect(page.getByRole('region', { name: msg('Practice.report.nextSteps') }).getByRole('listitem').first()).toHaveText(
        'Rewrite two stories around your own decisions',
      );
      // Three questions and the one follow-up answered (skipped ones aren't listed).
      await expect(page.getByRole('region', { name: msg('Practice.report.eachAnswer') }).getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('main').getByText(msg('PracticePages.status.completed'), { exact: true })).toBeVisible();

      // Export: a JSON file of the interview, with its questions, answers, feedback and report.
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: msg('Practice.report.export') }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^practice-interview-\d{4}-\d{2}-\d{2}\.json$/);
      const exported = JSON.parse(Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8')) as {
        session: { id: string };
        questions: Array<{ question_text: string; response_text: string | null; rubric: { feedback?: { score: number } } | null }>;
        report: { overall_score: number } | null;
      };
      expect(exported.session.id).toBe(session.id);
      expect(exported.questions.find((q) => q.question_text === q1)).toMatchObject({
        response_text: 'I led the payments migration at Stripe and cut checkout latency by 40 percent.',
        rubric: { feedback: { score: 7 } },
      });
      expect(exported.report?.overall_score).toBe(72);
      await expect(page).toHaveURL(new RegExp(`/en/interview/${session.id}$`));

      // What was saved.
      expect((await rows(request, 'interview_sessions', (row) => row.id === session.id))[0]).toMatchObject({
        status: 'completed',
        title: fill(msg('PracticePages.titleAt'), { role: 'Staff Engineer', company }),
      });
      expect((await rows(request, 'interview_reports', (row) => row.session_id === session.id))[0]).toMatchObject({ overall_score: 72 });
      const answered = await rows(request, 'interview_questions', (row) => row.session_id === session.id && typeof row.response_text === 'string');
      expect(answered).toHaveLength(4);

      // The list: this interview with its score, and the latest score.
      await page.goto('/en/interview', FIRST_LOAD);
      const listRow = page.getByRole('link', { name: new RegExp(escapeRegExp(fill(msg('PracticePages.titleAt'), { role: 'Staff Engineer', company }))) });
      await expect(listRow).toContainText(msg('PracticePages.status.completed'));
      await expect(listRow).toContainText('72');
      const trend = page.getByRole('region', { name: msg('PracticePages.trendTitle') });
      await expect(trend).toContainText('72');
      await listRow.click();
      await page.waitForURL(new RegExp(`/en/interview/${session.id}$`), FIRST_LOAD);
      await expect(page.getByRole('region', { name: msg('Practice.report.overall') })).toContainText('72');
      watch.expectClean();
    } finally {
      await made.clean(request, company);
    }
  });

  test('Practice from a goal: the setup is filled in from it', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const name = marker('goalpractice');
    const goal = await insertRow(request, 'goals', {
      name,
      company: `${name} Co`,
      role: 'Data Engineer',
      round: 'technical',
      resume_document_id: RESUME.id,
      job_description: 'Build the streaming pipeline.',
    });
    made.add('goals', goal.id);
    try {
      await signIn(page);
      await openGoals(page);
      const created = page.waitForResponse((res) => res.url().endsWith('/api/interviews') && res.request().method() === 'POST');
      await goalCard(page, name).getByRole('button', { name: msg('Goals.practice') }).click();
      const { session } = (await (await created).json()) as { session: { id: string } };
      made.interview(session.id);
      await page.waitForURL(new RegExp(`/en/interview/${session.id}\\?goal=${goal.id}$`), FIRST_LOAD);

      const setup = page.locator('form').filter({ has: page.getByRole('heading', { name: msg('Practice.setup.title') }) });
      await expect(setup.getByText(fill(msg('Practice.setup.fromGoal'), { name }))).toBeVisible();
      await expect(setup.getByRole('textbox', { name: field(msg('Practice.setup.role')) })).toHaveValue('Data Engineer');
      await expect(setup.getByRole('textbox', { name: field(msg('Practice.setup.company')) })).toHaveValue(`${name} Co`);
      await expect(setup.getByRole('radio', { name: msg('Practice.types.technical') })).toHaveAttribute('aria-checked', 'true');
      await expect(setup.getByRole('combobox', { name: field(msg('Practice.setup.resume')) })).toHaveValue(RESUME.id);
      await expect(setup.getByRole('textbox', { name: field(msg('Practice.setup.job')) })).toHaveValue('Build the streaming pipeline.');

      const startRequest = page.waitForRequest(isPost(/\/practice\/start$/));
      await setup.getByRole('button', { name: msg('Practice.setup.start') }).click();
      expect((await startRequest).postDataJSON()).toMatchObject({
        role: 'Data Engineer',
        company: `${name} Co`,
        type: 'technical',
        resumeDocumentId: RESUME.id,
        jobDescription: 'Build the streaming pipeline.',
      });
      await expect(page.getByRole('region', { name: msg('Practice.interview.question') })).toBeVisible(FIRST_LOAD);
      watch.expectClean();
    } finally {
      await made.clean(request, `${name} Co`);
    }
  });

  test('Question bank: add a question for a company, share it, remove it, and practise the bank', async ({ page, request }) => {
    const watch = watchPage(page);
    const made = tracker();
    const company = marker('bank');
    try {
      await signIn(page);
      await page.goto('/en/interview/bank', FIRST_LOAD);
      await page.getByRole('searchbox', { name: field(msg('QuestionBank.company')) }).fill(company);
      await page.getByRole('button', { name: msg('QuestionBank.open'), exact: true }).click();
      const bank = page.getByRole('region', { name: company });
      await expect(bank.getByText(format('QuestionBank.bankCount', { count: 0 }), { exact: true })).toBeVisible();

      // Add a question you were asked.
      const addQuestion = async (text: string) => {
        // The form stays open after an add; open it only when it's closed.
        const question = bank.getByRole('textbox', { name: field(msg('QuestionBank.question')) });
        if (!(await question.isVisible())) await bank.getByText(msg('QuestionBank.addTitle')).click();
        await bank.getByRole('textbox', { name: field(msg('QuestionBank.question')) }).fill(text);
        await bank.getByRole('combobox', { name: field(msg('QuestionBank.type')) }).selectOption('behavioral');
        await bank.getByRole('textbox', { name: field(msg('QuestionBank.role')) }).fill('Staff Engineer');
        const saved = page.waitForResponse((res) => res.url().endsWith('/api/question-bank') && res.request().method() === 'POST');
        await bank.getByRole('button', { name: msg('QuestionBank.add') }).click();
        expect((await saved).status()).toBe(201);
        const [row] = await rows(request, 'company_questions', (r) => r.question_text === text);
        made.add('company_questions', row.id);
        return row;
      };
      const first = `${company}: why did you leave your last job?`;
      const row = await addQuestion(first);
      expect(row).toMatchObject({ company, role: 'Staff Engineer', question_type: 'behavioral', source: 'reported', shared: false });
      const mine = bank.getByRole('region', { name: msg('QuestionBank.mine') });
      const item = mine.getByRole('listitem').filter({ hasText: first });
      await expect(item).toContainText(msg('QuestionBank.sourceReported'));
      await expect(item).toContainText(msg('QuestionBank.types.behavioral'));

      // Share it with other candidates, and stop sharing.
      const share = item.getByRole('switch', { name: msg('QuestionBank.shareLabel') });
      await expect(share).toHaveAttribute('aria-checked', 'false');
      await share.click();
      await expect(share).toHaveAttribute('aria-checked', 'true');
      await expect.poll(async () => (await rows(request, 'company_questions', (r) => r.id === row.id))[0]?.shared).toBe(true);
      await share.click();
      await expect(share).toHaveAttribute('aria-checked', 'false');
      await expect.poll(async () => (await rows(request, 'company_questions', (r) => r.id === row.id))[0]?.shared).toBe(false);

      // Remove it.
      await item.getByRole('button', { name: msg('QuestionBank.remove') }).click();
      await expect(item).toHaveCount(0);
      await expect.poll(async () => (await rows(request, 'company_questions', (r) => r.id === row.id)).length).toBe(0);

      // Practise these: a practice interview set up for this company and its bank.
      await addQuestion(`${company}: tell me about a launch that slipped.`);
      const created = page.waitForResponse((res) => res.url().endsWith('/api/interviews') && res.request().method() === 'POST');
      await bank.getByRole('button', { name: msg('QuestionBank.practice') }).click();
      const { session } = (await (await created).json()) as { session: { id: string } };
      made.interview(session.id);
      await page.waitForURL(new RegExp(`/en/interview/${session.id}\\?company=${escapeRegExp(encodeURIComponent(company))}&bank=1$`), FIRST_LOAD);
      await expect(page.getByRole('textbox', { name: field(msg('Practice.setup.company')) })).toHaveValue(company);
      watch.expectClean();
    } finally {
      await made.clean(request, company);
    }
  });

  test('Question bank: practise these starts with the bank’s questions', async ({ page, request }) => {
    test.setTimeout(240_000);
    const watch = watchPage(page);
    const made = tracker();
    const company = marker('bankpractice');
    // The bank as other visits left it: two questions you were asked there, and one another candidate
    // shared (their row, under the company written differently: the bank keys companies by lower(btrim())).
    const reported = [`${company}: walk me through a migration you led.`, `${company}: when did you push back on a deadline?`];
    for (const text of reported) {
      const row = await insertRow(request, 'company_questions', {
        company,
        role: 'Staff Engineer',
        question_text: text,
        question_type: 'behavioral',
        source: 'reported',
        shared: false,
      });
      expect(row).toMatchObject({ company_key: company.toLowerCase(), question_key: text.toLowerCase() });
      made.add('company_questions', row.id);
    }
    const sharedText = `${company}: how do you keep on-call calm?`;
    const theirs = await insertRow(request, 'company_questions', {
      user_id: randomUUID(),
      company: ` ${company.toUpperCase()} `,
      question_text: sharedText,
      question_type: 'situational',
      source: 'reported',
      shared: true,
    });
    made.add('company_questions', theirs.id);
    try {
      await recordInterviewerVoice(page);
      await signIn(page);

      // Found by name: yours and the shared one, as one company.
      await page.goto('/en/interview/bank', FIRST_LOAD);
      await page.getByRole('searchbox', { name: field(msg('QuestionBank.company')) }).fill(company);
      const listed = page.getByRole('list', { name: msg('QuestionBank.companies') }).getByRole('button', { name: new RegExp(`^${escapeRegExp(company)}`) });
      await expect(listed).toHaveCount(1);
      await expect(listed).toHaveAccessibleName(`${company} ${format('QuestionBank.companyCount', { count: 3 })}`);
      await listed.click();
      const bank = page.getByRole('region', { name: company });
      await expect(bank.getByText(format('QuestionBank.bankCount', { count: 3 }), { exact: true })).toBeVisible();
      const mine = bank.getByRole('region', { name: msg('QuestionBank.mine') });
      for (const text of reported) await expect(mine.getByRole('listitem').filter({ hasText: text })).toContainText(msg('QuestionBank.sourceReported'));
      // Shared ones never say who shared them, only how many people did.
      const shared = bank.getByRole('region', { name: msg('QuestionBank.others') }).getByRole('listitem');
      await expect(shared).toHaveCount(1);
      await expect(shared).toContainText(sharedText);
      await expect(shared).toContainText(format('QuestionBank.reports', { count: 1 }));

      // Practise these: the setup for this company offers its bank, and it's on.
      const created = page.waitForResponse((res) => res.url().endsWith('/api/interviews') && res.request().method() === 'POST');
      await bank.getByRole('button', { name: msg('QuestionBank.practice') }).click();
      const { session } = (await (await created).json()) as { session: { id: string } };
      made.interview(session.id);
      await page.waitForURL(new RegExp(`/en/interview/${session.id}\\?company=${escapeRegExp(encodeURIComponent(company))}&bank=1$`), FIRST_LOAD);
      const setup = page.locator('form').filter({ has: page.getByRole('heading', { name: msg('Practice.setup.title') }) });
      await expect(setup.getByRole('textbox', { name: field(msg('Practice.setup.company')) })).toHaveValue(company);
      const fromBank = setup.getByRole('switch', { name: fill(msg('Practice.setup.fromBank'), { company }) });
      await expect(fromBank).toHaveAttribute('aria-checked', 'true', FIRST_LOAD);
      await expect(setup.getByText(format('Practice.setup.fromBankHelp', { count: 3 }))).toBeVisible();
      await setup.getByRole('textbox', { name: field(msg('Practice.setup.role')) }).fill('Staff Engineer');

      const started = page.waitForResponse((res) => /\/practice\/start$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST');
      await setup.getByRole('button', { name: msg('Practice.setup.start') }).click();
      const startResponse = await started;
      expect(startResponse.request().postDataJSON()).toMatchObject({ role: 'Staff Engineer', company, fromBank: true, count: 5 });
      expect(startResponse.status()).toBe(201);
      const body = (await startResponse.json()) as { setup: { fromBank?: boolean }; questions: Array<{ question_text: string; order_index: number }> };
      expect(body.setup.fromBank).toBe(true);
      // Questions you were asked there come first, then the shared one, then the model writes the rest.
      const texts = body.questions.map((question) => question.question_text);
      expect(texts).toHaveLength(5);
      expect(texts.slice(0, 2).sort()).toEqual([...reported].sort());
      expect(texts[2]).toBe(sharedText);
      expect(texts.slice(3)).not.toContain(sharedText);

      // The interview opens on the first of them.
      const progress = page.getByRole('navigation', { name: msg('Practice.interview.questions') });
      await expect(progress.getByText(fill(msg('Practice.interview.progress'), { current: 1, total: 5 }))).toBeVisible(FIRST_LOAD);
      await expect(page.getByRole('region', { name: msg('Practice.interview.question') })).toContainText(texts[0]);
      const saved = await rows(request, 'interview_questions', (row) => row.session_id === session.id);
      expect([...saved].sort((a, b) => Number(a.order_index) - Number(b.order_index)).map((row) => row.question_text)).toEqual(texts);

      // Only the model's new questions join your bank (from practice), once each; the bank's own aren't copied.
      const bankNow = await rows(request, 'company_questions', (row) => row.company_key === company.toLowerCase() && row.user_id === USER.id);
      expect(bankNow.filter((row) => row.source === 'practice').map((row) => row.question_text).sort()).toEqual(texts.slice(3).sort());
      expect(bankNow.filter((row) => row.source === 'reported')).toHaveLength(2);
      watch.expectClean();
    } finally {
      await made.clean(request, company);
    }
  });

  test('Home: Next up leads to a goal, a live session and practice; the quick links, activity and usage go somewhere real', async ({ page, request }) => {
    test.setTimeout(240_000);
    const watch = watchPage(page);
    const made = tracker();
    const company = marker('home');
    // An interview in ten minutes: sooner than anything else on the shared board, so Home leads with it.
    const job = await insertRow(request, 'job_applications', {
      company,
      title: 'Data Engineer',
      stage: 'interview',
      status: 'active',
      interview_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    made.add('job_applications', job.id);
    try {
      await signIn(page);
      const nextUp = page.getByRole('region', { name: fill(msg('Home.nextUp.roleAt'), { role: 'Data Engineer', company }) });
      await expect(nextUp).toBeVisible();
      await expect(nextUp.getByText(msg('Home.nextUp.label'), { exact: true })).toBeVisible();
      await expect(nextUp).toContainText(/in 10 minutes|in 9 minutes/);
      await expect(nextUp.getByRole('heading', { name: msg('Home.nextUp.noGoal') })).toBeVisible();

      // Make a goal: the goal sheet opens filled in from the job.
      await nextUp.getByRole('link', { name: msg('Home.nextUp.makeGoal') }).click();
      await page.waitForURL(new RegExp(`/en/goals\\?fromJob=${job.id}$`), FIRST_LOAD);
      const sheet = page.getByRole('dialog', { name: msg('Goals.newGoal') });
      await expect(sheet.getByRole('textbox', { name: field(msg('Goals.company')) })).toHaveValue(company);
      await sheet.getByRole('combobox', { name: field(msg('Goals.resume')) }).selectOption(RESUME.id);
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(sheet).toHaveCount(0);
      const [goal] = await rows(request, 'goals', (row) => row.job_application_id === job.id);
      made.add('goals', goal.id);

      // Back on Home: ready for it, with the goal's résumé.
      await page.goto('/en/dashboard', FIRST_LOAD);
      await expect(nextUp.getByRole('heading', { name: msg('Home.nextUp.readyTitle') })).toBeVisible();
      await expect(nextUp).toContainText(fill(msg('Home.nextUp.resumeOn'), { name: RESUME.filename }));
      await expect(nextUp).toContainText(msg('Home.nextUp.jobOff'));
      await expect(nextUp.getByRole('link', { name: msg('Home.nextUp.editGoal') })).toHaveAttribute('href', '/en/goals');

      // Start live session: the live page with the goal picked.
      await nextUp.getByRole('link', { name: msg('Home.nextUp.startLive') }).click();
      await page.waitForURL(new RegExp(`/en/copilot/live\\?goal=${goal.id}$`), FIRST_LOAD);
      await expect(page.getByRole('region', { name: msg('SessionSetup.label') }).getByRole('combobox', { name: field(msg('SessionSetup.goal')) })).toHaveValue(goal.id, FIRST_LOAD);

      // Practice for it: a practice interview set up from the goal.
      await page.goto('/en/dashboard', FIRST_LOAD);
      const created = page.waitForResponse((res) => res.url().endsWith('/api/interviews') && res.request().method() === 'POST');
      await nextUp.getByRole('button', { name: msg('Home.nextUp.practice') }).click();
      const { session } = (await (await created).json()) as { session: { id: string } };
      made.interview(session.id);
      await page.waitForURL(new RegExp(`/en/interview/${session.id}\\?goal=${goal.id}$`), FIRST_LOAD);
      await expect(page.getByRole('textbox', { name: field(msg('Practice.setup.company')) })).toHaveValue(company);

      // Quick actions: each opens its page.
      await page.goto('/en/dashboard', FIRST_LOAD);
      const quick = page.getByRole('navigation', { name: msg('Home.quick.label') });
      const destinations: Array<[string, string]> = [
        [msg('Home.quick.practice.title'), '/en/interview'],
        [msg('Home.quick.resume.title'), '/en/resume'],
        [msg('Home.quick.jobs.title'), '/en/jobs'],
        [msg('Home.quick.analytics.title'), '/en/analytics'],
      ];
      for (const [title, href] of destinations) {
        const link = quick.getByRole('link', { name: new RegExp(`^${escapeRegExp(title)}`) });
        await expect(link).toHaveAttribute('href', href);
        const res = await page.request.get(href, { timeout: 120_000 });
        expect(res.status(), href).toBe(200);
      }
      await quick.getByRole('link', { name: new RegExp(`^${escapeRegExp(msg('Home.quick.practice.title'))}`) }).click();
      await page.waitForURL(/\/en\/interview$/, FIRST_LOAD);
      await expect(page.getByRole('heading', { level: 1, name: msg('PracticePages.title') })).toBeVisible();

      // Recent activity: practice interviews, résumés and live sessions, each a link to its page.
      await page.goto('/en/dashboard', FIRST_LOAD);
      const activity = page.getByRole('region', { name: msg('Home.activity') });
      await expect(activity.getByRole('link').first()).toBeVisible();
      const hrefs = await activity.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).toMatch(new RegExp(`^/en/(interview/${UUID}|resume|copilot/live)$`));
      expect(hrefs).toContain(`/en/interview/${session.id}`);
      await activity.getByRole('link', { name: msg('NewPractice.defaultTitle') }).first().click();
      await page.waitForURL(new RegExp(`/en/interview/${UUID}$`), FIRST_LOAD);

      // Practice interviews and résumés on Home lead to their pages too.
      await page.goto('/en/dashboard', FIRST_LOAD);
      await expect(page.getByRole('link', { name: msg('Home.allPractice') })).toHaveAttribute('href', '/en/interview');
      await expect(page.getByRole('link', { name: msg('Home.openResume') })).toHaveAttribute('href', '/en/resume');
      await expect(page.getByRole('region', { name: msg('Home.progress') })).toContainText(msg('Home.statInterviews'));

      // Usage: this month's figures, and billing (Pro here; without Stripe set up it says so plainly).
      const usage = page.getByRole('region', { name: msg('Usage.title') });
      await expect(usage).toContainText(fill(msg('Usage.plan'), { plan: msg('Usage.plans.pro') }));
      await expect(usage).toContainText(msg('Usage.copilotMonth'));
      const portal = page.waitForResponse((res) => res.url().endsWith('/api/billing/portal'));
      await usage.getByRole('button', { name: msg('Billing.manage') }).click();
      const portalResponse = await portal;
      if (portalResponse.ok()) {
        await page.waitForURL((url) => !url.pathname.startsWith('/en/dashboard'), FIRST_LOAD);
      } else {
        const known = [msg('Billing.unreachable'), ...['billing_unavailable', 'no_billing_account', 'rate_limited', 'unauthorized'].map((code) => msg(`Billing.errors.${code}`))];
        await expect(usage.getByRole('alert')).toHaveText(new RegExp(`^(${known.map(escapeRegExp).join('|')})$`));
      }
      watch.expectClean();
    } finally {
      await made.clean(request, company);
    }
  });

  test('@mobile Goals and practice on a phone', async ({ page, request, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    const watch = watchPage(page);
    await hideNextDevBadge(page);
    const made = tracker();
    const name = marker('mgoal');
    try {
      await signIn(page);
      await openGoals(page);
      await page.getByRole('button', { name: msg('Goals.newGoal') }).first().click();
      const sheet = page.getByRole('dialog', { name: msg('Goals.newGoal') });
      // On a phone the editor is a bottom sheet that fits the screen.
      const box = await sheet.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await sheet.getByRole('textbox', { name: field(msg('Goals.name')) }).fill(name);
      await sheet.getByRole('textbox', { name: field(msg('Goals.role')) }).fill('Designer');
      await sheet.getByRole('button', { name: msg('Goals.save') }).click();
      await expect(sheet).toHaveCount(0);
      const [goal] = await rows(request, 'goals', (row) => row.name === name);
      made.add('goals', goal.id);
      const card = goalCard(page, name);
      await expect(card).toBeVisible();
      const created = page.waitForResponse((res) => res.url().endsWith('/api/interviews') && res.request().method() === 'POST');
      await card.getByRole('button', { name: msg('Goals.practice') }).click();
      const { session } = (await (await created).json()) as { session: { id: string } };
      made.interview(session.id);
      await page.waitForURL(new RegExp(`/en/interview/${session.id}`), FIRST_LOAD);
      await expect(page.getByRole('textbox', { name: field(msg('Practice.setup.role')) })).toHaveValue('Designer');
      // No sideways scrolling on a phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      watch.expectClean();
    } finally {
      await made.clean(request);
    }
  });
});
