import { expect, test, type APIRequestContext } from '@playwright/test';
import { ANSWER_PIECES, KEYS, PORTS, QUESTION, RESUME, USER } from './fakes/config.cjs';

/**
 * The live copilot loop, end to end (Step 7). Chromium's fake microphone plays
 * the interviewer (NEXT_PUBLIC_E2E_FAKE_AUDIO=1 routes it to the interviewer
 * channel), and the test follows it through capture, the STT relay, the
 * transcript, the question gate and the streamed answer.
 *
 * Fakes mode (default) also checks what reached each service. Real mode
 * (E2E_REAL=1) only checks what the candidate sees.
 */

const REAL = process.env.E2E_REAL === '1';
const EMAIL = REAL ? process.env.E2E_EMAIL ?? '' : USER.email;
const PASSWORD = REAL ? process.env.E2E_PASSWORD ?? '' : USER.password;

const fake = {
  supabase: `http://127.0.0.1:${PORTS.supabase}`,
  deepgram: `http://127.0.0.1:${PORTS.deepgram}`,
  openai: `http://127.0.0.1:${PORTS.openai}`,
};

type Row = { id: string; event_type?: string; status?: string; payload?: Record<string, unknown>; metadata?: Record<string, unknown> };
type SupabaseState = { tables: { copilot_sessions: Row[]; copilot_events: Row[] } };

async function state<T>(request: APIRequestContext, base: string): Promise<T> {
  return (await (await request.get(`${base}/__state`)).json()) as T;
}

test.describe('live copilot loop', () => {
  // The dev server compiles each route on first use, which can take longer
  // than a streamed answer is allowed to. Touch them once up front.
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    const session = '00000000-0000-4000-8000-000000000000';
    await request.get('/en/auth');
    await request.get('/en/copilot/live');
    for (const route of ['answer', 'gate', 'transcript', 'latency', 'heartbeat']) {
      await request.post(`/api/copilot/sessions/${session}/${route}`, { data: {}, timeout: 120_000 });
    }
    await request.post('/api/copilot/sessions/start', { data: {}, timeout: 120_000 });
    await request.post('/api/copilot/sessions/stop', { data: {}, timeout: 120_000 });
  });

  test.beforeEach(async ({ request }) => {
    if (REAL) return;
    await Promise.all(Object.values(fake).map((base) => request.post(`${base}/__reset`)));
  });

  test('interviewer audio → transcript → question → streamed answer', async ({ page, request }) => {
    test.skip(REAL && (!EMAIL || !PASSWORD), 'E2E_REAL=1 needs E2E_EMAIL and E2E_PASSWORD for a test user.');

    // Sign in and land on the live page.
    await page.goto('/en/auth?next=/en/copilot/live');
    const form = page.getByRole('form', { name: 'Auth form' });
    await form.getByLabel('Email').fill(EMAIL);
    await form.getByLabel('Password').fill(PASSWORD);
    await form.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL('**/copilot/live');

    // Setup step: company, role, résumé, job.
    const setup = page.getByRole('region', { name: 'Session setup' });
    await expect(setup).toBeVisible({ timeout: 60_000 });
    await setup.getByLabel('Company').fill('Acme');
    await setup.getByLabel('Role').fill('Staff Engineer');
    if (!REAL) {
      const resumePicker = setup.getByLabel('Résumé');
      await expect(resumePicker.locator('option', { hasText: RESUME.filename })).toHaveCount(1);
      await resumePicker.selectOption(RESUME.id);
    }
    await setup.getByLabel('Job description').fill('Requirements:\n- Lead large migrations\n- 5+ years in payments');
    await setup.getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByRole('button', { name: 'Stop session' })).toBeVisible({ timeout: 30_000 });

    // Listen: the fake microphone plays the interviewer.
    await page.getByRole('button', { name: 'Start listening' }).click();
    const audioPanel = page.getByRole('region', { name: 'Audio sources' });
    await expect(audioPanel.getByText('Listening', { exact: true })).toBeVisible();
    await expect(audioPanel.getByText('Transcribing', { exact: true })).toBeVisible({ timeout: 30_000 });

    // The question is picked up and answered as text streams in.
    const card = page.getByRole('region', { name: 'Current question' });
    const answer = card.getByLabel('Suggested answer');
    if (REAL) {
      await expect(card.locator('p').first()).not.toBeEmpty({ timeout: 60_000 });
      await expect(card.getByText(/^Answered/)).toBeVisible({ timeout: 60_000 });
      await expect(answer).not.toBeEmpty();
    } else {
      await expect(card).toContainText(QUESTION, { timeout: 60_000 });
      await expect(card.getByText('Behavioral')).toBeVisible();
      await expect(answer).toContainText(ANSWER_PIECES[0].trim(), { timeout: 60_000 });
      await expect(card.getByText(/^Answered · first words in \d+ ms$/)).toBeVisible();
      await expect(answer).toContainText('checkout latency dropped by 40%');
    }

    // Timing reaches the latency drawer.
    const latency = page.locator('details').filter({ hasText: /Latency/ });
    await expect(latency.locator('summary')).toContainText('1 question this session');

    if (!REAL) {
      // What reached each service on the way.
      const deepgram = await state<{ connections: Array<{ authorization: string; frames: number; maxRms: [number, number]; sentQuestion: boolean }> }>(
        request,
        fake.deepgram,
      );
      expect(deepgram.connections.length).toBeGreaterThanOrEqual(1);
      const stream = deepgram.connections[0];
      expect(stream.authorization).toBe(`Token ${KEYS.deepgram}`); // the key stayed on the server
      expect(stream.sentQuestion).toBe(true);
      expect(stream.frames).toBeGreaterThan(20);
      expect(stream.maxRms[1]).toBeGreaterThan(300); // interviewer channel carried the fake mic
      expect(stream.maxRms[0]).toBeLessThan(50); // candidate channel stayed silent

      const openai = await state<{ requests: Array<{ stream: boolean; messages: Array<{ role: string; content: string }> }> }>(
        request,
        fake.openai,
      );
      const answerCall = openai.requests.find((call) => call.stream);
      expect(answerCall).toBeDefined();
      const system = answerCall!.messages.find((message) => message.role === 'system')!.content;
      expect(system).toContain('Interviewing for: Staff Engineer at Acme');
      expect(system).toContain('Led the payments migration at Stripe');
      expect(answerCall!.messages.at(-1)!.content).toContain(`Interviewer's question: ${QUESTION}`);

      await expect
        .poll(async () => {
          const { tables } = await state<SupabaseState>(request, fake.supabase);
          const events = tables.copilot_events;
          return {
            transcript: events.some((e) => e.event_type === 'transcript' && e.payload?.text === QUESTION && e.payload?.speaker === 'interviewer'),
            answer: events.some((e) => e.event_type === 'suggestion' && e.payload?.question === QUESTION),
            latency: events.some((e) => e.payload?.kind === 'latency' && e.payload?.outcome === 'answered'),
          };
        })
        .toEqual({ transcript: true, answer: true, latency: true });
    }

    // Stop: the setup step comes back and the session records why and how fast it was.
    await page.getByRole('button', { name: 'Stop session' }).click();
    await expect(page.getByRole('region', { name: 'Session setup' })).toBeVisible();

    if (!REAL) {
      const { tables } = await state<SupabaseState>(request, fake.supabase);
      const session = tables.copilot_sessions.at(-1)!;
      expect(session.status).toBe('stopped');
      expect(session.metadata).toMatchObject({ stop_reason: 'user', latency_summary: { turns: 1, outcomes: { answered: 1 } } });
    }
  });
});
