// A stand-in for the OpenAI chat completions API: streams the scripted answer
// in pieces (so the test sees text arrive progressively) and answers the
// question-gate classifier with JSON. Records every request for assertions.

import http from 'node:http';
import config from './config.cjs';

const { ANSWER_PIECES, KEYS } = config;

/** Scripted JSON replies for the practice interview and cover letter tasks. */
const PRACTICE_REPLIES = {
  'TASK: cover_letter': {
    letter:
      'Dear Acme hiring team,\n\nAcme is rebuilding checkout at a scale I know well. At Stripe I led the payments migration that cut checkout latency by 40%, planning the cut-over in stages so nothing broke for customers.\n\nI also mentored four engineers and ran the on-call rotation, which taught me to make systems that other people can operate calmly.\n\nI would welcome the chance to bring that experience to your platform team.\n\nKind regards,\nE2E Candidate',
    matched_keywords: ['payments', 'latency', 'mentoring', 'on-call'],
    alignment_score: 78,
  },
  'TASK: practice_questions': {
    questions: [
      { text: 'Tell me about a time you led a project through a hard deadline.', type: 'behavioral', difficulty: 'medium' },
      { text: 'Describe a disagreement with a teammate and how you resolved it.', type: 'behavioral', difficulty: 'medium' },
      { text: 'What is a decision you made with incomplete data, and how did it turn out?', type: 'behavioral', difficulty: 'hard' },
    ],
  },
  'TASK: practice_feedback': {
    score: 7,
    verdict: 'A clear story with a real result; make your own role sharper.',
    strengths: ['Concrete outcome: latency down 40%', 'Good pacing for a spoken answer'],
    improvements: ['Say what you decided, not what the team did', 'Open with one line of context, not three'],
    stronger_answer: ['Stakes in one sentence', 'Your two key decisions', 'The measured result and what you learned'],
  },
  'TASK: practice_report': {
    overall_score: 72,
    hiring_signal: 'lean_hire',
    summary: 'Specific, well-paced answers with measurable results. Ownership and trade-offs need to come through more clearly.',
    strengths: ['Uses numbers to show impact', 'Answers stay on the question'],
    weaknesses: ['Too much "we", not enough "I"', 'Trade-offs are mentioned but not explained'],
    next_steps: ['P1: Rewrite two stories around your own decisions', 'P2: Practise a 90-second version of each answer'],
    rubric: {
      clarity: { score: 4, evidence: 'Short sentences, clear sequence', recommendation: 'Keep the opening to one line.' },
      confidence: { score: 3, evidence: 'Hedging in the third answer', recommendation: 'State the decision before the doubts.' },
      relevance: { score: 4, evidence: 'Every answer addressed the question', recommendation: 'Tie the result back to the question.' },
      structure: { score: 3, evidence: 'Result came early, action was thin', recommendation: 'Use situation, action, result in that order.' },
    },
  },
};

let requests = [];

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function startFakeOpenAI(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname === '/__state') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ requests }));
    }
    if (url.pathname === '/__reset') {
      requests = [];
      return res.end('{"ok":true}');
    }
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      res.statusCode = 404;
      return res.end('{}');
    }
    if (req.headers.authorization !== `Bearer ${KEYS.openai}`) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: 'bad key' } }));
    }

    const body = await readJson(req);
    requests.push({ model: body?.model, stream: body?.stream === true, messages: body?.messages ?? [] });
    const id = `chatcmpl-e2e-${requests.length}`;
    const created = Math.floor(Date.now() / 1000);

    if (!body?.stream) {
      // The question gate's classifier.
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: body?.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":true,"category":"behavioral"}' } }],
        }),
      );
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.write(chunk({ role: 'assistant', content: '' }));
    // Practice interviews ask for JSON; the system prompt names the task.
    const system = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : '';
    const practice = Object.entries(PRACTICE_REPLIES).find(([task]) => system.includes(task));
    for (const piece of practice ? [JSON.stringify(practice[1])] : ANSWER_PIECES) {
      await sleep(120);
      if (res.destroyed) return;
      res.write(chunk({ content: piece }));
    }
    res.write(chunk({}, 'stop'));
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
