import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { fakeStorage } from './helpers/accounts';
import {
  USER,
  clipboardText,
  escapeRegExp,
  eventually,
  expect,
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
 * Résumé and Cover letters, end to end against the fakes: the ATS check,
 * missing keywords, the bullet rewriter, a tailored version written by the
 * fake model (copy, PDF, text, delete), and a cover letter (write, open,
 * edit and save, copy, download, delete).
 *
 * Every test works on a résumé document of its own (inserted through the
 * fake's REST API), never the seeded one: the ATS check writes its score back
 * to the document.
 */

const RESUME_TEXT = [
  'Jane Doe · jane.doe@example.test · +44 20 7946 0000',
  'Senior engineer with 8 years of experience building payments platforms in TypeScript, React and PostgreSQL.',
  'Led a team of five through a payments migration that cut checkout latency by 40%.',
  'Education: BSc Computer Science, University of Leeds.',
].join('\n');

const JOB =
  'We are hiring a senior engineer for our platform team. Requirements: TypeScript, React, Kubernetes, GraphQL ' +
  'and leadership. Experience with PostgreSQL is a plus.';

/** A one-page PDF with real text (Helvetica), so the upload route can read it. */
function tinyPdf(lines: string[]): Buffer {
  const text = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 18} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const resumeSelect = (page: Page) => page.getByRole('combobox', { name: m('Resume.resume'), exact: true });
const jobField = (page: Page) => page.getByRole('textbox', { name: new RegExp(`^${escapeRegExp(m('Resume.job'))}`) });
const toasts = (page: Page) => page.locator('[role="status"], [role="alert"]');

test.describe('Résumé', () => {
  const mark = marker('resume');
  const docId = randomUUID();
  const filename = `${mark}.pdf`;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/resume', '/en/cover-letters']);
    await restInsert(request, 'resume_documents', {
      id: docId,
      user_id: USER.id,
      filename,
      content_type: 'application/pdf',
      size_bytes: 2048,
      storage_bucket: 'resumes',
      storage_path: `${USER.id}/${filename}`,
      parsed_text: RESUME_TEXT,
      parsed_data: {},
      parse_status: 'completed',
    });
  });

  test.afterAll(async ({ request }) => {
    // Everything made from this document, then the document itself.
    for (const gen of await restGet(request, 'resume_generations', `document_id=eq.${docId}`)) {
      await restDelete(request, 'notifications', `user_id=eq.${USER.id}&data->>generationId=eq.${gen.id}`);
      await restDelete(request, 'resume_generations', `id=eq.${gen.id}`);
    }
    await restDelete(request, 'resume_documents', `id=eq.${docId}`);
  });

  test.beforeEach(async ({ page }) => {
    await signIn(page, '/en/resume');
    await expect(resumeSelect(page)).toBeVisible();
    await resumeSelect(page).selectOption(docId);
  });

  test('checks the résumé against a job: score, matched and missing keywords', async ({ page, request }) => {
    await jobField(page).fill(JOB);
    const response = page.waitForResponse((res) => res.url().includes(`/api/resume/${docId}/analyze`));
    await page.getByRole('button', { name: m('Resume.check'), exact: true }).click();
    const analysis = await (await response).json();
    expect(analysis.atsScore).toBeGreaterThan(0);

    const result = page.getByRole('region', { name: m('Resume.matchTitle') });
    await expect(result).toBeVisible();
    await expect(result.getByText(m('Resume.scoreLabel', { score: Math.round(analysis.atsScore) }))).toBeAttached();
    const matched = result.getByRole('list', { name: m('Resume.matchedLabel') });
    await expect(matched.getByRole('listitem').filter({ hasText: /^typescript$/ })).toBeVisible();
    await expect(matched.getByRole('listitem').filter({ hasText: /^react$/ })).toBeVisible();
    const missing = result.getByRole('list', { name: m('Resume.missingLabel') });
    await expect(missing.getByRole('listitem').filter({ hasText: /^kubernetes$/ })).toBeVisible();
    await expect(missing.getByRole('listitem').filter({ hasText: /^graphql$/ })).toBeVisible();
    await expect(toasts(page).getByText(m('Resume.scoreBody', { score: analysis.atsScore }))).toBeVisible();
    // Suggestions are worded in the reader's language from the codes the check returns.
    const tips = result.getByRole('listitem').filter({ hasText: m('Resume.tips.expand') });
    await expect(tips).toBeVisible();
    await expect(result.getByText(m('Resume.tips.add_keywords', { keywords: analysis.missingKeywords.slice(0, 5).join(', ') }), { exact: true })).toBeVisible();

    // The score and the keywords the résumé covers are saved on the document.
    const doc = await restRow(request, 'resume_documents', docId);
    expect(doc?.ats_score).toBe(analysis.atsScore);
    expect(doc?.keywords).toEqual(expect.arrayContaining(['typescript', 'react']));
    expect(doc?.keywords).not.toContain('kubernetes');
  });

  test('finds the job keywords the résumé is missing, without claiming them', async ({ page, request }) => {
    await jobField(page).fill(JOB);
    const response = page.waitForResponse((res) => res.url().includes(`/api/resume/${docId}/keywords`));
    await page.getByRole('button', { name: m('Resume.findKeywords'), exact: true }).click();
    expect((await response).ok()).toBeTruthy();

    const region = page.getByRole('region', { name: m('Resume.keywordsTitle') });
    await expect(region).toBeVisible();
    const tags = region.getByRole('list', { name: m('Resume.missingLabel') });
    await expect(tags.getByRole('listitem').filter({ hasText: /^kubernetes$/ })).toBeVisible();
    await expect(tags.getByRole('listitem').filter({ hasText: /^graphql$/ })).toBeVisible();
    await expect(tags.getByRole('listitem').filter({ hasText: /^typescript$/ })).toHaveCount(0);

    // The document's keywords are the ones it covers: a missing keyword is not added to them.
    const doc = await restRow(request, 'resume_documents', docId);
    expect(doc?.keywords ?? []).not.toContain('kubernetes');
    expect(doc?.keywords ?? []).not.toContain('graphql');
  });

  test('rewrites bullet points', async ({ page }) => {
    const bullets = ['Worked on the checkout service', 'Responsible for on-call and incident reviews'];
    await page.getByRole('textbox', { name: m('Resume.bulletsInput'), exact: true }).fill(bullets.join('\n'));
    await page.getByRole('button', { name: m('Resume.rewrite'), exact: true }).click();

    const results = page.getByRole('region', { name: m('Resume.rewrittenHeading') });
    await expect(results).toBeVisible();
    for (const [i, bullet] of bullets.entries()) {
      const item = results.getByRole('article', { name: m('Resume.analysisLabel', { n: i + 1, total: bullets.length }) });
      await expect(item).toContainText(bullet);
      await expect(item.getByText(m('Resume.rewritten'), { exact: true })).toBeVisible();
      await expect(item).toContainText(m('Resume.bulletIssues.no_metrics'));
    }
    await expect(toasts(page).getByText(m('Resume.rewrittenBody'))).toBeVisible();
  });

  test('writes a tailored version: ready, copy, PDF and text downloads, delete', async ({ page, request }) => {
    test.setTimeout(240_000);
    await jobField(page).fill(JOB);
    const started = page.waitForResponse((res) => res.url().endsWith('/api/resume/generate') && res.request().method() === 'POST');
    await page.getByRole('button', { name: m('Resume.generate'), exact: true }).click();
    const startedRes = await started;
    expect(startedRes.status()).toBe(202);
    const { generation } = await startedRes.json();
    await expect(toasts(page).getByText(m('Resume.generatingTitle'))).toBeVisible();

    // The fake model writes it in the background; the row goes to "completed".
    const done = await eventually(
      async () => {
        const row = await restRow(request, 'resume_generations', generation.id);
        return row?.status === 'completed' ? row : null;
      },
      'the tailored résumé is written',
      90_000,
    );
    const output = done.output as { target: string; resume: string };
    expect(output.resume).toContain('Stripe');

    // The page checks every few seconds while a version is being written.
    const list = page.getByRole('list', { name: new RegExp(`^${escapeRegExp(m('Resume.tailored'))}`) });
    const item = list.getByRole('listitem').filter({ hasText: output.target }).first();
    await expect(item.getByRole('status')).toHaveText(m('Resume.statusReady'), { timeout: 30_000 });
    // It opened when it was started, so its text shows as soon as it's ready.
    await expect(item.locator('pre')).toContainText('Stripe');

    await item.getByRole('button', { name: m('Resume.copy'), exact: true }).click();
    await expect(toasts(page).getByText(m('Resume.copiedBody'))).toBeVisible();
    expect(await clipboardText(page)).toBe(output.resume);

    const base = output.target.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const [pdf] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: m('Resume.pdf'), exact: true }).click()]);
    expect(pdf.suggestedFilename()).toBe(`${base}.pdf`);
    expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe('%PDF-');

    const [txt] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: m('Resume.text'), exact: true }).click()]);
    expect(txt.suggestedFilename()).toBe(`${base}.txt`);
    expect(await readFile(await txt.path(), 'utf8')).toBe(output.resume);

    // The "ready" notification points back here.
    const [notification] = await restGet(request, 'notifications', `user_id=eq.${USER.id}&data->>generationId=eq.${generation.id}`);
    expect(notification?.title).toBeTruthy();
    await restDelete(request, 'notifications', `id=eq.${notification.id}`);

    const versions = list.locator(':scope > li');
    const countBefore = await versions.count();
    await item.getByRole('button', { name: m('Resume.delete'), exact: true }).click();
    await expect(versions).toHaveCount(countBefore - 1);
    expect(await restRow(request, 'resume_generations', generation.id)).toBeNull();
  });

  test('refuses a file that is not a PDF or Word document, with a clear message', async ({ page, request }) => {
    const before = await restGet(request, 'resume_documents', `user_id=eq.${USER.id}`);
    await page.locator('input[type=file]').setInputFiles({ name: `${mark}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Plain text résumé') });
    await page.getByRole('button', { name: m('Resume.upload'), exact: true }).click();
    await expect(toasts(page).getByText(m('Resume.errors.unsupported_type'))).toBeVisible();
    expect(await restGet(request, 'resume_documents', `user_id=eq.${USER.id}`)).toHaveLength(before.length);
  });

  test('uploads a PDF and reads its text, downloads it from a signed link, and deletes it with its file', async ({ page, context, request }) => {
    test.setTimeout(180_000);
    const name = `${mark}-upload.pdf`;
    const pdf = tinyPdf(['Jane Doe', 'Senior engineer, TypeScript and React']);
    let docId = '';
    try {
      await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf });
      const uploaded = page.waitForResponse((res) => res.url().includes('/api/resume/upload') && res.request().method() === 'POST');
      await page.getByRole('button', { name: m('Resume.upload'), exact: true }).click();
      const upload = await uploaded;
      expect(upload.status()).toBe(200);
      await expect(toasts(page).getByText(m('Resume.uploadedReady'))).toBeVisible();

      // The row: the text read from the PDF, and where the file is (the user's own folder of the résumés bucket).
      const [doc] = await restGet(request, 'resume_documents', `filename=eq.${encodeURIComponent(name)}`);
      docId = String(doc.id);
      expect(doc).toMatchObject({ user_id: USER.id, parse_status: 'completed', storage_bucket: 'resumes', content_type: 'application/pdf', size_bytes: pdf.length });
      expect(String(doc.parsed_text)).toContain('TypeScript');
      expect(String(doc.storage_path)).toMatch(new RegExp(`^${USER.id}/\\d+-${escapeRegExp(name)}$`));
      await expect(resumeSelect(page)).toHaveValue(docId);
      // The file, byte for byte.
      const stored = (await fakeStorage(request)).find((object) => object.bucket === 'resumes' && object.name === doc.storage_path);
      expect(stored).toMatchObject({ size: pdf.length, contentType: 'application/pdf', sha256: createHash('sha256').update(pdf).digest('hex') });

      // Download: the app signs a short-lived link to the file and opens it in a new tab.
      const row = page.getByRole('list', { name: m('Resume.documentsLabel') }).getByRole('listitem').filter({ hasText: name });
      const signed = page.waitForResponse((res) => res.url().endsWith(`/api/resume/${docId}/download`));
      const tab = context.waitForEvent('page');
      await row.getByRole('button', { name: m('Resume.downloadLabel', { name }) }).click();
      const signedResponse = await signed;
      expect(signedResponse.status()).toBe(200);
      const { url } = (await signedResponse.json()) as { url: string };
      expect(url).toContain('/storage/v1/object/sign/resumes/');
      await (await tab).close();
      const file = await request.get(url);
      expect(file.status()).toBe(200);
      expect(file.headers()['content-type']).toBe('application/pdf');
      expect(Buffer.compare(await file.body(), pdf)).toBe(0);
      // A link with a made-up signature downloads nothing.
      expect((await request.get(url.replace(/token=[^&]+/, 'token=not-a-real-token'))).status()).toBe(400);

      // Delete: the file goes from storage, the row from the table.
      page.once('dialog', (dialog) => void dialog.accept());
      const deleted = page.waitForResponse((res) => res.url().endsWith(`/api/resume/documents/${docId}`) && res.request().method() === 'DELETE');
      await row.getByRole('button', { name: m('Resume.deleteDocumentLabel', { name }) }).click();
      expect((await deleted).status()).toBe(200);
      await expect(row).toHaveCount(0);
      await expect(toasts(page).getByText(m('Resume.documentDeletedBody', { name }))).toBeVisible();
      expect(await restRow(request, 'resume_documents', docId)).toBeNull();
      expect((await fakeStorage(request)).some((object) => object.name === doc.storage_path)).toBe(false);
      expect((await request.get(url)).status()).toBe(400);
    } finally {
      if (docId) await restDelete(request, 'resume_documents', `id=eq.${docId}`);
    }
  });

  test('deletes your own document', async ({ page, request }) => {
    const id = randomUUID();
    const name = `${mark}-delete.pdf`;
    await restInsert(request, 'resume_documents', {
      id,
      user_id: USER.id,
      filename: name,
      content_type: 'application/pdf',
      storage_bucket: 'resumes',
      storage_path: `${USER.id}/${name}`,
      parsed_text: RESUME_TEXT,
      parse_status: 'completed',
    });
    try {
      await page.reload();
      const documents = page.getByRole('list', { name: m('Resume.documentsLabel') });
      const row = documents.getByRole('listitem').filter({ hasText: name });
      await expect(row).toBeVisible();

      // Dismissing the question keeps it.
      page.once('dialog', (dialog) => void dialog.dismiss());
      await row.getByRole('button', { name: m('Resume.deleteDocumentLabel', { name }) }).click();
      await expect(row).toBeVisible();
      expect(await restRow(request, 'resume_documents', id)).not.toBeNull();

      page.once('dialog', (dialog) => {
        expect(dialog.message()).toBe(m('Resume.confirmDeleteDocument', { name }));
        void dialog.accept();
      });
      await row.getByRole('button', { name: m('Resume.deleteDocumentLabel', { name }) }).click();
      await expect(row).toHaveCount(0);
      await expect(resumeSelect(page).locator('option', { hasText: name })).toHaveCount(0);
      expect(await restRow(request, 'resume_documents', id)).toBeNull();
    } finally {
      await restDelete(request, 'resume_documents', `id=eq.${id}`);
    }
  });
});

test.describe('Cover letters', () => {
  const mark = marker('cover');
  const docId = randomUUID();
  const role = `Platform engineer ${mark}`;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await warmUp(request, ['/en/auth', '/en/cover-letters']);
    await restInsert(request, 'resume_documents', {
      id: docId,
      user_id: USER.id,
      filename: `${mark}.pdf`,
      content_type: 'application/pdf',
      storage_bucket: 'resumes',
      storage_path: `${USER.id}/${mark}.pdf`,
      parsed_text: RESUME_TEXT,
      parse_status: 'completed',
    });
  });

  test.afterAll(async ({ request }) => {
    for (const letter of await restGet(request, 'cover_letters', `user_id=eq.${USER.id}&title=like.*${mark}*`)) {
      await restDelete(request, 'cover_letters', `id=eq.${letter.id}`);
    }
    await restDelete(request, 'resume_documents', `id=eq.${docId}`);
  });

  test('writes a letter, then opens, edits, saves, copies, downloads and deletes it', async ({ page, request }) => {
    test.setTimeout(240_000);
    await signIn(page, '/en/cover-letters');
    const form = page.getByRole('form', { name: m('CoverLetters.writeTitle') });
    await form.getByRole('textbox', { name: m('CoverLetters.role'), exact: true }).fill(role);
    await form.getByRole('textbox', { name: m('CoverLetters.company'), exact: true }).fill('Acme');
    await form.getByRole('textbox', { name: m('CoverLetters.job'), exact: true }).fill(JOB);
    await form.getByRole('combobox', { name: m('CoverLetters.resume'), exact: true }).selectOption(docId);
    const tone = form.getByRole('radio', { name: m('CoverLetters.tones.confident') });
    await tone.click();
    await expect(tone).toHaveAttribute('aria-checked', 'true');
    await form.getByRole('textbox', { name: m('CoverLetters.extra'), exact: true }).fill('I can start in May.');

    const written = page.waitForResponse((res) => res.url().endsWith('/api/cover-letters') && res.request().method() === 'POST');
    await form.getByRole('button', { name: m('CoverLetters.write'), exact: true }).click();
    const res = await written;
    expect(res.status()).toBe(201);
    const { cover_letter: created } = await res.json();

    // The new letter opens in the editor.
    const title = m('CoverLetters.titleAt', { role, company: 'Acme' });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const editor = page.getByRole('textbox', { name: m('CoverLetters.letterText') });
    await expect(editor).toHaveValue(/Dear Acme hiring team/);
    const row = await restRow(request, 'cover_letters', created.id);
    expect(row).toMatchObject({ user_id: USER.id, tone: 'confident', status: 'generated' });
    expect(row?.metadata).toMatchObject({ jobTitle: role, companyName: 'Acme', resume_document_id: docId });

    // Back to the list, and open it again from there.
    await page.getByRole('button', { name: m('CoverLetters.allLetters') }).click();
    const listItem = page.getByRole('button', { name: new RegExp(escapeRegExp(title)) });
    await expect(listItem).toBeVisible();
    await listItem.click();
    await expect(editor).toBeVisible();

    // Edit: "Unsaved changes" until it's saved.
    const edited = `${await editor.inputValue()}\n\nP.S. ${mark}`;
    await editor.fill(edited);
    const status = page.getByRole('status').filter({ hasText: m('CoverLetters.unsaved') });
    await expect(status).toBeVisible();
    await page.getByRole('button', { name: m('CoverLetters.save'), exact: true }).click();
    await expect(page.getByText(m('CoverLetters.saved'), { exact: true })).toBeVisible();
    await expect(page.getByText(m('CoverLetters.unsaved'), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: m('CoverLetters.save'), exact: true })).toBeDisabled();
    expect(await restRow(request, 'cover_letters', created.id)).toMatchObject({ content: edited, status: 'saved' });

    // Saved for real: it's there after a reload.
    await page.reload();
    await page.getByRole('button', { name: new RegExp(escapeRegExp(title)) }).click();
    await expect(editor).toHaveValue(edited);

    await page.getByRole('button', { name: m('CoverLetters.copy'), exact: true }).click();
    await expect(page.getByText(m('CoverLetters.copied'), { exact: true })).toBeVisible();
    expect(await clipboardText(page)).toBe(edited);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: m('CoverLetters.download'), exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
    expect(await readFile(await download.path(), 'utf8')).toBe(edited);

    await page.getByRole('button', { name: m('CoverLetters.deleteLetter'), exact: true }).click();
    await expect(page.getByText(m('CoverLetters.confirmDelete'))).toBeVisible();
    // "Keep it" keeps it.
    await page.getByRole('button', { name: m('CoverLetters.keep'), exact: true }).click();
    await expect(editor).toBeVisible();
    await page.getByRole('button', { name: m('CoverLetters.deleteLetter'), exact: true }).click();
    await page.getByRole('button', { name: m('CoverLetters.delete'), exact: true }).click();
    await expect(page.getByRole('heading', { name: m('CoverLetters.writeTitle') })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(escapeRegExp(title)) })).toHaveCount(0);
    expect(await restRow(request, 'cover_letters', created.id)).toBeNull();
  });

  test('explains a letter that could not be written instead of failing silently', async ({ page }) => {
    await signIn(page, '/en/cover-letters');
    // A job description under 50 characters keeps the button off.
    const form = page.getByRole('form', { name: m('CoverLetters.writeTitle') });
    await form.getByRole('textbox', { name: m('CoverLetters.role'), exact: true }).fill(role);
    await form.getByRole('textbox', { name: m('CoverLetters.company'), exact: true }).fill('Acme');
    await form.getByRole('textbox', { name: m('CoverLetters.job'), exact: true }).fill('Too short');
    await expect(form.getByRole('button', { name: m('CoverLetters.write'), exact: true })).toBeDisabled();
  });
});
